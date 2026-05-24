import { useCallback, useEffect, useState } from "react";

import {
  type CreateProjectInput,
  type CreateServiceInput,
  type CreateWorkspaceInput,
  workspacesService} from "@/services/workspaces.service";
import { useWorkspacesStore } from "@/stores/workspaces.store";
import { errorMessage } from "@/utils/forms";

export function useWorkspaces() {
  const workspaces = useWorkspacesStore((state) => state.workspaces);
  const projects = useWorkspacesStore((state) => state.projects);
  const services = useWorkspacesStore((state) => state.services);
  const lastFetchedAt = useWorkspacesStore((state) => state.lastFetchedAt);
  const setData = useWorkspacesStore((state) => state.setData);
  const addWorkspace = useWorkspacesStore((state) => state.addWorkspace);
  const addProject = useWorkspacesStore((state) => state.addProject);
  const addService = useWorkspacesStore((state) => state.addService);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(
    async (force = false) => {
      if (!force && lastFetchedAt) return;
      try {
        const [workspaceResponse, projectResponse, serviceResponse] = await Promise.all([
          workspacesService.listWorkspaces(),
          workspacesService.listProjects(),
          workspacesService.listServices()
        ]);
        setData({
          workspaces: workspaceResponse.workspaces,
          projects: projectResponse.projects,
          services: serviceResponse.services
        });
      } catch (requestError) {
        setError(errorMessage(requestError, "Failed to load workspaces."));
      }
    },
    [lastFetchedAt, setData]
  );

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const createWorkspace = useCallback(
    async (input: CreateWorkspaceInput) => {
      const response = await workspacesService.createWorkspace(input);
      addWorkspace(response.workspace);
      return response.workspace;
    },
    [addWorkspace]
  );

  const createProject = useCallback(
    async (input: CreateProjectInput) => {
      const response = await workspacesService.createProject(input);
      addProject(response.project);
      return response.project;
    },
    [addProject]
  );

  const createService = useCallback(
    async (input: CreateServiceInput) => {
      const response = await workspacesService.createService(input);
      addService(response.service);
      return response;
    },
    [addService]
  );

  return {
    workspaces,
    projects,
    services,
    error,
    setError,
    refetch: () => fetchAll(true),
    createWorkspace,
    createProject,
    createService
  };
}
