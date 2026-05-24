import { useCallback, useEffect, useState } from "react";

import { type CreateProviderKeyInput,providerKeysService } from "@/services/provider-keys.service";
import { useProviderKeysStore } from "@/stores/provider-keys.store";
import { errorMessage } from "@/utils/forms";

export function useProviderKeys() {
  const providerKeys = useProviderKeysStore((state) => state.providerKeys);
  const lastFetchedAt = useProviderKeysStore((state) => state.lastFetchedAt);
  const setProviderKeys = useProviderKeysStore((state) => state.setProviderKeys);
  const addProviderKey = useProviderKeysStore((state) => state.addProviderKey);
  const [error, setError] = useState<string | null>(null);

  const fetchProviderKeys = useCallback(
    async (force = false) => {
      if (!force && lastFetchedAt) return;
      try {
        const response = await providerKeysService.list();
        setProviderKeys(response.providerKeys);
      } catch (requestError) {
        setError(errorMessage(requestError, "Failed to load provider keys."));
      }
    },
    [lastFetchedAt, setProviderKeys]
  );

  useEffect(() => {
    void fetchProviderKeys();
  }, [fetchProviderKeys]);

  const createProviderKey = useCallback(
    async (input: CreateProviderKeyInput) => {
      const response = await providerKeysService.create(input);
      addProviderKey(response.providerKey);
      return response.providerKey;
    },
    [addProviderKey]
  );

  return { providerKeys, error, setError, refetch: () => fetchProviderKeys(true), createProviderKey };
}
