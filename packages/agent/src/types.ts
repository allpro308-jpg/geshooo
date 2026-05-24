import type {
  ChatMessage,
  ChatToolCall,
  ToolDefinition,
  UsageInfo
} from "@singulary/inference";

/**
 * Tool handler signature. Receives parsed JSON arguments and a context object
 * the host can use to thread per-run data (project id, user id, etc.).
 */
export type ToolHandler<TCtx = unknown, TArgs = Record<string, unknown>> = (
  args: TArgs,
  ctx: ToolContext<TCtx>
) => Promise<unknown> | unknown;

export interface ToolContext<TCtx = unknown> {
  /** Host-provided per-run context (whatever you pass to `Agent.run`). */
  ctx: TCtx;
  /** AbortSignal that fires when the run is cancelled or the tool times out. */
  signal: AbortSignal;
  /** Tool call id from the LLM. */
  toolCallId: string;
  /** Iteration number of the current loop (1-based). */
  iteration: number;
}

/**
 * Tool definition used both as the LLM-facing schema and as the local
 * implementation. Keys prefixed with `_` are agent-only and are stripped
 * before the definition is sent to the model.
 */
export type ToolRiskLevel = "safe" | "medium" | "high" | "dangerous";

export interface ToolSpec<TCtx = unknown, TArgs = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: ToolHandler<TCtx, TArgs>;
  /** Per-tool timeout in SECONDS. Falls back to `_defaultTimeout` on the model config. */
  _timeout?: number;
  /** Risk classification. The agent loop emits it on tool_call events for the host to audit/gate. */
  _risk?: ToolRiskLevel;
  /** Optional pre-execution hook the host can use to snapshot, audit, or block. */
  _preExecute?: (args: TArgs, ctx: ToolContext<TCtx>) => Promise<void> | void;
}

/**
 * Model configuration. Anything starting with `_` is agent-local. Everything
 * else is passed through to the OpenAI-compatible chat completion call.
 */
export interface ModelConfig {
  model: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string | string[];

  /** Maximum tool-calling loop iterations. */
  _maxLoops?: number;
  /** Default per-tool timeout in seconds. */
  _defaultTimeout?: number;
  /** Per-call timeout in milliseconds for the LLM HTTP call itself. */
  _llmTimeoutMs?: number;

  /** Any other OpenAI-compatible field. */
  [key: string]: unknown;
}

export interface RunMessageRecord {
  role: ChatMessage["role"];
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

/**
 * Real-time events emitted by `Agent.run()`.
 *
 * - `content`: streaming text chunk.
 * - `tool_call_start`: an assembled tool call is about to execute.
 * - `tool_call_result`: tool finished (or failed / timed out).
 * - `assistant_message`: final or intermediate assistant message persisted.
 * - `usage`: token usage from an LLM call.
 * - `error`: terminal error.
 * - `done`: loop finished cleanly.
 */
export type AgentEvent<TToolResult = unknown> =
  | { type: "iteration_start"; iteration: number }
  | { type: "content"; delta: string }
  | { type: "tool_call_start"; toolCall: ChatToolCall; iteration: number; risk: ToolRiskLevel }
  | {
      type: "tool_call_result";
      toolCallId: string;
      toolName: string;
      result: TToolResult;
      status: "completed" | "failed" | "timeout";
      durationMs: number;
      risk: ToolRiskLevel;
    }
  | { type: "assistant_message"; message: RunMessageRecord; intermediate: boolean }
  | { type: "usage"; usage: UsageInfo }
  | { type: "error"; error: string }
  | { type: "done"; reason: "completed" | "cancelled" | "max_loops" };

export type ToolGateDecision =
  | { approved: true }
  | {
      approved: false;
      result: unknown;
      status?: "completed" | "failed";
    };

export type ToolGateRequest<TCtx = unknown> = {
  toolCall: ChatToolCall;
  toolName: string;
  args: Record<string, unknown>;
  risk: ToolRiskLevel;
  iteration: number;
  context: TCtx;
};

export interface AgentRunOptions<TCtx = unknown> {
  /** Existing conversation. The system prompt is prepended automatically. */
  messages: ChatMessage[];
  /** Per-run context passed to every tool handler. */
  context: TCtx;
  /** Cancellation. */
  signal?: AbortSignal;
  /** Per-run override of model config keys. */
  config?: Partial<ModelConfig>;
  /** Event sink. Called synchronously as events occur. */
  onEvent?: (event: AgentEvent) => void;
  /** Optional host gate. Return approved=false to skip local tool execution and feed the result to the model. */
  beforeToolExecute?: (request: ToolGateRequest<TCtx>) => Promise<ToolGateDecision | void> | ToolGateDecision | void;
}

export interface AgentRunResult {
  /** Why the loop exited. */
  reason: "completed" | "cancelled" | "max_loops";
  /** Conversation messages produced during this run (in order). */
  messages: RunMessageRecord[];
  /** Sum of token usage across LLM calls in this run. */
  totalUsage: UsageInfo;
  /** Number of LLM iterations that ran. */
  iterations: number;
}

export { ChatMessage, ChatToolCall, ToolDefinition, UsageInfo };
