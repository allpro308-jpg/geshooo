import { Router } from "express";
import { z } from "zod";

import { db, nowIso, slugify } from "@/db/database";
import { mapWorkspaceService } from "@/db/mappers";
import { recordAudit } from "@/modules/audit/audit-service";
import { requireAuth } from "@/modules/auth/auth-middleware";
import { getServiceTemplate } from "@/modules/service-templates/service-templates";
import { HttpError } from "@/shared/errors/http-error";

import {
  getServiceDetail,
  getServiceRuntime,
  provisionServiceFromTemplate,
  readServiceLogs,
  serviceAction
} from "./service-runtime";

const createServiceSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(2).max(120),
  templateId: z.string().min(1),
  config: z.record(z.unknown()).default({}),
  internalHost: z.string().max(120).optional(),
  connectionEnvKey: z.string().max(120).optional()
});

export const workspaceServiceRouter = Router();

workspaceServiceRouter.use(requireAuth);

workspaceServiceRouter.get("/", (req, res) => {
  const workspaceId = z.string().optional().parse(req.query.workspaceId);
  const params: string[] = [req.user!.id];
  let workspaceFilter = "";

  if (workspaceId) {
    params.push(workspaceId);
    workspaceFilter = "AND workspace_services.workspace_id = ?";
  }

  const rows = db
    .prepare(
      `SELECT workspace_services.*
       FROM workspace_services
       JOIN workspace_groups ON workspace_groups.workspace_id = workspace_services.workspace_id
       JOIN group_members ON group_members.group_id = workspace_groups.group_id
       WHERE group_members.user_id = ?
       ${workspaceFilter}
       ORDER BY workspace_services.updated_at DESC`
    )
    .all(...params);

  res.json({ services: rows.map((row) => mapWorkspaceService(row as Parameters<typeof mapWorkspaceService>[0])) });
});

workspaceServiceRouter.post("/", async (req, res, next) => {
  try {
    const body = createServiceSchema.parse(req.body);
    ensureWorkspaceAdmin(body.workspaceId, req.user!.id);

    const template = getServiceTemplate(body.templateId);
    if (!template) {
      throw new HttpError(404, "service_template_not_found", "Service template not found.");
    }

    const baseSlug = slugify(body.name);
    const slug = uniqueServiceSlug(body.workspaceId, baseSlug || "service");
    const internalHost = body.internalHost?.trim() || slug;

    const result = await provisionServiceFromTemplate({
      workspaceId: body.workspaceId,
      templateId: body.templateId,
      name: body.name.trim(),
      slug,
      internalHost,
      connectionEnvKey: body.connectionEnvKey?.trim() || null,
      userConfig: body.config
    });

    recordAudit("workspace_service.created", req.user!.id, {
      serviceId: result.service.id,
      workspaceId: body.workspaceId,
      templateId: body.templateId
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

workspaceServiceRouter.get("/:serviceId", async (req, res, next) => {
  try {
    const serviceId = z.string().min(1).parse(req.params.serviceId);
    ensureServiceMember(serviceId, req.user!.id);
    const detail = await getServiceDetail(serviceId);
    res.json(detail);
  } catch (error) {
    next(error);
  }
});

workspaceServiceRouter.get("/:serviceId/runtime", async (req, res, next) => {
  try {
    const serviceId = z.string().min(1).parse(req.params.serviceId);
    ensureServiceMember(serviceId, req.user!.id);
    const runtime = await getServiceRuntime(serviceId);
    res.json({ runtime });
  } catch (error) {
    next(error);
  }
});

workspaceServiceRouter.get("/:serviceId/logs", async (req, res, next) => {
  try {
    const serviceId = z.string().min(1).parse(req.params.serviceId);
    const tail = z.coerce.number().int().positive().max(2000).default(200).parse(req.query.tail);
    ensureServiceMember(serviceId, req.user!.id);
    const lines = await readServiceLogs(serviceId, tail);
    res.json({ lines });
  } catch (error) {
    next(error);
  }
});

workspaceServiceRouter.post("/:serviceId/actions", async (req, res, next) => {
  try {
    const serviceId = z.string().min(1).parse(req.params.serviceId);
    const body = z.object({ action: z.enum(["start", "stop", "restart", "destroy"]) }).parse(req.body);
    ensureServiceAdmin(serviceId, req.user!.id);
    const runtime = await serviceAction(serviceId, body.action);
    recordAudit(`workspace_service.${body.action}`, req.user!.id, { serviceId });
    res.json({ runtime });
  } catch (error) {
    next(error);
  }
});

function ensureWorkspaceAdmin(workspaceId: string, userId: string): void {
  const row = db
    .prepare(
      `SELECT group_members.role
       FROM workspace_groups
       JOIN group_members ON group_members.group_id = workspace_groups.group_id
       WHERE workspace_groups.workspace_id = ? AND group_members.user_id = ?
       ORDER BY CASE group_members.role WHEN 'group_admin' THEN 0 ELSE 1 END
       LIMIT 1`
    )
    .get(workspaceId, userId) as { role: "group_admin" | "group_member" } | undefined;

  if (!row) {
    throw new HttpError(404, "workspace_not_found", "Workspace not found.");
  }
  if (row.role !== "group_admin") {
    throw new HttpError(403, "group_admin_required", "Only group admins can manage services in this workspace.");
  }
}

function ensureServiceMember(serviceId: string, userId: string): void {
  const row = db
    .prepare(
      `SELECT group_members.role
       FROM workspace_services
       JOIN workspace_groups ON workspace_groups.workspace_id = workspace_services.workspace_id
       JOIN group_members ON group_members.group_id = workspace_groups.group_id
       WHERE workspace_services.id = ? AND group_members.user_id = ?
       LIMIT 1`
    )
    .get(serviceId, userId) as { role: string } | undefined;

  if (!row) {
    throw new HttpError(404, "service_not_found", "Service not found.");
  }
}

function ensureServiceAdmin(serviceId: string, userId: string): void {
  const row = db
    .prepare(
      `SELECT group_members.role
       FROM workspace_services
       JOIN workspace_groups ON workspace_groups.workspace_id = workspace_services.workspace_id
       JOIN group_members ON group_members.group_id = workspace_groups.group_id
       WHERE workspace_services.id = ? AND group_members.user_id = ?
       ORDER BY CASE group_members.role WHEN 'group_admin' THEN 0 ELSE 1 END
       LIMIT 1`
    )
    .get(serviceId, userId) as { role: "group_admin" | "group_member" } | undefined;

  if (!row) {
    throw new HttpError(404, "service_not_found", "Service not found.");
  }
  if (row.role !== "group_admin") {
    throw new HttpError(403, "group_admin_required", "Only group admins can run service actions.");
  }
}

function uniqueServiceSlug(workspaceId: string, baseSlug: string): string {
  let slug = baseSlug;
  let suffix = 2;

  while (db.prepare("SELECT id FROM workspace_services WHERE workspace_id = ? AND slug = ?").get(workspaceId, slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return slug;
}
