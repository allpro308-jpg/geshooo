import { Router } from "express";

import { db } from "@/db/database";
import { mapAudit } from "@/db/mappers";
import { requireAuth } from "@/modules/auth/auth-middleware";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get("/summary", (_req, res) => {
  const users = count("users");
  const workspaces = count("workspaces");
  const projects = count("projects");
  const providerKeys = count("provider_keys");
  const auditRows = db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 8").all();

  res.json({
    users,
    workspaces,
    projects,
    providerKeys,
    recentAuditEvents: auditRows.map((row) => mapAudit(row as Parameters<typeof mapAudit>[0]))
  });
});

function count(table: string): number {
  const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
  return row.count;
}
