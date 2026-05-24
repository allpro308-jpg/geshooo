import type {
  Project,
  ServiceCredential,
  ServiceDetail,
  ServiceLogLine,
  ServiceRuntimeInfo,
  ServiceTemplate,
  Workspace,
  WorkspaceService
} from "@singulary/shared";

import { apiGet, apiPost } from "./api";

export type CreateWorkspaceInput = {
  name: string;
  description?: string;
};

export type CreateProjectInput = {
  workspaceId: string;
  name: string;
  runtimeKind: string;
};

export type CreateServiceInput = {
  workspaceId: string;
  name: string;
  templateId: string;
  config: Record<string, unknown>;
  internalHost?: string;
  connectionEnvKey?: string;
};

export type ServiceAction = "start" | "stop" | "restart" | "destroy";

export const workspacesService = {
  listWorkspaces: () => apiGet<{ workspaces: Workspace[] }>("/api/workspaces"),
  createWorkspace: (input: CreateWorkspaceInput) =>
    apiPost<{ workspace: Workspace }>("/api/workspaces", input),
  listProjects: () => apiGet<{ projects: Project[] }>("/api/projects"),
  createProject: (input: CreateProjectInput) =>
    apiPost<{ project: Project }>("/api/projects", input),
  listServices: () => apiGet<{ services: WorkspaceService[] }>("/api/workspace-services"),
  listServiceTemplates: () =>
    apiGet<{ templates: ServiceTemplate[] }>("/api/service-templates"),
  createService: (input: CreateServiceInput) =>
    apiPost<{ service: WorkspaceService; credentials: ServiceCredential[] }>(
      "/api/workspace-services",
      input
    ),
  getServiceDetail: (serviceId: string) =>
    apiGet<ServiceDetail>(`/api/workspace-services/${serviceId}`),
  getServiceRuntime: (serviceId: string) =>
    apiGet<{ runtime: ServiceRuntimeInfo }>(`/api/workspace-services/${serviceId}/runtime`),
  getServiceLogs: (serviceId: string, tail = 200) =>
    apiGet<{ lines: ServiceLogLine[] }>(`/api/workspace-services/${serviceId}/logs?tail=${tail}`),
  runServiceAction: (serviceId: string, action: ServiceAction) =>
    apiPost<{ runtime: ServiceRuntimeInfo }>(
      `/api/workspace-services/${serviceId}/actions`,
      { action }
    )
};
