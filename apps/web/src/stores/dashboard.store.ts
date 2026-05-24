import type { DashboardSummary, MyGroup } from "@singulary/shared";
import { create } from "zustand";

type DashboardState = {
  summary: DashboardSummary | null;
  myGroups: MyGroup[];
  lastFetchedAt: number | null;
  setDashboardData: (data: { summary: DashboardSummary; myGroups: MyGroup[] }) => void;
};

export const useDashboardStore = create<DashboardState>((set) => ({
  summary: null,
  myGroups: [],
  lastFetchedAt: null,
  setDashboardData: ({ summary, myGroups }) => set({ summary, myGroups, lastFetchedAt: Date.now() })
}));
