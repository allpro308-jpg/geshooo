import type { ProviderKey } from "@singulary/shared";

import { apiGet, apiPost } from "./api";

export type CreateProviderKeyInput = {
  scopeType?: "user" | "workspace" | "organization" | "global";
  provider: string;
  label: string;
  key: string;
};

export const providerKeysService = {
  list: () => apiGet<{ providerKeys: ProviderKey[] }>("/api/provider-keys"),
  create: (input: CreateProviderKeyInput) => apiPost<{ providerKey: ProviderKey }>("/api/provider-keys", input)
};
