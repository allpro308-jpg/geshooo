import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { config } from "@/config";

/**
 * Content-addressed blob and tree store.
 *
 * - Blobs are file contents hashed with SHA-256 and stored as
 *   `storage/snapshots/blobs/<aa>/<sha256>`.
 * - Trees are JSON arrays of `{ path, blobSha, size }` entries sorted by path,
 *   hashed again so identical trees dedupe, stored as
 *   `storage/snapshots/trees/<sha256>.json`.
 *
 * Restoring a snapshot writes every blob back into the project working tree
 * and removes any file not present in the tree.
 */

export const SNAPSHOTS_ROOT = path.resolve(config.storageRoot, "snapshots");
const BLOBS_ROOT = path.join(SNAPSHOTS_ROOT, "blobs");
const TREES_ROOT = path.join(SNAPSHOTS_ROOT, "trees");

/** File entries that should never be snapshotted or restored. */
const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  ".cache",
  "build",
  "out",
  "target",
  "vendor"
]);

export interface TreeEntry {
  path: string;
  blobSha: string;
  size: number;
}

export interface CapturedTree {
  treeSha: string;
  entries: TreeEntry[];
  totalBytes: number;
}

export async function ensureStorage(): Promise<void> {
  await fs.mkdir(BLOBS_ROOT, { recursive: true });
  await fs.mkdir(TREES_ROOT, { recursive: true });
}

function blobPath(sha: string): string {
  return path.join(BLOBS_ROOT, sha.slice(0, 2), sha);
}

function treePath(sha: string): string {
  return path.join(TREES_ROOT, `${sha}.json`);
}

async function sha256OfBuffer(data: Buffer): Promise<string> {
  return createHash("sha256").update(data).digest("hex");
}

async function writeBlob(buffer: Buffer): Promise<string> {
  const sha = await sha256OfBuffer(buffer);
  const target = blobPath(sha);
  try {
    await fs.access(target);
    return sha;
  } catch {
    // not present yet
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  return sha;
}

async function readBlob(sha: string): Promise<Buffer> {
  return fs.readFile(blobPath(sha));
}

async function walk(root: string, rel: string, entries: TreeEntry[]): Promise<void> {
  const full = path.join(root, rel);
  const dirents = await fs.readdir(full, { withFileTypes: true });
  for (const dirent of dirents) {
    if (IGNORE_DIRS.has(dirent.name)) continue;
    const childRel = rel ? `${rel}/${dirent.name}` : dirent.name;
    const childFull = path.join(root, childRel);
    if (dirent.isDirectory()) {
      await walk(root, childRel, entries);
    } else if (dirent.isFile()) {
      const stat = await fs.stat(childFull).catch(() => null);
      if (!stat) continue;
      if (stat.size > 5 * 1024 * 1024) {
        // skip very large files to keep snapshots small; this matches the
        // editor 2MB cap with headroom.
        continue;
      }
      const buf = await fs.readFile(childFull);
      const sha = await writeBlob(buf);
      entries.push({ path: childRel, blobSha: sha, size: stat.size });
    }
  }
}

export async function captureTree(projectRoot: string): Promise<CapturedTree> {
  await ensureStorage();
  const entries: TreeEntry[] = [];
  await walk(projectRoot, "", entries);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const totalBytes = entries.reduce((acc, e) => acc + e.size, 0);
  const treeJson = JSON.stringify(entries);
  const treeSha = await sha256OfBuffer(Buffer.from(treeJson, "utf8"));
  const targetTreePath = treePath(treeSha);
  try {
    await fs.access(targetTreePath);
  } catch {
    await fs.writeFile(targetTreePath, treeJson, "utf8");
  }
  return { treeSha, entries, totalBytes };
}

export async function readTree(treeSha: string): Promise<TreeEntry[]> {
  const raw = await fs.readFile(treePath(treeSha), "utf8");
  return JSON.parse(raw) as TreeEntry[];
}

export async function readFileFromTree(treeSha: string, filePath: string): Promise<Buffer | null> {
  const entries = await readTree(treeSha);
  const match = entries.find((e) => e.path === filePath);
  if (!match) return null;
  return readBlob(match.blobSha);
}

/** Restore an entire tree into the project working directory. */
export async function restoreTree(projectRoot: string, treeSha: string): Promise<{ written: number; removed: number }> {
  const entries = await readTree(treeSha);
  const targets = new Set(entries.map((e) => e.path));

  // 1. Write blobs back.
  let written = 0;
  for (const entry of entries) {
    const target = path.join(projectRoot, entry.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const buf = await readBlob(entry.blobSha);
    await fs.writeFile(target, buf);
    written += 1;
  }

  // 2. Remove files present in the working tree but absent from the snapshot.
  const current: string[] = [];
  await walkPaths(projectRoot, "", current);
  let removed = 0;
  for (const rel of current) {
    if (!targets.has(rel)) {
      try {
        await fs.unlink(path.join(projectRoot, rel));
        removed += 1;
      } catch {
        // ignore
      }
    }
  }

  // 3. Prune empty directories.
  await pruneEmptyDirs(projectRoot, "");

  return { written, removed };
}

async function walkPaths(root: string, rel: string, out: string[]): Promise<void> {
  const full = path.join(root, rel);
  const dirents = await fs.readdir(full, { withFileTypes: true }).catch(() => []);
  for (const dirent of dirents) {
    if (IGNORE_DIRS.has(dirent.name)) continue;
    const childRel = rel ? `${rel}/${dirent.name}` : dirent.name;
    if (dirent.isDirectory()) {
      await walkPaths(root, childRel, out);
    } else if (dirent.isFile()) {
      out.push(childRel);
    }
  }
}

async function pruneEmptyDirs(root: string, rel: string): Promise<void> {
  const full = path.join(root, rel);
  const dirents = await fs.readdir(full, { withFileTypes: true }).catch(() => []);
  for (const dirent of dirents) {
    if (!dirent.isDirectory() || IGNORE_DIRS.has(dirent.name)) continue;
    const childRel = rel ? `${rel}/${dirent.name}` : dirent.name;
    await pruneEmptyDirs(root, childRel);
    const remaining = await fs.readdir(path.join(root, childRel)).catch(() => null);
    if (remaining && remaining.length === 0) {
      await fs.rmdir(path.join(root, childRel)).catch(() => undefined);
    }
  }
}
