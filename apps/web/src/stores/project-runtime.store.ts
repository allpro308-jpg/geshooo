import type {
  ProjectLogLine,
  ProjectLogStats,
  ProjectRuntimeInfo,
  ProjectShell
} from "@singulary/shared";
import { create } from "zustand";

const MAX_LOG_BUFFER = 800;

type PresenceInfo = {
  clients: number;
  idleUntilEpochMs: number | null;
};

type State = {
  runtimeByProject: Record<string, ProjectRuntimeInfo>;
  statsByProject: Record<string, ProjectLogStats>;
  logsByProject: Record<string, ProjectLogLine[]>;
  shellsByProject: Record<string, ProjectShell[]>;
  presenceByProject: Record<string, PresenceInfo>;
  terminalOpen: boolean;
  setRuntime: (projectId: string, runtime: ProjectRuntimeInfo) => void;
  setStats: (projectId: string, stats: ProjectLogStats) => void;
  setLogs: (projectId: string, lines: ProjectLogLine[]) => void;
  appendLogs: (projectId: string, lines: ProjectLogLine[], stats: ProjectLogStats) => void;
  setShells: (projectId: string, shells: ProjectShell[]) => void;
  setPresence: (projectId: string, presence: PresenceInfo) => void;
  openTerminal: () => void;
  closeTerminal: () => void;
  toggleTerminal: () => void;
};

export const useProjectRuntimeStore = create<State>((set) => ({
  runtimeByProject: {},
  statsByProject: {},
  logsByProject: {},
  shellsByProject: {},
  presenceByProject: {},
  terminalOpen: false,
  setRuntime: (projectId, runtime) =>
    set((state) => ({ runtimeByProject: { ...state.runtimeByProject, [projectId]: runtime } })),
  setStats: (projectId, stats) =>
    set((state) => ({ statsByProject: { ...state.statsByProject, [projectId]: stats } })),
  setLogs: (projectId, lines) =>
    set((state) => ({ logsByProject: { ...state.logsByProject, [projectId]: lines } })),
  appendLogs: (projectId, lines, stats) =>
    set((state) => {
      const current = state.logsByProject[projectId] ?? [];
      const merged = current.concat(lines);
      const trimmed = merged.length > MAX_LOG_BUFFER ? merged.slice(merged.length - MAX_LOG_BUFFER) : merged;
      return {
        logsByProject: { ...state.logsByProject, [projectId]: trimmed },
        statsByProject: { ...state.statsByProject, [projectId]: stats }
      };
    }),
  setShells: (projectId, shells) =>
    set((state) => ({ shellsByProject: { ...state.shellsByProject, [projectId]: shells } })),
  setPresence: (projectId, presence) =>
    set((state) => ({ presenceByProject: { ...state.presenceByProject, [projectId]: presence } })),
  openTerminal: () => set({ terminalOpen: true }),
  closeTerminal: () => set({ terminalOpen: false }),
  toggleTerminal: () => set((state) => ({ terminalOpen: !state.terminalOpen }))
}));
