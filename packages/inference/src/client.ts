import { openAIAdapter } from "./adapters";
import {
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatStreamEvent,
  ChatToolCall,
  InferenceError,
  InferenceProvider,
  ModelInfo,
  UsageInfo
} from "./types";

/**
 * Pure OpenAI-compatible REST client for one configured provider.
 *
 * - No database access, no encryption, no business rules.
 * - Streams chunks via an async generator. Caller decides what to do with them.
 * - `listModels()` returns ALL models the provider exposes. Filtering by
 *   platform policy is the host's responsibility.
 */
export class InferenceClient {
  readonly provider: InferenceProvider;
  private adapter;

  constructor(provider: InferenceProvider) {
    this.provider = provider;
    this.adapter = provider.adapter ?? openAIAdapter;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...this.adapter.authHeader(this.provider.apiKey),
      ...this.provider.headers,
      ...extra
    };
  }

  /** List ALL models from the provider's `/models` endpoint. No filtering. */
  async listModels(options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ModelInfo[]> {
    const url = this.adapter.modelsUrl(this.provider.baseUrl);
    const signal = mergeAbortSignals(options.signal, timeoutSignal(options.timeoutMs ?? 8000));

    const res = await fetch(url, { headers: this.headers(), signal });
    if (!res.ok) {
      const body = await safeText(res);
      throw new InferenceError(res.status, `models request failed: ${res.status}`, body);
    }

    const payload = (await res.json()) as {
      data?: Array<{ id?: string; owned_by?: string | null; ownedBy?: string | null }>;
    };
    return (payload.data ?? []).flatMap((model) =>
      model.id
        ? [
            {
              id: model.id,
              ownedBy: model.owned_by ?? model.ownedBy ?? null
            }
          ]
        : []
    );
  }

  /** Non-streaming chat completion. */
  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const url = this.adapter.chatCompletionsUrl(this.provider.baseUrl);
    const body = buildBody(request, false);
    const signal = mergeAbortSignals(request.signal, timeoutSignal(request.timeoutMs));

    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal
    });

    if (!res.ok) {
      const text = await safeText(res);
      throw new InferenceError(res.status, `chat.completions failed: ${res.status}`, text);
    }

    const data = (await res.json()) as ChatCompletionsResponse;
    return parseNonStreaming(data);
  }

  /**
   * Streaming chat completion. Yields content/tool-call deltas as they arrive,
   * and finally a `done` event with the assembled result.
   */
  async *stream(request: ChatCompletionRequest): AsyncGenerator<ChatStreamEvent, ChatCompletionResult, void> {
    const url = this.adapter.chatCompletionsUrl(this.provider.baseUrl);
    const body = buildBody(request, true);
    const signal = mergeAbortSignals(request.signal, timeoutSignal(request.timeoutMs));

    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal
    });

    if (!res.ok) {
      const text = await safeText(res);
      throw new InferenceError(res.status, `chat.completions stream failed: ${res.status}`, text);
    }
    if (!res.body) {
      throw new InferenceError(res.status, "chat.completions stream missing body");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf8");

    let buffer = "";
    let content = "";
    const toolCalls: ChatToolCall[] = [];
    let usage: UsageInfo = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let finishReason: string | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx = buffer.indexOf("\n");
        while (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          newlineIdx = buffer.indexOf("\n");

          if (!line || !line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;

          let parsed: ChatCompletionsStreamChunk;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          const choice = parsed.choices?.[0];
          const delta = choice?.delta;

          if (delta?.content) {
            content += delta.content;
            yield { type: "content", delta: delta.content };
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.index === undefined) continue;
              const existing =
                toolCalls[tc.index] ??
                (toolCalls[tc.index] = {
                  id: tc.id ?? "",
                  type: "function" as const,
                  function: { name: tc.function?.name ?? "", arguments: "" }
                });
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.function.name = tc.function.name;
              if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
              yield { type: "tool_call_delta", toolCall: { ...existing, function: { ...existing.function } } };
            }
          }

          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
          }

          if (parsed.usage) {
            usage = readUsage(parsed.usage);
            yield { type: "usage", usage };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const cleanedToolCalls = toolCalls.filter(Boolean);
    const result: ChatCompletionResult = {
      content: content.length > 0 ? content : null,
      toolCalls: cleanedToolCalls.length > 0 ? cleanedToolCalls : null,
      usage: estimateUsageIfEmpty(usage, request, content, cleanedToolCalls),
      finishReason
    };
    yield { type: "done", result };
    return result;
  }
}

// --- helpers ---------------------------------------------------------------

interface ChatCompletionsResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ChatToolCall[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

interface ChatCompletionsStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: ChatCompletionsResponse["usage"];
}

function buildBody(request: ChatCompletionRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages
  };
  if (request.tools && request.tools.length > 0) body.tools = request.tools;
  if (request.toolChoice !== undefined) body.tool_choice = request.toolChoice;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.topP !== undefined) body.top_p = request.topP;
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  if (request.stop !== undefined) body.stop = request.stop;
  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  if (request.extra) {
    for (const [k, v] of Object.entries(request.extra)) body[k] = v;
  }
  return body;
}

function parseNonStreaming(data: ChatCompletionsResponse): ChatCompletionResult {
  const choice = data.choices?.[0];
  const content = choice?.message?.content ?? null;
  const toolCalls = choice?.message?.tool_calls ?? null;
  const usage = data.usage
    ? readUsage(data.usage)
    : { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  return {
    content,
    toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : null,
    usage,
    finishReason: choice?.finish_reason ?? null
  };
}

function readUsage(raw: NonNullable<ChatCompletionsResponse["usage"]>): UsageInfo {
  const input = raw.prompt_tokens ?? 0;
  const output = raw.completion_tokens ?? 0;
  const total = raw.total_tokens ?? input + output;
  return {
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: raw.prompt_tokens_details?.cached_tokens,
    totalTokens: total
  };
}

function estimateUsageIfEmpty(
  usage: UsageInfo,
  request: ChatCompletionRequest,
  content: string,
  toolCalls: ChatToolCall[]
): UsageInfo {
  if (usage.totalTokens > 0) return usage;
  const inputChars = request.messages.reduce(
    (acc, msg) => acc + (typeof msg.content === "string" ? msg.content.length : 0),
    0
  );
  const outputChars =
    content.length + toolCalls.reduce((acc, tc) => acc + JSON.stringify(tc).length, 0);
  const inputTokens = Math.max(1, Math.round(inputChars / 4));
  const outputTokens = Math.max(1, Math.round(outputChars / 4));
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

async function safeText(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}

function timeoutSignal(ms?: number): AbortSignal | undefined {
  if (!ms || ms <= 0) return undefined;
  return AbortSignal.timeout(ms);
}

function mergeAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const real = signals.filter((s): s is AbortSignal => Boolean(s));
  if (real.length === 0) return undefined;
  if (real.length === 1) return real[0];
  const controller = new AbortController();
  for (const sig of real) {
    if (sig.aborted) {
      controller.abort(sig.reason);
      return controller.signal;
    }
    sig.addEventListener(
      "abort",
      () => controller.abort(sig.reason),
      { once: true }
    );
  }
  return controller.signal;
}
