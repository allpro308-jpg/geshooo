import type { AuthUser, SetupStatus } from "@singulary/shared";

import { apiGet, apiPost } from "./api";

export type SetupInput = {
  email: string;
  username: string;
  password: string;
  displayName?: string;
};

export const authService = {
  setupStatus: () => apiGet<SetupStatus>("/api/setup/status"),
  me: () => apiGet<{ user: AuthUser }>("/api/auth/me"),
  wsToken: () => apiGet<{ token: string; expiresAt: string }>("/api/auth/ws-token"),
  completeSetup: (input: SetupInput) => apiPost<{ user: AuthUser }>("/api/setup/complete", input),
  login: (email: string, password: string) => apiPost<{ user: AuthUser }>("/api/auth/login", { email, password }),
  logout: () => apiPost<void>("/api/auth/logout")
};
