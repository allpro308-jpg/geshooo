import fs from "node:fs/promises";
import path from "node:path";

import { config } from "@/config";
import { db } from "@/db/database";
import { HttpError } from "@/shared/errors/http-error";

export type FileEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number | null;
  modifiedAt: string;
};

const IGNORE = new Set([".git", "node_modules", ".next", ".turbo", "dist", ".cache"]);

type ProjectRow = {
  id: string;
  workspace_id: string;
  name: string;
  source_path: string;
};

export async function resolveProjectRoot(projectId: string): Promise<{ project: ProjectRow; root: string }> {
  const project = db.prepare("SELECT id, workspace_id, name, source_path FROM projects WHERE id = ?").get(projectId) as
    | ProjectRow
    | undefined;
  if (!project) {
    throw new HttpError(404, "project_not_found", "Project not found.");
  }
  const root = path.resolve(config.storageRoot, project.source_path);
  if (!root.startsWith(config.storageRoot)) {
    throw new HttpError(400, "invalid_project_root", "Project root is outside storage.");
  }
  await fs.mkdir(root, { recursive: true });
  return { project, root };
}

export function resolveSafePath(root: string, relativePath: string | undefined): string {
  const normalized = relativePath ? relativePath.replace(/^\/+/, "") : "";
  const resolved = path.resolve(root, normalized);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new HttpError(400, "invalid_path", "Path is outside the project root.");
  }
  return resolved;
}

export async function listDirectory(root: string, relativePath: string): Promise<FileEntry[]> {
  const target = resolveSafePath(root, relativePath);
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) return [];
  if (!stat.isDirectory()) {
    throw new HttpError(400, "not_a_directory", "Target is not a directory.");
  }

  const entries = await fs.readdir(target, { withFileTypes: true });
  const result: FileEntry[] = [];
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue;
    const fullPath = path.join(target, entry.name);
    const relPath = path.relative(root, fullPath).split(path.sep).join("/");
    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: relPath,
        type: "directory",
        size: null,
        modifiedAt: (await fs.stat(fullPath)).mtime.toISOString()
      });
    } else if (entry.isFile()) {
      const fileStat = await fs.stat(fullPath);
      result.push({
        name: entry.name,
        path: relPath,
        type: "file",
        size: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString()
      });
    }
  }

  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

export async function readFileContent(root: string, relativePath: string): Promise<{ content: string; size: number; binary: boolean }> {
  const target = resolveSafePath(root, relativePath);
  const stat = await fs.stat(target);
  if (!stat.isFile()) {
    throw new HttpError(400, "not_a_file", "Target is not a file.");
  }
  if (stat.size > 2 * 1024 * 1024) {
    throw new HttpError(413, "file_too_large", "File exceeds 2 MB editor limit.");
  }
  const buffer = await fs.readFile(target);
  const isBinary = looksBinary(buffer);
  return {
    content: isBinary ? "" : buffer.toString("utf8"),
    size: stat.size,
    binary: isBinary
  };
}

function looksBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 4096);
  for (let i = 0; i < limit; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

export async function writeFileContent(root: string, relativePath: string, content: string): Promise<FileEntry> {
  const target = resolveSafePath(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  const stat = await fs.stat(target);
  return {
    name: path.basename(target),
    path: relativePath,
    type: "file",
    size: stat.size,
    modifiedAt: stat.mtime.toISOString()
  };
}

export async function createEntry(root: string, relativePath: string, type: "file" | "directory"): Promise<FileEntry> {
  const target = resolveSafePath(root, relativePath);
  if (type === "directory") {
    await fs.mkdir(target, { recursive: true });
  } else {
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      const handle = await fs.open(target, "wx");
      await handle.close();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new HttpError(409, "file_exists", "A file with that name already exists.");
      }
      throw error;
    }
  }
  const stat = await fs.stat(target);
  return {
    name: path.basename(target),
    path: relativePath,
    type,
    size: type === "file" ? stat.size : null,
    modifiedAt: stat.mtime.toISOString()
  };
}

export async function deleteEntry(root: string, relativePath: string): Promise<void> {
  const target = resolveSafePath(root, relativePath);
  if (target === root) {
    throw new HttpError(400, "cannot_delete_root", "Cannot delete project root.");
  }
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) return;
  if (stat.isDirectory()) {
    await fs.rm(target, { recursive: true, force: true });
  } else {
    await fs.unlink(target);
  }
}

export async function renameEntry(root: string, fromPath: string, toPath: string): Promise<FileEntry> {
  const source = resolveSafePath(root, fromPath);
  const target = resolveSafePath(root, toPath);
  if (source === root || target === root) {
    throw new HttpError(400, "invalid_rename", "Cannot rename project root.");
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.rename(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new HttpError(404, "not_found", "Source path does not exist.");
    }
    throw error;
  }
  const stat = await fs.stat(target);
  return {
    name: path.basename(target),
    path: toPath,
    type: stat.isDirectory() ? "directory" : "file",
    size: stat.isFile() ? stat.size : null,
    modifiedAt: stat.mtime.toISOString()
  };
}

export async function copyEntry(root: string, fromPath: string, toPath: string): Promise<FileEntry> {
  const source = resolveSafePath(root, fromPath);
  const target = resolveSafePath(root, toPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true, errorOnExist: false });
  const stat = await fs.stat(target);
  return {
    name: path.basename(target),
    path: toPath,
    type: stat.isDirectory() ? "directory" : "file",
    size: stat.isFile() ? stat.size : null,
    modifiedAt: stat.mtime.toISOString()
  };
}
