import type { IncomingMessage } from "node:http";
import path from "node:path";
import type { Duplex } from "node:stream";

import type { ProjectShell as ProjectShellSummary } from "@singulary/shared";
import { type WebSocket,WebSocketServer } from "ws";

import { config } from "@/config";
import { db, nowIso } from "@/db/database";
import { sessionCookieName } from "@/modules/auth/auth-middleware";
import { resolveSession, resolveWebSocketAuthToken } from "@/modules/auth/auth-service";
import {
  attachContainer,
  createContainer,
  DockerError,
  ensureNetwork,
  inspectContainer,
  inspectImage,
  pullImage,
  removeContainer,
  resizeContainerTty,
  startContainer,
  stopContainer
} from "@/modules/docker/docker-client";
import { HttpError } from "@/shared/errors/http-error";
import { createId } from "@/shared/ids/id";

import { broadcastProjectEvent } from "./project-events";
import { loadProject, resolveTemplate } from "./project-runtime";

const MAX_BUFFER_BYTES = 256 * 1024; // 256 KB rolling buffer per shell
const WORKSPACE_NETWORK_PREFIX = "singulary_ws_";

function workspaceNetwork(workspaceId: string): string {
  return `${WORKSPACE_NETWORK_PREFIX}${workspaceId.replace(/^ws_/, "")}`;
}

type Shell = {
  id: string;
  projectId: string;
  workspaceId: string;
  label: string;
  containerId: string;
  stream: Duplex;
  buffer: Buffer[];
  bufferBytes: number;
  clients: Set<WebSocket>;
  cols: number;
  rows: number;
  status: "running" | "exited";
  createdAt: string;
  exitMessage?: string;
};

const shells = new Map<string, Shell>();
const shellsByProject = new Map<string, Set<string>>();

function indexShellForProject(shell: Shell): void {
  let set = shellsByProject.get(shell.projectId);
  if (!set) {
    set = new Set();
    shellsByProject.set(shell.projectId, set);
  }
  set.add(shell.id);
}

function removeShellFromIndex(shell: Shell): void {
  const set = shellsByProject.get(shell.projectId);
  if (!set) return;
  set.delete(shell.id);
  if (set.size === 0) shellsByProject.delete(shell.projectId);
}

function summarize(shell: Shell): ProjectShellSummary {
  return {
    id: shell.id,
    projectId: shell.projectId,
    label: shell.label,
    status: shell.status,
    createdAt: shell.createdAt,
    cols: shell.cols,
    rows: shell.rows
  };
}

export function listShells(projectId: string): ProjectShellSummary[] {
  const set = shellsByProject.get(projectId);
  if (!set) return [];
  return Array.from(set)
    .map((id) => shells.get(id))
    .filter((shell): shell is Shell => Boolean(shell))
    .map(summarize);
}

export function getShell(shellId: string): ProjectShellSummary | null {
  const shell = shells.get(shellId);
  return shell ? summarize(shell) : null;
}

export async function createShell(projectId: string, label?: string): Promise<ProjectShellSummary> {
  const project = loadProject(projectId);
  const template = resolveTemplate(project);
  const image = project.image || template.image;

  const existing = shellsByProject.get(projectId);
  const ordinal = existing ? existing.size + 1 : 1;
  const shellId = createId("sh");

  // Ensure network + image exist before creating the container.
  const networkName = workspaceNetwork(project.workspaceId);
  await ensureNetwork(networkName);
  try {
    await inspectImage(image);
  } catch (error) {
    if (error instanceof DockerError && error.status === 404) {
      await pullImage(image);
    } else {
      throw error;
    }
  }

  const sourceHostPath = path.resolve(config.storageRoot, project.sourcePath);
  const binds: string[] = [`${sourceHostPath}:${template.hints.workdir}`];
  // Note: we deliberately do NOT mount the deps volume here. Shells should
  // see whatever the runtime has (or hasn't) installed. If you want clean
  // installs you can run them from the shell directly.

  const containerName = `singulary_${project.workspaceId.replace(/^ws_/, "")}_${project.slug}_shell_${shellId.replace(
    /^sh_/,
    ""
  )}`;

  let created: { Id: string };
  try {
    created = await createContainer(containerName, {
      Image: image,
      Cmd: ["/bin/sh", "-lc", "if command -v bash >/dev/null; then exec bash; else exec sh; fi"],
      Env: ["TERM=xterm-256color", "HOST=0.0.0.0"],
      // OpenStdin/Tty are required for an interactive PTY container.
      // The Docker API treats these as top-level fields.
      ...({ Tty: true, OpenStdin: true, AttachStdin: true, AttachStdout: true, AttachStderr: true } as Record<
        string,
        unknown
      >),
      HostConfig: {
        NetworkMode: networkName,
        Binds: binds,
        AutoRemove: true
      } as unknown as Record<string, unknown>,
      Labels: {
        "singulary.workspace": project.workspaceId,
        "singulary.project": project.id,
        "singulary.shell": shellId,
        "singulary.kind": "shell"
      }
    } as Parameters<typeof createContainer>[1]);
  } catch (error) {
    if (error instanceof DockerError) {
      throw new HttpError(502, "docker_create_failed", `Could not create shell container: ${error.message}`);
    }
    throw error;
  }

  try {
    await startContainer(created.Id);
  } catch (error) {
    // Clean up the half-created container before surfacing the error.
    try {
      await removeContainer(created.Id, true, true);
    } catch {
      // ignore
    }
    if (error instanceof DockerError) {
      throw new HttpError(502, "docker_start_failed", `Could not start shell container: ${error.message}`);
    }
    throw error;
  }

  // Attach to the container TTY (hijacked stream).
  const { stream } = await attachContainer(created.Id);

  const shell: Shell = {
    id: shellId,
    projectId,
    workspaceId: project.workspaceId,
    label: label?.trim() || `Shell ${ordinal}`,
    containerId: created.Id,
    stream: stream as unknown as Duplex,
    buffer: [],
    bufferBytes: 0,
    clients: new Set(),
    cols: 100,
    rows: 28,
    status: "running",
    createdAt: nowIso()
  };

  stream.on("data", (chunk: Buffer) => {
    shell.buffer.push(chunk);
    shell.bufferBytes += chunk.length;
    while (shell.bufferBytes > MAX_BUFFER_BYTES && shell.buffer.length > 1) {
      const dropped = shell.buffer.shift();
      if (dropped) shell.bufferBytes -= dropped.length;
    }
    for (const client of shell.clients) {
      if (client.readyState === client.OPEN) client.send(chunk);
    }
  });

  const finalize = (message: string) => {
    if (shell.status === "exited") return;
    shell.status = "exited";
    shell.exitMessage = message;
    for (const client of shell.clients) {
      try {
        client.send(JSON.stringify({ type: "exit", message }));
      } catch {
        // ignore
      }
      if (client.readyState === client.OPEN) {
        client.close(1000, "shell_exited");
      }
    }
    broadcastProjectEvent(shell.projectId, { type: "shells", shells: listShells(shell.projectId) });
  };

  stream.on("close", () => finalize("Shell container closed."));
  stream.on("error", (error: Error) => finalize(error.message));

  // Initial resize so the shell takes a sensible geometry.
  await resizeContainerTty(created.Id, shell.cols, shell.rows);

  shells.set(shell.id, shell);
  indexShellForProject(shell);
  broadcastProjectEvent(projectId, { type: "shells", shells: listShells(projectId) });
  return summarize(shell);
}

export async function destroyShell(shellId: string): Promise<void> {
  const shell = shells.get(shellId);
  if (!shell) return;
  shell.status = "exited";
  try {
    shell.stream.destroy();
  } catch {
    // ignore
  }
  for (const client of shell.clients) {
    if (client.readyState === client.OPEN) client.close(1000, "shell_closed");
  }
  try {
    await stopContainer(shell.containerId, 2);
  } catch (error) {
    if (!(error instanceof DockerError) || (error.status !== 404 && error.status !== 304)) {
      // Best-effort removal in case AutoRemove didn't fire.
      try {
        await removeContainer(shell.containerId, true, true);
      } catch {
        // ignore
      }
    }
  }
  removeShellFromIndex(shell);
  shells.delete(shellId);
  broadcastProjectEvent(shell.projectId, { type: "shells", shells: listShells(shell.projectId) });
}

export async function destroyAllShellsForProject(projectId: string): Promise<void> {
  const set = shellsByProject.get(projectId);
  if (!set) return;
  await Promise.all(Array.from(set).map((id) => destroyShell(id)));
}

// --- WebSocket attach ----------------------------------------------------

export function createShellWebSocketServer() {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage, shellId: string) => {
    const shell = shells.get(shellId);
    if (!shell) {
      try {
        ws.send(JSON.stringify({ type: "error", message: "Shell not found." }));
      } catch {
        // ignore
      }
      ws.close(1011, "shell_not_found");
      return;
    }

    shell.clients.add(ws);

    // Replay the rolling buffer so reconnecting clients see prior output.
    for (const chunk of shell.buffer) {
      try {
        ws.send(chunk);
      } catch {
        break;
      }
    }

    if (shell.status === "exited") {
      try {
        ws.send(JSON.stringify({ type: "exit", message: shell.exitMessage ?? "Shell has exited." }));
      } catch {
        // ignore
      }
    }

    ws.on("message", (data, isBinary) => {
      if (shell.status === "exited") return;
      if (!isBinary) {
        const text = data.toString();
        if (text.startsWith("{") && text.includes("\"type\"")) {
          try {
            const payload = JSON.parse(text) as { type: string; cols?: number; rows?: number };
            if (payload.type === "resize" && payload.cols && payload.rows) {
              shell.cols = payload.cols;
              shell.rows = payload.rows;
              void resizeContainerTty(shell.containerId, shell.cols, shell.rows);
              return;
            }
          } catch {
            // fall through
          }
        }
        shell.stream.write(text);
        return;
      }
      shell.stream.write(data as Buffer);
    });

    ws.on("close", () => {
      shell.clients.delete(ws);
    });
    ws.on("error", () => {
      shell.clients.delete(ws);
    });
  });

  return {
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
      const url = new URL(req.url ?? "", "http://localhost");
      const match = url.pathname.match(/^\/(?:api\/)?ws\/projects\/([^/]+)\/shells\/([^/]+)$/);
      if (!match) {
        socket.destroy();
        return;
      }
      const [, projectId, shellId] = match;

      const userId = resolveUserIdForWebSocket(req, url);
      if (!userId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      if (!projectAllowsUser(projectId, userId)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      const shell = shells.get(shellId);
      if (!shell || shell.projectId !== projectId) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, shellId);
      });
    }
  };
}

function resolveUserIdForWebSocket(req: IncomingMessage, url: URL): string | null {
  return resolveWebSocketAuthToken(url.searchParams.get("wsToken")) ?? resolveSessionFromCookieHeader(req.headers.cookie);
}

function resolveSessionFromCookieHeader(header: string | undefined): string | null {
  if (!header) return null;
  const cookies = Object.fromEntries(
    header.split(";").map((part) => {
      const [name, ...rest] = part.trim().split("=");
      return [name, decodeURIComponent(rest.join("="))];
    })
  );
  const token = cookies[sessionCookieName];
  const user = token ? resolveSession(token) : null;
  return user?.id ?? null;
}

function projectAllowsUser(projectId: string, userId: string): boolean {
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
  return Boolean(row);
}

// Note: we keep inspectContainer + the waitForRunning logic in case the new
// container takes a moment to start. Auto-remove handles cleanup after exit.
async function waitForContainerRunning(containerId: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const inspect = await inspectContainer(containerId);
      if (inspect.State.Running && !inspect.State.Restarting) return true;
      if (inspect.State.Status === "exited" || inspect.State.Status === "dead") return false;
    } catch (error) {
      if (error instanceof DockerError && error.status === 404) return false;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

// Exported for callers that may want to await readiness in the future.
export { waitForContainerRunning };
