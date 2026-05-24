import { Router } from "express";
import { z } from "zod";

import { db } from "@/db/database";
import { recordAudit } from "@/modules/audit/audit-service";
import { requireAuth } from "@/modules/auth/auth-middleware";
import { HttpError } from "@/shared/errors/http-error";

import {
  createSnapshot,
  diffSnapshots,
  getSnapshot,
  getSnapshotFiles,
  listSnapshots,
  readSnapshotFile,
  restoreSnapshot,
  restoreSnapshotFile
} from "./snapshot-service";

export const snapshotRouter = Router();
snapshotRouter.use(requireAuth);

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
    throw new HttpError(403, "group_admin_required", "Only group admins can perform this action.");
  }
}

snapshotRouter.get("/projects/:projectId/snapshots", (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectMember(projectId, req.user!.id);
    res.json({ snapshots: listSnapshots(projectId) });
  } catch (error) {
    next(error);
  }
});

snapshotRouter.post("/projects/:projectId/snapshots", async (req, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.params.projectId);
    ensureProjectAdmin(projectId, req.user!.id);
    const body = z
      .object({ message: z.string().min(1).max(500).default("Manual snapshot") })
      .parse(req.body ?? {});
    const snapshot = await createSnapshot({
      projectId,
      message: body.message,
      kind: "manual",
      userId: req.user!.id
    });
    recordAudit("snapshot.created", req.user!.id, {
      snapshotId: snapshot.id,
      projectId,
      kind: snapshot.kind
    });
    res.status(201).json({ snapshot });
  } catch (error) {
    next(error);
  }
});

snapshotRouter.get("/snapshots/:snapshotId", (req, res, next) => {
  try {
    const snapshotId = z.string().min(1).parse(req.params.snapshotId);
    const snapshot = getSnapshot(snapshotId);
    if (snapshot.projectId) ensureProjectMember(snapshot.projectId, req.user!.id);
    res.json({ snapshot });
  } catch (error) {
    next(error);
  }
});

snapshotRouter.get("/snapshots/:snapshotId/files", async (req, res, next) => {
  try {
    const snapshotId = z.string().min(1).parse(req.params.snapshotId);
    const snapshot = getSnapshot(snapshotId);
    if (snapshot.projectId) ensureProjectMember(snapshot.projectId, req.user!.id);
    res.json({ files: await getSnapshotFiles(snapshotId) });
  } catch (error) {
    next(error);
  }
});

snapshotRouter.get("/snapshots/:snapshotId/file", async (req, res, next) => {
  try {
    const snapshotId = z.string().min(1).parse(req.params.snapshotId);
    const filePath = z.string().min(1).parse(req.query.path);
    const snapshot = getSnapshot(snapshotId);
    if (snapshot.projectId) ensureProjectMember(snapshot.projectId, req.user!.id);
    const file = await readSnapshotFile(snapshotId, filePath);
    if (!file) throw new HttpError(404, "snapshot_file_not_found", "File not in snapshot.");
    res.json(file);
  } catch (error) {
    next(error);
  }
});

snapshotRouter.post("/snapshots/:snapshotId/restore", async (req, res, next) => {
  try {
    const snapshotId = z.string().min(1).parse(req.params.snapshotId);
    const body = z.object({ checkpoint: z.boolean().default(true) }).parse(req.body ?? {});
    const snapshot = getSnapshot(snapshotId);
    if (snapshot.projectId) ensureProjectAdmin(snapshot.projectId, req.user!.id);
    const result = await restoreSnapshot(snapshotId, {
      userId: req.user!.id,
      createCheckpoint: body.checkpoint
    });
    recordAudit("snapshot.restored", req.user!.id, {
      snapshotId,
      projectId: snapshot.projectId,
      checkpointId: result.checkpoint?.id ?? null,
      written: result.written,
      removed: result.removed
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

snapshotRouter.post("/snapshots/:snapshotId/restore-file", async (req, res, next) => {
  try {
    const snapshotId = z.string().min(1).parse(req.params.snapshotId);
    const body = z.object({ path: z.string().min(1) }).parse(req.body);
    const snapshot = getSnapshot(snapshotId);
    if (snapshot.projectId) ensureProjectAdmin(snapshot.projectId, req.user!.id);
    const result = await restoreSnapshotFile(snapshotId, body.path);
    recordAudit("snapshot.file_restored", req.user!.id, {
      snapshotId,
      projectId: snapshot.projectId,
      path: body.path
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

snapshotRouter.get("/snapshots/:snapshotId/diff", async (req, res, next) => {
  try {
    const snapshotId = z.string().min(1).parse(req.params.snapshotId);
    const baseId = typeof req.query.base === "string" && req.query.base.length > 0 ? req.query.base : null;
    const snapshot = getSnapshot(snapshotId);
    if (snapshot.projectId) ensureProjectMember(snapshot.projectId, req.user!.id);
    if (baseId) {
      const base = getSnapshot(baseId);
      if (base.projectId && base.projectId !== snapshot.projectId) {
        throw new HttpError(400, "snapshot_project_mismatch", "Snapshots belong to different projects.");
      }
    }
    const diff = await diffSnapshots(baseId, snapshotId);
    res.json({ diff });
  } catch (error) {
    next(error);
  }
});
