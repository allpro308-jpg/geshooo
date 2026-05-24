import http from "node:http";
import https from "node:https";

import { db } from "@/db/database";
import { decryptSecret } from "@/shared/crypto/secrets";

type DockerConfigRow = {
  connection_type: "socket" | "tcp";
  socket_path: string;
  tcp_host: string;
  tcp_port: number;
  tcp_use_tls: number;
  tcp_username: string | null;
  encrypted_tcp_password: string | null;
};

function getDockerConfig(): DockerConfigRow {
  return db.prepare("SELECT * FROM docker_config WHERE id = 'default'").get() as DockerConfigRow;
}

type DockerRequestOptions = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  stream?: boolean;
};

export class DockerError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function buildRequestOptions(config: DockerConfigRow, options: DockerRequestOptions) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers ?? {})
  };

  if (config.connection_type === "tcp" && config.tcp_username && config.encrypted_tcp_password) {
    const password = decryptSecret(config.encrypted_tcp_password);
    headers.Authorization =
      "Basic " + Buffer.from(`${config.tcp_username}:${password}`).toString("base64");
  }

  if (config.connection_type === "socket") {
    return {
      transport: http,
      requestOptions: {
        socketPath: config.socket_path,
        path: options.path,
        method: options.method,
        headers
      }
    };
  }

  return {
    transport: config.tcp_use_tls ? https : http,
    requestOptions: {
      host: config.tcp_host,
      port: config.tcp_port,
      path: options.path,
      method: options.method,
      headers
    }
  };
}

export function dockerRequest<T = unknown>(options: DockerRequestOptions): Promise<T> {
  return new Promise((resolve, reject) => {
    const config = getDockerConfig();
    const { transport, requestOptions } = buildRequestOptions(config, options);

    const req = transport.request(requestOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const status = res.statusCode ?? 0;

        if (status >= 400) {
          let message = text || res.statusMessage || "Docker request failed";
          try {
            const parsed = JSON.parse(text) as { message?: string };
            if (parsed.message) message = parsed.message;
          } catch {
            // not JSON, use text
          }
          reject(new DockerError(status, message));
          return;
        }

        if (!text) {
          resolve(undefined as T);
          return;
        }

        try {
          resolve(JSON.parse(text) as T);
        } catch {
          resolve(text as unknown as T);
        }
      });
    });

    req.on("error", reject);

    if (options.body !== undefined) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

export function dockerStream(options: DockerRequestOptions): Promise<{ stream: NodeJS.ReadableStream; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const config = getDockerConfig();
    const { transport, requestOptions } = buildRequestOptions(config, options);
    let settled = false;

    const settleResolve = (value: { stream: NodeJS.ReadableStream; statusCode: number }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const req = transport.request(requestOptions, (res) => {
      settleResolve({ stream: res, statusCode: res.statusCode ?? 0 });
    });

    req.on("upgrade", (res, socket, head) => {
      if (head.length > 0) {
        socket.unshift(head);
      }
      settleResolve({ stream: socket, statusCode: res.statusCode ?? 101 });
    });

    req.on("error", settleReject);

    if (options.body !== undefined) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

export type ContainerCreatePayload = {
  Image: string;
  Env?: string[];
  ExposedPorts?: Record<string, Record<string, never>>;
  HostConfig?: {
    PortBindings?: Record<string, Array<{ HostPort?: string; HostIp?: string }>>;
    RestartPolicy?: { Name: "no" | "always" | "unless-stopped" | "on-failure" };
    NetworkMode?: string;
    Binds?: string[];
  };
  NetworkingConfig?: {
    EndpointsConfig?: Record<string, { Aliases?: string[] }>;
  };
  Labels?: Record<string, string>;
  Cmd?: string[];
};

export async function createContainer(
  name: string,
  payload: ContainerCreatePayload
): Promise<{ Id: string }> {
  return dockerRequest<{ Id: string }>({
    method: "POST",
    path: `/v1.41/containers/create?name=${encodeURIComponent(name)}`,
    body: payload
  });
}

export async function startContainer(id: string): Promise<void> {
  await dockerRequest({
    method: "POST",
    path: `/v1.41/containers/${id}/start`
  });
}

export async function stopContainer(id: string, timeout = 10): Promise<void> {
  await dockerRequest({
    method: "POST",
    path: `/v1.41/containers/${id}/stop?t=${timeout}`
  });
}

export async function restartContainer(id: string, timeout = 10): Promise<void> {
  await dockerRequest({
    method: "POST",
    path: `/v1.41/containers/${id}/restart?t=${timeout}`
  });
}

export async function removeContainer(id: string, force = true, removeVolumes = true): Promise<void> {
  const params = new URLSearchParams();
  if (force) params.set("force", "true");
  if (removeVolumes) params.set("v", "true");
  await dockerRequest({
    method: "DELETE",
    path: `/v1.41/containers/${id}?${params.toString()}`
  });
}

export type ContainerInspect = {
  Id: string;
  State: {
    Status: string;
    Running: boolean;
    Restarting: boolean;
    Paused: boolean;
    StartedAt: string;
    FinishedAt: string;
    ExitCode: number;
    Error: string;
  };
  NetworkSettings: {
    IPAddress: string;
    Networks?: Record<string, { IPAddress: string; Aliases?: string[] }>;
  };
  Config: {
    Image: string;
    Env: string[] | null;
    Labels: Record<string, string> | null;
    ExposedPorts?: Record<string, Record<string, never>> | null;
  };
};

export async function inspectContainer(id: string): Promise<ContainerInspect> {
  return dockerRequest<ContainerInspect>({
    method: "GET",
    path: `/v1.41/containers/${id}/json`
  });
}

export async function inspectImage(image: string): Promise<void> {
  await dockerRequest({
    method: "GET",
    path: `/v1.41/images/${encodeURIComponent(image)}/json`
  });
}

export async function resizeContainerTty(id: string, cols: number, rows: number): Promise<void> {
  try {
    await dockerRequest({
      method: "POST",
      path: `/v1.41/containers/${id}/resize?h=${rows}&w=${cols}`
    });
  } catch {
    // ignore resize failures (container may have exited)
  }
}

export async function attachContainer(
  id: string
): Promise<{ stream: NodeJS.ReadableStream; statusCode: number }> {
  return dockerStream({
    method: "POST",
    path: `/v1.41/containers/${id}/attach?stream=1&stdin=1&stdout=1&stderr=1`,
    headers: {
      "Content-Type": "application/vnd.docker.raw-stream",
      Upgrade: "tcp",
      Connection: "Upgrade"
    }
  });
}

export async function getContainerLogs(
  id: string,
  options: { tail?: number; stdout?: boolean; stderr?: boolean; timestamps?: boolean } = {}
): Promise<string> {
  const params = new URLSearchParams();
  params.set("stdout", String(options.stdout ?? true));
  params.set("stderr", String(options.stderr ?? true));
  params.set("tail", String(options.tail ?? 200));
  params.set("timestamps", String(options.timestamps ?? true));

  const { stream } = await dockerStream({
    method: "GET",
    path: `/v1.41/containers/${id}/logs?${params.toString()}`
  });

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(parseLogStream(Buffer.concat(chunks))));
    stream.on("error", reject);
  });
}

// Docker multiplexed log frames: 8-byte header (stream type + size) + payload.
function parseLogStream(buffer: Buffer): string {
  if (buffer.length === 0) return "";
  // If stream is not multiplexed (non-tty), header bytes are present.
  let offset = 0;
  const out: string[] = [];

  // Heuristic: if first byte is 1, 2, or 0 and bytes 1-3 are 0, treat as multiplexed.
  while (offset + 8 <= buffer.length) {
    const streamType = buffer[offset];
    if (streamType > 2 || buffer[offset + 1] !== 0 || buffer[offset + 2] !== 0 || buffer[offset + 3] !== 0) {
      // Not a header, fall back to plain text
      return buffer.toString("utf8");
    }
    const size = buffer.readUInt32BE(offset + 4);
    const end = offset + 8 + size;
    if (end > buffer.length) break;
    out.push(buffer.slice(offset + 8, end).toString("utf8"));
    offset = end;
  }

  if (out.length === 0) return buffer.toString("utf8");
  return out.join("");
}

export async function ensureNetwork(name: string): Promise<void> {
  try {
    await dockerRequest({ method: "GET", path: `/v1.41/networks/${encodeURIComponent(name)}` });
  } catch (error) {
    if (error instanceof DockerError && error.status === 404) {
      await dockerRequest({
        method: "POST",
        path: "/v1.41/networks/create",
        body: { Name: name, Driver: "bridge", CheckDuplicate: true }
      });
      return;
    }
    throw error;
  }
}

export async function pullImage(image: string): Promise<void> {
  const { stream, statusCode } = await dockerStream({
    method: "POST",
    path: `/v1.41/images/create?fromImage=${encodeURIComponent(image)}`
  });

  if (statusCode >= 400) {
    throw new DockerError(statusCode, `Failed to pull image ${image}`);
  }

  // Drain the stream so the pull actually completes.
  await new Promise<void>((resolve, reject) => {
    stream.on("data", () => undefined);
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
}
