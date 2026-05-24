import type { AgentMessage, AgentToolCall } from "@singulary/shared";
import { Check, CheckCircle2, ChevronDown, ChevronUp, Clipboard, Database, FileCode, RotateCw,Settings, Terminal, Trash2, XCircle } from "lucide-react";
import { useState } from "react";

type ChatMessageProps = {
  message: AgentMessage | { role: "assistant"; content: string; toolCalls?: null | any[] };
  isStreaming?: boolean;
};

import { useAgentStore } from "@/stores/agent.store";

export function ChatMessage({ message, isStreaming = false, isConsecutive = false }: ChatMessageProps & { isConsecutive?: boolean }) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const messageId = "id" in message ? message.id : null;
  const isError = !isUser && (messageId?.startsWith("error_") || (message.content && message.content.startsWith("Error:")));
  const { deleteMessage } = useAgentStore();

  if (isTool) {
    // We hide standalone tool messages because the assistant message's ToolCallCard already renders the result.
    return null;
  }

  const visibleToolCalls = message.toolCalls?.filter(
    tc => !["read_file", "list_files", "find", "shell_read"].includes(tc.toolName)
  ) || [];

  return (
    <div className={`group flex w-full flex-col gap-1.5 ${isUser ? "items-end" : "items-start"} ${isConsecutive ? "pt-0 pb-1" : "py-3"}`}>
      {/* Sender Label & Actions */}
      {!isConsecutive && (
        <div className={`flex items-center gap-2 px-1 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted/80">
            {isUser ? "You" : isError ? "Agent Error" : "Agent"}
          </span>
          {!isStreaming && messageId && (
            <button
              onClick={() => deleteMessage(messageId)}
              title="Delete message"
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-rose-500 outline-none"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}

      {/* Bubble Container */}
      <div
        className={`relative overflow-hidden rounded-2xl shadow-sm transition-all ${
          isUser
            ? "rounded-tr-none bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-600 text-white max-w-[85%]"
            : isError
              ? "rounded-tl-none border border-rose-500/30 bg-rose-500/5 text-rose-500 max-w-[90%]"
              : "rounded-tl-none border border-hairline bg-surface text-ink max-w-[90%]"
        }`}
      >
        {/* Text Content */}
        {(message.content || isStreaming || (visibleToolCalls.length === 0 && !message.toolCalls?.length)) && (
          <div className="px-4 py-3 prose prose-sm dark:prose-invert max-w-none text-[13.5px] leading-relaxed break-words">
            {message.content ? (
              <FormattedText text={message.content} />
            ) : isStreaming ? (
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500" style={{ animationDelay: "0ms" }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500" style={{ animationDelay: "150ms" }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500" style={{ animationDelay: "300ms" }} />
              </span>
            ) : (
              <span className="italic text-dim">No content</span>
            )}
          </div>
        )}

        {/* Render tool calls inside the same bubble */}
        {visibleToolCalls.length > 0 && (
          <div className={`flex w-full flex-col ${message.content ? "border-t border-hairline" : ""}`}>
            {visibleToolCalls.map((tc, idx) => (
              <ToolCallCard 
                key={tc.id} 
                toolCall={tc} 
                isLast={idx === visibleToolCalls.length - 1} 
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Collapsible Tool Execution Card (displayed inline inside history)
function ToolCallCard({ toolCall, isLast = false }: { toolCall: AgentToolCall, isLast?: boolean }) {
  const [open, setOpen] = useState(false);
  const isCompleted = toolCall.status === "completed";
  const isFailed = toolCall.status === "failed";
  const isRunning = toolCall.status === "running";

  return (
    <div className={`w-full transition-colors hover:bg-elevated/20 ${isLast ? "" : "border-b border-hairline"}`}>
      {/* Header */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs outline-none"
      >
        <div className="flex items-center gap-2 font-mono font-medium text-ink flex-1 truncate">
          {toolCall.toolName.startsWith("shell_") ? (
            <Terminal size={14} className="text-violet-500 shrink-0" />
          ) : toolCall.toolName === "project_settings" ? (
            <Settings size={14} className="text-amber-500 shrink-0" />
          ) : toolCall.toolName === "ws_create_service" ? (
            <Database size={14} className="text-cyan-500 shrink-0" />
          ) : toolCall.toolName === "container_restart" ? (
            <RotateCw size={14} className="text-orange-500 shrink-0" />
          ) : (
            <FileCode size={14} className="text-indigo-500 shrink-0" />
          )}
          
          {(toolCall.toolName === "write_file" || toolCall.toolName === "write_diff") && toolCall.arguments?.path ? (
            <div className="flex items-center gap-2 truncate">
              <span className="truncate">{String(toolCall.arguments.path)}</span>
              {toolCall.toolName === "write_file" && (
                <span className="text-[10px] text-emerald-500 font-bold shrink-0">
                  +{String(toolCall.arguments.content ?? "").split("\n").length}
                </span>
              )}
              {toolCall.toolName === "write_diff" && (
                <span className="text-[10px] flex gap-1 font-bold shrink-0">
                  <span className="text-emerald-500">+{String(toolCall.arguments.replacementContent ?? "").split("\n").length}</span>
                  <span className="text-rose-500">-{String(toolCall.arguments.targetContent ?? "").split("\n").length}</span>
                </span>
              )}
            </div>
          ) : toolCall.toolName === "project_settings" ? (
            <span className="truncate">Update project settings</span>
          ) : toolCall.toolName === "ws_create_service" ? (
            <span className="truncate">Create service: {String(toolCall.arguments?.name ?? "")}</span>
          ) : toolCall.toolName === "container_restart" ? (
            <span className="truncate">Restart container</span>
          ) : (
            <span className="truncate">{toolCall.toolName}</span>
          )}
        </div>
        
        <div className="flex items-center gap-2 shrink-0">
          {isRunning && (
            <span className="h-2 w-2 animate-ping rounded-full bg-amber-500" />
          )}
          {isCompleted && (
            <CheckCircle2 size={13} className="text-emerald-500" />
          )}
          {isFailed && (
            <XCircle size={13} className="text-rose-500" />
          )}
          {isFailed && <span className="text-[10px] text-muted capitalize">Failed</span>}
          {isRunning && <span className="text-[10px] text-muted capitalize">Running</span>}
          {open ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
        </div>
      </button>

      {/* Collapsible content */}
      {open && (
        <div className="border-t border-hairline bg-elevated/40 px-3 py-2 text-[11px] font-mono leading-relaxed text-muted">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted/60">Arguments:</div>
          <pre className="overflow-x-auto rounded-md bg-elevated p-2 text-ink">
            {JSON.stringify(toolCall.arguments, null, 2)}
          </pre>
          
          {!!toolCall.result && (
            <>
              <div className="mt-2 mb-1 text-[10px] font-bold uppercase tracking-wider text-muted/60">Result:</div>
              <pre className="max-h-60 overflow-y-auto overflow-x-auto rounded-md bg-elevated p-2 text-ink">
                {typeof toolCall.result === "string" ? toolCall.result : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Renders the separate 'tool' message in the history beautifully
function ToolMessageContent({ content, toolCallId }: { content: string | null; toolCallId: string | null }) {
  const [open, setOpen] = useState(false);
  let parsed: any = null;
  try {
    if (content) parsed = JSON.parse(content);
  } catch {
    // ignore parse errors
  }

  const isError = parsed && typeof parsed === "object" && parsed.error;

  return (
    <div className="my-1.5 flex w-full flex-col pl-4">
      <div className="flex items-center gap-2 text-[11px] text-muted">
        {isError ? (
          <XCircle size={12} className="text-rose-500" />
        ) : (
          <CheckCircle2 size={12} className="text-emerald-500" />
        )}
        <span className="font-semibold uppercase tracking-wider text-muted/80">Tool Executed</span>
        <button
          onClick={() => setOpen(!open)}
          className="ml-1 inline-flex items-center gap-1 font-mono text-indigo-500 hover:text-indigo-600 outline-none"
        >
          {open ? (
            <>
              <span>Hide Details</span>
              <ChevronUp size={12} />
            </>
          ) : (
            <>
              <span>Show Details</span>
              <ChevronDown size={12} />
            </>
          )}
        </button>
      </div>

      {open && (
        <div className="mt-1.5 w-full max-w-[85%] rounded-lg border border-hairline/80 bg-elevated/40 p-2 font-mono text-[11px] leading-normal">
          {toolCallId && (
            <div className="mb-1 text-[9px] font-semibold text-muted">Call ID: {toolCallId}</div>
          )}
          <pre className="max-h-40 overflow-y-auto overflow-x-auto rounded bg-elevated p-1.5 text-ink">
            {parsed ? JSON.stringify(parsed, null, 2) : content}
          </pre>
        </div>
      )}
    </div>
  );
}

// Basic formatted text renderer that creates beautiful inline code and blocks
function FormattedText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const parts = text.split(/(```[\s\S]*?```)/g);

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-2">
      {parts.map((part, index) => {
        if (part.startsWith("```")) {
          const match = part.match(/```(\w*)\n([\s\S]*?)```/);
          const lang = match ? match[1] : "";
          const code = match ? match[2] : part.slice(3, -3);

          return (
            <div key={index} className="my-1.5 overflow-hidden rounded-lg border border-hairline bg-elevated shadow-xs">
              <div className="flex items-center justify-between bg-surface px-3 py-1.5 text-[10px] font-mono font-semibold text-muted border-b border-hairline">
                <span>{lang || "code"}</span>
                <button
                  onClick={() => copyToClipboard(code)}
                  className="flex items-center gap-1 hover:text-ink outline-none"
                >
                  {copied ? (
                    <>
                      <Check size={11} className="text-emerald-500" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Clipboard size={11} />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="overflow-x-auto p-3 text-[12px] font-mono leading-relaxed text-ink bg-surface/50">
                <code>{code}</code>
              </pre>
            </div>
          );
        }

        // Inline code rendering
        const inlineParts = part.split(/(`[^`\n]+`)/g);
        return (
          <span key={index} className="whitespace-pre-wrap leading-relaxed">
            {inlineParts.map((subPart, subIndex) => {
              if (subPart.startsWith("`") && subPart.endsWith("`")) {
                return (
                  <code key={subIndex} className="mx-0.5 rounded bg-elevated px-1 py-0.5 font-mono text-[12px] font-medium text-indigo-500 border border-hairline">
                    {subPart.slice(1, -1)}
                  </code>
                );
              }
              return subPart;
            })}
          </span>
        );
      })}
    </div>
  );
}
