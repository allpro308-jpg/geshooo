import { Router } from "express";
import { z } from "zod";

import { db, nowIso, slugify } from "@/db/database";
import { mapProject } from "@/db/mappers";
import { recordAudit } from "@/modules/audit/audit-service";
import { requireAuth } from "@/modules/auth/auth-middleware";
import { resolveGroupLimits } from "@/modules/groups/group-service";
import { decryptSecret, encryptSecret } from "@/shared/crypto/secrets";
import { HttpError } from "@/shared/errors/http-error";
import { createId } from "@/shared/ids/id";

import {
  copyEntry,
  createEntry,
  deleteEntry,
  listDirectory,
  readFileContent,
  renameEntry,
  resolveProjectRoot,
  writeFileContent
} from "./project-filesystem";
import {
  destroyProjectContainer,
  ensureProjectContainer,
  getProjectRuntimeInfo,
  loadProject,
  readBufferedLogs,
  readLogStats,
  regeneratePreviewToken,
  resetLogStats,
  resolveTemplate,
  restartProjectContainer,
  stopProjectContainer
} from "./project-runtime";
import { getScaffoldFor } from "./project-scaffolds";
import { createShell, destroyShell, listShells } from "./project-shells";
import { getProjectTemplate } from "./project-templates";

const runtimeKinds = [
  "node",
  "bun",
  "deno",
  "python",
  "go",
  "rust",
  "php",
  "static",
  "database_sqlite",
  "redis",
  "custom_dockerfile",
  "custom_compose"
] as const;

const createProjectSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(2).max(120),
  runtimeKind: z.enum(runtimeKinds).default("node"),
  templateId: z.string().min(1).max(120).optional(),
  sourcePath: z.string().min(1).max(500).optional()
});

export const projectRouter = Router();

projectRouter.use(requireAuth);

projectRouter.get("/", (req, res) => {
  const workspaceId = z.string().optional().parse(req.query.workspaceId);
  const params: string[] = [req.user!.id];
  let workspaceFilter = "";

  if (workspaceId) {
    params.push(workspaceId);
    workspaceFilter = "AND projects.workspace_id = ?";
  }

  const rows = db
    .prepare(
      `SELECT projects.*
       FROM projects
       JOIN workspace_groups ON workspace_groups.workspace_id = projects.workspace_id
       JOIN group_members ON group_members.group_id = workspace_groups.group_id
       WHERE group_members.user_id = ?
       ${workspaceFilter}
       ORDER BY projects.updated_at DESC`
    )
    .all(...params);

  res.json({ projects: rows.map((row) => mapProject(row as Parameters<typeof mapProject>[0])) });
});

projectRouter.post("/", (req, res, next) => {
  try {
    const body = createProjectSchema.parse(req.body);
    const access = ensureWorkspaceAccess(body.workspaceId, req.user!.id);
    if (access.group_role !== "group_admin") {
      throw new HttpError(403, "group_admin_required", "Only group admins can create projects in this workspace.");
    }
    const limits = resolveGroupLimits(access.group_id, false);
    if (limits.maxProjectsPerWorkspace !== null) {
      const count = db
        .prepare("SELECT COUNT(*) as count FROM projects WHERE workspace_id = ?")
        .get(body.workspaceId) as { count: number };
      if (count.count >= limits.maxProjectsPerWorkspace) {
        throw new HttpError(403, "project_limit_reached", "The project limit for this workspace has been reached.");
      }
    }

    const id = createId("prj");
    const now = nowIso();
    const baseSlug = slugify(body.name);
    const slug = uniqueProjectSlug(body.workspaceId, baseSlug || "project");
    const sourcePath = body.sourcePath?.trim() || `workspaces/${body.workspaceId}/projects/${id}/current`;

    const template = body.templateId ? getProjectTemplate(body.templateId) : null;
    if (body.templateId && !template) {
      throw new HttpError(400, "unknown_template", "Unknown project template.");
    }
    const runtimeKind = template?.runtimeKind ?? body.runtimeKind;
    const image = template?.image ?? null;
    const installCommand = template?.installCommand ?? null;
    const startCommand = template?.startCommand ?? null;

    db.prepare(
      `INSERT INTO projects (id, workspace_id, name, slug, type, runtime_kind, source_path, template_id, image, install_command, start_command, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      body.workspaceId,
      body.name.trim(),
      slug,
      "app",
      runtimeKind,
      sourcePath,
      template?.id ?? null,
      image,
      installCommand,
      startCommand,
      now,
      now
    );

    recordAudit("project.created", req.user!.id, {
      projectId: id,
      workspaceId: body.workspaceId,
      name: body.name,
      templateId: template?.id ?? null
    });

    void seedProject(id, body.name.trim(), runtimeKind, template?.id ?? null).catch(() => undefined);

    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    res.status(201).json({ project: mapProject(row as Parameters<typeof mapProject>[0]) });
  } catch (error) {
    next(error);
  }
});

projectRouter.get("/:projectId", (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectMember(projectId, req.user!.id);
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
    if (!row) throw new HttpError(404, "project_not_found", "Project not found.");
    res.json({ project: mapProject(row as Parameters<typeof mapProject>[0]) });
  } catch (error) {
    next(error);
  }
});

projectRouter.get("/:projectId/files", async (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectMember(projectId, req.user!.id);
    const dirPath = z.string().optional().parse(req.query.path) ?? "";
    const { root } = await resolveProjectRoot(projectId);
    const entries = await listDirectory(root, dirPath);
    res.json({ entries, path: dirPath });
  } catch (error) {
    next(error);
  }
});

projectRouter.get("/:projectId/file", async (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectMember(projectId, req.user!.id);
    const filePath = z.string().min(1).parse(req.query.path);
    const { root } = await resolveProjectRoot(projectId);
    const file = await readFileContent(root, filePath);
    res.json(file);
  } catch (error) {
    next(error);
  }
});

projectRouter.put("/:projectId/file", async (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectAdmin(projectId, req.user!.id);
    const body = z.object({ path: z.string().min(1), content: z.string() }).parse(req.body);
    const { root } = await resolveProjectRoot(projectId);
    const entry = await writeFileContent(root, body.path, body.content);
    res.json({ entry });
  } catch (error) {
    next(error);
  }
});

projectRouter.post("/:projectId/files", async (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectAdmin(projectId, req.user!.id);
    const body = z
      .object({
        path: z.string().min(1),
        type: z.enum(["file", "directory"]).default("file")
      })
      .parse(req.body);
    const { root } = await resolveProjectRoot(projectId);
    const entry = await createEntry(root, body.path, body.type);
    res.status(201).json({ entry });
  } catch (error) {
    next(error);
  }
});

projectRouter.post("/:projectId/files/rename", async (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectAdmin(projectId, req.user!.id);
    const body = z.object({ from: z.string().min(1), to: z.string().min(1) }).parse(req.body);
    const { root } = await resolveProjectRoot(projectId);
    const entry = await renameEntry(root, body.from, body.to);
    res.json({ entry });
  } catch (error) {
    next(error);
  }
});

projectRouter.post("/:projectId/files/copy", async (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectAdmin(projectId, req.user!.id);
    const body = z.object({ from: z.string().min(1), to: z.string().min(1) }).parse(req.body);
    const { root } = await resolveProjectRoot(projectId);
    const entry = await copyEntry(root, body.from, body.to);
    res.status(201).json({ entry });
  } catch (error) {
    next(error);
  }
});

projectRouter.delete("/:projectId/files", async (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectAdmin(projectId, req.user!.id);
    const filePath = z.string().min(1).parse(req.query.path);
    const { root } = await resolveProjectRoot(projectId);
    await deleteEntry(root, filePath);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

projectRouter.get("/:projectId/env", (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectMember(projectId, req.user!.id);
    const rows = db
      .prepare("SELECT * FROM env_vars WHERE scope_type = 'project' AND scope_id = ? ORDER BY key ASC")
      .all(projectId) as Array<{
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

projectRouter.post("/:projectId/env", (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectAdmin(projectId, req.user!.id);
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
       VALUES (?, 'project', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`
    ).run(id, projectId, body.key, encryptSecret(body.value), body.isSecret ? 1 : 0, req.user!.id, now, now);
    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

projectRouter.patch("/:projectId/env/:envId", (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    const envId = z.string().min(1).parse(req.params.envId);
    ensureProjectAdmin(projectId, req.user!.id);
    const body = z
      .object({
        value: z.string().optional(),
        isSecret: z.boolean().optional()
      })
      .parse(req.body);
    const existing = db
      .prepare("SELECT * FROM env_vars WHERE id = ? AND scope_type = 'project' AND scope_id = ?")
      .get(envId, projectId) as { encrypted_value: string; is_secret: number } | undefined;
    if (!existing) throw new HttpError(404, "env_not_found", "Env var not found.");

    const newEncrypted = body.value !== undefined ? encryptSecret(body.value) : existing.encrypted_value;
    const newSecret = body.isSecret === undefined ? existing.is_secret : body.isSecret ? 1 : 0;
    db.prepare(
      `UPDATE env_vars SET encrypted_value = ?, is_secret = ?, updated_at = ? WHERE id = ?`
    ).run(newEncrypted, newSecret, nowIso(), envId);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

projectRouter.delete("/:projectId/env/:envId", (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    const envId = z.string().min(1).parse(req.params.envId);
    ensureProjectAdmin(projectId, req.user!.id);
    db.prepare("DELETE FROM env_vars WHERE id = ? AND scope_type = 'project' AND scope_id = ?").run(
      envId,
      projectId
    );
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

projectRouter.patch("/:projectId", (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectAdmin(projectId, req.user!.id);
    const body = z
      .object({
        name: z.string().min(2).max(120).optional(),
        templateId: z.string().min(1).max(120).nullable().optional(),
        installCommand: z.string().max(500).nullable().optional(),
        startCommand: z.string().max(500).nullable().optional()
      })
      .parse(req.body);

    const updates: string[] = [];
    const args: Array<string | number | null> = [];
    const setField = (col: string, value: string | number | null | undefined) => {
      if (value === undefined) return;
      updates.push(`${col} = ?`);
      args.push(typeof value === "string" && value === "" ? null : value);
    };
    setField("name", body.name?.trim());
    if (body.templateId !== undefined) {
      const tpl = body.templateId ? getProjectTemplate(body.templateId) : null;
      if (body.templateId && !tpl) {
        throw new HttpError(400, "unknown_template", "Unknown project template.");
      }
      setField("template_id", body.templateId);
      setField("image", tpl ? tpl.image : null);
      if (tpl) setField("runtime_kind", tpl.runtimeKind);
    }
    setField("install_command", body.installCommand === null ? null : body.installCommand?.trim());
    setField("start_command", body.startCommand === null ? null : body.startCommand?.trim());
    if (updates.length === 0) {
      res.json({ project: loadProject(projectId) });
      return;
    }
    updates.push("updated_at = ?");
    args.push(nowIso());
    args.push(projectId);
    db.prepare(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`).run(...args);
    recordAudit("project.updated", req.user!.id, { projectId });
    res.json({ project: loadProject(projectId) });
  } catch (error) {
    next(error);
  }
});

projectRouter.get("/:projectId/runtime", async (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectMember(projectId, req.user!.id);
    const project = loadProject(projectId);
    const runtime = await getProjectRuntimeInfo(project);
    const template = resolveTemplate(project);
    res.json({ runtime, template });
  } catch (error) {
    next(error);
  }
});

projectRouter.post("/:projectId/runtime/actions", async (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectAdmin(projectId, req.user!.id);
    const body = z.object({ action: z.enum(["start", "stop", "restart", "destroy"]) }).parse(req.body);
    const project = loadProject(projectId);
    let runtime;
    if (body.action === "start") {
      runtime = (await ensureProjectContainer(project)).runtime;
    } else if (body.action === "stop") {
      runtime = await stopProjectContainer(project);
    } else if (body.action === "restart") {
      runtime = await restartProjectContainer(project);
    } else {
      await destroyProjectContainer(project);
      runtime = await getProjectRuntimeInfo(loadProject(projectId));
    }
    recordAudit(`project.${body.action}`, req.user!.id, { projectId });
    res.json({ runtime });
  } catch (error) {
    next(error);
  }
});

projectRouter.get("/:projectId/runtime/logs", (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectMember(projectId, req.user!.id);
    const limit = z.coerce.number().int().positive().max(2000).default(300).parse(req.query.limit);
    res.json({ lines: readBufferedLogs(projectId, limit), stats: readLogStats(projectId) });
  } catch (error) {
    next(error);
  }
});

projectRouter.post("/:projectId/runtime/logs/clear", (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectMember(projectId, req.user!.id);
    resetLogStats(projectId);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

projectRouter.get("/:projectId/shells", (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectMember(projectId, req.user!.id);
    res.json({ shells: listShells(projectId) });
  } catch (error) {
    next(error);
  }
});

projectRouter.post("/:projectId/shells", async (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectAdmin(projectId, req.user!.id);
    const body = z.object({ label: z.string().max(80).optional() }).parse(req.body ?? {});
    const shell = await createShell(projectId, body.label);
    recordAudit("project.shell_opened", req.user!.id, { projectId, shellId: shell.id });
    res.status(201).json({ shell });
  } catch (error) {
    next(error);
  }
});

projectRouter.delete("/:projectId/shells/:shellId", async (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    const shellId = z.string().min(1).parse(req.params.shellId);
    ensureProjectAdmin(projectId, req.user!.id);
    await destroyShell(shellId);
    recordAudit("project.shell_closed", req.user!.id, { projectId, shellId });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

projectRouter.post("/:projectId/preview-token", (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectAdmin(projectId, req.user!.id);
    const token = regeneratePreviewToken(projectId);
    recordAudit("project.preview_token_regenerated", req.user!.id, { projectId });
    res.json({ previewToken: token });
  } catch (error) {
    next(error);
  }
});

async function seedProject(
  projectId: string,
  name: string,
  runtimeKind: string,
  templateId: string | null
): Promise<void> {
  const { root } = await resolveProjectRoot(projectId);
  const files = getScaffoldFor(templateId, runtimeKind, name);
  for (const file of files) {
    await writeFileContent(root, file.path, file.content);
  }
}

function ensureProjectMember(projectId: string, userId: string): void {
  const row = db
    .prepare(
      `SELECT 1
       FROM projects
       JOIN workspace_groups ON workspace_groups.workspace_id = projects.workspace_id
       JOIN group_members ON group_members.group_id = workspace_groups.group_id
       WHERE projects.id = ? AND group_members.user_id = ?
       LIMIT 1`
    )
    .get(projectId, userId);
  if (!row) throw new HttpError(404, "project_not_found", "Project not found.");
}

function ensureProjectAdmin(projectId: string, userId: string): void {
  const row = db
    .prepare(
      `SELECT group_members.role
       FROM projects
       JOIN workspace_groups ON workspace_groups.workspace_id = projects.workspace_id
       JOIN group_members ON group_members.group_id = workspace_groups.group_id
       WHERE projects.id = ? AND group_members.user_id = ?
       ORDER BY CASE group_members.role WHEN 'group_admin' THEN 0 ELSE 1 END
       LIMIT 1`
    )
    .get(projectId, userId) as { role: "group_admin" | "group_member" } | undefined;
  if (!row) throw new HttpError(404, "project_not_found", "Project not found.");
  if (row.role !== "group_admin") {
    throw new HttpError(403, "group_admin_required", "Only group admins can modify this project.");
  }
}

function ensureWorkspaceAccess(workspaceId: string, userId: string): { group_id: string; group_role: "group_admin" | "group_member" } {
  const row = db
    .prepare(
      `SELECT workspace_groups.group_id, group_members.role as group_role
       FROM workspaces
       JOIN workspace_groups ON workspace_groups.workspace_id = workspaces.id
       JOIN group_members ON group_members.group_id = workspace_groups.group_id
       WHERE workspaces.id = ? AND group_members.user_id = ?
       ORDER BY CASE group_members.role WHEN 'group_admin' THEN 0 ELSE 1 END
       LIMIT 1`
    )
    .get(workspaceId, userId) as { group_id: string; group_role: "group_admin" | "group_member" } | undefined;

  if (!row) {
    throw new HttpError(404, "workspace_not_found", "Workspace not found.");
  }
  return row;
}

function uniqueProjectSlug(workspaceId: string, baseSlug: string): string {
  let slug = baseSlug;
  let suffix = 2;

  while (
    db
      .prepare("SELECT id FROM projects WHERE workspace_id = ? AND slug = ?")
      .get(workspaceId, slug)
  ) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return slug;
}
