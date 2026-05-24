import type {
  FileContent,
  FileEntry,
  Project,
  ProjectEnvVar,
  ProjectLogLine,
  ProjectLogStats,
  ProjectRuntimeInfo,
  ProjectShell,
  ProjectTemplate
} from "@singulary/shared";

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./api";

export type ProjectAction = "start" | "stop" | "restart" | "destroy";

export type ProjectUpdateInput = {
  name?: string;
  templateId?: string | null;
  installCommand?: string | null;
  startCommand?: string | null;
};

export const projectsService = {
  get: (projectId: string) => apiGet<{ project: Project }>(`/api/projects/${projectId}`),
  listFiles: (projectId: string, path = "") =>
    apiGet<{ entries: FileEntry[]; path: string }>(
      `/api/projects/${projectId}/files${path ? `?path=${encodeURIComponent(path)}` : ""}`
    ),
  readFile: (projectId: string, path: string) =>
    apiGet<FileContent>(`/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`),
  writeFile: (projectId: string, path: string, content: string) =>
    apiPut<{ entry: FileEntry }>(`/api/projects/${projectId}/file`, { path, content }),
  createEntry: (projectId: string, path: string, type: "file" | "directory") =>
    apiPost<{ entry: FileEntry }>(`/api/projects/${projectId}/files`, { path, type }),
  renameEntry: (projectId: string, from: string, to: string) =>
    apiPost<{ entry: FileEntry }>(`/api/projects/${projectId}/files/rename`, { from, to }),
  copyEntry: (projectId: string, from: string, to: string) =>
    apiPost<{ entry: FileEntry }>(`/api/projects/${projectId}/files/copy`, { from, to }),
  deleteEntry: (projectId: string, path: string) =>
    apiDelete<void>(`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`),
  listEnv: (projectId: string) =>
    apiGet<{ vars: ProjectEnvVar[] }>(`/api/projects/${projectId}/env`),
  createEnv: (projectId: string, input: { key: string; value: string; isSecret: boolean }) =>
    apiPost<{ ok: true }>(`/api/projects/${projectId}/env`, input),
  updateEnv: (projectId: string, envId: string, input: { value?: string; isSecret?: boolean }) =>
    apiPatch<{ ok: true }>(`/api/projects/${projectId}/env/${envId}`, input),
  deleteEnv: (projectId: string, envId: string) =>
    apiDelete<void>(`/api/projects/${projectId}/env/${envId}`),
  listTemplates: () => apiGet<{ templates: ProjectTemplate[] }>("/api/project-templates"),
  update: (projectId: string, input: ProjectUpdateInput) =>
    apiPatch<{ project: Project }>(`/api/projects/${projectId}`, input),
  getRuntime: (projectId: string) =>
    apiGet<{ runtime: ProjectRuntimeInfo; template: ProjectTemplate }>(
      `/api/projects/${projectId}/runtime`
    ),
  runtimeAction: (projectId: string, action: ProjectAction) =>
    apiPost<{ runtime: ProjectRuntimeInfo }>(`/api/projects/${projectId}/runtime/actions`, { action }),
  getLogs: (projectId: string, limit = 300) =>
    apiGet<{ lines: ProjectLogLine[]; stats: ProjectLogStats }>(
      `/api/projects/${projectId}/runtime/logs?limit=${limit}`
    ),
  clearLogs: (projectId: string) => apiPost(`/api/projects/${projectId}/runtime/logs/clear`),
  listShells: (projectId: string) =>
    apiGet<{ shells: ProjectShell[] }>(`/api/projects/${projectId}/shells`),
  createShell: (projectId: string, label?: string) =>
    apiPost<{ shell: ProjectShell }>(`/api/projects/${projectId}/shells`, label ? { label } : {}),
  closeShell: (projectId: string, shellId: string) =>
    apiDelete<void>(`/api/projects/${projectId}/shells/${shellId}`)
};

