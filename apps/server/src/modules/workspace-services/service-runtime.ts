import { randomBytes } from "node:crypto";
import net from "node:net";

import type {
  ServiceCredential,
  ServiceDetail,
  ServiceLogLine,
  ServiceRuntimeInfo,
  ServiceStatus,
  ServiceTemplate,
  WorkspaceService
} from "@singulary/shared";

import { db, nowIso } from "@/db/database";
import { mapWorkspaceService } from "@/db/mappers";
import {
  createContainer,
  DockerError,
  ensureNetwork,
  getContainerLogs,
  inspectContainer,
  pullImage,
  removeContainer,
  restartContainer,
  startContainer,
  stopContainer
} from "@/modules/docker/docker-client";
import { getServiceTemplate, renderTemplate } from "@/modules/service-templates/service-templates";
import { decryptSecret, encryptSecret } from "@/shared/crypto/secrets";
import { HttpError } from "@/shared/errors/http-error";

const WORKSPACE_NETWORK_PREFIX = "singulary_ws_";

function workspaceNetwork(workspaceId: string): string {
  return `${WORKSPACE_NETWORK_PREFIX}${workspaceId.replace(/^ws_/, "")}`;
}

function generateSecret(length = 24): string {
  return randomBytes(length).toString("base64url").slice(0, length);
}

export function resolveTemplateConfig(template: ServiceTemplate, userConfig: Record<string, unknown>): {
  config: Record<string, string>;
  credentials: ServiceCredential[];
} {
  const config: Record<string, string> = {};
  const credentials: ServiceCredential[] = [];

  for (const field of template.fields) {
    let value = userConfig[field.key];

    if ((value === undefined || value === null || value === "") && field.generated) {
      value = generateSecret();
    }
    if ((value === undefined || value === null || value === "") && field.defaultValue !== undefined) {
      value = field.defaultValue;
    }
    if ((value === undefined || value === null || value === "") && field.required) {
      throw new HttpError(400, "missing_field", `Service field "${field.label}" is required.`);
    }

    const str = value == null ? "" : String(value);
    config[field.key] = str;
    if (str) {
      credentials.push({
        key: field.key,
        label: field.label,
        value: str,
        secret: Boolean(field.secret)
      });
    }
  }

  return { config, credentials };
}

function loadServiceRow(serviceId: string) {
  const row = db.prepare("SELECT * FROM workspace_services WHERE id = ?").get(serviceId) as
    | (Parameters<typeof mapWorkspaceService>[0] & {
        config_json: string;
        encrypted_credentials: string | null;
      })
    | undefined;
  if (!row) {
    throw new HttpError(404, "service_not_found", "Service not found.");
  }
  return row;
}

function persistRuntimeState(
  serviceId: string,
  containerId: string | null,
  status: ServiceStatus
): void {
  const now = nowIso();
  db.prepare(
    `UPDATE workspace_services
     SET container_id = ?, last_status = ?, last_status_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(containerId, status, now, now, serviceId);
}

export async function provisionServiceFromTemplate(input: {
  workspaceId: string;
  templateId: string;
  name: string;
  slug: string;
  internalHost: string;
  connectionEnvKey: string | null;
  userConfig: Record<string, unknown>;
}): Promise<{ service: WorkspaceService; credentials: ServiceCredential[] }> {
  const template = getServiceTemplate(input.templateId);
  if (!template) {
    throw new HttpError(404, "service_template_not_found", "Service template not found.");
  }

  const { config, credentials } = resolveTemplateConfig(template, input.userConfig);
  const id = `svc_${randomBytes(8).toString("hex")}`;
  const now = nowIso();

  const env = Object.entries(template.envTemplate).map(([key, valueTemplate]) => {
    const value = renderTemplate(valueTemplate, config);
    return `${key}=${value}`;
  });

  db.prepare(
    `INSERT INTO workspace_services (
       id, workspace_id, name, slug, kind, template_id, image, internal_host, internal_port,
       connection_env_key, config_json, encrypted_credentials, container_id, last_status, last_status_at,
       created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'creating', ?, ?, ?)`
  ).run(
    id,
    input.workspaceId,
    input.name,
    input.slug,
    template.kind,
    template.id,
    template.image,
    input.internalHost,
    template.defaultPort,
    input.connectionEnvKey ?? template.defaultEnvKey,
    JSON.stringify(config),
    encryptSecret(JSON.stringify(credentials)),
    now,
    now,
    now
  );

  try {
    const networkName = workspaceNetwork(input.workspaceId);
    await ensureNetwork(networkName);

    // pullImage is best-effort; if the image is already present, Docker just no-ops.
    try {
      await pullImage(template.image);
    } catch (error) {
      // Fall through; createContainer will fail with a clearer message if the image is missing.
      if (!(error instanceof DockerError)) throw error;
    }

    const containerName = `singulary_${input.workspaceId.replace(/^ws_/, "")}_${input.slug}`;
    const created = await createContainer(containerName, {
      Image: template.image,
      Env: env,
      ExposedPorts: { [`${template.defaultPort}/tcp`]: {} },
      HostConfig: {
        RestartPolicy: { Name: "unless-stopped" },
        NetworkMode: networkName
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [networkName]: {
            Aliases: [input.internalHost, input.slug]
          }
        }
      },
      Labels: {
        "singulary.workspace": input.workspaceId,
        "singulary.service": id,
        "singulary.template": template.id
      }
    });

    await startContainer(created.Id);
    persistRuntimeState(id, created.Id, "running");
  } catch (error) {
    persistRuntimeState(id, null, "error");
    if (error instanceof DockerError) {
      throw new HttpError(502, "docker_error", `Docker: ${error.message}`);
    }
    throw error;
  }

  const row = loadServiceRow(id);
  return {
    service: mapWorkspaceService(row),
    credentials
  };
}

export async function getServiceRuntime(serviceId: string): Promise<ServiceRuntimeInfo> {
  const row = loadServiceRow(serviceId);
  if (!row.container_id) {
    return {
      status: row.last_status ?? "pending",
      containerId: null,
      ipAddress: null,
      startedAt: null,
      exitCode: null,
      error: null,
      healthy: null,
      healthCheckedAt: null,
      healthMessage: null
    };
  }

  try {
    const inspect = await inspectContainer(row.container_id);
    const status = mapDockerStatus(inspect.State.Status, inspect.State.Running);

    const networkName = workspaceNetwork(row.workspace_id);
    const ipAddress =
      inspect.NetworkSettings.Networks?.[networkName]?.IPAddress ||
      inspect.NetworkSettings.IPAddress ||
      null;

    if (status !== row.last_status) {
      persistRuntimeState(serviceId, row.container_id, status);
    }

    const port = row.internal_port ?? null;
    const probe =
      status === "running" && ipAddress && port
        ? await probeTcp(ipAddress, port, 800)
        : { healthy: null as boolean | null, message: status === "running" ? "No port to probe." : "Container not running." };

    return {
      status,
      containerId: row.container_id,
      ipAddress,
      startedAt: inspect.State.StartedAt || null,
      exitCode: inspect.State.ExitCode || null,
      error: inspect.State.Error || null,
      healthy: probe.healthy,
      healthCheckedAt: nowIso(),
      healthMessage: probe.message
    };
  } catch (error) {
    if (error instanceof DockerError && error.status === 404) {
      persistRuntimeState(serviceId, null, "destroyed");
      return {
        status: "destroyed",
        containerId: null,
        ipAddress: null,
        startedAt: null,
        exitCode: null,
        error: "Container missing",
        healthy: null,
        healthCheckedAt: null,
        healthMessage: null
      };
    }
    throw error;
  }
}

function probeTcp(host: string, port: number, timeoutMs: number): Promise<{ healthy: boolean; message: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finalize = (healthy: boolean, message: string) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ healthy, message });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finalize(true, `TCP ${host}:${port} OK`));
    socket.once("timeout", () => finalize(false, `TCP ${host}:${port} timed out`));
    socket.once("error", (error) => finalize(false, `TCP ${host}:${port} ${error.message}`));
    try {
      socket.connect(port, host);
    } catch (error: any) {
      finalize(false, error?.message ?? "unknown");
    }
  });
}

function mapDockerStatus(status: string, running: boolean): ServiceStatus {
  if (running) return "running";
  switch (status) {
    case "created":
      return "pending";
    case "restarting":
      return "restarting";
    case "removing":
      return "destroyed";
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

export async function getServiceDetail(serviceId: string): Promise<ServiceDetail> {
  const row = loadServiceRow(serviceId);
  const template = row.template_id ? getServiceTemplate(row.template_id) : null;

  let runtime: ServiceRuntimeInfo;
  try {
    runtime = await getServiceRuntime(serviceId);
  } catch (error) {
    runtime = {
      status: "unknown",
      containerId: row.container_id,
      ipAddress: null,
      startedAt: null,
      exitCode: null,
      error: error instanceof Error ? error.message : "Unknown error",
      healthy: null,
      healthCheckedAt: null,
      healthMessage: null
    };
  }

  const config = JSON.parse(row.config_json || "{}") as Record<string, string>;
  const credentials = row.encrypted_credentials
    ? (JSON.parse(decryptSecret(row.encrypted_credentials)) as ServiceCredential[])
    : [];

  const uriContext: Record<string, string> = {
    ...config,
    host: row.internal_host,
    port: String(row.internal_port ?? template?.defaultPort ?? "")
  };

  const connectionUri = template
    ? renderTemplate(template.connectionUriTemplate, uriContext)
    : null;

  return {
    service: mapWorkspaceService(row),
    template,
    runtime,
    connectionUri,
    credentials,
    config
  };
}

export async function serviceAction(
  serviceId: string,
  action: "start" | "stop" | "restart" | "destroy"
): Promise<ServiceRuntimeInfo> {
  const row = loadServiceRow(serviceId);

  if (action === "destroy") {
    if (row.container_id) {
      try {
        await removeContainer(row.container_id, true, true);
      } catch (error) {
        if (!(error instanceof DockerError) || error.status !== 404) throw error;
      }
    }
    db.prepare("DELETE FROM workspace_services WHERE id = ?").run(serviceId);
    return {
      status: "destroyed",
      containerId: null,
      ipAddress: null,
      startedAt: null,
      exitCode: null,
      error: null,
      healthy: null,
      healthCheckedAt: null,
      healthMessage: null
    };
  }

  if (!row.container_id) {
    throw new HttpError(409, "no_container", "Service has no container to operate on.");
  }

  try {
    if (action === "start") await startContainer(row.container_id);
    if (action === "stop") await stopContainer(row.container_id);
    if (action === "restart") await restartContainer(row.container_id);
  } catch (error) {
    if (error instanceof DockerError) {
      throw new HttpError(502, "docker_error", `Docker: ${error.message}`);
    }
    throw error;
  }

  return getServiceRuntime(serviceId);
}

export async function readServiceLogs(serviceId: string, tail = 200): Promise<ServiceLogLine[]> {
  const row = loadServiceRow(serviceId);
  if (!row.container_id) return [];

  try {
    const raw = await getContainerLogs(row.container_id, { tail, timestamps: true });
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\S+)\s+(.*)$/);
        if (match) {
          return { stream: "stdout" as const, text: match[2], timestamp: match[1] };
        }
        return { stream: "stdout" as const, text: line, timestamp: "" };
      });
  } catch (error) {
    if (error instanceof DockerError && error.status === 404) {
      return [];
    }
    throw error;
  }
}
