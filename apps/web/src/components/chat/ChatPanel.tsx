import type { AgentApprovalMode, ApprovalRequest } from "@singulary/shared";
import {
  AlertTriangle,
  Bug,
  Check,
  ChevronDown,
  Cpu,
  FileCode,
  Pencil,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Zap
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { useAgentStore } from "@/stores/agent.store";

import { ChatMessage, messageHasVisibleContent } from "./ChatMessage";
import { ModelSelectorModal } from "./ModelSelectorModal";

export function ChatPanel() {
  const params = useParams<{ id: string; projectId?: string }>();
  const workspaceId = params.id;
  const projectId = params.projectId;

  const {
    sessions,
    activeSessionId,
    activeSession,
    messages,
    pendingApprovals,
    providers,
    isLoadingSessions,
    isLoadingMessages,
    isGenerating,
    chatPanelOpen,
    chatPanelWidth,
    selectedProvider,
    selectedModel,
    approvalMode,
    debugMode,
    streamingMessageId,
    streamingContent,
    streamingToolCalls,
    setChatPanelWidth,
    fetchSessions,
    createSession,
    selectSession,
    sendMessage,
    cancelGeneration,
    resolveApproval,
    fetchModels,
    renameSession,
    removeSession,
    setApprovalMode,
    setDebugMode
  } = useAgentStore();

  const [isResizing, setIsResizing] = useState(false);
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load sessions and models
  useEffect(() => {
    if (projectId && workspaceId) {
      fetchSessions(projectId, workspaceId);
      fetchModels();
    }
  }, [projectId, workspaceId]);

  // Auto-create a session if none exist
  useEffect(() => {
    if (!isLoadingSessions && sessions.length === 0 && projectId && workspaceId && !activeSessionId) {
      createSession(workspaceId, projectId);
    }
  }, [sessions, isLoadingSessions, projectId, workspaceId, activeSessionId]);

  // Auto-scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, streamingToolCalls]);

  // Handle textarea height adjustment
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(128, textareaRef.current.scrollHeight)}px`;
    }
  }, [inputValue]);

  if (!chatPanelOpen || !projectId) return null;

  // Handle panel resizing
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = chatPanelWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setChatPanelWidth(startX > moveEvent.clientX ? startWidth - deltaX : startWidth + deltaX);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isGenerating || !activeSessionId || !selectedModel) return;
    const content = inputValue.trim();
    setInputValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    await sendMessage(content);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!selectedModel) {
        setIsModelSelectorOpen(true);
        return;
      }
      handleSend();
    }
  };

  const handleNewSession = async () => {
    if (workspaceId && projectId) {
      await createSession(workspaceId, projectId);
    }
  };

  // Pre-fill quick prompts
  const starterPrompts = [
    { text: "List the files in this project", icon: <FileCode size={14} className="text-indigo-400" /> },
    { text: "Help me write a README.md", icon: <FileCode size={14} className="text-pink-400" /> },
    { text: "Check project dependencies", icon: <Terminal size={14} className="text-emerald-400" /> }
  ];

  // Active provider's quota warning (if used > 90% of user limit)
  const currentProviderConfig = providers.find((p) => p.provider === selectedProvider);
  const quotaWarning =
    currentProviderConfig?.quota?.userLimit &&
    currentProviderConfig.quota.userUsed / currentProviderConfig.quota.userLimit > 0.9;

  return (
    <div
      className={`relative flex h-full shrink-0 flex-col border-r border-hairline bg-surface overflow-hidden ${
        isResizing ? "" : "transition-[width] duration-200 ease-in-out"
      }`}
      style={{ width: `${chatPanelWidth}px` }}
    >
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between px-4 pt-1 gap-3 bg-surface/50 backdrop-blur-md z-10">
        <div className="relative flex flex-1 items-center px-1 text-xs min-w-0">
          {isEditingTitle ? (
            <div className="flex w-full items-center gap-1">
              <input
                type="text"
                autoFocus
                value={editTitleValue}
                onChange={(e) => setEditTitleValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    renameSession(activeSessionId!, editTitleValue);
                    setIsEditingTitle(false);
                  }
                  if (e.key === "Escape") {
                    setIsEditingTitle(false);
                  }
                }}
                className="w-full bg-elevated border border-accent rounded px-2 py-1 outline-none text-[13.5px] font-bold tracking-tight text-ink"
              />
              <button
                onClick={() => {
                  renameSession(activeSessionId!, editTitleValue);
                  setIsEditingTitle(false);
                }}
                className="focus-ring grid h-8 w-8 place-items-center rounded-lg border border-hairline bg-elevated text-muted hover:text-emerald-500 transition-colors outline-none"
              >
                <Check size={15} />
              </button>
            </div>
          ) : (
            <select
              value={activeSessionId || ""}
              onChange={(e) => selectSession(e.target.value)}
              className="bg-transparent border-0 outline-none text-[13.5px] font-bold tracking-tight text-ink w-full cursor-pointer truncate focus:ring-0 hover:text-indigo-400 transition-colors"
            >
              {sessions.map((s, idx) => (
                <option key={s.id} value={s.id} className="font-medium bg-surface text-ink">
                  {s.title || `Chat ${sessions.length - idx}`}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleNewSession}
            disabled={isGenerating}
            title="New chat"
            className="focus-ring grid h-8 w-8 place-items-center rounded-lg border border-hairline bg-elevated text-muted hover:text-ink disabled:opacity-50 transition-colors outline-none"
          >
            <Plus size={15} />
          </button>

          {activeSessionId && !isEditingTitle && (
            <button
              onClick={() => {
                setEditTitleValue(activeSession?.title || "");
                setIsEditingTitle(true);
              }}
              title="Rename chat"
              className="focus-ring grid h-8 w-8 place-items-center rounded-lg border border-hairline bg-elevated text-muted hover:text-amber-500 transition-colors outline-none"
            >
              <Pencil size={15} />
            </button>
          )}

          {activeSessionId && !isEditingTitle && (
            <button
              onClick={() => {
                if (confirm("Are you sure you want to delete this chat?")) {
                  removeSession(activeSessionId);
                }
              }}
              title="Delete chat"
              className="focus-ring grid h-8 w-8 place-items-center rounded-lg border border-hairline bg-elevated text-muted hover:text-rose-500 transition-colors outline-none"
            >
              <Trash2 size={15} />
            </button>
          )}

          <button
            onClick={() => setDebugMode(!debugMode)}
            title={
              debugMode
                ? "Debug mode ON — click to hide noisy tool calls"
                : "Debug mode OFF — click to show all tool calls"
            }
            aria-pressed={debugMode}
            className={`focus-ring grid h-8 w-8 place-items-center rounded-lg border transition-colors outline-none ${
              debugMode
                ? "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                : "border-hairline bg-elevated text-muted hover:text-ink"
            }`}
          >
            <Bug size={15} />
          </button>
        </div>
      </header>



      {/* Message History area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
        {isLoadingMessages ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-dim">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <span>Loading message history...</span>
          </div>
        ) : messages.length === 0 ? (
          // Welcome / Starter Prompts screen
          <div className="flex h-full flex-col justify-center px-2 py-8 text-center">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-hairline bg-elevated text-accent">
              <Sparkles size={22} className="animate-pulse" />
            </div>
            <h3 className="text-sm font-bold tracking-tight text-ink">Welcome to Singulary</h3>
            <p className="mt-1 text-xs text-muted max-w-[240px] mx-auto leading-relaxed">
              Ask questions, examine files, or run terminal tasks inside your sandbox container.
            </p>

            <div className="mt-6 flex flex-col gap-2">
              {starterPrompts.map((prompt, index) => (
                <button
                  key={index}
                  onClick={() => setInputValue(prompt.text)}
                  className="flex items-center gap-2.5 rounded-xl border border-hairline bg-elevated/40 p-3 text-left text-xs font-medium text-muted transition-all hover:border-muted/30 hover:bg-elevated hover:text-ink outline-none"
                >
                  {prompt.icon}
                  <span className="truncate">{prompt.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {(() => {
              // Build the list of items to render in chronological order.
              // We deduplicate by id (the optimistic message_start commit + DB
              // reload can produce duplicates with the same server id) and
              // drop messages whose entire content is invisible at the current
              // debug level (e.g. an assistant turn whose only tool call is
              // the internal set_change_title).
              const items: any[] = [];
              const seenIds = new Set<string>();
              for (const msg of messages) {
                if (seenIds.has(msg.id)) continue;
                seenIds.add(msg.id);
                if (!messageHasVisibleContent(msg, debugMode)) continue;
                items.push(msg);
              }

              // Append the live streaming bubble for the current iteration.
              if (isGenerating) {
                const liveId = streamingMessageId ?? "streaming";
                const liveMsg = {
                  id: liveId,
                  role: "assistant" as const,
                  content: streamingContent || null,
                  toolCalls:
                    streamingToolCalls.length > 0 ? streamingToolCalls : null,
                  isStreaming: true
                };
                if (!seenIds.has(liveId) && messageHasVisibleContent(liveMsg, debugMode)) {
                  items.push(liveMsg);
                }
              }

              // Suppress the "Agent" label on consecutive assistant bubbles
              // so a multi-iteration turn reads as one continuous response
              // even though each bubble is a separate message.
              let prevRole: string | null = null;
              return items.map((msg) => {
                const isConsecutive = prevRole === "assistant" && msg.role === "assistant";
                prevRole = msg.role;
                return (
                  <ChatMessage
                    key={msg.id}
                    message={msg}
                    isStreaming={Boolean(msg.isStreaming)}
                    isConsecutive={isConsecutive}
                    debug={debugMode}
                  />
                );
              });
            })()}

            {/* Persistent thinking indicator — pinned below the last message
                whenever the agent is generating so the user knows the agent
                is alive even during long tool-call sequences. */}
            {isGenerating ? <ThinkingIndicator /> : null}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Text Input area */}
      <footer className="shrink-0 px-4 pb-4 pt-2">
        <div className="relative flex flex-col gap-2 rounded-xl border border-hairline bg-elevated/40 px-3 py-2.5 transition-all">
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What are we building today?"
            className="w-full max-h-32 min-h-[24px] resize-none bg-transparent p-0 text-xs text-ink outline-none border-0 placeholder-dim leading-relaxed focus:ring-0"
            disabled={isLoadingMessages || !activeSessionId}
          />
          
          <div className="flex items-center justify-between border-t border-hairline/40 pt-2 mt-1">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsModelSelectorOpen(true)}
                title="Change AI Model"
                className="flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-2 py-1 text-[10px] font-medium text-muted hover:border-muted/30 hover:text-ink transition-colors outline-none"
              >
                <Cpu size={11} className="text-accent shrink-0" />
                <span className="font-mono max-w-[110px] truncate">{selectedModel || "Select LLM"}</span>
              </button>
              <ApprovalModeSelect
                value={approvalMode}
                onChange={(mode) => void setApprovalMode(mode)}
              />
              {quotaWarning && (
                <div className="flex items-center gap-1 text-[9px] font-semibold text-rose-500 animate-pulse">
                  <AlertTriangle size={10} />
                  <span>Quota low</span>
                </div>
              )}
            </div>

            {isGenerating ? (
              <button
                onClick={cancelGeneration}
                title="Stop generation"
                className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500 hover:bg-rose-600 text-white transition-colors outline-none"
              >
                <Square size={12} fill="white" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() || !activeSessionId || !selectedModel}
                title={!selectedModel ? "Select an AI model first" : "Send message"}
                className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:hover:bg-accent transition-colors outline-none"
              >
                <Send size={12} />
              </button>
            )}
          </div>
        </div>
      </footer>

      {/* Resize Drag Handle */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/40 active:bg-accent transition-colors z-30"
      />

      {/* Model Selector Modal */}
      <ModelSelectorModal
        isOpen={isModelSelectorOpen}
        onClose={() => setIsModelSelectorOpen(false)}
      />

      {pendingApprovals.length > 0 ? (
        <ApprovalModal
          approval={pendingApprovals[0]}
          onApprove={() => resolveApproval(pendingApprovals[0].id, "approved")}
          onReject={() => resolveApproval(pendingApprovals[0].id, "rejected")}
        />
      ) : null}
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div
      className="flex items-center gap-2 px-2 pt-1 pb-2 text-[11px] text-muted"
      role="status"
      aria-live="polite"
    >
      <span className="flex items-center gap-1">
        <span
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400"
          style={{ animationDelay: "140ms" }}
        />
        <span
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400"
          style={{ animationDelay: "280ms" }}
        />
      </span>
      <span className="text-dim">Agent is working…</span>
    </div>
  );
}

function ApprovalModeSelect({
  value,
  onChange
}: {
  value: AgentApprovalMode;
  onChange: (mode: AgentApprovalMode) => void;
}) {
  const isAuto = value === "auto";
  const Icon = isAuto ? Zap : ShieldCheck;
  const labelClass = isAuto ? "text-amber-400" : "text-muted";
  const ringClass = isAuto
    ? "border-amber-500/40 bg-amber-500/10 hover:border-amber-400"
    : "border-hairline bg-surface hover:border-muted/30 hover:text-ink";
  return (
    <label
      title={
        isAuto
          ? "Auto-approve risky tool calls (file deletes, shell, restarts, snapshot restore, service create). Sent at session start and on every message."
          : "Pause and ask before running risky tool calls."
      }
      className={`relative flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium transition-colors cursor-pointer ${ringClass} ${labelClass}`}
    >
      <Icon size={11} className="shrink-0" />
      <span>Approval:</span>
      <span className={`font-semibold ${isAuto ? "text-amber-300" : "text-ink"}`}>
        {isAuto ? "Auto" : "Manual"}
      </span>
      <ChevronDown size={10} className="opacity-60" />
      <select
        aria-label="Approval mode"
        value={value}
        onChange={(event) => onChange(event.target.value as AgentApprovalMode)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="manual">Manual — ask before risky tools</option>
        <option value="auto">Auto — auto-approve everything</option>
      </select>
    </label>
  );
}

function ApprovalModal({
  approval,
  onApprove,
  onReject
}: {
  approval: ApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
}) {
  const args = approval.metadata?.arguments ?? {};
  return (
    <div className="absolute inset-0 z-40 flex items-end bg-bg/60 p-3 backdrop-blur-sm">
      <div className="w-full overflow-hidden rounded-xl border border-amber-500/30 bg-surface shadow-2xl">
        <div className="border-b border-hairline px-4 py-3">
          <div className="flex items-center gap-2 text-amber-500">
            <AlertTriangle size={15} />
            <span className="text-xs font-bold uppercase tracking-tightish">Approval required</span>
          </div>
          <div className="mt-2 text-sm font-semibold text-ink">{approval.reason}</div>
          <div className="mt-1 font-mono text-[11px] text-muted">
            {approval.action} · {approval.riskLevel}
          </div>
        </div>
        <div className="max-h-56 overflow-auto px-4 py-3">
          <pre className="rounded-lg border border-hairline bg-elevated p-3 text-[11px] leading-relaxed text-ink">
            {JSON.stringify(args, null, 2)}
          </pre>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-hairline px-4 py-3">
          <button
            type="button"
            onClick={onReject}
            className="focus-ring h-8 rounded-lg border border-line px-3 text-xs font-medium text-muted transition-colors hover:border-rose-500/40 hover:text-rose-500"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={onApprove}
            className="focus-ring h-8 rounded-lg bg-amber-500 px-3 text-xs font-semibold text-white transition-colors hover:bg-amber-400"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
