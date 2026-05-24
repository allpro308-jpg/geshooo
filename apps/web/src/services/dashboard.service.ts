import type { DashboardSummary, MyGroup } from "@singulary/shared";

import { apiGet } from "./api";

export const dashboardService = {
  summary: () => apiGet<DashboardSummary>("/api/dashboard/summary"),
  myGroups: () => apiGet<{ groups: MyGroup[] }>("/api/me/groups")
};
