import type { ProviderKey } from "@singulary/shared";
import { create } from "zustand";

type ProviderKeysState = {
  providerKeys: ProviderKey[];
  lastFetchedAt: number | null;
  setProviderKeys: (providerKeys: ProviderKey[]) => void;
  addProviderKey: (providerKey: ProviderKey) => void;
};

export const useProviderKeysStore = create<ProviderKeysState>((set) => ({
  providerKeys: [],
  lastFetchedAt: null,
  setProviderKeys: (providerKeys) => set({ providerKeys, lastFetchedAt: Date.now() }),
  addProviderKey: (providerKey) => set((state) => ({ providerKeys: [providerKey, ...state.providerKeys] }))
}));
