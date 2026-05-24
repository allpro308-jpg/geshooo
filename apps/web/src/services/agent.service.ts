import type { AgentMessage, AgentSession, ApprovalRequest, ProviderWithModels } from "@singulary/shared";

import { apiDelete, apiGet, apiPatch,apiPost } from "./api";

export const agentService = {
  listSessions: (projectId?: string, workspaceId?: string) => {
    let url = "/api/agent/sessions";
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (workspaceId) params.set("workspaceId", workspaceId);
    const query = params.toString();
    if (query) url += `?${query}`;
    return apiGet<{ sessions: AgentSession[] }>(url);
  },

  createSession: (input: { workspaceId: string; projectId?: string; modelProvider?: string; modelName?: string }) => {
    return apiPost<{ session: AgentSession }>("/api/agent/sessions", input);
  },

  updateSession: (sessionId: string, input: { title: string | null }) => {
    return apiPatch<{ session: AgentSession }>(`/api/agent/sessions/${sessionId}`, input);
  },

  deleteSession: (sessionId: string) => {
    return apiDelete<{ success: boolean }>(`/api/agent/sessions/${sessionId}`);
  },

  getMessages: (sessionId: string) => {
    return apiGet<{ messages: AgentMessage[] }>(`/api/agent/sessions/${sessionId}/messages`);
  },

  getPendingApprovals: (sessionId: string) => {
    return apiGet<{ approvals: ApprovalRequest[] }>(`/api/agent/sessions/${sessionId}/approvals`);
  },

  sendMessage: (
    sessionId: string,
    input: { content: string; modelProvider?: string; modelName?: string; tempId?: string }
  ) => {
    return apiPost<{ success: boolean }>(`/api/agent/sessions/${sessionId}/messages`, input);
  },

  cancelSession: (sessionId: string) => {
    return apiPost<{ success: boolean }>(`/api/agent/sessions/${sessionId}/cancel`);
  },

  resolveApproval: (approvalId: string, decision: "approved" | "rejected") => {
    return apiPost<{ approval: ApprovalRequest }>(`/api/agent/approvals/${approvalId}/resolve`, { decision });
  },

  deleteMessage: (sessionId: string, messageId: string) => {
    return apiDelete<{ success: boolean }>(`/api/agent/sessions/${sessionId}/messages/${messageId}`);
  },

  getModels: () => {
    return apiGet<{ providers: ProviderWithModels[] }>("/api/models");
  }
};
