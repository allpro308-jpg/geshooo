import { Router } from "express";
import { z } from "zod";

import { db, nowIso, slugify } from "@/db/database";
import { mapWorkspace } from "@/db/mappers";
import { recordAudit } from "@/modules/audit/audit-service";
import { requireAuth } from "@/modules/auth/auth-middleware";
import { attachWorkspaceToGroup, getPersonalGroupId, resolveGroupLimits } from "@/modules/groups/group-service";
import { decryptSecret, encryptSecret } from "@/shared/crypto/secrets";
import { HttpError } from "@/shared/errors/http-error";
import { createId } from "@/shared/ids/id";

const createWorkspaceSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  groupId: z.string().min(1).optional()
});

export const workspaceRouter = Router();

workspaceRouter.use(requireAuth);

workspaceRouter.get("/", (req, res) => {
  const rows = db
    .prepare(
      `SELECT workspaces.*
       FROM workspaces
       JOIN workspace_groups ON workspace_groups.workspace_id = workspaces.id
       JOIN group_members ON group_members.group_id = workspace_groups.group_id
       WHERE group_members.user_id = ?
       ORDER BY workspaces.updated_at DESC`
    )
    .all(req.user!.id);

  res.json({ workspaces: rows.map((row) => mapWorkspace(row as Parameters<typeof mapWorkspace>[0])) });
});

workspaceRouter.post("/", (req, res, next) => {
  try {
    const body = createWorkspaceSchema.parse(req.body);
    const organization = db
      .prepare("SELECT organization_id FROM organization_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1")
      .get(req.user!.id) as { organization_id: string } | undefined;

    if (!organization) {
      throw new HttpError(400, "missing_organization", "The current user is not attached to an organization.");
    }

    const id = createId("wsp");
    const now = nowIso();
    const personalGroupId = getPersonalGroupId(req.user!.id);

    // Resolve target group: explicit groupId (the user must be a group_admin
    // there) or the user's personal group as a fallback.
    let targetGroupId = personalGroupId;
    let isPersonal = true;
    if (body.groupId && body.groupId !== personalGroupId) {
      const membership = db
        .prepare(
          "SELECT role FROM group_members WHERE group_id = ? AND user_id = ?"
        )
        .get(body.groupId, req.user!.id) as { role: "group_admin" | "group_member" } | undefined;
      if (!membership || membership.role !== "group_admin") {
        throw new HttpError(
          403,
          "group_admin_required",
          "You must be a group admin to create workspaces in this group."
        );
      }
      targetGroupId = body.groupId;
      isPersonal = false;
    }

    const limits = resolveGroupLimits(targetGroupId, isPersonal);
    if (limits.maxWorkspaces !== null) {
      const count = db
        .prepare("SELECT COUNT(*) as count FROM workspace_groups WHERE group_id = ?")
        .get(targetGroupId) as { count: number };
      if (count.count >= limits.maxWorkspaces) {
        throw new HttpError(403, "workspace_limit_reached", "The workspace limit for this group has been reached.");
      }
    }
    const baseSlug = slugify(body.name);
    const slug = uniqueWorkspaceSlug(organization.organization_id, baseSlug || "workspace");

    db.prepare(
      `INSERT INTO workspaces (id, organization_id, name, slug, description, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, organization.organization_id, body.name.trim(), slug, body.description?.trim() || null, req.user!.id, now, now);
    attachWorkspaceToGroup(id, targetGroupId);

    recordAudit("workspace.created", req.user!.id, {
      workspaceId: id,
      name: body.name,
      groupId: targetGroupId
    });

    const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id);
    res.status(201).json({ workspace: mapWorkspace(row as Parameters<typeof mapWorkspace>[0]) });
  } catch (error) {
    next(error);
  }
});

// --- workspace env vars --------------------------------------------------

function ensureWorkspaceMember(workspaceId: string, userId: string): "group_admin" | "group_member" {
  const row = db
    .prepare(
      `SELECT group_members.role
       FROM workspaces
       JOIN workspace_groups ON workspace_groups.workspace_id = workspaces.id
       JOIN group_members ON group_members.group_id = workspace_groups.group_id
       WHERE workspaces.id = ? AND group_members.user_id = ?
       ORDER BY CASE group_members.role WHEN 'group_admin' THEN 0 ELSE 1 END
       LIMIT 1`
    )
    .get(workspaceId, userId) as { role: "group_admin" | "group_member" } | undefined;
  if (!row) throw new HttpError(404, "workspace_not_found", "Workspace not found.");
  return row.role;
}

workspaceRouter.get("/:workspaceId/env", (req, res, next) => {
  try {
    const workspaceId = z.string().min(1).parse(req.params.workspaceId);
    ensureWorkspaceMember(workspaceId, req.user!.id);
    const rows = db
      .prepare(
        "SELECT * FROM env_vars WHERE scope_type = 'workspace' AND scope_id = ? ORDER BY key ASC"
      )
      .all(workspaceId) as Array<{
      id: string;
      key: string;
      encrypted_value: string;
      is_secret: number;
      created_at: string;
      updated_at: string;
    }>;
    const vars = rows.map((row) => ({
      id: row.id,
      key: row.key,
      value: row.is_secret === 1 ? null : decryptSecret(row.encrypted_value),
      isSecret: row.is_secret === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
    res.json({ vars });
  } catch (error) {
    next(error);
  }
});

workspaceRouter.post("/:workspaceId/env", (req, res, next) => {
  try {
    const workspaceId = z.string().min(1).parse(req.params.workspaceId);
    const role = ensureWorkspaceMember(workspaceId, req.user!.id);
    if (role !== "group_admin") {
      throw new HttpError(403, "group_admin_required", "Only group admins can edit workspace env vars.");
    }
    const body = z
      .object({
        key: z.string().min(1).max(160).regex(/^[A-Z_][A-Z0-9_]*$/),
        value: z.string(),
        isSecret: z.boolean().default(true)
      })
      .parse(req.body);
    const now = nowIso();
    const id = createId("env");
    db.prepare(
      `INSERT INTO env_vars (id, scope_type, scope_id, key, encrypted_value, is_secret, created_by, created_at, updated_at)
       VALUES (?, 'workspace', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`
    ).run(id, workspaceId, body.key, encryptSecret(body.value), body.isSecret ? 1 : 0, req.user!.id, now, now);
    recordAudit("workspace.env_var_created", req.user!.id, { workspaceId, key: body.key });
    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

workspaceRouter.patch("/:workspaceId/env/:envId", (req, res, next) => {
  try {
    const workspaceId = z.string().min(1).parse(req.params.workspaceId);
    const envId = z.string().min(1).parse(req.params.envId);
    const role = ensureWorkspaceMember(workspaceId, req.user!.id);
    if (role !== "group_admin") {
      throw new HttpError(403, "group_admin_required", "Only group admins can edit workspace env vars.");
    }
    const body = z.object({ value: z.string().optional(), isSecret: z.boolean().optional() }).parse(req.body);
    const existing = db
      .prepare(
        "SELECT encrypted_value, is_secret, key FROM env_vars WHERE id = ? AND scope_type = 'workspace' AND scope_id = ?"
      )
      .get(envId, workspaceId) as { encrypted_value: string; is_secret: number; key: string } | undefined;
    if (!existing) throw new HttpError(404, "env_not_found", "Env var not found.");
    const newEncrypted = body.value !== undefined ? encryptSecret(body.value) : existing.encrypted_value;
    const newSecret = body.isSecret === undefined ? existing.is_secret : body.isSecret ? 1 : 0;
    db.prepare(
      "UPDATE env_vars SET encrypted_value = ?, is_secret = ?, updated_at = ? WHERE id = ?"
    ).run(newEncrypted, newSecret, nowIso(), envId);
    recordAudit("workspace.env_var_updated", req.user!.id, { workspaceId, key: existing.key });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

workspaceRouter.delete("/:workspaceId/env/:envId", (req, res, next) => {
  try {
    const workspaceId = z.string().min(1).parse(req.params.workspaceId);
    const envId = z.string().min(1).parse(req.params.envId);
    const role = ensureWorkspaceMember(workspaceId, req.user!.id);
    if (role !== "group_admin") {
      throw new HttpError(403, "group_admin_required", "Only group admins can edit workspace env vars.");
    }
    db.prepare("DELETE FROM env_vars WHERE id = ? AND scope_type = 'workspace' AND scope_id = ?").run(
      envId,
      workspaceId
    );
    recordAudit("workspace.env_var_deleted", req.user!.id, { workspaceId, envId });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

function uniqueWorkspaceSlug(organizationId: string, baseSlug: string): string {
  let slug = baseSlug;
  let suffix = 2;

  while (
    db
      .prepare("SELECT id FROM workspaces WHERE organization_id = ? AND slug = ?")
      .get(organizationId, slug)
  ) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return slug;
}
