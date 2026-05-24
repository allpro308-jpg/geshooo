import type { Project, Workspace, WorkspaceService } from "@singulary/shared";
import { create } from "zustand";

type WorkspacesState = {
  workspaces: Workspace[];
  projects: Project[];
  services: WorkspaceService[];
  lastFetchedAt: number | null;
  setData: (data: { workspaces: Workspace[]; projects: Project[]; services: WorkspaceService[] }) => void;
  addWorkspace: (workspace: Workspace) => void;
  addProject: (project: Project) => void;
  addService: (service: WorkspaceService) => void;
};

export const useWorkspacesStore = create<WorkspacesState>((set) => ({
  workspaces: [],
  projects: [],
  services: [],
  lastFetchedAt: null,
  setData: ({ workspaces, projects, services }) => set({ workspaces, projects, services, lastFetchedAt: Date.now() }),
  addWorkspace: (workspace) => set((state) => ({ workspaces: [workspace, ...state.workspaces] })),
  addProject: (project) => set((state) => ({ projects: [project, ...state.projects] })),
  addService: (service) => set((state) => ({ services: [service, ...state.services] }))
}));
