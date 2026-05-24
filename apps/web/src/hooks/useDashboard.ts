import { useCallback, useEffect, useState } from "react";

import { dashboardService } from "@/services/dashboard.service";
import { useDashboardStore } from "@/stores/dashboard.store";
import { errorMessage } from "@/utils/forms";

export function useDashboard() {
  const summary = useDashboardStore((state) => state.summary);
  const myGroups = useDashboardStore((state) => state.myGroups);
  const lastFetchedAt = useDashboardStore((state) => state.lastFetchedAt);
  const setDashboardData = useDashboardStore((state) => state.setDashboardData);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(
    async (force = false) => {
      if (!force && lastFetchedAt) return;
      try {
        const [summaryResponse, groupsResponse] = await Promise.all([dashboardService.summary(), dashboardService.myGroups()]);
        setDashboardData({ summary: summaryResponse, myGroups: groupsResponse.groups });
      } catch (requestError) {
        setError(errorMessage(requestError, "Failed to load dashboard."));
      }
    },
    [lastFetchedAt, setDashboardData]
  );

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  return { summary, myGroups, error, refetch: () => fetchDashboard(true) };
}
