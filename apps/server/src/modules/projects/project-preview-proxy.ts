import type { IncomingMessage, ServerResponse } from "node:http";
import http from "node:http";
import type { Duplex } from "node:stream";

import type { NextFunction, Request, RequestHandler, Response } from "express";

import { getPlatformSettings } from "@/modules/admin/platform-settings";

import { findProjectByPreviewToken, getProjectRuntimeInfo, loadProject } from "./project-runtime";

/**
 * Host-based reverse proxy used when the admin configures a
 * `previewBaseDomain`. The expected URL scheme is:
 *
 *   <port>.<projectToken>.<previewBaseDomain>[/<path>]
 *
 * which gets rewritten to `containerIp:port/<path>`. No path stripping or
 * HTML rewriting — root-relative URLs stay on the same host so the browser
 * naturally hits the same proxy for every asset.
 *
 * When `previewBaseDomain` is null this middleware is a no-op and the
 * frontend connects directly to the container IP.
 */

interface PreviewTarget {
  ip: string;
  port: number;
  projectId: string;
}

function parsePreviewHost(hostHeader: string | undefined): { token: string; port: number } | null {
  if (!hostHeader) return null;
  const settings = getPlatformSettings();
  if (!settings.previewBaseDomain) return null;
  const baseDomain = settings.previewBaseDomain.toLowerCase();

  // Strip port from Host header if present.
  const host = hostHeader.split(":")[0].toLowerCase();
  if (!host.endsWith(`.${baseDomain}`) && host !== baseDomain) return null;

  // Subdomain is everything before the base domain.
  const subdomain = host.slice(0, host.length - baseDomain.length - 1); // remove `.baseDomain`
  if (!subdomain) return null;

  // Expected shape: `<port>.<token>`. Token may itself contain dots in theory
  // but we generate hex tokens so it's a single label.
  const parts = subdomain.split(".");
  if (parts.length < 2) return null;
  const portStr = parts[0];
  const token = parts.slice(1).join(".");
  const port = Number(portStr);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
  if (!token) return null;
  return { token, port };
}

async function resolvePreviewTarget(token: string, port: number): Promise<PreviewTarget | null> {
  const lookup = findProjectByPreviewToken(token);
  if (!lookup) return null;
  const project = loadProject(lookup.projectId);
  const runtime = await getProjectRuntimeInfo(project);
  if (runtime.status !== "running" || !runtime.ipAddress) return null;
  return { ip: runtime.ipAddress, port, projectId: project.id };
}

export const previewHostMiddleware: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const parsed = parsePreviewHost(req.headers.host);
  if (!parsed) {
    next();
    return;
  }
  const target = await resolvePreviewTarget(parsed.token, parsed.port).catch(() => null);
  if (!target) {
    res
      .status(503)
      .type("text/html")
      .send(renderUnavailable("not_ready", "Preview target is not running yet."));
    return;
  }

  const upstream = http.request(
    {
      host: target.ip,
      port: target.port,
      method: req.method,
      path: req.url || "/",
      headers: filterRequestHeaders(req.headers, target.ip, target.port)
    },
    (upstreamRes) => {
      res.status(upstreamRes.statusCode ?? 502);
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (!value || HOP_BY_HOP.has(key.toLowerCase())) continue;
        res.setHeader(key, value as string | string[]);
      }
      upstreamRes.pipe(res);
    }
  );
  upstream.on("error", (error) => {
    if (!res.headersSent) {
      res.status(502).type("text/html").send(renderUnavailable("error", error.message));
    }
  });
  upstream.setTimeout(30000, () => {
    upstream.destroy(new Error("preview upstream timeout"));
  });
  req.pipe(upstream);
};

/**
 * WebSocket upgrade handler. Mirrors `previewHostMiddleware` for ws://
 * traffic (e.g. Vite HMR). Returns true if the upgrade was handled.
 */
export async function handlePreviewWebsocketUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer
): Promise<boolean> {
  const parsed = parsePreviewHost(req.headers.host);
  if (!parsed) return false;
  const target = await resolvePreviewTarget(parsed.token, parsed.port).catch(() => null);
  if (!target) {
    socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    socket.destroy();
    return true;
  }

  const upstream = http.request({
    host: target.ip,
    port: target.port,
    method: req.method,
    path: req.url || "/",
    headers: filterRequestHeaders(req.headers, target.ip, target.port)
  });

  upstream.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
    const headers = [`HTTP/1.1 ${upstreamRes.statusCode ?? 101} ${upstreamRes.statusMessage ?? "Switching Protocols"}`];
    for (const [key, value] of Object.entries(upstreamRes.headers)) {
      if (!value) continue;
      if (Array.isArray(value)) {
        for (const v of value) headers.push(`${key}: ${v}`);
      } else {
        headers.push(`${key}: ${value}`);
      }
    }
    socket.write(headers.join("\r\n") + "\r\n\r\n");
    if (upstreamHead && upstreamHead.length > 0) socket.write(upstreamHead);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
    upstreamSocket.on("error", () => socket.destroy());
    socket.on("error", () => upstreamSocket.destroy());
  });

  upstream.on("error", () => {
    try {
      socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    } catch {
      // ignore
    }
    socket.destroy();
  });

  if (head && head.length > 0) upstream.write(head);
  upstream.end();
  return true;
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

function filterRequestHeaders(
  headers: http.IncomingHttpHeaders,
  upstreamHost: string,
  upstreamPort: number
): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    if (key.toLowerCase() === "host") continue;
    out[key] = value;
  }
  out.host = `${upstreamHost}:${upstreamPort}`;
  return out;
}

function renderUnavailable(status: string, error?: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Preview unavailable</title>
<style>
  body { margin:0; font-family: ui-sans-serif, system-ui, sans-serif; background:#070708; color:#fafafa; display:grid; place-items:center; min-height:100vh; padding:32px; }
  .card { max-width: 380px; padding: 32px; border: 1px solid #26262d; border-radius: 14px; background: #0f0f11; text-align:center; }
  h1 { font-size: 15px; margin: 0 0 8px; color:#ec4899; text-transform: uppercase; letter-spacing: .08em; }
  p { color:#c8c8d0; font-size: 14px; margin: 0 0 4px; }
  small { color:#8e8e98; font-size: 12px; }
</style></head>
<body>
  <div class="card">
    <h1>Preview unavailable</h1>
    <p>Status: <strong>${status}</strong></p>
    ${error ? `<p style="color:#f43f5e">${escapeHtml(error)}</p>` : ""}
    <small>Start the project from the status bar, then pick a port.</small>
  </div>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Used by ServerResponse type to avoid an unused import warning in some setups.
export type _PreviewResponse = ServerResponse;
