import type {
  AgentApprovalMode,
  AgentMessage,
  AgentSession,
  AgentStreamEvent,
  AgentToolCall,
  ApprovalRequest,
  ProviderWithModels
} from "@singulary/shared";
import { create } from "zustand";

import { agentService } from "@/services/agent.service";

type AgentState = {
  sessions: AgentSession[];
  activeSessionId: string | null;
  activeSession: AgentSession | null;
  messages: AgentMessage[];
  pendingApprovals: ApprovalRequest[];
  providers: ProviderWithModels[];

  isLoadingSessions: boolean;
  isLoadingMessages: boolean;
  isLoadingModels: boolean;
  isGenerating: boolean;

  chatPanelOpen: boolean;
  chatPanelWidth: number;
  debugMode: boolean;

  selectedProvider: string | null;
  selectedModel: string | null;
  approvalMode: AgentApprovalMode;

  streamingMessageId: string | null;
  streamingContent: string;
  streamingToolCalls: AgentToolCall[];

  eventSource: EventSource | null;

  // Actions
  toggleChatPanel: (open?: boolean) => void;
  setChatPanelWidth: (width: number) => void;
  setDebugMode: (enabled: boolean) => void;
  fetchSessions: (projectId: string, workspaceId: string) => Promise<void>;
  createSession: (workspaceId: string, projectId?: string) => Promise<string>;
  selectSession: (sessionId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  cancelGeneration: () => Promise<void>;
  resolveApproval: (approvalId: string, decision: "approved" | "rejected") => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  fetchModels: () => Promise<void>;
  selectModel: (provider: string, model: string) => void;
  setApprovalMode: (mode: AgentApprovalMode) => Promise<void>;
  clearSession: () => void;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  removeSession: (sessionId: string) => Promise<void>;
};

export const useAgentStore = create<AgentState>((set, get) => {
  // Load saved layouts
  const savedWidth = localStorage.getItem("singulary_chat_width");
  const savedOpen = localStorage.getItem("singulary_chat_open");
  const savedApprovalMode = localStorage.getItem("singulary_approval_mode");
  const savedDebugMode = localStorage.getItem("singulary_chat_debug");
  const initialApprovalMode: AgentApprovalMode =
    savedApprovalMode === "auto" ? "auto" : "manual";

  return {
    sessions: [],
    activeSessionId: null,
    activeSession: null,
    messages: [],
    pendingApprovals: [],
    providers: [],

    isLoadingSessions: true,
    isLoadingMessages: false,
    isLoadingModels: false,
    isGenerating: false,

    chatPanelOpen: savedOpen !== null ? savedOpen === "true" : true,
    chatPanelWidth: savedWidth ? Number(savedWidth) : 380,
    debugMode: savedDebugMode === "true",

    selectedProvider: null,
    selectedModel: null,
    approvalMode: initialApprovalMode,

    streamingMessageId: null,
    streamingContent: "",
    streamingToolCalls: [],

    eventSource: null,

    toggleChatPanel: (open) => {
      const nextOpen = open !== undefined ? open : !get().chatPanelOpen;
      localStorage.setItem("singulary_chat_open", String(nextOpen));
      set({ chatPanelOpen: nextOpen });
    },

    setChatPanelWidth: (width) => {
      const nextWidth = Math.max(280, Math.min(600, width));
      localStorage.setItem("singulary_chat_width", String(nextWidth));
      set({ chatPanelWidth: nextWidth });
    },

    setDebugMode: (enabled) => {
      localStorage.setItem("singulary_chat_debug", String(enabled));
      set({ debugMode: enabled });
    },

    fetchSessions: async (projectId, workspaceId) => {
      set({ isLoadingSessions: true });
      try {
        const { sessions } = await agentService.listSessions(projectId, workspaceId);
        set({ sessions });
        
        // Auto-select last used session or most recent if none cached
        if (!get().activeSessionId) {
          const lastSessionId = localStorage.getItem(`singulary_last_session_${projectId}`);
          const lastSessionExists = sessions.some((s) => s.id === lastSessionId);

          if (lastSessionExists) {
            await get().selectSession(lastSessionId!);
          } else if (sessions.length > 0) {
            await get().selectSession(sessions[0].id);
          }
        }
      } catch (err) {
        console.error("Failed to fetch sessions", err);
      } finally {
        set({ isLoadingSessions: false });
      }
    },

    createSession: async (workspaceId, projectId) => {
      set({ isGenerating: false });
      const { selectedProvider, selectedModel, approvalMode } = get();

      const { session } = await agentService.createSession({
        workspaceId,
        projectId,
        modelProvider: selectedProvider || undefined,
        modelName: selectedModel || undefined,
        approvalMode
      });

      set((state) => ({
        sessions: [session, ...state.sessions],
        activeSessionId: session.id,
        activeSession: session,
        approvalMode: session.approvalMode ?? approvalMode,
        messages: []
      }));

      return session.id;
    },

    selectSession: async (sessionId) => {
      // Close existing event source if changing session
      get().eventSource?.close();
      
      set({
        activeSessionId: sessionId,
        isLoadingMessages: true,
        isGenerating: false,
        streamingMessageId: null,
        streamingContent: "",
        streamingToolCalls: [],
        pendingApprovals: []
      });

      try {
        const session = get().sessions.find((s) => s.id === sessionId) || null;
        if (session && session.projectId) {
          localStorage.setItem(`singulary_last_session_${session.projectId}`, session.id);
        }

        const [{ messages }, { approvals }] = await Promise.all([
          agentService.getMessages(sessionId),
          agentService.getPendingApprovals(sessionId)
        ]);
        
        set({
          activeSession: session,
          messages,
          pendingApprovals: approvals,
          selectedProvider: session?.modelProvider || get().selectedProvider,
          selectedModel: session?.modelName || get().selectedModel,
          approvalMode: session?.approvalMode ?? get().approvalMode
        });
      } catch (err) {
        console.error("Failed to load session messages", err);
      } finally {
        set({ isLoadingMessages: false });
      }
    },

    sendMessage: async (content) => {
      const { activeSessionId, selectedProvider, selectedModel, approvalMode, isGenerating } = get();
      if (!activeSessionId || isGenerating) return;

      // Close prior event source
      get().eventSource?.close();

      const tempId = "temp_user_" + Math.random().toString(36).slice(2, 9);
      // Create a temporary user message
      const tempUserMsg: AgentMessage = {
        id: tempId,
        sessionId: activeSessionId,
        role: "user",
        content,
        toolCallId: null,
        toolCalls: null,
        createdAt: new Date().toISOString()
      };

      set((state) => ({
        messages: [...state.messages, tempUserMsg],
        isGenerating: true,
        streamingMessageId: null,
        streamingContent: "",
        streamingToolCalls: []
      }));

      try {
        // Create a promise to wait for SSE connection
        const es = new EventSource(`/api/agent/sessions/${activeSessionId}/stream`, {
          withCredentials: true
        });

        set({ eventSource: es });

        await new Promise<void>((resolve, reject) => {
          es.onopen = () => resolve();
          es.onerror = (err) => {
            if (es.readyState === EventSource.CLOSED) {
              reject(new Error("Failed to connect to agent stream."));
            }
          };
          // Fallback timeout in case onopen never fires but no error happens
          setTimeout(resolve, 2000); 
        });

        // Now safe to trigger the background generation
        await agentService.sendMessage(activeSessionId, {
          content,
          tempId,
          modelProvider: selectedProvider || undefined,
          modelName: selectedModel || undefined,
          approvalMode
        });

        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as AgentStreamEvent;
            
            if (data.type === "message_start") {
              // A new iteration is starting. Commit the prior iteration's
              // streaming buffer to `messages` so its text + tool calls are
              // not wiped — otherwise multi-iteration turns "eat" earlier
              // assistant text the moment the next iteration begins.
              set((state) => {
                const next: AgentMessage[] = [...state.messages];
                if (
                  state.streamingMessageId &&
                  (state.streamingContent.length > 0 || state.streamingToolCalls.length > 0)
                ) {
                  next.push({
                    id: state.streamingMessageId,
                    sessionId: activeSessionId,
                    role: "assistant",
                    content: state.streamingContent || null,
                    toolCallId: null,
                    toolCalls:
                      state.streamingToolCalls.length > 0 ? [...state.streamingToolCalls] : null,
                    createdAt: new Date().toISOString()
                  });
                }
                return {
                  messages: next,
                  streamingMessageId: data.messageId,
                  streamingContent: "",
                  streamingToolCalls: []
                };
              });
            } else if (data.type === "content_delta") {
              set((state) => ({
                streamingContent: state.streamingContent + data.delta
              }));
            } else if (data.type === "tool_call_start") {
              set((state) => ({
                streamingToolCalls: [...state.streamingToolCalls, data.toolCall]
              }));
            } else if (data.type === "tool_call_result") {
              set((state) => ({
                streamingToolCalls: state.streamingToolCalls.map((tc) =>
                  tc.id === data.toolCallId
                    ? { ...tc, result: data.result, status: data.status, completedAt: new Date().toISOString() }
                    : tc
                )
              }));
            } else if (data.type === "approval_requested") {
              set((state) => ({
                pendingApprovals: state.pendingApprovals.some((approval) => approval.id === data.approval.id)
                  ? state.pendingApprovals
                  : [...state.pendingApprovals, data.approval],
                activeSession: state.activeSession
                  ? { ...state.activeSession, status: "waiting_for_approval" }
                  : state.activeSession,
                sessions: state.sessions.map((session) =>
                  session.id === activeSessionId ? { ...session, status: "waiting_for_approval" } : session
                ),
                streamingToolCalls: state.streamingToolCalls.map((tc) =>
                  tc.id === data.approval.toolCallId ? { ...tc, status: "pending" } : tc
                )
              }));
            } else if (data.type === "approval_resolved") {
              set((state) => ({
                pendingApprovals: state.pendingApprovals.filter((approval) => approval.id !== data.approvalId),
                activeSession: state.activeSession
                  ? { ...state.activeSession, status: "running" }
                  : state.activeSession,
                sessions: state.sessions.map((session) =>
                  session.id === activeSessionId
                    ? { ...session, status: "running" }
                    : session
                ),
                streamingToolCalls: state.streamingToolCalls.map((tc) =>
                  state.pendingApprovals.some(
                    (approval) => approval.id === data.approvalId && approval.toolCallId === tc.id
                  )
                    ? { ...tc, status: data.status === "approved" ? "running" : "failed" }
                    : tc
                )
              }));
            } else if (data.type === "message_added") {
              set((state) => {
                // Remove the optimistic temp message and prevent appending it twice
                const newMessages = state.messages.filter((m) => m.id !== data.tempId);
                if (!newMessages.some((m) => m.id === data.message.id)) {
                  newMessages.push(data.message);
                }
                return { messages: newMessages };
              });
            } else if (data.type === "message_end") {
              set((state) => ({
                messages: [...state.messages, data.message],
                streamingMessageId: null,
                streamingContent: "",
                streamingToolCalls: []
              }));
            } else if (data.type === "error") {
              const errMsg: AgentMessage = {
                id: "error_" + Math.random(),
                sessionId: activeSessionId,
                role: "assistant",
                content: `Error: ${data.error}`,
                toolCallId: null,
                toolCalls: null,
                createdAt: new Date().toISOString()
              };
              set((state) => ({
                messages: [...state.messages.filter((m) => !m.id.startsWith("temp_")), errMsg],
                isGenerating: false,
                streamingMessageId: null,
                streamingContent: "",
                streamingToolCalls: []
              }));
              es.close();
            } else if (data.type === "done") {
              set({ isGenerating: false });
              es.close();
              // reload from DB to ensure history is perfectly synchronized
              get().selectSession(activeSessionId);
            }
          } catch (e) {
            console.error("SSE parse error", e);
          }
        };

        es.onerror = () => {
          console.error("SSE error, closing stream");
          set({ isGenerating: false });
          es.close();
        };

      } catch (err: any) {
        console.error("Failed to send message", err);
        const errMsg: AgentMessage = {
          id: "error_" + Math.random(),
          sessionId: activeSessionId,
          role: "assistant",
          content: `Failed to communicate with agent: ${err.message}`,
          toolCallId: null,
          toolCalls: null,
          createdAt: new Date().toISOString()
        };
        set((state) => ({
          messages: [...state.messages, errMsg],
          isGenerating: false
        }));
      }
    },

    cancelGeneration: async () => {
      const { activeSessionId, eventSource } = get();
      if (!activeSessionId) return;

      try {
        eventSource?.close();
        await agentService.cancelSession(activeSessionId);
      } catch (err) {
        console.error("Failed to cancel generation", err);
      } finally {
        set({ isGenerating: false, streamingMessageId: null, streamingContent: "", streamingToolCalls: [] });
        set({ pendingApprovals: [] });
        // reload
        await get().selectSession(activeSessionId);
      }
    },

    resolveApproval: async (approvalId, decision) => {
      const { activeSessionId } = get();
      if (!activeSessionId) return;
      const approval = get().pendingApprovals.find((item) => item.id === approvalId);
      set((state) => ({
        pendingApprovals: state.pendingApprovals.filter((item) => item.id !== approvalId),
        streamingToolCalls: state.streamingToolCalls.map((tc) =>
          approval && tc.id === approval.toolCallId
            ? { ...tc, status: decision === "approved" ? "running" : "failed" }
            : tc
        )
      }));
      try {
        await agentService.resolveApproval(approvalId, decision);
      } catch (err) {
        console.error("Failed to resolve approval", err);
        await get().selectSession(activeSessionId);
      }
    },

    deleteMessage: async (messageId) => {
      const { activeSessionId } = get();
      if (!activeSessionId) return;

      set((state) => ({
        messages: state.messages.filter((m) => m.id !== messageId)
      }));

      try {
        if (!messageId.startsWith("temp_") && !messageId.startsWith("error_")) {
          await agentService.deleteMessage(activeSessionId, messageId);
        }
      } catch (err) {
        console.error("Failed to delete message", err);
        await get().selectSession(activeSessionId);
      }
    },

    fetchModels: async () => {
      set({ isLoadingModels: true });
      try {
        const { providers } = await agentService.getModels();
        set({ providers });
        
        // Auto-select first enabled provider and its model if not selected yet
        if (providers.length > 0 && !get().selectedProvider) {
          const activeProv = providers.find((p) => p.enabled) || providers[0];
          if (activeProv.models.length > 0) {
            set({
              selectedProvider: activeProv.provider,
              selectedModel: activeProv.models[0].id
            });
          }
        }
      } catch (err) {
        console.error("Failed to load models list", err);
      } finally {
        set({ isLoadingModels: false });
      }
    },

    setApprovalMode: async (mode) => {
      // Optimistic update + persist locally so the choice survives reloads.
      localStorage.setItem("singulary_approval_mode", mode);
      set((state) => ({
        approvalMode: mode,
        activeSession: state.activeSession ? { ...state.activeSession, approvalMode: mode } : null,
        sessions: state.activeSessionId
          ? state.sessions.map((s) =>
              s.id === state.activeSessionId ? { ...s, approvalMode: mode } : s
            )
          : state.sessions
      }));

      // If a session is active, push the change to the server so the next loop
      // iteration sees it even before the user sends a new message.
      const { activeSessionId } = get();
      if (!activeSessionId) return;
      try {
        const { session } = await agentService.updateSession(activeSessionId, {
          approvalMode: mode
        });
        set((state) => ({
          activeSession: state.activeSessionId === activeSessionId ? session : state.activeSession,
          sessions: state.sessions.map((s) => (s.id === activeSessionId ? session : s))
        }));
      } catch (err) {
        console.error("Failed to update approval mode", err);
      }
    },

    selectModel: (provider, model) => {
      set({ selectedProvider: provider, selectedModel: model });
      
      // Persist onto session if active
      const { activeSessionId } = get();
      if (activeSessionId) {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === activeSessionId ? { ...s, modelProvider: provider, modelName: model } : s
          ),
          activeSession: state.activeSession ? { ...state.activeSession, modelProvider: provider, modelName: model } : null
        }));
      }
    },

    clearSession: () => {
      set({
        activeSessionId: null,
        activeSession: null,
        messages: [],
        pendingApprovals: [],
        streamingMessageId: null,
        streamingContent: "",
        streamingToolCalls: []
      });
      get().eventSource?.close();
      set({ eventSource: null });
    },

    renameSession: async (sessionId, title) => {
      try {
        const { session } = await agentService.updateSession(sessionId, { title });
        set((state) => ({
          sessions: state.sessions.map((s) => (s.id === sessionId ? session : s)),
          activeSession: state.activeSessionId === sessionId ? session : state.activeSession
        }));
      } catch (err) {
        console.error("Failed to rename session", err);
      }
    },

    removeSession: async (sessionId) => {
      try {
        await agentService.deleteSession(sessionId);
        set((state) => {
          const sessions = state.sessions.filter((s) => s.id !== sessionId);
          return { sessions };
        });
        
        if (get().activeSessionId === sessionId) {
          get().clearSession();
          const remaining = get().sessions;
          if (remaining.length > 0) {
            get().selectSession(remaining[0].id);
          }
        }
      } catch (err) {
        console.error("Failed to delete session", err);
      }
    }
  };
});
