import type {
  AdminSummary,
  AdminUser,
  DockerConfig,
  DockerConnectionCheck,
  Group,
  GroupConfig,
  GroupMember,
  GroupRole,
  PermissionPolicy,
  PlatformSettings,
  ProviderAccessPolicy,
  ProviderConfig,
  ProviderKey,
  ProviderModelOption,
  ProviderModelPolicy,
  TokenBudget,
  Workspace
} from "@singulary/shared";

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./api";

export const adminService = {
  summary: () => apiGet<AdminSummary>("/api/admin/summary"),
  users: () => apiGet<{ users: AdminUser[] }>("/api/admin/users"),
  groups: () => apiGet<{ groups: Group[] }>("/api/admin/groups"),
  workspaces: () => apiGet<{ workspaces: Workspace[] }>("/api/admin/workspaces"),
  providerKeys: () => apiGet<{ providerKeys: ProviderKey[] }>("/api/admin/provider-keys"),
  providers: () => apiGet<{ providers: ProviderConfig[] }>("/api/admin/providers"),
  modelAccess: () => apiGet<{ policies: ProviderModelPolicy[] }>("/api/admin/model-access"),
  providerAccess: () => apiGet<{ providerAccessPolicies: ProviderAccessPolicy[] }>("/api/admin/provider-access"),
  tokenBudgets: () => apiGet<{ tokenBudgets: TokenBudget[] }>("/api/admin/token-budgets"),
  permissionPolicies: () => apiGet<{ permissionPolicies: PermissionPolicy[] }>("/api/admin/permission-policies"),
  settings: () => apiGet<{ settings: PlatformSettings }>("/api/admin/settings"),
  dockerConfig: () => apiGet<{ dockerConfig: DockerConfig }>("/api/admin/docker-config"),
  groupMembers: (groupId: string) => apiGet<{ members: GroupMember[] }>(`/api/admin/groups/${groupId}/members`),
  groupConfig: (groupId: string) => apiGet<{ config: GroupConfig }>(`/api/admin/groups/${groupId}/config`),
  saveGroupConfig: (groupId: string, config: Omit<GroupConfig, "groupId" | "groupName" | "isUserGroup">) =>
    apiPut<{ config: GroupConfig }>(`/api/admin/groups/${groupId}/config`, config),
  providerModels: (provider: string, query: string) =>
    apiGet<{ models: ProviderModelOption[] }>(
      `/api/admin/providers/${encodeURIComponent(provider)}/models/all?query=${encodeURIComponent(query)}`
    ),
  updateUserRole: (userId: string, role: string) => apiPatch(`/api/admin/users/${userId}`, { role }),
  createGroup: (input: { name: string; description?: string }) => apiPost("/api/admin/groups", input),
  addGroupMember: (groupId: string, input: { userId: string; role?: GroupRole }) =>
    apiPost(`/api/admin/groups/${groupId}/members`, input),
  updateGroupMemberRole: (groupId: string, userId: string, role: GroupRole) =>
    apiPatch(`/api/admin/groups/${groupId}/members/${userId}`, { role }),
  removeGroupMember: (groupId: string, userId: string) =>
    apiDelete(`/api/admin/groups/${groupId}/members/${userId}`),
  createGlobalProviderKey: (input: { provider: string; label: string; key: string }) =>
    apiPost("/api/admin/provider-keys/global", input),
  saveProvider: (input: { provider: string; label: string; baseUrl: string; apiKey: string; enabled: boolean }) =>
    apiPost("/api/admin/providers", input),
  updateModelAccessMode: (provider: string, mode: ProviderModelPolicy["mode"]) =>
    apiPatch<{ policy: ProviderModelPolicy }>(`/api/admin/model-access/${provider}`, { mode }),
  addModelAccessRule: (provider: string, modelId: string) =>
    apiPost<{ policy: ProviderModelPolicy }>(`/api/admin/model-access/${provider}/models`, { modelId }),
  removeModelAccessRule: (provider: string, modelId: string) =>
    apiDelete(`/api/admin/model-access/${provider}/models/${encodeURIComponent(modelId)}`),
  createProviderAccess: (input: { scopeType: string; scopeId: string | null; provider: string; effect: string }) =>
    apiPost("/api/admin/provider-access", input),
  updateDockerConfig: (input: Record<string, unknown>) =>
    apiPatch<{ dockerConfig: DockerConfig }>("/api/admin/docker-config", input),
  checkDockerConfig: () => apiPost<{ check: DockerConnectionCheck }>("/api/admin/docker-config/check"),
  createTokenBudget: (input: Record<string, unknown>) => apiPost("/api/admin/token-budgets", input),
  createPermissionPolicy: (input: Record<string, unknown>) => apiPost("/api/admin/permission-policies", input),
  updateSettings: (input: Partial<PlatformSettings>) =>
    apiPatch<{ settings: PlatformSettings }>("/api/admin/settings", input)
};
