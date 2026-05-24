import type {
  ChatCompletionRequest,
  ChatMessage,
  ChatToolCall,
  InferenceClient,
  ToolDefinition,
  UsageInfo
} from "@singulary/inference";

import type {
  AgentEvent,
  AgentRunOptions,
  AgentRunResult,
  ModelConfig,
  RunMessageRecord,
  ToolSpec
} from "./types";

const DEFAULT_MAX_LOOPS = 16;
const DEFAULT_TOOL_TIMEOUT_S = 60;

/**
 * Code agent. Owns:
 *
 * - A tool registry (`registerTool` / `unregisterTool`).
 * - The system prompt template.
 * - The model config (with `_`-prefixed agent-only keys).
 * - The tool-calling loop: ask model → run tools → feed back → repeat until
 *   no tool call or max loops reached.
 *
 * The agent does not own persistence or transport. It emits events, the host
 * decides how to broadcast them.
 */
export class Agent<TCtx = unknown> {
  private tools = new Map<string, ToolSpec<TCtx>>();

  constructor(
    private client: InferenceClient,
    private modelConfig: ModelConfig,
    private systemPrompt: string = ""
  ) {}

  // --- configuration -------------------------------------------------------

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  setModelConfig(patch: Partial<ModelConfig>): void {
    this.modelConfig = { ...this.modelConfig, ...patch };
  }

  setInferenceClient(client: InferenceClient): void {
    this.client = client;
  }

  // --- tool registry -------------------------------------------------------

  registerTool<TArgs = Record<string, unknown>>(tool: ToolSpec<TCtx, TArgs>): void {
    if (!tool.name) throw new Error("Tool requires a name.");
    this.tools.set(tool.name, tool as ToolSpec<TCtx>);
  }

  registerTools(tools: Array<ToolSpec<TCtx>>): void {
    for (const tool of tools) this.registerTool(tool);
  }

  unregisterTool(name: string): void {
    this.tools.delete(name);
  }

  listTools(): ToolSpec<TCtx>[] {
    return Array.from(this.tools.values());
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /** Build the LLM-facing tool array (drops `_`-prefixed keys + the handler). */
  buildToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }

  // --- run loop ------------------------------------------------------------

  async run(options: AgentRunOptions<TCtx>): Promise<AgentRunResult> {
    const config: ModelConfig = { ...this.modelConfig, ...(options.config ?? {}) };
    const maxLoops = config._maxLoops ?? DEFAULT_MAX_LOOPS;
    const defaultTimeoutSec = config._defaultTimeout ?? DEFAULT_TOOL_TIMEOUT_S;
    const llmTimeoutMs = config._llmTimeoutMs;

    const emit = (event: AgentEvent) => {
      try {
        options.onEvent?.(event);
      } catch {
        // never let an event handler break the loop
      }
    };

    const conversation: ChatMessage[] = [
      ...(this.systemPrompt ? [{ role: "system" as const, content: this.systemPrompt }] : []),
      ...options.messages
    ];
    const produced: RunMessageRecord[] = [];
    const totalUsage: UsageInfo = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    let iterations = 0;
    let exitReason: AgentRunResult["reason"] = "completed";

    try {
      for (let loop = 0; loop < maxLoops; loop++) {
        if (options.signal?.aborted) {
          exitReason = "cancelled";
          break;
        }

        iterations += 1;
        emit({ type: "iteration_start", iteration: iterations });

        const request = this.buildRequest(config, conversation, llmTimeoutMs, options.signal);
        const { content, toolCalls, usage } = await this.streamOnce(request, emit);

        addUsage(totalUsage, usage);
        emit({ type: "usage", usage });

        if (toolCalls && toolCalls.length > 0) {
          // Persist assistant tool-call message in conversation + emit it.
          const assistantMsg: RunMessageRecord = {
            role: "assistant",
            content: content && content.length > 0 ? content : null,
            tool_calls: toolCalls
          };
          conversation.push({
            role: "assistant",
            content: assistantMsg.content,
            tool_calls: assistantMsg.tool_calls
          });
          produced.push(assistantMsg);
          emit({ type: "assistant_message", message: assistantMsg, intermediate: true });

          // Execute each tool sequentially. Per-tool timeouts honored.
          for (const toolCall of toolCalls) {
            if (options.signal?.aborted) {
              exitReason = "cancelled";
              break;
            }
            const tool = this.tools.get(toolCall.function.name);
            const risk = tool?._risk ?? "safe";
            emit({ type: "tool_call_start", toolCall, iteration: iterations, risk });

            const { result, status, durationMs } = await this.executeTool(
              toolCall,
              options.context,
              iterations,
              defaultTimeoutSec,
              options.signal
            );

            emit({
              type: "tool_call_result",
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              result,
              status,
              durationMs,
              risk
            });

            const toolMsg: RunMessageRecord = {
              role: "tool",
              content: stringifyToolResult(result),
              tool_call_id: toolCall.id
            };
            conversation.push({
              role: "tool",
              content: toolMsg.content,
              tool_call_id: toolCall.id
            });
            produced.push(toolMsg);
          }

          if (exitReason === "cancelled") break;
          continue;
        }

        // No tool calls: this is the final assistant turn.
        const finalMsg: RunMessageRecord = {
          role: "assistant",
          content: content ?? ""
        };
        produced.push(finalMsg);
        emit({ type: "assistant_message", message: finalMsg, intermediate: false });
        exitReason = "completed";
        emit({ type: "done", reason: "completed" });
        return { reason: "completed", messages: produced, totalUsage, iterations };
      }

      if (exitReason !== "cancelled") {
        // Hit the loop cap without resolving.
        exitReason = iterations >= maxLoops ? "max_loops" : exitReason;
        emit({ type: "done", reason: exitReason });
      } else {
        emit({ type: "done", reason: "cancelled" });
      }
      return { reason: exitReason, messages: produced, totalUsage, iterations };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted = options.signal?.aborted || isAbortError(error);
      if (aborted) {
        emit({ type: "done", reason: "cancelled" });
        return { reason: "cancelled", messages: produced, totalUsage, iterations };
      }
      emit({ type: "error", error: message });
      emit({ type: "done", reason: exitReason });
      throw error;
    }
  }

  // --- internals -----------------------------------------------------------

  private buildRequest(
    config: ModelConfig,
    conversation: ChatMessage[],
    llmTimeoutMs: number | undefined,
    signal: AbortSignal | undefined
  ): ChatCompletionRequest {
    const tools = this.buildToolDefinitions();
    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (key.startsWith("_")) continue;
      if (["model", "temperature", "topP", "maxTokens", "stop"].includes(key)) continue;
      extra[key] = value;
    }
    return {
      model: config.model,
      messages: conversation,
      tools: tools.length > 0 ? tools : undefined,
      temperature: config.temperature,
      topP: config.topP,
      maxTokens: config.maxTokens,
      stop: config.stop,
      extra: Object.keys(extra).length > 0 ? extra : undefined,
      signal,
      timeoutMs: llmTimeoutMs
    };
  }

  private async streamOnce(
    request: ChatCompletionRequest,
    emit: (event: AgentEvent) => void
  ): Promise<{ content: string; toolCalls: ChatToolCall[] | null; usage: UsageInfo }> {
    let content = "";
    let toolCalls: ChatToolCall[] | null = null;
    let usage: UsageInfo = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    const stream = this.client.stream(request);
    for await (const event of stream) {
      if (event.type === "content") {
        content += event.delta;
        emit({ type: "content", delta: event.delta });
      } else if (event.type === "usage") {
        usage = event.usage;
      } else if (event.type === "done") {
        if (event.result.toolCalls) toolCalls = event.result.toolCalls;
        if (event.result.usage) usage = event.result.usage;
        if (event.result.content !== null) content = event.result.content;
      }
    }

    return { content, toolCalls, usage };
  }

  private async executeTool(
    toolCall: ChatToolCall,
    ctx: TCtx,
    iteration: number,
    defaultTimeoutSec: number,
    parentSignal: AbortSignal | undefined
  ): Promise<{ result: unknown; status: "completed" | "failed" | "timeout"; durationMs: number }> {
    const startedAt = Date.now();
    const tool = this.tools.get(toolCall.function.name);

    if (!tool) {
      return {
        result: { error: `Unknown tool '${toolCall.function.name}'` },
        status: "failed",
        durationMs: Date.now() - startedAt
      };
    }

    let parsedArgs: Record<string, unknown> = {};
    if (toolCall.function.arguments) {
      try {
        parsedArgs = JSON.parse(toolCall.function.arguments);
      } catch (error) {
        return {
          result: {
            error: `Invalid JSON arguments for ${toolCall.function.name}: ${
              error instanceof Error ? error.message : String(error)
            }`
          },
          status: "failed",
          durationMs: Date.now() - startedAt
        };
      }
    }

    const timeoutSec = tool._timeout ?? defaultTimeoutSec;
    const timeoutMs = Math.max(1, Math.round(timeoutSec * 1000));
    const toolController = new AbortController();
    const onParentAbort = () => toolController.abort(parentSignal?.reason);
    if (parentSignal) {
      if (parentSignal.aborted) toolController.abort(parentSignal.reason);
      else parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      toolController.abort(new Error(`Tool '${tool.name}' timed out after ${timeoutSec}s`));
    }, timeoutMs);

    try {
      const toolCtx = {
        ctx,
        signal: toolController.signal,
        toolCallId: toolCall.id,
        iteration
      };
      if (tool._preExecute) {
        await Promise.resolve(tool._preExecute(parsedArgs, toolCtx));
      }
      const result = await Promise.resolve(tool.handler(parsedArgs, toolCtx));
      return { result, status: "completed", durationMs: Date.now() - startedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (timedOut) {
        return {
          result: { error: message },
          status: "timeout",
          durationMs: Date.now() - startedAt
        };
      }
      return {
        result: { error: message },
        status: "failed",
        durationMs: Date.now() - startedAt
      };
    } finally {
      clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener("abort", onParentAbort);
    }
  }
}

// --- helpers ---------------------------------------------------------------

function addUsage(target: UsageInfo, delta: UsageInfo): void {
  target.inputTokens += delta.inputTokens || 0;
  target.outputTokens += delta.outputTokens || 0;
  target.totalTokens += delta.totalTokens || 0;
  if (delta.cachedInputTokens) {
    target.cachedInputTokens = (target.cachedInputTokens ?? 0) + delta.cachedInputTokens;
  }
}

function stringifyToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result ?? null);
  } catch {
    return String(result);
  }
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  return name === "AbortError";
}
