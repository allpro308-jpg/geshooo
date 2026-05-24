import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import type { ProjectEvent } from "@singulary/shared";
import { type WebSocket,WebSocketServer } from "ws";

import { db } from "@/db/database";
import { sessionCookieName } from "@/modules/auth/auth-middleware";
import { resolveSession, resolveWebSocketAuthToken } from "@/modules/auth/auth-service";

const GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes
const HEARTBEAT_MS = 30_000;

type LifecycleHandlers = {
  onFirstClient: (projectId: string) => Promise<void> | void;
  onIdle: (projectId: string) => Promise<void> | void;
};

let lifecycle: LifecycleHandlers = {
  onFirstClient: () => undefined,
  onIdle: () => undefined
};

export function setLifecycleHandlers(handlers: LifecycleHandlers): void {
  lifecycle = handlers;
}

type Client = WebSocket & {
  isAlive?: boolean;
  projectId?: string;
};

type Hub = {
  projectId: string;
  clients: Set<Client>;
  idleTimer: NodeJS.Timeout | null;
  idleUntilEpochMs: number | null;
};

const hubs = new Map<string, Hub>();

export function hasActiveClients(projectId: string): boolean {
  const hub = hubs.get(projectId);
  return Boolean(hub && hub.clients.size > 0);
}

export function listActiveProjects(): string[] {
  const ids: string[] = [];
  for (const [projectId, hub] of hubs) {
    if (hub.clients.size > 0) ids.push(projectId);
  }
  return ids;
}

function getHub(projectId: string): Hub {
  let hub = hubs.get(projectId);
  if (!hub) {
    hub = { projectId, clients: new Set(), idleTimer: null, idleUntilEpochMs: null };
    hubs.set(projectId, hub);
  }
  return hub;
}

export function broadcastProjectEvent(projectId: string, event: ProjectEvent): void {
  const hub = hubs.get(projectId);
  if (!hub) return;
  const payload = JSON.stringify(event);
  for (const client of hub.clients) {
    if (client.readyState === client.OPEN) {
      try {
        client.send(payload);
      } catch {
        // ignore — client will be cleaned up by heartbeat
      }
    }
  }
}

function presencePayload(hub: Hub): ProjectEvent {
  return {
    type: "presence",
    clients: hub.clients.size,
    idleUntilEpochMs: hub.idleUntilEpochMs
  };
}

function scheduleIdleStop(hub: Hub): void {
  if (hub.idleTimer) clearTimeout(hub.idleTimer);
  hub.idleUntilEpochMs = Date.now() + GRACE_PERIOD_MS;
  hub.idleTimer = setTimeout(() => {
    hub.idleTimer = null;
    hub.idleUntilEpochMs = null;
    if (hub.clients.size > 0) return;
    void Promise.resolve(lifecycle.onIdle(hub.projectId)).catch((error) => {
      console.error(`Idle stop failed for ${hub.projectId}:`, error);
    });
  }, GRACE_PERIOD_MS);
}

function cancelIdleStop(hub: Hub): void {
  if (hub.idleTimer) {
    clearTimeout(hub.idleTimer);
    hub.idleTimer = null;
  }
  hub.idleUntilEpochMs = null;
}

export function createEventsWebSocketServer() {
  const wss = new WebSocketServer({ noServer: true });

  // Server-side heartbeat: ping all clients periodically; terminate the dead.
  const heartbeat = setInterval(() => {
    for (const hub of hubs.values()) {
      for (const client of hub.clients) {
        if (!client.isAlive) {
          try {
            client.terminate();
          } catch {
            // ignore
          }
          continue;
        }
        client.isAlive = false;
        try {
          client.ping();
        } catch {
          // ignore
        }
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  wss.on("connection", (ws: Client, _req: IncomingMessage, projectId: string) => {
    const hub = getHub(projectId);
    const wasEmpty = hub.clients.size === 0;
    hub.clients.add(ws);
    ws.isAlive = true;
    ws.projectId = projectId;

    cancelIdleStop(hub);

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      // Treat any text message as activity; explicit "ping" supported.
      ws.isAlive = true;
      try {
        const payload = JSON.parse(data.toString()) as { type?: string };
        if (payload.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // not JSON, just count as activity
      }
    });

    ws.on("close", () => {
      hub.clients.delete(ws);
      if (hub.clients.size === 0) {
        scheduleIdleStop(hub);
      }
      broadcastProjectEvent(projectId, presencePayload(hub));
    });

    ws.on("error", () => {
      hub.clients.delete(ws);
      if (hub.clients.size === 0) scheduleIdleStop(hub);
    });

    // Tell this client about presence right away.
    try {
      ws.send(JSON.stringify(presencePayload(hub)));
    } catch {
      // ignore
    }

    // Inform everyone of the new presence count.
    broadcastProjectEvent(projectId, presencePayload(hub));

    if (wasEmpty) {
      void Promise.resolve(lifecycle.onFirstClient(projectId)).catch((error) => {
        try {
          ws.send(
            JSON.stringify({
              type: "error",
              message: error instanceof Error ? error.message : "Auto-start failed."
            })
          );
        } catch {
          // ignore
        }
      });
    }
  });

  return {
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
      const url = new URL(req.url ?? "", "http://localhost");
      const match = url.pathname.match(/^\/(?:api\/)?ws\/projects\/([^/]+)\/events$/);
      if (!match) {
        socket.destroy();
        return;
      }
      const projectId = match[1];

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

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, projectId);
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
