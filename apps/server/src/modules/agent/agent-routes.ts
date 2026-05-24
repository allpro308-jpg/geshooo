import { Router } from "express";

import { db, nowIso } from "@/db/database";
import { requireAuth } from "@/modules/auth/auth-middleware";
import { HttpError } from "@/shared/errors/http-error";
import { createId } from "@/shared/ids/id";

import { broadcastSessionEvent,cancelAgentSession, registerSessionStream, runAgentLoop } from "./agent-service";

export const agentRouter = Router();

function mapSession(s: any) {
  return {
    id: s.id,
    workspaceId: s.workspace_id,
    projectId: s.project_id,
    userId: s.user_id,
    status: s.status,
    title: s.title,
    modelProvider: s.model_provider,
    modelName: s.model_name,
    createdAt: s.created_at,
    updatedAt: s.updated_at
  };
}

agentRouter.use(requireAuth);

// List sessions for a project
agentRouter.get("/sessions", (req, res, next) => {
  try {
    const projectId = req.query.projectId as string;
    const workspaceId = req.query.workspaceId as string;

    let sessions;
    if (projectId) {
      sessions = db.prepare("SELECT * FROM agent_sessions WHERE project_id = ? ORDER BY updated_at DESC").all(projectId) as any[];
    } else if (workspaceId) {
      sessions = db.prepare("SELECT * FROM agent_sessions WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId) as any[];
    } else {
      sessions = db.prepare("SELECT * FROM agent_sessions ORDER BY updated_at DESC").all() as any[];
    }

    const mapped = sessions.map(mapSession);

    res.json({ sessions: mapped });
  } catch (err) {
    next(err);
  }
});

// Create a new session
agentRouter.post("/sessions", (req, res, next) => {
  try {
    const { workspaceId, projectId, modelProvider, modelName } = req.body;

    if (!workspaceId) {
      res.status(400).json({ error: "workspaceId is required." });
      return;
    }

    const id = createId("ses");
    db.prepare(
      `INSERT INTO agent_sessions (id, workspace_id, project_id, user_id, status, model_provider, model_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'idle', ?, ?, ?, ?)`
    ).run(
      id,
      workspaceId,
      projectId || null,
      req.user!.id,
      modelProvider || null,
      modelName || null,
      nowIso(),
      nowIso()
    );

    const mockSess = {
      id,
      workspace_id: workspaceId,
      project_id: projectId || null,
      user_id: req.user!.id,
      status: "idle",
      title: null,
      model_provider: modelProvider || null,
      model_name: modelName || null,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    
    res.status(201).json({ session: mapSession(mockSess) });
  } catch (err) {
    next(err);
  }
});

// Get messages for a session
agentRouter.get("/sessions/:id/messages", (req, res, next) => {
  try {
    const sessionId = req.params.id;

    const messages = db.prepare("SELECT * FROM agent_messages WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as any[];

    const mapped = messages.map((m) => {
      let toolCalls = null;
      if (m.tool_calls_json) {
        const tcs = db.prepare("SELECT * FROM agent_tool_calls WHERE message_id = ? ORDER BY created_at ASC").all(m.id) as any[];
        if (tcs.length > 0) {
          toolCalls = tcs.map((t) => ({
            id: t.id,
            toolName: t.tool_name,
            arguments: t.arguments_json ? JSON.parse(t.arguments_json) : {},
            result: t.result_json ? JSON.parse(t.result_json) : null,
            status: t.status,
            startedAt: t.started_at,
            completedAt: t.completed_at
          }));
        }
      }

      return {
        id: m.id,
        sessionId: m.session_id,
        role: m.role,
        content: m.content,
        toolCallId: m.tool_call_id,
        toolCalls,
        createdAt: m.created_at
      };
    });

    res.json({ messages: mapped });
  } catch (err) {
    next(err);
  }
});

agentRouter.patch("/sessions/:id", (req, res, next) => {
  try {
    const sessionId = req.params.id;
    const { title } = req.body;
    
    if (title !== undefined) {
      db.prepare("UPDATE agent_sessions SET title = ?, updated_at = ? WHERE id = ?").run(
        title.trim() === "" ? null : title.trim(),
        nowIso(),
        sessionId
      );
    }
    
    const session = db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(sessionId);
    if (!session) throw new HttpError(404, "session_not_found", "Session not found.");
    
    res.json({ session: mapSession(session) });
  } catch (err) {
    next(err);
  }
});

agentRouter.delete("/sessions/:id", (req, res, next) => {
  try {
    const sessionId = req.params.id;
    // Check if session exists and user has access (simplified for brevity, should check workspace/project access ideally)
    const session = db.prepare("SELECT id FROM agent_sessions WHERE id = ?").get(sessionId);
    if (!session) throw new HttpError(404, "session_not_found", "Session not found.");

    db.prepare("DELETE FROM agent_sessions WHERE id = ?").run(sessionId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Send a user message and trigger the background agent loop
agentRouter.post("/sessions/:id/messages", (req, res, next) => {
  try {
    const sessionId = req.params.id;
    const { content, modelProvider, modelName, tempId } = req.body;

    if (!content) {
      res.status(400).json({ error: "content is required." });
      return;
    }

    // Optionally update the model selection on send
    if (modelProvider && modelName) {
      db.prepare("UPDATE agent_sessions SET model_provider = ?, model_name = ?, updated_at = ? WHERE id = ?").run(
        modelProvider,
        modelName,
        nowIso(),
        sessionId
      );
    }

    // Insert user message
    const msgId = createId("msg");
    const createdAt = nowIso();
    
    db.prepare(
      "INSERT INTO agent_messages (id, session_id, role, content, tool_call_id, tool_calls_json, created_at) VALUES (?, ?, 'user', ?, NULL, NULL, ?)"
    ).run(msgId, sessionId, content, createdAt);

    // Broadcast message_added via SSE
    const savedUserMessage = {
      id: msgId,
      sessionId,
      role: "user" as const,
      content,
      toolCallId: null,
      toolCalls: null,
      createdAt
    };
    broadcastSessionEvent(sessionId, { type: "message_added", message: savedUserMessage, tempId });

    // Trigger loop in background (second-plane)
    void runAgentLoop(sessionId, req.user!.id).catch((err) => {
      // Background orchestrator errors are streamed to the client as events
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Delete a message
agentRouter.delete("/sessions/:id/messages/:messageId", (req, res, next) => {
  try {
    const { id, messageId } = req.params;
    db.prepare("DELETE FROM agent_messages WHERE id = ? AND session_id = ?").run(messageId, id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Real-time SSE event stream for a session
agentRouter.get("/sessions/:id/stream", (req, res, next) => {
  try {
    const sessionId = req.params.id;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const unsubscribe = registerSessionStream(sessionId, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    req.on("close", () => {
      unsubscribe();
    });
  } catch (err) {
    next(err);
  }
});

// Cancel a running session
agentRouter.post("/sessions/:id/cancel", (req, res, next) => {
  try {
    const sessionId = req.params.id;
    cancelAgentSession(sessionId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
