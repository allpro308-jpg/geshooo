import type { AuthUser, SetupStatus } from "@singulary/shared";
import { create } from "zustand";

type AuthState = {
  initialized: boolean;
  needsSetup: boolean;
  user: AuthUser | null;
  setInitialized: (initialized: boolean) => void;
  setSetupStatus: (setup: SetupStatus) => void;
  setUser: (user: AuthUser | null) => void;
  reset: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  initialized: false,
  needsSetup: false,
  user: null,
  setInitialized: (initialized) => set({ initialized }),
  setSetupStatus: (setup) => set(setup.needsSetup ? { initialized: true, needsSetup: true, user: null } : { initialized: true, needsSetup: false }),
  setUser: (user) => set({ user, needsSetup: false, initialized: true }),
  reset: () => set({ user: null })
}));
