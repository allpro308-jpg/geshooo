import http from "node:http";

import { createApp } from "./app";
import { config } from "./config";
import {
  broadcastProjectEvent,
  createEventsWebSocketServer,
  setLifecycleHandlers
} from "./modules/projects/project-events";
import { handlePreviewWebsocketUpgrade } from "./modules/projects/project-preview-proxy";
import {
  ensureProjectContainer,
  getProjectRuntimeInfo,
  loadProject,
  readBufferedLogs,
  readLogStats,
  reattachRunningStreams,
  stopProjectContainer
} from "./modules/projects/project-runtime";
import {
  createShellWebSocketServer,
  destroyAllShellsForProject,
  listShells
} from "./modules/projects/project-shells";

// Wire the events hub to runtime lifecycle: auto-start container on first
// connection, auto-stop after the grace timer expires with no clients.
setLifecycleHandlers({
  onFirstClient: async (projectId) => {
    const project = loadProject(projectId);
    if (project.lastStatus !== "running") {
      await ensureProjectContainer(project);
    }
    // Push a fresh snapshot so the UI doesn't need to poll on connect.
    const runtime = await getProjectRuntimeInfo(loadProject(projectId));
    broadcastProjectEvent(projectId, { type: "runtime", runtime });
    broadcastProjectEvent(projectId, {
      type: "logs",
      lines: readBufferedLogs(projectId, 300),
      stats: readLogStats(projectId),
      mode: "snapshot"
    });
    broadcastProjectEvent(projectId, { type: "shells", shells: listShells(projectId) });
  },
  onIdle: async (projectId) => {
    const project = loadProject(projectId);
    // Tear down any standalone shell containers so we don't leak them when
    // no clients are around to use them.
    await destroyAllShellsForProject(projectId);
    if (project.lastStatus !== "stopped") {
      await stopProjectContainer(project);
    }
  }
});

const app = createApp();
const server = http.createServer(app);
const shells = createShellWebSocketServer();
const events = createEventsWebSocketServer();

server.on("upgrade", (req, socket, head) => {
  if (req.url?.match(/^\/(?:api\/)?ws\/projects\/[^/]+\/shells\//)) {
    shells.handleUpgrade(req, socket, head);
    return;
  }
  if (req.url?.match(/^\/(?:api\/)?ws\/projects\/[^/]+\/events/)) {
    events.handleUpgrade(req, socket, head);
    return;
  }
  // Preview upgrade (e.g. Vite HMR over `<port>.<token>.<previewBaseDomain>`).
  void handlePreviewWebsocketUpgrade(req, socket, head)
    .then((handled) => {
      if (!handled) socket.destroy();
    })
    .catch(() => socket.destroy());
});

server.listen(config.port, () => {
  console.log(`Singulary server listening on http://localhost:${config.port}`);
  void reattachRunningStreams().catch((error) => {
    console.error("Failed to reattach project log streams:", error);
  });
});

// Refresh runtime info (port detection, status) every few seconds for any
// project that currently has connected clients. Containers without active
// listeners stay quiet.
import { listActiveProjects } from "./modules/projects/project-events";
setInterval(() => {
  for (const projectId of listActiveProjects()) {
    void getProjectRuntimeInfo(loadProject(projectId))
      .then((runtime) => broadcastProjectEvent(projectId, { type: "runtime", runtime }))
      .catch(() => undefined);
  }
}, 4000).unref?.();
