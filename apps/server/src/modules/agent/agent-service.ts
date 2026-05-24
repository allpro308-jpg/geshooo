import fs from "node:fs/promises";
import path from "node:path";

import { Agent, type AgentEvent, type ModelConfig } from "@singulary/agent";
import type { ChatMessage } from "@singulary/inference";
import type { AgentMessage, AgentStreamEvent, AgentToolCall } from "@singulary/shared";

import { db, nowIso } from "@/db/database";
import { recordAudit } from "@/modules/audit/audit-service";
import { resolveInferenceClient } from "@/modules/inference/inference-service";
import { estimateCostUsd } from "@/modules/inference/model-pricing";
import { assertCanCallModel } from "@/modules/policy/policy-service";
import { resolveProjectRoot } from "@/modules/projects/project-filesystem";
import { getProjectRuntimeInfo, loadProject } from "@/modules/projects/project-runtime";
import { serviceTemplates } from "@/modules/service-templates/service-templates";
import { resetAgentSessionSnapshotState } from "@/modules/snapshots/snapshot-service";
import { createId } from "@/shared/ids/id";

import { loadGitignore } from "./agent-gitignore";
import { type AgentToolContext,agentTools } from "./agent-tools";

/**
 * Bridges persistent agent_sessions / agent_messages / agent_tool_calls with
 * the pure `@singulary/agent` runtime. Streams events to subscribed clients,
 * persists everything to SQLite as it happens.
 */

const sessionStreams = new Map<string, Set<(event: AgentStreamEvent) => void>>();
const activeControllers = new Map<string, AbortController>();

export function registerSessionStream(
  sessionId: string,
  cb: (event: AgentStreamEvent) => void
): () => void {
  let set = sessionStreams.get(sessionId);
  if (!set) {
    set = new Set();
    sessionStreams.set(sessionId, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) sessionStreams.delete(sessionId);
  };
}

export function broadcastSessionEvent(sessionId: string, event: AgentStreamEvent): void {
  const set = sessionStreams.get(sessionId);
  if (!set) return;
  for (const cb of set) {
    try {
      cb(event);
    } catch {
      // ignore subscriber errors
    }
  }
}

export function cancelAgentSession(sessionId: string): void {
  const controller = activeControllers.get(sessionId);
  if (controller) {
    controller.abort();
    activeControllers.delete(sessionId);
  }
  db.prepare("UPDATE agent_sessions SET status = 'cancelled', updated_at = ? WHERE id = ?").run(
    nowIso(),
    sessionId
  );
  broadcastSessionEvent(sessionId, { type: "error", error: "Generation cancelled by user." });
  broadcastSessionEvent(sessionId, { type: "done" });
}

async function getProjectContext(projectId: string, workspaceId: string): Promise<string> {
  try {
    const project = loadProject(projectId);
    const { root } = await resolveProjectRoot(projectId);
    const matcher = await loadGitignore(root);

    const fileList: string[] = [];
    async function collect(dir: string, relDir: string) {
      if (fileList.length >= 250) return;
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const relPath = path.join(relDir, entry.name).split(path.sep).join("/");
        if (matcher.isIgnored(relPath)) continue;
        if (entry.isDirectory()) {
          await collect(path.join(dir, entry.name), relPath);
        } else if (entry.isFile()) {
          fileList.push(relPath);
        }
      }
    }
    await collect(root, "");

    let containerStatus = "unknown";
    try {
      const runtimeInfo = await getProjectRuntimeInfo(project);
      containerStatus = runtimeInfo.status;
    } catch {
      containerStatus = project.lastStatus || "unknown";
    }

    const allProjects = db
      .prepare("SELECT id, name, last_status FROM projects WHERE workspace_id = ?")
      .all(workspaceId) as Array<{ id: string; name: string; last_status: string | null }>;
    const projectsList = allProjects
      .map(
        (p) =>
          `- ${p.name} (${p.id})${p.id === projectId ? " [CURRENT]" : ""} — status: ${p.last_status || "unknown"}`
      )
      .join("\n");

    const services = db
      .prepare("SELECT name, kind, last_status FROM workspace_services WHERE workspace_id = ?")
      .all(workspaceId) as Array<{ name: string; kind: string; last_status: string | null }>;
    const servicesList =
      services.length > 0
        ? services.map((s) => `- ${s.name} (${s.kind}) — status: ${s.last_status || "unknown"}`).join("\n")
        : "No services provisioned.";

    const templatesList = serviceTemplates.map((t) => `- ${t.id}: ${t.name} (${t.kind})`).join("\n");

    return `
Project Name: ${project.name}
Project ID: ${projectId}
Runtime Environment: ${project.runtimeKind}
Container Status: ${containerStatus}
Install Command: ${project.installCommand || "(not set)"}
Start Command: ${project.startCommand || "(not set)"}
Template: ${project.templateId || "(not set)"}
Workspace absolute path on host: ${root}

### ALL WORKSPACE PROJECTS ###
${projectsList}

### WORKSPACE SERVICES ###
${servicesList}

### AVAILABLE SERVICE TEMPLATES ###
${templatesList}

### FILE TREE ###
${fileList.map((f) => `- ${f}`).join("\n")}
`;
  } catch {
    return "No project context available.";
  }
}

function loadConversation(sessionId: string): ChatMessage[] {
  const rows = db
    .prepare("SELECT * FROM agent_messages WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as Array<{
    role: ChatMessage["role"];
    content: string | null;
    tool_call_id: string | null;
    tool_calls_json: string | null;
  }>;
  return rows.map((row) => ({
    role: row.role,
    content: row.content,
    tool_call_id: row.tool_call_id ?? undefined,
    tool_calls: row.tool_calls_json ? JSON.parse(row.tool_calls_json) : undefined
  }));
}

export async function runAgentLoop(sessionId: string, userId: string): Promise<void> {
  const session = db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(sessionId) as
    | {
        id: string;
        workspace_id: string;
        project_id: string | null;
        status: string;
        model_provider: string | null;
        model_name: string | null;
      }
    | undefined;
  if (!session) throw new Error("Session not found.");
  if (session.status === "running") return;

  const controller = new AbortController();
  activeControllers.set(sessionId, controller);

  db.prepare("UPDATE agent_sessions SET status = 'running', updated_at = ? WHERE id = ?").run(
    nowIso(),
    sessionId
  );
  // New turn: clear the "pre-write snapshot already taken" mark so this turn
  // gets its own snapshot layer on the first mutation tool call.
  resetAgentSessionSnapshotState(sessionId);

  try {
    const providerRef = session.model_provider;
    const model = session.model_name;
    if (!providerRef || !model) {
      throw new Error("Model or Provider not selected for the session.");
    }
    const projectId = session.project_id;
    if (!projectId) {
      throw new Error("Agent sessions currently require a project.");
    }

    const { client, providerName, isPersonal } = resolveInferenceClient(providerRef);

    // Policy + quota gate (BYOK personal keys skip quota since they bill the user).
    if (!isPersonal) {
      assertCanCallModel({
        userId,
        workspaceId: session.workspace_id,
        provider: providerName,
        model
      });
    }

    const settingsRow = db
      .prepare("SELECT value FROM platform_settings WHERE key = 'agent_system_prompt'")
      .get() as { value: string } | undefined;
    const baseSystemPrompt = settingsRow?.value || "You are an AI coding assistant.";
    const projectContext = await getProjectContext(projectId, session.workspace_id);
    const systemPrompt = `${baseSystemPrompt}\n\n### CURRENT PROJECT CONTEXT ###\n${projectContext}`;

    const modelConfig: ModelConfig = {
      model,
      _maxLoops: 16,
      _defaultTimeout: 120,
      _llmTimeoutMs: 120_000
    };

    const agent = new Agent<AgentToolContext>(client, modelConfig, systemPrompt);
    agent.registerTools(agentTools);

    // Tool-call → assistant message id map so persisted tool_call rows
    // reference the right parent message.
    const toolCallToMessageId = new Map<string, string>();
    let currentAssistantMessageId: string | null = null;

    const onEvent = (event: AgentEvent) => {
      if (event.type === "iteration_start") {
        const newId = createId("msg");
        currentAssistantMessageId = newId;
        broadcastSessionEvent(sessionId, { type: "message_start", messageId: newId });
        return;
      }

      if (event.type === "content") {
        broadcastSessionEvent(sessionId, { type: "content_delta", delta: event.delta });
        return;
      }

      if (event.type === "assistant_message") {
        const assistantId = currentAssistantMessageId ?? createId("msg");
        if (event.message.tool_calls && event.message.tool_calls.length > 0) {
          // Persist the assistant message that triggered tool calls.
          db.prepare(
            "INSERT INTO agent_messages (id, session_id, role, content, tool_call_id, tool_calls_json, created_at) VALUES (?, ?, 'assistant', ?, NULL, ?, ?)"
          ).run(
            assistantId,
            sessionId,
            event.message.content,
            JSON.stringify(event.message.tool_calls),
            nowIso()
          );
          for (const tc of event.message.tool_calls) {
            toolCallToMessageId.set(tc.id, assistantId);
          }
        } else if (!event.intermediate) {
          // Final text message.
          db.prepare(
            "INSERT INTO agent_messages (id, session_id, role, content, tool_call_id, tool_calls_json, created_at) VALUES (?, ?, 'assistant', ?, NULL, NULL, ?)"
          ).run(assistantId, sessionId, event.message.content ?? "", nowIso());
          const savedMessage: AgentMessage = {
            id: assistantId,
            sessionId,
            role: "assistant",
            content: event.message.content,
            toolCallId: null,
            toolCalls: null,
            createdAt: nowIso()
          };
          broadcastSessionEvent(sessionId, { type: "message_end", message: savedMessage });
        }
        return;
      }

      if (event.type === "tool_call_start") {
        const parentMessageId =
          toolCallToMessageId.get(event.toolCall.id) ?? currentAssistantMessageId ?? createId("msg");
        toolCallToMessageId.set(event.toolCall.id, parentMessageId);
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = event.toolCall.function.arguments
            ? JSON.parse(event.toolCall.function.arguments)
            : {};
        } catch {
          // store raw
        }
        db.prepare(
          "INSERT OR REPLACE INTO agent_tool_calls (id, session_id, message_id, tool_name, arguments_json, result_json, status, started_at, completed_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, 'running', ?, NULL, ?)"
        ).run(
          event.toolCall.id,
          sessionId,
          parentMessageId,
          event.toolCall.function.name,
          event.toolCall.function.arguments || "{}",
          nowIso(),
          nowIso()
        );
        if (event.risk === "high" || event.risk === "dangerous") {
          recordAudit(`agent.tool_called.${event.risk}`, userId, {
            sessionId,
            toolName: event.toolCall.function.name,
            toolCallId: event.toolCall.id,
            arguments: parsedArgs,
            projectId
          });
        }
        const summary: AgentToolCall = {
          id: event.toolCall.id,
          toolName: event.toolCall.function.name,
          arguments: parsedArgs,
          result: null,
          status: "running",
          startedAt: nowIso(),
          completedAt: null
        };
        broadcastSessionEvent(sessionId, { type: "tool_call_start", toolCall: summary });
        return;
      }

      if (event.type === "tool_call_result") {
        const status = event.status === "completed" ? "completed" : "failed";
        db.prepare(
          "UPDATE agent_tool_calls SET result_json = ?, status = ?, completed_at = ? WHERE id = ?"
        ).run(JSON.stringify(event.result), status, nowIso(), event.toolCallId);
        // Persist the tool-response message so it shows up on reload.
        db.prepare(
          "INSERT INTO agent_messages (id, session_id, role, content, tool_call_id, tool_calls_json, created_at) VALUES (?, ?, 'tool', ?, ?, NULL, ?)"
        ).run(createId("msg"), sessionId, JSON.stringify(event.result), event.toolCallId, nowIso());
        broadcastSessionEvent(sessionId, {
          type: "tool_call_result",
          toolCallId: event.toolCallId,
          result: event.result,
          status
        });
        return;
      }

      if (event.type === "usage") {
        const cost = estimateCostUsd(
          model,
          event.usage.inputTokens,
          event.usage.outputTokens,
          event.usage.cachedInputTokens ?? 0
        );
        db.prepare(
          `INSERT INTO usage_records (id, user_id, organization_id, workspace_id, project_id, provider, model, input_tokens, output_tokens, total_tokens, estimated_cost, created_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          createId("use"),
          userId,
          session.workspace_id,
          projectId,
          providerName,
          model,
          event.usage.inputTokens,
          event.usage.outputTokens,
          event.usage.totalTokens,
          cost > 0 ? cost : null,
          nowIso()
        );
        return;
      }

      if (event.type === "error") {
        broadcastSessionEvent(sessionId, { type: "error", error: event.error });
        return;
      }

      if (event.type === "done") {
        const status =
          event.reason === "completed"
            ? "idle"
            : event.reason === "cancelled"
              ? "cancelled"
              : "failed";
        db.prepare("UPDATE agent_sessions SET status = ?, updated_at = ? WHERE id = ?").run(
          status,
          nowIso(),
          sessionId
        );
        broadcastSessionEvent(sessionId, { type: "done" });
        return;
      }
    };

    await agent.run({
      messages: loadConversation(sessionId),
      context: {
        projectId,
        workspaceId: session.workspace_id,
        userId,
        sessionId
      },
      signal: controller.signal,
      onEvent
    });
  } catch (error: any) {
    if (!controller.signal.aborted) {
      db.prepare("UPDATE agent_sessions SET status = 'failed', updated_at = ? WHERE id = ?").run(
        nowIso(),
        sessionId
      );
      broadcastSessionEvent(sessionId, {
        type: "error",
        error: error?.message || String(error)
      });
      broadcastSessionEvent(sessionId, { type: "done" });
    }
  } finally {
    activeControllers.delete(sessionId);
  }
}
