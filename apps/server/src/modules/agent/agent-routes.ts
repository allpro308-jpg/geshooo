import { Router } from "express";
import { z } from "zod";

import { db, nowIso } from "@/db/database";
import { requireAuth } from "@/modules/auth/auth-middleware";
import { HttpError } from "@/shared/errors/http-error";
import { createId } from "@/shared/ids/id";

import {
  broadcastSessionEvent,
  cancelAgentSession,
  listPendingApprovals,
  registerSessionStream,
  resolveApproval,
  runAgentLoop
} from "./agent-service";

export const agentRouter = Router();

function mapSession(s: any) {
  return {
    id: s.id,
    workspaceId: s.workspace_id,
    projectId: s.project_id,
    userId: s.user_id,
    status: s.status,
    title: s.title,
    approvalMode: s.approval_mode === "auto" ? "auto" : "manual",
    modelProvider: s.model_provider,
    modelName: s.model_name,
    createdAt: s.created_at,
    updatedAt: s.updated_at
  };
}

function normalizeApprovalMode(value: unknown): "manual" | "auto" | null {
  if (value === "manual" || value === "auto") return value;
  return null;
}

agentRouter.use(requireAuth);

function ensureSessionAccess(sessionId: string, userId: string): void {
  const row = db
    .prepare(
      `SELECT 1
       FROM agent_sessions
       JOIN workspace_groups ON workspace_groups.workspace_id = agent_sessions.workspace_id
       JOIN group_members ON group_members.group_id = workspace_groups.group_id
       WHERE agent_sessions.id = ? AND group_members.user_id = ?
       LIMIT 1`
    )
    .get(sessionId, userId);
  if (!row) throw new HttpError(404, "session_not_found", "Session not found.");
}

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
    const { workspaceId, projectId, modelProvider, modelName, approvalMode } = req.body;

    if (!workspaceId) {
      res.status(400).json({ error: "workspaceId is required." });
      return;
    }

    const id = createId("ses");
    const mode = normalizeApprovalMode(approvalMode) ?? "manual";
    db.prepare(
      `INSERT INTO agent_sessions (id, workspace_id, project_id, user_id, status, approval_mode, model_provider, model_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'idle', ?, ?, ?, ?, ?)`
    ).run(
      id,
      workspaceId,
      projectId || null,
      req.user!.id,
      mode,
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
      approval_mode: mode,
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
    ensureSessionAccess(sessionId, req.user!.id);

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
    ensureSessionAccess(sessionId, req.user!.id);
    const { title, approvalMode } = req.body;

    if (title !== undefined) {
      db.prepare("UPDATE agent_sessions SET title = ?, updated_at = ? WHERE id = ?").run(
        title.trim() === "" ? null : title.trim(),
        nowIso(),
        sessionId
      );
    }

    if (approvalMode !== undefined) {
      const mode = normalizeApprovalMode(approvalMode);
      if (!mode) throw new HttpError(400, "invalid_approval_mode", "approvalMode must be 'manual' or 'auto'.");
      db.prepare("UPDATE agent_sessions SET approval_mode = ?, updated_at = ? WHERE id = ?").run(
        mode,
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
    ensureSessionAccess(sessionId, req.user!.id);
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
    ensureSessionAccess(sessionId, req.user!.id);
    const { content, modelProvider, modelName, tempId, approvalMode } = req.body;

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

    // Apply the current approval mode before kicking off the loop so the
    // background runner reads the user's latest preference.
    const mode = normalizeApprovalMode(approvalMode);
    if (mode) {
      db.prepare("UPDATE agent_sessions SET approval_mode = ?, updated_at = ? WHERE id = ?").run(
        mode,
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
    ensureSessionAccess(id, req.user!.id);
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
    ensureSessionAccess(sessionId, req.user!.id);

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

agentRouter.get("/sessions/:id/approvals", (req, res, next) => {
  try {
    const sessionId = req.params.id;
    ensureSessionAccess(sessionId, req.user!.id);
    res.json({ approvals: listPendingApprovals(sessionId) });
  } catch (err) {
    next(err);
  }
});

agentRouter.post("/approvals/:id/resolve", (req, res, next) => {
  try {
    const approvalId = req.params.id;
    const body = z.object({ decision: z.enum(["approved", "rejected"]) }).parse(req.body);
    const row = db.prepare("SELECT session_id FROM approvals WHERE id = ?").get(approvalId) as
      | { session_id: string | null }
      | undefined;
    if (!row?.session_id) throw new HttpError(404, "approval_not_found", "Approval request not found.");
    ensureSessionAccess(row.session_id, req.user!.id);
    const approval = resolveApproval(approvalId, body.decision, req.user!.id);
    res.json({ approval });
  } catch (err) {
    next(err);
  }
});

// Cancel a running session
agentRouter.post("/sessions/:id/cancel", (req, res, next) => {
  try {
    const sessionId = req.params.id;
    ensureSessionAccess(sessionId, req.user!.id);
    cancelAgentSession(sessionId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
