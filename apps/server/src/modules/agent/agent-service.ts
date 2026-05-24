import fs from "node:fs/promises";
import path from "node:path";

import { Agent, type AgentEvent, type ModelConfig, type ToolGateDecision, type ToolGateRequest } from "@singulary/agent";
import type { ChatMessage } from "@singulary/inference";
import type { AgentMessage, AgentStreamEvent, AgentToolCall, ApprovalRequest } from "@singulary/shared";

import { db, nowIso } from "@/db/database";
import { getPlatformSettings } from "@/modules/admin/platform-settings";
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
const pendingApprovalWaits = new Map<string, (status: "approved" | "rejected" | "cancelled") => void>();

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
  resolvePendingApprovalsForSession(sessionId, "cancelled", null);
  db.prepare("UPDATE agent_sessions SET status = 'cancelled', updated_at = ? WHERE id = ?").run(
    nowIso(),
    sessionId
  );
  broadcastSessionEvent(sessionId, { type: "error", error: "Generation cancelled by user." });
  broadcastSessionEvent(sessionId, { type: "done" });
}

type ApprovalRow = {
  id: string;
  session_id: string | null;
  tool_call_id: string | null;
  action: string;
  reason: string;
  risk_level: "high" | "dangerous";
  affected_project_id: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  metadata_json: string | null;
  created_at: string;
  resolved_at: string | null;
};

function mapApproval(row: ApprovalRow): ApprovalRequest {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = row.metadata_json ? JSON.parse(row.metadata_json) : {};
  } catch {
    metadata = {};
  }
  return {
    id: row.id,
    sessionId: row.session_id ?? "",
    toolCallId: row.tool_call_id ?? "",
    action: row.action,
    reason: row.reason,
    riskLevel: row.risk_level,
    affectedProjectId: row.affected_project_id,
    status: row.status,
    metadata,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at
  };
}

export function listPendingApprovals(sessionId: string): ApprovalRequest[] {
  const rows = db
    .prepare("SELECT * FROM approvals WHERE session_id = ? AND status = 'pending' ORDER BY created_at ASC")
    .all(sessionId) as ApprovalRow[];
  return rows.map(mapApproval);
}

export function resolveApproval(
  approvalId: string,
  status: "approved" | "rejected",
  resolvedBy: string
): ApprovalRequest {
  const row = db.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as ApprovalRow | undefined;
  if (!row) throw new Error("Approval request not found.");
  if (row.status !== "pending") return mapApproval(row);

  const resolvedAt = nowIso();
  db.prepare("UPDATE approvals SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?").run(
    status,
    resolvedBy,
    resolvedAt,
    approvalId
  );
  const updated = db.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as ApprovalRow;
  recordAudit(`approval.${status}`, resolvedBy, {
    approvalId,
    sessionId: row.session_id,
    toolCallId: row.tool_call_id,
    action: row.action,
    riskLevel: row.risk_level
  });
  pendingApprovalWaits.get(approvalId)?.(status);
  pendingApprovalWaits.delete(approvalId);
  if (row.session_id) {
    broadcastSessionEvent(row.session_id, { type: "approval_resolved", approvalId, status });
  }
  return mapApproval(updated);
}

function resolvePendingApprovalsForSession(
  sessionId: string,
  status: "cancelled",
  resolvedBy: string | null
): void {
  const rows = db
    .prepare("SELECT * FROM approvals WHERE session_id = ? AND status = 'pending'")
    .all(sessionId) as ApprovalRow[];
  if (rows.length === 0) return;
  const resolvedAt = nowIso();
  const update = db.prepare("UPDATE approvals SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?");
  for (const row of rows) {
    update.run(status, resolvedBy, resolvedAt, row.id);
    pendingApprovalWaits.get(row.id)?.(status);
    pendingApprovalWaits.delete(row.id);
    broadcastSessionEvent(sessionId, { type: "approval_resolved", approvalId: row.id, status });
  }
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

async function waitForApprovalDecision(
  approvalId: string,
  signal: AbortSignal
): Promise<"approved" | "rejected" | "cancelled"> {
  const current = db.prepare("SELECT status FROM approvals WHERE id = ?").get(approvalId) as
    | { status: "pending" | "approved" | "rejected" | "cancelled" }
    | undefined;
  if (!current) return "cancelled";
  if (current.status === "approved" || current.status === "rejected" || current.status === "cancelled") {
    return current.status;
  }
  if (signal.aborted) return "cancelled";

  return await new Promise((resolve) => {
    const onAbort = () => {
      pendingApprovalWaits.delete(approvalId);
      resolve("cancelled");
    };
    signal.addEventListener("abort", onAbort, { once: true });
    pendingApprovalWaits.set(approvalId, (status) => {
      signal.removeEventListener("abort", onAbort);
      resolve(status);
    });
  });
}

async function requestToolApproval(
  request: ToolGateRequest<AgentToolContext>,
  sessionId: string,
  userId: string,
  projectId: string,
  signal: AbortSignal
): Promise<ToolGateDecision | void> {
  if (request.risk !== "high" && request.risk !== "dangerous") return;
  const settings = getPlatformSettings();
  if (!settings.requireApprovalForDangerousTools) return;

  const approvalId = createId("apr");
  const createdAt = nowIso();
  const metadata = {
    toolName: request.toolName,
    toolCallId: request.toolCall.id,
    arguments: request.args,
    iteration: request.iteration
  };
  const reason = approvalReason(request.toolName, request.args, request.risk);

  db.prepare(
    `INSERT INTO approvals (
      id,
      session_id,
      tool_call_id,
      action,
      reason,
      risk_level,
      affected_project_id,
      status,
      metadata_json,
      requested_by,
      resolved_by,
      created_at,
      resolved_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, ?, NULL)`
  ).run(
    approvalId,
    sessionId,
    request.toolCall.id,
    request.toolName,
    reason,
    request.risk,
    projectId,
    JSON.stringify(metadata),
    userId,
    createdAt
  );

  db.prepare("UPDATE agent_tool_calls SET status = 'pending' WHERE id = ?").run(request.toolCall.id);
  db.prepare("UPDATE agent_sessions SET status = 'waiting_for_approval', updated_at = ? WHERE id = ?").run(
    nowIso(),
    sessionId
  );

  const approval = mapApproval(
    db.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as ApprovalRow
  );
  recordAudit("approval.requested", userId, {
    approvalId,
    sessionId,
    toolCallId: request.toolCall.id,
    action: request.toolName,
    riskLevel: request.risk,
    projectId,
    arguments: request.args
  });
  broadcastSessionEvent(sessionId, { type: "approval_requested", approval });

  const decision = await waitForApprovalDecision(approvalId, signal);
  if (decision === "approved") {
    db.prepare("UPDATE agent_sessions SET status = 'running', updated_at = ? WHERE id = ?").run(
      nowIso(),
      sessionId
    );
    db.prepare("UPDATE agent_tool_calls SET status = 'running' WHERE id = ?").run(request.toolCall.id);
    return { approved: true };
  }

  db.prepare("UPDATE agent_sessions SET status = 'running', updated_at = ? WHERE id = ?").run(
    nowIso(),
    sessionId
  );
  const message =
    decision === "cancelled"
      ? "Tool execution was cancelled before approval."
      : "Tool execution was rejected by the user.";
  return {
    approved: false,
    status: "failed",
    result: { error: message, approvalId, toolName: request.toolName }
  };
}

function approvalReason(toolName: string, args: Record<string, unknown>, risk: string): string {
  if (toolName.startsWith("shell_")) {
    return `Run shell command: ${String(args.command ?? "(command not available)")}`;
  }
  if (toolName === "delete_file") {
    return `Delete path: ${String(args.path ?? "(path not available)")}`;
  }
  if (toolName === "ws_create_service") {
    return `Create workspace service: ${String(args.name ?? args.templateId ?? "(service not available)")}`;
  }
  if (toolName === "container_restart") {
    return "Restart the project container.";
  }
  if (toolName === "restore_snapshot") {
    return `Restore snapshot: ${String(args.snapshotId ?? "(snapshot not available)")}`;
  }
  return `Execute ${risk}-risk tool: ${toolName}`;
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
      onEvent,
      beforeToolExecute: (request) => requestToolApproval(request, sessionId, userId, projectId, controller.signal)
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
