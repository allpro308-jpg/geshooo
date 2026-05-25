import fs from "node:fs/promises";
import path from "node:path";

import type {
  Snapshot,
  SnapshotDiff,
  SnapshotDiffEntry,
  SnapshotFileEntry,
  SnapshotKind
} from "@singulary/shared";

import { db, nowIso } from "@/db/database";
import { resolveProjectRoot } from "@/modules/projects/project-filesystem";
import { HttpError } from "@/shared/errors/http-error";
import { createId } from "@/shared/ids/id";

import {
  captureTree,
  readFileFromTree,
  readTree,
  restoreTree
} from "./snapshot-storage";

type SnapshotRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  parent_snapshot_id: string | null;
  created_by_session_id: string | null;
  created_by_user_id: string | null;
  title: string | null;
  message: string;
  kind: SnapshotKind;
  tree_sha: string | null;
  file_count: number;
  total_bytes: number;
  created_at: string;
};

function mapSnapshot(row: SnapshotRow): Snapshot {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    parentSnapshotId: row.parent_snapshot_id,
    createdBySessionId: row.created_by_session_id,
    createdByUserId: row.created_by_user_id,
    title: row.title,
    message: row.message,
    kind: row.kind,
    treeSha: row.tree_sha ?? "",
    fileCount: row.file_count ?? 0,
    totalBytes: row.total_bytes ?? 0,
    createdAt: row.created_at
  };
}

export interface CreateSnapshotInput {
  projectId: string;
  message: string;
  /** Optional short human-readable label shown in the UI. */
  title?: string | null;
  kind?: SnapshotKind;
  userId: string | null;
  sessionId?: string | null;
}

export async function createSnapshot(input: CreateSnapshotInput): Promise<Snapshot> {
  const projectRow = db
    .prepare("SELECT workspace_id, source_path FROM projects WHERE id = ?")
    .get(input.projectId) as { workspace_id: string; source_path: string } | undefined;
  if (!projectRow) {
    throw new HttpError(404, "project_not_found", "Project not found.");
  }

  const { root } = await resolveProjectRoot(input.projectId);
  const tree = await captureTree(root);

  const lastSnapshot = db
    .prepare(
      "SELECT id, tree_sha FROM snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT 1"
    )
    .get(input.projectId) as { id: string; tree_sha: string | null } | undefined;

  if (lastSnapshot && lastSnapshot.tree_sha === tree.treeSha && input.kind !== "manual") {
    // No changes since the previous snapshot — return that one instead of churning.
    const row = db.prepare("SELECT * FROM snapshots WHERE id = ?").get(lastSnapshot.id) as SnapshotRow;
    // If we have a title and the existing snapshot has none, attach it.
    if (input.title && !row.title) {
      db.prepare("UPDATE snapshots SET title = ? WHERE id = ?").run(input.title, row.id);
      row.title = input.title;
    }
    return mapSnapshot(row);
  }

  const id = createId("snp");
  const now = nowIso();
  db.prepare(
    `INSERT INTO snapshots (
       id, workspace_id, project_id, parent_snapshot_id, created_by_session_id,
       created_by_user_id, title, message, kind, tree_sha, file_count, total_bytes, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    projectRow.workspace_id,
    input.projectId,
    lastSnapshot?.id ?? null,
    input.sessionId ?? null,
    input.userId,
    input.title ?? null,
    input.message,
    input.kind ?? "manual",
    tree.treeSha,
    tree.entries.length,
    tree.totalBytes,
    now
  );

  const row = db.prepare("SELECT * FROM snapshots WHERE id = ?").get(id) as SnapshotRow;
  return mapSnapshot(row);
}

export function updateSnapshotTitle(snapshotId: string, title: string): Snapshot | null {
  db.prepare("UPDATE snapshots SET title = ? WHERE id = ?").run(title, snapshotId);
  const row = db.prepare("SELECT * FROM snapshots WHERE id = ?").get(snapshotId) as
    | SnapshotRow
    | undefined;
  return row ? mapSnapshot(row) : null;
}

export function listSnapshots(projectId: string, limit = 100): Snapshot[] {
  const rows = db
    .prepare(
      "SELECT * FROM snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(projectId, limit) as SnapshotRow[];
  return rows.map(mapSnapshot);
}

export function getSnapshot(snapshotId: string): Snapshot {
  const row = db.prepare("SELECT * FROM snapshots WHERE id = ?").get(snapshotId) as
    | SnapshotRow
    | undefined;
  if (!row) throw new HttpError(404, "snapshot_not_found", "Snapshot not found.");
  return mapSnapshot(row);
}

export async function getSnapshotFiles(snapshotId: string): Promise<SnapshotFileEntry[]> {
  const snapshot = getSnapshot(snapshotId);
  if (!snapshot.treeSha) return [];
  const entries = await readTree(snapshot.treeSha);
  return entries.map((e) => ({ path: e.path, blobSha: e.blobSha, size: e.size }));
}

export async function readSnapshotFile(
  snapshotId: string,
  filePath: string
): Promise<{ content: string; binary: boolean; size: number } | null> {
  const snapshot = getSnapshot(snapshotId);
  if (!snapshot.treeSha) return null;
  const buffer = await readFileFromTree(snapshot.treeSha, filePath);
  if (!buffer) return null;
  const isBinary = looksBinary(buffer);
  return {
    content: isBinary ? "" : buffer.toString("utf8"),
    binary: isBinary,
    size: buffer.length
  };
}

export async function restoreSnapshot(
  snapshotId: string,
  options: { userId: string | null; createCheckpoint?: boolean }
): Promise<{ snapshot: Snapshot; written: number; removed: number; checkpoint: Snapshot | null }> {
  const snapshot = getSnapshot(snapshotId);
  if (!snapshot.projectId || !snapshot.treeSha) {
    throw new HttpError(400, "snapshot_unrestorable", "Snapshot is not restorable.");
  }

  let checkpoint: Snapshot | null = null;
  if (options.createCheckpoint !== false) {
    checkpoint = await createSnapshot({
      projectId: snapshot.projectId,
      message: `Checkpoint before restoring ${snapshot.id}`,
      kind: "checkpoint",
      userId: options.userId
    });
  }

  const { root } = await resolveProjectRoot(snapshot.projectId);
  const { written, removed } = await restoreTree(root, snapshot.treeSha);
  return { snapshot, written, removed, checkpoint };
}

export async function restoreSnapshotFile(
  snapshotId: string,
  filePath: string
): Promise<{ snapshot: Snapshot; restored: boolean }> {
  const snapshot = getSnapshot(snapshotId);
  if (!snapshot.projectId || !snapshot.treeSha) {
    throw new HttpError(400, "snapshot_unrestorable", "Snapshot is not restorable.");
  }
  const buffer = await readFileFromTree(snapshot.treeSha, filePath);
  if (!buffer) {
    return { snapshot, restored: false };
  }
  const { root } = await resolveProjectRoot(snapshot.projectId);
  const target = resolveJoined(root, filePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  return { snapshot, restored: true };
}

export async function diffSnapshots(
  baseSnapshotId: string | null,
  targetSnapshotId: string
): Promise<SnapshotDiff> {
  const target = getSnapshot(targetSnapshotId);
  if (!target.treeSha) {
    return { baseSnapshotId, targetSnapshotId, entries: [] };
  }
  const targetEntries = await readTree(target.treeSha);
  const targetMap = new Map(targetEntries.map((e) => [e.path, e]));

  const baseEntries = baseSnapshotId
    ? await loadEntries(baseSnapshotId)
    : [];
  const baseMap = new Map(baseEntries.map((e) => [e.path, e]));

  const allPaths = new Set<string>();
  for (const e of targetEntries) allPaths.add(e.path);
  for (const e of baseEntries) allPaths.add(e.path);

  const entries: SnapshotDiffEntry[] = Array.from(allPaths)
    .sort()
    .map((path) => {
      const before = baseMap.get(path);
      const after = targetMap.get(path);
      if (!before && after) {
        return { path, status: "added" as const, beforeSize: null, afterSize: after.size };
      }
      if (before && !after) {
        return { path, status: "removed" as const, beforeSize: before.size, afterSize: null };
      }
      if (before && after) {
        if (before.blobSha === after.blobSha) {
          return { path, status: "unchanged" as const, beforeSize: before.size, afterSize: after.size };
        }
        return { path, status: "modified" as const, beforeSize: before.size, afterSize: after.size };
      }
      return { path, status: "unchanged" as const, beforeSize: null, afterSize: null };
    });

  return { baseSnapshotId, targetSnapshotId, entries };
}

async function loadEntries(snapshotId: string) {
  const snapshot = getSnapshot(snapshotId);
  if (!snapshot.treeSha) return [];
  return readTree(snapshot.treeSha);
}

function looksBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 4096);
  for (let i = 0; i < limit; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function resolveJoined(root: string, rel: string): string {
  const resolved = path.resolve(root, rel.replace(/^\/+/, ""));
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new HttpError(400, "invalid_path", "Path is outside the project root.");
  }
  return resolved;
}

// --- agent helpers -------------------------------------------------------

/**
 * Per-turn snapshot state for an agent session. Tracks:
 * - whether a pre-write snapshot was already taken this turn, and
 * - the pending human-readable title the agent set for this turn (so the next
 *   pre-write snapshot gets it).
 *
 * Reset at the start of every agent turn by `resetAgentSessionSnapshotState`.
 */
type SessionSnapshotState = {
  snapshotId: string | null;
  pendingTitle: string | null;
};

const sessionSnapshotState = new Map<string, SessionSnapshotState>();

function getState(sessionId: string): SessionSnapshotState {
  let state = sessionSnapshotState.get(sessionId);
  if (!state) {
    state = { snapshotId: null, pendingTitle: null };
    sessionSnapshotState.set(sessionId, state);
  }
  return state;
}

/**
 * Record the title the agent wants on the current turn's snapshot. If a
 * pre-write snapshot already exists for this turn, update it in place.
 * Returns whether the title was applied to an existing snapshot or stashed
 * for the next one.
 */
export function setSessionChangeTitle(
  sessionId: string,
  title: string
): { applied: "updated" | "stashed"; snapshotId: string | null } {
  const state = getState(sessionId);
  state.pendingTitle = title;
  if (state.snapshotId) {
    updateSnapshotTitle(state.snapshotId, title);
    return { applied: "updated", snapshotId: state.snapshotId };
  }
  return { applied: "stashed", snapshotId: null };
}

/**
 * Make sure there is a fresh "before AI write" snapshot for this turn.
 * Returns the snapshot if one was created (or already exists for this turn).
 */
export async function ensureAgentPreWriteSnapshot(
  projectId: string,
  sessionId: string,
  userId: string | null
): Promise<Snapshot | null> {
  const state = getState(sessionId);
  if (state.snapshotId) return null;
  try {
    const snapshot = await createSnapshot({
      projectId,
      message: `Auto-snapshot before agent edits (session ${sessionId})`,
      title: state.pendingTitle,
      kind: "agent_pre_write",
      userId,
      sessionId
    });
    state.snapshotId = snapshot.id;
    return snapshot;
  } catch {
    return null;
  }
}

export function resetAgentSessionSnapshotState(sessionId: string): void {
  sessionSnapshotState.delete(sessionId);
}
