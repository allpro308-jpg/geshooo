import fs from "node:fs/promises";
import path from "node:path";

import type { ToolSpec } from "@singulary/agent";

import { db, nowIso } from "@/db/database";
import { dockerRequest, dockerStream, inspectContainer } from "@/modules/docker/docker-client";
import { resolveProjectRoot, resolveSafePath } from "@/modules/projects/project-filesystem";
import {
  loadProject,
  restartProjectContainer
} from "@/modules/projects/project-runtime";
import { getProjectTemplate } from "@/modules/projects/project-templates";
import {
  createSnapshot,
  ensureAgentPreWriteSnapshot,
  getSnapshot,
  listSnapshots,
  restoreSnapshot
} from "@/modules/snapshots/snapshot-service";
import { provisionServiceFromTemplate } from "@/modules/workspace-services/service-runtime";

import { type GitignoreMatcher,loadGitignore } from "./agent-gitignore";

/**
 * Per-tool execution context threaded through the agent.
 */
export interface AgentToolContext {
  projectId: string;
  workspaceId: string;
  userId: string;
  sessionId: string;
}

async function preWriteSnapshot(ctx: AgentToolContext): Promise<void> {
  await ensureAgentPreWriteSnapshot(ctx.projectId, ctx.sessionId, ctx.userId).catch(() => undefined);
}

// Map of background shell runs (kept module-local so tools can refer to them).
export type ShellRun = {
  id: string;
  projectId: string;
  command: string;
  stream: any;
  output: string;
  exitCode: number | null;
  status: "running" | "completed" | "failed";
  completedAt: string | null;
};

export const activeShellRuns = new Map<string, ShellRun>();

// --- helpers -------------------------------------------------------------

async function withRoot(projectId: string): Promise<{ root: string; matcher: GitignoreMatcher }> {
  const { root } = await resolveProjectRoot(projectId);
  const matcher = await loadGitignore(root);
  return { root, matcher };
}

function denied(path: string): { error: string } {
  return { error: `Access Denied: Path '${path}' is ignored by .gitignore.` };
}

async function recListFiles(
  dir: string,
  relDir: string,
  matcher: GitignoreMatcher,
  results: Array<{ name: string; path: string; type: "file" | "directory"; size?: number }>
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const relPath = path.join(relDir, entry.name).split(path.sep).join("/");
    if (matcher.isIgnored(relPath)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push({ name: entry.name, path: relPath, type: "directory" });
      await recListFiles(fullPath, relPath, matcher, results);
    } else if (entry.isFile()) {
      const stat = await fs.stat(fullPath).catch(() => null);
      results.push({ name: entry.name, path: relPath, type: "file", size: stat?.size ?? 0 });
    }
  }
}

async function recFind(
  dir: string,
  relDir: string,
  query: string,
  matcher: GitignoreMatcher,
  results: Array<{ path: string; line: number; content: string }>
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const relPath = path.join(relDir, entry.name).split(path.sep).join("/");
    if (matcher.isIgnored(relPath)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await recFind(fullPath, relPath, query, matcher, results);
    } else if (entry.isFile()) {
      try {
        const text = await fs.readFile(fullPath, "utf8");
        if (!text.includes(query)) continue;
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(query)) {
            results.push({ path: relPath, line: i + 1, content: lines[i].trim() });
            if (results.length >= 100) return;
          }
        }
      } catch {
        // unreadable file
      }
    }
  }
}

// --- tools ---------------------------------------------------------------

export const agentTools: Array<ToolSpec<AgentToolContext>> = [
  {
    name: "read_file",
    description: "Read the contents of a file in the workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path of the file to read" }
      },
      required: ["path"]
    },
    _timeout: 15,
    _risk: "safe",
    handler: async (args, { ctx }) => {
      const relPath = String(args.path ?? "");
      const { root, matcher } = await withRoot(ctx.projectId);
      if (matcher.isIgnored(relPath)) return denied(relPath);
      const safePath = resolveSafePath(root, relPath);
      try {
        const content = await fs.readFile(safePath, "utf8");
        return { path: relPath, content };
      } catch (error: any) {
        return { error: `Failed to read file: ${error.message}` };
      }
    }
  },
  {
    name: "write_file",
    description:
      "Write or create a file in the workspace with the specified content. Only use this for NEW files or completely rewriting small files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path of the file to write" },
        content: { type: "string", description: "File content to write" }
      },
      required: ["path", "content"]
    },
    _timeout: 30,
    _risk: "medium",
    _preExecute: async (_args, { ctx }) => preWriteSnapshot(ctx),
    handler: async (args, { ctx }) => {
      const relPath = String(args.path ?? "");
      const content = typeof args.content === "string" ? args.content : "";
      const { root, matcher } = await withRoot(ctx.projectId);
      if (matcher.isIgnored(relPath)) return denied(relPath);
      const safePath = resolveSafePath(root, relPath);
      try {
        await fs.mkdir(path.dirname(safePath), { recursive: true });
        await fs.writeFile(safePath, content, "utf8");
        return { success: true, path: relPath };
      } catch (error: any) {
        return { error: `Failed to write file: ${error.message}` };
      }
    }
  },
  {
    name: "write_diff",
    description:
      "Replace a specific block of text in an existing file. Use this for editing existing files. You must provide the exact string block to be replaced (including exact indentation) and the replacement block.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path of the file to edit" },
        targetContent: {
          type: "string",
          description: "The EXACT text block to be replaced, including all indentation and newlines"
        },
        replacementContent: {
          type: "string",
          description: "The new text block that will replace the targetContent"
        }
      },
      required: ["path", "targetContent", "replacementContent"]
    },
    _timeout: 30,
    _risk: "medium",
    _preExecute: async (_args, { ctx }) => preWriteSnapshot(ctx),
    handler: async (args, { ctx }) => {
      const relPath = String(args.path ?? "");
      const target = typeof args.targetContent === "string" ? args.targetContent : "";
      const replacement = typeof args.replacementContent === "string" ? args.replacementContent : "";
      if (!relPath || !target) {
        return { error: "Missing path, targetContent, or replacementContent for write_diff" };
      }
      const { root, matcher } = await withRoot(ctx.projectId);
      if (matcher.isIgnored(relPath)) return denied(relPath);
      const editPath = resolveSafePath(root, relPath);

      let fileContent: string;
      try {
        fileContent = await fs.readFile(editPath, "utf-8");
      } catch (err: any) {
        return { error: `Cannot read file to diff: ${err.message}` };
      }

      if (!fileContent.includes(target)) {
        return {
          error:
            "targetContent not found in the file. Ensure you matched the exact text, including whitespace and indentation."
        };
      }
      const occurrences = fileContent.split(target).length - 1;
      if (occurrences > 1) {
        return {
          error: `targetContent is ambiguous: found ${occurrences} times in the file. Provide a larger unique block.`
        };
      }
      try {
        await fs.writeFile(editPath, fileContent.replace(target, replacement), "utf-8");
      } catch (err: any) {
        return { error: `Failed to write file: ${err.message}` };
      }
      return {
        success: true,
        message: `Replaced ${target.split("\n").length} line(s) with ${replacement.split("\n").length} line(s) in ${relPath}`
      };
    }
  },
  {
    name: "list_files",
    description: "List files and directories in a given relative path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative directory path (e.g. '', 'src')" }
      },
      required: ["path"]
    },
    _timeout: 20,
    _risk: "safe",
    handler: async (args, { ctx }) => {
      const relPath = String(args.path ?? "");
      const { root, matcher } = await withRoot(ctx.projectId);
      if (matcher.isIgnored(relPath)) return denied(relPath);
      const safePath = resolveSafePath(root, relPath);
      try {
        const results: Array<{ name: string; path: string; type: "file" | "directory"; size?: number }> = [];
        await recListFiles(safePath, relPath, matcher, results);
        return { files: results };
      } catch (error: any) {
        return { error: `Failed to list files: ${error.message}` };
      }
    }
  },
  {
    name: "delete_file",
    description: "Delete a file or directory in the workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path of the file or directory to delete" }
      },
      required: ["path"]
    },
    _timeout: 20,
    _risk: "high",
    _preExecute: async (_args, { ctx }) => preWriteSnapshot(ctx),
    handler: async (args, { ctx }) => {
      const relPath = String(args.path ?? "");
      const { root, matcher } = await withRoot(ctx.projectId);
      if (matcher.isIgnored(relPath)) return denied(relPath);
      const safePath = resolveSafePath(root, relPath);
      try {
        const stat = await fs.stat(safePath);
        if (stat.isDirectory()) {
          await fs.rm(safePath, { recursive: true, force: true });
        } else {
          await fs.unlink(safePath);
        }
        return { success: true, path: relPath };
      } catch (error: any) {
        return { error: `Failed to delete path: ${error.message}` };
      }
    }
  },
  {
    name: "move_file",
    description: "Move or rename a file or directory in the workspace.",
    parameters: {
      type: "object",
      properties: {
        fromPath: { type: "string", description: "Original relative path" },
        toPath: { type: "string", description: "Target relative path" }
      },
      required: ["fromPath", "toPath"]
    },
    _timeout: 20,
    _risk: "medium",
    _preExecute: async (_args, { ctx }) => preWriteSnapshot(ctx),
    handler: async (args, { ctx }) => {
      const fromRel = String(args.fromPath ?? "");
      const toRel = String(args.toPath ?? "");
      const { root, matcher } = await withRoot(ctx.projectId);
      if (matcher.isIgnored(fromRel) || matcher.isIgnored(toRel)) {
        return { error: `Access Denied: Source or target path is ignored by .gitignore.` };
      }
      const source = resolveSafePath(root, fromRel);
      const target = resolveSafePath(root, toRel);
      try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.rename(source, target);
        return { success: true, from: fromRel, to: toRel };
      } catch (error: any) {
        return { error: `Failed to move/rename: ${error.message}` };
      }
    }
  },
  {
    name: "copy_file",
    description: "Copy a file or directory in the workspace.",
    parameters: {
      type: "object",
      properties: {
        fromPath: { type: "string", description: "Source relative path" },
        toPath: { type: "string", description: "Target relative path" }
      },
      required: ["fromPath", "toPath"]
    },
    _timeout: 60,
    _risk: "medium",
    _preExecute: async (_args, { ctx }) => preWriteSnapshot(ctx),
    handler: async (args, { ctx }) => {
      const fromRel = String(args.fromPath ?? "");
      const toRel = String(args.toPath ?? "");
      const { root, matcher } = await withRoot(ctx.projectId);
      if (matcher.isIgnored(fromRel) || matcher.isIgnored(toRel)) {
        return { error: `Access Denied: Source or target path is ignored by .gitignore.` };
      }
      const source = resolveSafePath(root, fromRel);
      const target = resolveSafePath(root, toRel);
      try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.cp(source, target, { recursive: true });
        return { success: true, from: fromRel, to: toRel };
      } catch (error: any) {
        return { error: `Failed to copy: ${error.message}` };
      }
    }
  },
  {
    name: "find",
    description: "Search for a string pattern across files in the workspace (grep-like).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "String pattern to search for" }
      },
      required: ["query"]
    },
    _timeout: 30,
    _risk: "safe",
    handler: async (args, { ctx }) => {
      const query = String(args.query ?? "");
      if (!query) return { error: "query is required" };
      const { root, matcher } = await withRoot(ctx.projectId);
      try {
        const results: Array<{ path: string; line: number; content: string }> = [];
        await recFind(root, "", query, matcher, results);
        return { results };
      } catch (error: any) {
        return { error: `Failed to find: ${error.message}` };
      }
    }
  },
  {
    name: "shell_open",
    description: "Open a shell command inside the project's Docker container in the background.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to run" }
      },
      required: ["command"]
    },
    _timeout: 30,
    _risk: "high",
    handler: async (args, { ctx }) => {
      const command = String(args.command ?? "");
      if (!command) return { error: "command is required" };
      const project = loadProject(ctx.projectId);
      if (!project.containerId) {
        return { error: "No container is running for this project. Please start the project container first." };
      }

      try {
        const inspect = await inspectContainer(project.containerId);
        if (!inspect.State.Running) {
          return { error: "Project container is stopped. Please start it first." };
        }
      } catch (error: any) {
        return { error: `Could not inspect container: ${error.message}` };
      }

      try {
        const execCreate = await dockerRequest<any>({
          method: "POST",
          path: `/v1.41/containers/${project.containerId}/exec`,
          body: {
            AttachStdout: true,
            AttachStderr: true,
            AttachStdin: false,
            Tty: true,
            Cmd: ["/bin/sh", "-c", command]
          }
        });
        const execId = execCreate.Id;
        const { stream } = await dockerStream({
          method: "POST",
          path: `/v1.41/exec/${execId}/start`,
          body: { Detach: false, Tty: true }
        });

        const shellId = "sh_" + Math.random().toString(36).slice(2, 11);
        const shellRun: ShellRun = {
          id: shellId,
          projectId: ctx.projectId,
          command,
          stream,
          output: "",
          exitCode: null,
          status: "running",
          completedAt: null
        };
        activeShellRuns.set(shellId, shellRun);

        stream.on("data", (chunk: Buffer) => {
          shellRun.output += chunk.toString("utf8");
        });
        stream.on("end", async () => {
          shellRun.status = "completed";
          shellRun.completedAt = new Date().toISOString();
          try {
            const inspect = await dockerRequest<any>({
              method: "GET",
              path: `/v1.41/exec/${execId}/json`
            });
            shellRun.exitCode = inspect.ExitCode ?? 0;
            if (shellRun.exitCode !== 0) shellRun.status = "failed";
          } catch {
            shellRun.exitCode = 0;
          }
        });
        stream.on("error", (err: any) => {
          shellRun.status = "failed";
          shellRun.completedAt = new Date().toISOString();
          shellRun.output += `\n[Error: ${err.message}]`;
          shellRun.exitCode = -1;
        });

        return { shellId, status: "running" };
      } catch (error: any) {
        return { error: `Failed to open shell: ${error.message}` };
      }
    }
  },
  {
    name: "shell_read",
    description: "Read the accumulated output and status of a running shell command.",
    parameters: {
      type: "object",
      properties: { shellId: { type: "string", description: "The ID of the shell" } },
      required: ["shellId"]
    },
    _timeout: 10,
    _risk: "safe",
    handler: async (args) => {
      const shellId = String(args.shellId ?? "");
      const shellRun = activeShellRuns.get(shellId);
      if (!shellRun) return { error: "Shell run not found." };
      return { shellId, status: shellRun.status, exitCode: shellRun.exitCode, output: shellRun.output };
    }
  },
  {
    name: "shell_wait",
    description: "Wait for a shell command to complete with a specified maximum timeout.",
    parameters: {
      type: "object",
      properties: {
        shellId: { type: "string", description: "The ID of the shell" },
        maxTimeMs: { type: "number", description: "Maximum milliseconds to wait (default 10000)" }
      },
      required: ["shellId"]
    },
    // wait can be long; bound it by the max poll window + safety margin
    _timeout: 600,
    _risk: "safe",
    handler: async (args, { signal }) => {
      const shellId = String(args.shellId ?? "");
      const maxTimeMs =
        typeof args.maxTimeMs === "number" && args.maxTimeMs > 0 ? Math.min(args.maxTimeMs, 5 * 60 * 1000) : 10_000;
      const shellRun = activeShellRuns.get(shellId);
      if (!shellRun) return { error: "Shell run not found." };
      const start = Date.now();
      while (shellRun.status === "running" && Date.now() - start < maxTimeMs) {
        if (signal.aborted) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return { shellId, status: shellRun.status, exitCode: shellRun.exitCode, output: shellRun.output };
    }
  },
  {
    name: "shell_kill",
    description: "Kill/cancel a running shell command.",
    parameters: {
      type: "object",
      properties: { shellId: { type: "string", description: "The ID of the shell to kill" } },
      required: ["shellId"]
    },
    _timeout: 5,
    _risk: "medium",
    handler: async (args) => {
      const shellId = String(args.shellId ?? "");
      const shellRun = activeShellRuns.get(shellId);
      if (!shellRun) return { error: "Shell run not found." };
      if (shellRun.status === "running") {
        try {
          shellRun.stream.destroy();
        } catch {
          // ignore
        }
        shellRun.status = "failed";
        shellRun.completedAt = new Date().toISOString();
      }
      return { success: true };
    }
  },
  {
    name: "project_settings",
    description: "Update the current project's settings. Only provide the fields you want to change.",
    parameters: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Project template ID (e.g. 'node-22', 'python-3.12')" },
        installCommand: { type: "string", description: "Shell command to install dependencies" },
        startCommand: { type: "string", description: "Shell command to start the dev server" }
      }
    },
    _timeout: 10,
    _risk: "medium",
    handler: async (args, { ctx }) => {
      const project = loadProject(ctx.projectId);
      const updates: string[] = [];
      const sqlArgs: Array<string | null> = [];
      const setField = (col: string, value: string | null | undefined) => {
        if (value === undefined) return;
        updates.push(`${col} = ?`);
        sqlArgs.push(value && value.trim() !== "" ? value.trim() : null);
      };

      if (args.templateId !== undefined) {
        const tplId = typeof args.templateId === "string" ? args.templateId : null;
        const tpl = tplId ? getProjectTemplate(tplId) : null;
        if (tplId && !tpl) return { error: `Unknown project template '${tplId}'.` };
        setField("template_id", tplId);
        if (tpl) {
          setField("image", tpl.image);
          setField("runtime_kind", tpl.runtimeKind);
        }
      }
      setField("install_command", typeof args.installCommand === "string" ? args.installCommand : undefined);
      setField("start_command", typeof args.startCommand === "string" ? args.startCommand : undefined);

      if (updates.length === 0) {
        return {
          success: true,
          message: "No changes made.",
          project: { name: project.name, installCommand: project.installCommand, startCommand: project.startCommand }
        };
      }

      updates.push("updated_at = ?");
      sqlArgs.push(nowIso());
      sqlArgs.push(ctx.projectId);
      db.prepare(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`).run(...sqlArgs);
      const updated = loadProject(ctx.projectId);
      return {
        success: true,
        message: "Project settings updated.",
        project: {
          name: updated.name,
          templateId: updated.templateId,
          installCommand: updated.installCommand,
          startCommand: updated.startCommand
        }
      };
    }
  },
  {
    name: "ws_create_service",
    description:
      "Provision a new workspace service (e.g. database, cache) from a template. Once created, the connection URL is injected as an env var into all projects in the workspace.",
    parameters: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Service template ID (e.g. 'postgres-16', 'redis-7')" },
        name: { type: "string", description: "Human-readable name for the service" }
      },
      required: ["templateId", "name"]
    },
    _timeout: 180,
    _risk: "high",
    handler: async (args, { ctx }) => {
      const templateId = typeof args.templateId === "string" ? args.templateId : "";
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!templateId || !name) return { error: "templateId and name are required." };
      try {
        const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        let slug = baseSlug || "service";
        let counter = 1;
        while (
          db
            .prepare("SELECT id FROM workspace_services WHERE workspace_id = ? AND slug = ?")
            .get(ctx.workspaceId, slug)
        ) {
          slug = `${baseSlug}-${++counter}`;
        }
        const result = await provisionServiceFromTemplate({
          workspaceId: ctx.workspaceId,
          templateId,
          name,
          slug,
          internalHost: slug,
          connectionEnvKey: null,
          userConfig: {}
        });
        return {
          success: true,
          message: `Service '${result.service.name}' created. Connection env key: ${result.service.connectionEnvKey}.`,
          serviceId: result.service.id,
          kind: result.service.kind,
          connectionEnvKey: result.service.connectionEnvKey
        };
      } catch (err: any) {
        return { error: `Failed to create service: ${err.message}` };
      }
    }
  },
  {
    name: "container_restart",
    description:
      "Restart the current project's container. Use this after changing settings like installCommand/startCommand, or when there's no hot reload.",
    parameters: { type: "object", properties: {} },
    _timeout: 60,
    _risk: "medium",
    handler: async (_args, { ctx }) => {
      try {
        const project = loadProject(ctx.projectId);
        if (!project.containerId) {
          return { error: "Project has no container to restart. Start the project first." };
        }
        await restartProjectContainer(project);
        return { success: true, message: `Container for project '${project.name}' restarted.` };
      } catch (err: any) {
        return { error: `Failed to restart container: ${err.message}` };
      }
    }
  },
  {
    name: "create_snapshot",
    description:
      "Create a manual snapshot of the project's current state. Snapshots are automatic before AI writes, but use this to mark a known-good checkpoint.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Short label for the snapshot" }
      },
      required: ["message"]
    },
    _timeout: 60,
    _risk: "safe",
    handler: async (args, { ctx }) => {
      const message = typeof args.message === "string" && args.message.trim() ? args.message.trim() : "Agent checkpoint";
      try {
        const snapshot = await createSnapshot({
          projectId: ctx.projectId,
          message,
          kind: "checkpoint",
          userId: ctx.userId,
          sessionId: ctx.sessionId
        });
        return {
          success: true,
          snapshotId: snapshot.id,
          fileCount: snapshot.fileCount,
          totalBytes: snapshot.totalBytes,
          message: snapshot.message
        };
      } catch (err: any) {
        return { error: `Failed to create snapshot: ${err.message}` };
      }
    }
  },
  {
    name: "list_snapshots",
    description: "List recent snapshots of the current project (most recent first).",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max snapshots to return (default 25)" }
      }
    },
    _timeout: 10,
    _risk: "safe",
    handler: async (args, { ctx }) => {
      const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(args.limit, 100) : 25;
      const snapshots = listSnapshots(ctx.projectId, limit);
      return {
        snapshots: snapshots.map((s) => ({
          id: s.id,
          kind: s.kind,
          message: s.message,
          fileCount: s.fileCount,
          totalBytes: s.totalBytes,
          createdAt: s.createdAt
        }))
      };
    }
  },
  {
    name: "restore_snapshot",
    description:
      "Restore the project workdir to a previous snapshot. A checkpoint of the current state is saved first so you can move forward again.",
    parameters: {
      type: "object",
      properties: {
        snapshotId: { type: "string", description: "Snapshot id to restore" }
      },
      required: ["snapshotId"]
    },
    _timeout: 60,
    _risk: "high",
    handler: async (args, { ctx }) => {
      const snapshotId = typeof args.snapshotId === "string" ? args.snapshotId : "";
      if (!snapshotId) return { error: "snapshotId is required" };
      try {
        const snapshot = getSnapshot(snapshotId);
        if (snapshot.projectId !== ctx.projectId) {
          return { error: "Snapshot does not belong to the current project." };
        }
        const result = await restoreSnapshot(snapshotId, { userId: ctx.userId });
        return {
          success: true,
          restoredSnapshotId: snapshotId,
          checkpointId: result.checkpoint?.id ?? null,
          filesWritten: result.written,
          filesRemoved: result.removed
        };
      } catch (err: any) {
        return { error: `Failed to restore snapshot: ${err.message}` };
      }
    }
  }
];
