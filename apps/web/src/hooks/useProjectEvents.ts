import type { ProjectEvent } from "@singulary/shared";
import { useEffect, useRef } from "react";

import { authenticatedWsUrl } from "@/services/ws";
import { useProjectRuntimeStore } from "@/stores/project-runtime.store";

export function useProjectEvents(projectId: string | undefined): void {
  const setRuntime = useProjectRuntimeStore((state) => state.setRuntime);
  const setLogs = useProjectRuntimeStore((state) => state.setLogs);
  const setStats = useProjectRuntimeStore((state) => state.setStats);
  const appendLogs = useProjectRuntimeStore((state) => state.appendLogs);
  const setShells = useProjectRuntimeStore((state) => state.setShells);
  const setPresence = useProjectRuntimeStore((state) => state.setPresence);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const pingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let disposed = false;

    function clearTimers() {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (pingTimerRef.current) {
        window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
    }

    async function connect() {
      if (disposed) return;
      let url: string;
      try {
        url = await authenticatedWsUrl(`/api/ws/projects/${projectId}/events`);
      } catch {
        if (!disposed) {
          reconnectTimerRef.current = window.setTimeout(connect, 5_000);
        }
        return;
      }
      if (disposed) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        attemptRef.current = 0;
        // Application-level ping so we have an explicit liveness signal in
        // addition to the WS-level ping/pong driven by the server.
        pingTimerRef.current = window.setInterval(() => {
          if (ws.readyState === ws.OPEN) {
            try {
              ws.send(JSON.stringify({ type: "ping" }));
            } catch {
              // ignore
            }
          }
        }, 25_000);
      });

      ws.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return;
        const payload = parsed as ProjectEvent | { type: string };

        switch (payload.type) {
          case "runtime":
            setRuntime(projectId!, (payload as Extract<ProjectEvent, { type: "runtime" }>).runtime);
            break;
          case "logs": {
            const logs = payload as Extract<ProjectEvent, { type: "logs" }>;
            if (logs.mode === "snapshot") {
              setLogs(projectId!, logs.lines);
              setStats(projectId!, logs.stats);
            } else {
              appendLogs(projectId!, logs.lines, logs.stats);
            }
            break;
          }
          case "shells":
            setShells(projectId!, (payload as Extract<ProjectEvent, { type: "shells" }>).shells);
            break;
          case "presence": {
            const presence = payload as Extract<ProjectEvent, { type: "presence" }>;
            setPresence(projectId!, {
              clients: presence.clients,
              idleUntilEpochMs: presence.idleUntilEpochMs
            });
            break;
          }
          default:
            break;
        }
      });

      ws.addEventListener("close", () => {
        if (pingTimerRef.current) {
          window.clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
        if (disposed) return;
        attemptRef.current = Math.min(attemptRef.current + 1, 6);
        const delay = Math.min(1000 * 2 ** attemptRef.current, 15_000);
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      });

      ws.addEventListener("error", () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      });
    }

    connect();

    return () => {
      disposed = true;
      clearTimers();
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        try {
          ws.close(1000, "navigation");
        } catch {
          // ignore
        }
      }
    };
  }, [projectId, setRuntime, setLogs, setStats, appendLogs, setShells, setPresence]);
}
