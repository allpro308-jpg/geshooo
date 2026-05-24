import { randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";

import type {
  Project,
  ProjectLogLine,
  ProjectLogStats,
  ProjectRuntimeInfo,
  ProjectStatus,
  ProjectTemplate
} from "@singulary/shared";

import { config } from "@/config";
import { db, nowIso } from "@/db/database";
import { mapProject } from "@/db/mappers";
import { getPlatformSettings } from "@/modules/admin/platform-settings";
import {
  createContainer,
  DockerError,
  dockerStream,
  ensureNetwork,
  inspectContainer,
  pullImage,
  removeContainer,
  restartContainer,
  startContainer,
  stopContainer
} from "@/modules/docker/docker-client";
import { getServiceTemplate, renderTemplate } from "@/modules/service-templates/service-templates";
import { decryptSecret } from "@/shared/crypto/secrets";
import { HttpError } from "@/shared/errors/http-error";

import { broadcastProjectEvent } from "./project-events";
import { destroyAllShellsForProject } from "./project-shells";
import { defaultTemplateFor, getProjectTemplate } from "./project-templates";

const WORKSPACE_NETWORK_PREFIX = "singulary_ws_";

function workspaceNetwork(workspaceId: string): string {
  return `${WORKSPACE_NETWORK_PREFIX}${workspaceId.replace(/^ws_/, "")}`;
}

function containerName(project: Project): string {
  return `singulary_${project.workspaceId.replace(/^ws_/, "")}_${project.slug}`;
}

function depsVolumeName(project: Project): string {
  return `singulary_${project.workspaceId.replace(/^ws_/, "")}_${project.slug}_deps`;
}

export function resolveTemplate(project: Project): ProjectTemplate {
  return getProjectTemplate(project.templateId) ?? defaultTemplateFor(project.runtimeKind);
}

export function loadProject(projectId: string): Project {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as
    | Parameters<typeof mapProject>[0]
    | undefined;
  if (!row) {
    throw new HttpError(404, "project_not_found", "Project not found.");
  }
  return mapProject(row);
}

function setProjectStatus(projectId: string, status: ProjectStatus, containerId?: string | null): void {
  const now = nowIso();
  const updates: string[] = ["last_status = ?", "updated_at = ?"];
  const args: Array<string | number | null> = [status, now];
  if (containerId !== undefined) {
    updates.push("container_id = ?");
    args.push(containerId);
  }
  args.push(projectId);
  db.prepare(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`).run(...args);
  // Push a runtime snapshot to any listening clients (best-effort).
  void getProjectRuntimeInfo(loadProject(projectId))
    .then((runtime) => broadcastProjectEvent(projectId, { type: "runtime", runtime }))
    .catch(() => undefined);
}

// --- Log buffer ----------------------------------------------------------

type LogEntry = ProjectLogLine;
const MAX_LOG_LINES = 800;
const buffers = new Map<string, { lines: LogEntry[]; stats: ProjectLogStats; stopper?: () => void }>();

function ensureBuffer(projectId: string) {
  let buffer = buffers.get(projectId);
  if (!buffer) {
    buffer = { lines: [], stats: { total: 0, info: 0, warn: 0, error: 0 } };
    buffers.set(projectId, buffer);
  }
  return buffer;
}

function classify(text: string, stream: "stdout" | "stderr"): "info" | "warn" | "error" {
  if (stream === "stderr") {
    if (/warn(ing)?/i.test(text)) return "warn";
    return "error";
  }
  if (/\berror\b|\bfail(ed)?\b|exception/i.test(text)) return "error";
  if (/\bwarn(ing)?\b|\bdeprecat/i.test(text)) return "warn";
  return "info";
}

function recordLine(projectId: string, raw: string, stream: "stdout" | "stderr"): void {
  const buffer = ensureBuffer(projectId);
  const lines = raw.split(/\r?\n/);
  const appended: LogEntry[] = [];
  for (const line of lines) {
    if (!line) continue;
    const level = classify(line, stream);
    const entry: LogEntry = { level, stream, text: line, timestamp: new Date().toISOString() };
    buffer.lines.push(entry);
    appended.push(entry);
    if (buffer.lines.length > MAX_LOG_LINES) {
      const dropped = buffer.lines.shift();
      if (dropped) {
        buffer.stats.total = Math.max(0, buffer.stats.total - 1);
        buffer.stats[dropped.level] = Math.max(0, buffer.stats[dropped.level] - 1);
      }
    }
    buffer.stats.total += 1;
    buffer.stats[level] += 1;
  }
  if (appended.length > 0) {
    broadcastProjectEvent(projectId, {
      type: "logs",
      lines: appended,
      stats: { ...buffer.stats },
      mode: "append"
    });
  }
}

function clearBuffer(projectId: string): void {
  buffers.delete(projectId);
}

function attachLogStream(projectId: string, containerId: string): void {
  const buffer = ensureBuffer(projectId);
  if (buffer.stopper) buffer.stopper();

  let aborted = false;
  buffer.stopper = () => {
    aborted = true;
  };

  (async () => {
    try {
      const { stream } = await dockerStream({
        method: "GET",
        path: `/v1.41/containers/${containerId}/logs?follow=true&stdout=true&stderr=true&tail=0`
      });

      let pending = Buffer.alloc(0);
      stream.on("data", (chunk: Buffer) => {
        if (aborted) return;
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= 8) {
          const streamType = pending[0];
          if (streamType > 2 || pending[1] !== 0 || pending[2] !== 0 || pending[3] !== 0) {
            recordLine(projectId, pending.toString("utf8"), "stdout");
            pending = Buffer.alloc(0);
            return;
          }
          const size = pending.readUInt32BE(4);
          if (pending.length < 8 + size) return;
          const payload = pending.slice(8, 8 + size).toString("utf8");
          pending = pending.slice(8 + size);
          recordLine(projectId, payload, streamType === 2 ? "stderr" : "stdout");
        }
      });
      stream.on("error", () => undefined);
      stream.on("end", () => {
        const current = buffers.get(projectId);
        if (current) current.stopper = undefined;
      });
    } catch (error) {
      const current = buffers.get(projectId);
      if (current) current.stopper = undefined;
      recordLine(projectId, `[log-stream-error] ${error instanceof Error ? error.message : String(error)}`, "stderr");
    }
  })();
}

// --- Port detection ------------------------------------------------------

const COMMON_DEV_PORTS = [
  80,
  3000,
  3001,
  4000,
  4173,
  4200,
  4321,
  5000,
  5173,
  5174,
  5500,
  6006,
  7000,
  7777,
  8000,
  8080,
  8888,
  9000,
  9090
];

type PortScanCache = {
  expiresAt: number;
  detected: number[];
  exposed: number[];
};

const portCache = new Map<string, PortScanCache>();

function tcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finalize = (ok: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finalize(true));
    socket.once("timeout", () => finalize(false));
    socket.once("error", () => finalize(false));
    try {
      socket.connect(port, host);
    } catch {
      finalize(false);
    }
  });
}

async function detectPorts(
  projectId: string,
  ip: string,
  exposed: number[],
  hints: number[]
): Promise<{ detected: number[]; exposed: number[] }> {
  const cached = portCache.get(projectId);
  if (cached && cached.expiresAt > Date.now()) {
    return { detected: cached.detected, exposed: cached.exposed };
  }
  const candidates = new Set<number>();
  for (const port of exposed) candidates.add(port);
  for (const port of hints) candidates.add(port);
  for (const port of COMMON_DEV_PORTS) candidates.add(port);

  const detected: number[] = [];
  await Promise.all(
    Array.from(candidates).map(async (port) => {
      const ok = await tcpProbe(ip, port, 250);
      if (ok) detected.push(port);
    })
  );
  detected.sort((a, b) => a - b);

  const result = { detected, exposed: [...exposed].sort((a, b) => a - b) };
  portCache.set(projectId, { ...result, expiresAt: Date.now() + 2500 });
  return result;
}

function exposedPortsFromInspect(inspect: { Config?: { ExposedPorts?: Record<string, unknown> | null } }): number[] {
  const map = inspect.Config?.ExposedPorts;
  if (!map) return [];
  const ports = new Set<number>();
  for (const key of Object.keys(map)) {
    const [portStr] = key.split("/");
    const port = Number(portStr);
    if (Number.isFinite(port)) ports.add(port);
  }
  return Array.from(ports);
}

// --- Runtime info / lifecycle -------------------------------------------

function buildPreviewBlock(
  project: Project,
  ipAddress: string | null,
  detectedPorts: number[]
): ProjectRuntimeInfo["preview"] {
  const settings = getPlatformSettings();
  const baseDomain = settings.previewBaseDomain;
  const scheme = settings.previewScheme;
  const token = ensurePreviewToken(project.id);

  const urlsByPort: Record<number, string> = {};
  if (baseDomain && token) {
    for (const port of detectedPorts) {
      urlsByPort[port] = `${scheme}://${port}.${token}.${baseDomain}/`;
    }
    return { mode: "domain", token, baseDomain, scheme, urlsByPort };
  }
  if (ipAddress) {
    for (const port of detectedPorts) {
      urlsByPort[port] = `http://${ipAddress}:${port}/`;
    }
  }
  return { mode: "direct", token, baseDomain: null, scheme, urlsByPort };
}

export async function getProjectRuntimeInfo(project: Project): Promise<ProjectRuntimeInfo> {
  if (!project.containerId) {
    return {
      status: project.lastStatus,
      containerId: null,
      ipAddress: null,
      startedAt: null,
      exitCode: null,
      error: null,
      previewReady: false,
      detectedPorts: [],
      exposedPorts: [],
      preview: buildPreviewBlock(project, null, [])
    };
  }

  try {
    const inspect = await inspectContainer(project.containerId);
    const networkName = workspaceNetwork(project.workspaceId);
    const ipAddress =
      inspect.NetworkSettings.Networks?.[networkName]?.IPAddress ||
      inspect.NetworkSettings.IPAddress ||
      null;
    const status = mapDockerStatus(inspect.State.Status, inspect.State.Running);
    if (status !== project.lastStatus) {
      setProjectStatus(project.id, status);
    }
    const template = resolveTemplate(project);
    const exposed = exposedPortsFromInspect(inspect);
    const portInfo =
      status === "running" && ipAddress
        ? await detectPorts(project.id, ipAddress, exposed, template.hints.commonPorts)
        : { detected: [], exposed };
    return {
      status,
      containerId: project.containerId,
      ipAddress,
      startedAt: inspect.State.StartedAt || null,
      exitCode: inspect.State.ExitCode || null,
      error: inspect.State.Error || null,
      previewReady: status === "running" && Boolean(ipAddress) && portInfo.detected.length > 0,
      detectedPorts: portInfo.detected,
      exposedPorts: portInfo.exposed,
      preview: buildPreviewBlock(project, ipAddress, portInfo.detected)
    };
  } catch (error) {
    if (error instanceof DockerError && error.status === 404) {
      setProjectStatus(project.id, "stopped", null);
      return {
        status: "stopped",
        containerId: null,
        ipAddress: null,
        startedAt: null,
        exitCode: null,
        error: "Container missing",
        previewReady: false,
        detectedPorts: [],
        exposedPorts: [],
        preview: buildPreviewBlock(project, null, [])
      };
    }
    throw error;
  }
}

/**
 * Ensure a project has a `preview_token`. Used both lazily (when building
 * runtime info) and on project create. Returns the token.
 */
export function ensurePreviewToken(projectId: string): string {
  const row = db
    .prepare("SELECT preview_token FROM projects WHERE id = ?")
    .get(projectId) as { preview_token: string | null } | undefined;
  if (!row) return "";
  if (row.preview_token && row.preview_token.length > 0) return row.preview_token;
  const token = randomBytes(8).toString("hex");
  db.prepare("UPDATE projects SET preview_token = ? WHERE id = ?").run(token, projectId);
  return token;
}

export function regeneratePreviewToken(projectId: string): string {
  const token = randomBytes(8).toString("hex");
  db.prepare("UPDATE projects SET preview_token = ? WHERE id = ?").run(token, projectId);
  return token;
}

export function findProjectByPreviewToken(token: string): { projectId: string; workspaceId: string } | null {
  if (!token) return null;
  const row = db
    .prepare("SELECT id, workspace_id FROM projects WHERE preview_token = ?")
    .get(token) as { id: string; workspace_id: string } | undefined;
  if (!row) return null;
  return { projectId: row.id, workspaceId: row.workspace_id };
}

function mapDockerStatus(status: string, running: boolean): ProjectStatus {
  if (running) return "running";
  switch (status) {
    case "created":
      return "starting";
    case "restarting":
      return "starting";
    case "removing":
      return "stopped";
    case "paused":
      return "stopped";
    case "exited":
      return "exited";
    case "dead":
      return "error";
    default:
      return "unknown";
  }
}

export async function ensureProjectContainer(project: Project): Promise<{ project: Project; runtime: ProjectRuntimeInfo }> {
  if (project.containerId) {
    try {
      const inspect = await inspectContainer(project.containerId);
      if (!inspect.State.Running) {
        await startContainer(project.containerId);
        setProjectStatus(project.id, "running");
        attachLogStream(project.id, project.containerId);
      }
      return { project, runtime: await getProjectRuntimeInfo(project) };
    } catch (error) {
      if (!(error instanceof DockerError) || error.status !== 404) throw error;
      setProjectStatus(project.id, "stopped", null);
    }
  }

  const template = resolveTemplate(project);
  const image = project.image || template.image;
  const installCommand = project.installCommand ?? template.installCommand;
  const startCommand = project.startCommand ?? template.startCommand;

  setProjectStatus(project.id, "starting");
  portCache.delete(project.id);

  try {
    await pullImage(image);
  } catch (error) {
    if (!(error instanceof DockerError)) throw error;
    // Continue — image may be local.
  }

  const networkName = workspaceNetwork(project.workspaceId);
  await ensureNetwork(networkName);

  const sourceHostPath = path.resolve(config.storageRoot, project.sourcePath);
  const binds: string[] = [`${sourceHostPath}:${template.hints.workdir}`];
  if (template.hints.depsVolumePath) {
    binds.push(`${depsVolumeName(project)}:${template.hints.depsVolumePath}`);
  }

  const env = buildContainerEnv(project);

  const innerScript = [
    "set -e",
    `cd ${template.hints.workdir}`,
    installCommand ? `echo "[singulary] ${escapeShell(installCommand)}" && ${installCommand}` : null,
    startCommand
      ? `echo "[singulary] ${escapeShell(startCommand)}" && exec ${startCommand}`
      : `echo "[singulary] no start command configured" && sleep infinity`
  ]
    .filter(Boolean)
    .join(" && ");

  const created = await createContainer(containerName(project), {
    Image: image,
    Env: env,
    HostConfig: {
      RestartPolicy: { Name: "unless-stopped" },
      NetworkMode: networkName,
      Binds: binds
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [networkName]: {
          Aliases: [project.slug]
        }
      }
    },
    Labels: {
      "singulary.workspace": project.workspaceId,
      "singulary.project": project.id
    },
    Cmd: ["/bin/sh", "-c", innerScript]
  });

  await startContainer(created.Id);
  setProjectStatus(project.id, "running", created.Id);
  attachLogStream(project.id, created.Id);

  const reloaded = loadProject(project.id);
  const runtime = await getProjectRuntimeInfo(reloaded);
  return { project: reloaded, runtime };
}

export async function stopProjectContainer(project: Project): Promise<ProjectRuntimeInfo> {
  if (!project.containerId) return getProjectRuntimeInfo(project);
  try {
    await stopContainer(project.containerId);
  } catch (error) {
    if (!(error instanceof DockerError) || (error.status !== 404 && error.status !== 304)) throw error;
  }
  const buffer = buffers.get(project.id);
  buffer?.stopper?.();
  // Shells are independent containers; they survive runtime stop.
  portCache.delete(project.id);
  setProjectStatus(project.id, "stopped");
  return getProjectRuntimeInfo(loadProject(project.id));
}

export async function restartProjectContainer(project: Project): Promise<ProjectRuntimeInfo> {
  if (!project.containerId) return (await ensureProjectContainer(project)).runtime;
  // Shells are independent containers; they survive a runtime restart.
  await restartContainer(project.containerId);
  attachLogStream(project.id, project.containerId);
  setProjectStatus(project.id, "running");
  portCache.delete(project.id);
  return getProjectRuntimeInfo(loadProject(project.id));
}

export async function destroyProjectContainer(project: Project): Promise<void> {
  if (project.containerId) {
    try {
      await removeContainer(project.containerId, true, false);
    } catch (error) {
      if (!(error instanceof DockerError) || error.status !== 404) throw error;
    }
  }
  // Project teardown takes shells with it.
  await destroyAllShellsForProject(project.id);
  buffers.get(project.id)?.stopper?.();
  clearBuffer(project.id);
  portCache.delete(project.id);
  setProjectStatus(project.id, "stopped", null);
}

export function readBufferedLogs(projectId: string, limit = 250): ProjectLogLine[] {
  const buffer = buffers.get(projectId);
  if (!buffer) return [];
  return buffer.lines.slice(-limit);
}

export function readLogStats(projectId: string): ProjectLogStats {
  return buffers.get(projectId)?.stats ?? { total: 0, info: 0, warn: 0, error: 0 };
}

export function resetLogStats(projectId: string): void {
  const buffer = buffers.get(projectId);
  if (!buffer) return;
  buffer.lines = [];
  buffer.stats = { total: 0, info: 0, warn: 0, error: 0 };
}

function escapeShell(value: string): string {
  return value.replace(/"/g, '\\"');
}

type EnvVarRow = {
  key: string;
  encrypted_value: string;
};

type WorkspaceServiceEnvRow = {
  template_id: string | null;
  internal_host: string;
  internal_port: number | null;
  connection_env_key: string | null;
  config_json: string | null;
};

function buildContainerEnv(project: Project): string[] {
  // Inheritance chain (later wins): defaults → service URIs → workspace env → project env.
  const map = new Map<string, string>();
  const push = (key: string, value: string) => {
    map.set(key, value);
  };

  // Only inject a sane default for NODE_ENV. We intentionally do NOT inject
  // HOST=0.0.0.0: templates and user start commands are responsible for
  // binding to the right interface inside the container. The container is
  // already isolated on the workspace Docker network, so its bridge IP is the
  // boundary, not a host-side port publishing.
  push("NODE_ENV", "development");

  // Workspace service connection URIs.
  try {
    const services = db
      .prepare(
        "SELECT template_id, internal_host, internal_port, connection_env_key, config_json FROM workspace_services WHERE workspace_id = ?"
      )
      .all(project.workspaceId) as WorkspaceServiceEnvRow[];
    for (const service of services) {
      if (!service.connection_env_key) continue;
      const template = service.template_id ? getServiceTemplate(service.template_id) : null;
      if (!template) continue;
      const config = service.config_json ? (JSON.parse(service.config_json) as Record<string, string>) : {};
      const context: Record<string, string> = {
        ...config,
        host: service.internal_host,
        port: String(service.internal_port ?? template.defaultPort ?? "")
      };
      const uri = renderTemplate(template.connectionUriTemplate, context);
      if (uri) push(service.connection_env_key, uri);
    }
  } catch {
    // best-effort
  }

  // Workspace-scoped env vars override service URIs.
  try {
    const rows = db
      .prepare("SELECT key, encrypted_value FROM env_vars WHERE scope_type = 'workspace' AND scope_id = ?")
      .all(project.workspaceId) as EnvVarRow[];
    for (const row of rows) {
      try {
        push(row.key, decryptSecret(row.encrypted_value));
      } catch {
        // skip undecryptable
      }
    }
  } catch {
    // best-effort
  }

  // Project-scoped env vars override workspace.
  try {
    const rows = db
      .prepare("SELECT key, encrypted_value FROM env_vars WHERE scope_type = 'project' AND scope_id = ?")
      .all(project.id) as EnvVarRow[];
    for (const row of rows) {
      try {
        push(row.key, decryptSecret(row.encrypted_value));
      } catch {
        // skip
      }
    }
  } catch {
    // best-effort
  }

  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`);
}

export async function reattachRunningStreams(): Promise<void> {
  const rows = db.prepare("SELECT * FROM projects WHERE container_id IS NOT NULL").all() as Array<
    Parameters<typeof mapProject>[0]
  >;
  for (const row of rows) {
    const project = mapProject(row);
    if (!project.containerId) continue;
    try {
      const inspect = await inspectContainer(project.containerId);
      if (inspect.State.Running) {
        attachLogStream(project.id, project.containerId);
      }
    } catch {
      // ignore; status will be reconciled on next user request
    }
  }
}
