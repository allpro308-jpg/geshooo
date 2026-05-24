import { useCallback } from "react";

import { authService, type SetupInput } from "@/services/auth.service";
import { useAuthStore } from "@/stores/auth.store";

export function useAuth() {
  const initialized = useAuthStore((state) => state.initialized);
  const needsSetup = useAuthStore((state) => state.needsSetup);
  const user = useAuthStore((state) => state.user);
  const setSetupStatus = useAuthStore((state) => state.setSetupStatus);
  const setUser = useAuthStore((state) => state.setUser);
  const reset = useAuthStore((state) => state.reset);

  const initialize = useCallback(async () => {
    const setup = await authService.setupStatus();
    setSetupStatus(setup);

    if (setup.needsSetup) return;

    try {
      const response = await authService.me();
      setUser(response.user);
    } catch {
      setUser(null);
    }
  }, [setSetupStatus, setUser]);

  const completeSetup = useCallback(
    async (input: SetupInput) => {
      const response = await authService.completeSetup(input);
      setUser(response.user);
    },
    [setUser]
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await authService.login(email, password);
      setUser(response.user);
    },
    [setUser]
  );

  const logout = useCallback(async () => {
    await authService.logout();
    reset();
  }, [reset]);

  return {
    initialized,
    needsSetup,
    user,
    initialize,
    completeSetup,
    login,
    logout
  };
}
