/**
 * OpenAI-compatible chat completion types.
 * This package speaks the OpenAI chat-completions REST shape across providers
 * (OpenAI, Anthropic compat, OpenRouter, Groq, xAI, DeepSeek, Ollama, etc.).
 */

export type ChatMessageRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatMessageRole;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON-encoded arguments string. */
    arguments: string;
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  totalTokens: number;
}

export interface ChatCompletionRequest {
  /** Model id, as the provider expects it. */
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string | string[];
  /**
   * Provider-specific pass-through fields. Anything in here is shallow-merged
   * into the request body before sending.
   */
  extra?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Per-call timeout in milliseconds. */
  timeoutMs?: number;
}

export interface ChatCompletionResult {
  content: string | null;
  toolCalls: ChatToolCall[] | null;
  usage: UsageInfo;
  finishReason: string | null;
}

export type ChatStreamEvent =
  | { type: "content"; delta: string }
  | { type: "tool_call_delta"; toolCall: ChatToolCall }
  | { type: "usage"; usage: UsageInfo }
  | { type: "done"; result: ChatCompletionResult };

export interface ModelInfo {
  id: string;
  ownedBy: string | null;
  /** Optional capabilities surfaced by the provider, if any. */
  capabilities?: Record<string, unknown>;
}

export interface InferenceProvider {
  /** Stable id (e.g. "openai"). Used only for logging on the client. */
  id: string;
  /** Human-readable label. */
  label?: string;
  /** Resolved base URL of the OpenAI-compatible endpoint (no trailing slash). */
  baseUrl: string;
  /** API key for `Authorization: Bearer ...`. */
  apiKey: string;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  /**
   * If the provider deviates from the OpenAI shape (e.g. anthropic native),
   * pass a custom adapter. Defaults to the OpenAI-compatible adapter.
   */
  adapter?: ProviderAdapter;
}

export interface ProviderAdapter {
  /** Build the URL for the `/chat/completions` endpoint. */
  chatCompletionsUrl(baseUrl: string): string;
  /** Build the URL for the `/models` endpoint. */
  modelsUrl(baseUrl: string): string;
  /** Build the auth header. */
  authHeader(apiKey: string): Record<string, string>;
}

export class InferenceError extends Error {
  status: number;
  body: string | undefined;
  constructor(status: number, message: string, body?: string) {
    super(message);
    this.name = "InferenceError";
    this.status = status;
    this.body = body;
  }
}
