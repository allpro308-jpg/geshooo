import path from "node:path";
import { fileURLToPath } from "node:url";

import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { ZodError } from "zod";

import { config, isProduction } from "./config";
import { adminRouter } from "./modules/admin/admin-routes";
import { agentRouter } from "./modules/agent/agent-routes";
import { modelsRouter } from "./modules/agent/models-routes";
import { attachUser } from "./modules/auth/auth-middleware";
import { authRouter } from "./modules/auth/auth-routes";
import { dashboardRouter } from "./modules/dashboard/dashboard-routes";
import { meRouter } from "./modules/me/me-routes";
import { previewHostMiddleware } from "./modules/projects/project-preview-proxy";
import { projectRouter } from "./modules/projects/project-routes";
import { projectTemplateRouter } from "./modules/projects/project-template-routes";
import { providerKeyRouter } from "./modules/provider-keys/provider-key-routes";
import { serviceTemplateRouter } from "./modules/service-templates/service-template-routes";
import { setupRouter } from "./modules/setup/setup-routes";
import { snapshotRouter } from "./modules/snapshots/snapshot-routes";
import { workspaceServiceRouter } from "./modules/workspace-services/workspace-service-routes";
import { workspaceRouter } from "./modules/workspaces/workspace-routes";
import { HttpError } from "./shared/errors/http-error";

import "./db/database.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  app.disable("x-powered-by");

  // Host-based preview proxy runs BEFORE json/cookie/auth parsing so that
  // request bodies are piped untouched to the container and we don't try to
  // attach a platform session to a preview iframe asset request.
  app.use(previewHostMiddleware);

  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  if (!isProduction) {
    app.use(
      cors({
        origin: config.webOrigin,
        credentials: true
      })
    );
  }

  app.use(attachUser);

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      name: "singulary",
      storage: "sqlite"
    });
  });

  app.use("/api/setup", setupRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/me", meRouter);
  app.use("/api/workspaces", workspaceRouter);
  app.use("/api/workspace-services", workspaceServiceRouter);
  app.use("/api/service-templates", serviceTemplateRouter);
  app.use("/api/project-templates", projectTemplateRouter);
  app.use("/api/projects", projectRouter);
  app.use("/api/provider-keys", providerKeyRouter);
  app.use("/api/agent", agentRouter);
  app.use("/api/models", modelsRouter);
  app.use("/api", snapshotRouter);

  if (isProduction) {
    const webDist = path.resolve(__dirname, "../../web/dist");
    app.use(express.static(webDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) {
        next();
        return;
      }
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

function notFoundHandler(_req: express.Request, res: express.Response): void {
  res.status(404).json({
    error: {
      code: "not_found",
      message: "The requested resource was not found."
    }
  });
}

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "validation_error",
        message: error.issues.map((issue) => issue.message).join("; ")
      }
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message
      }
    });
    return;
  }

  console.error(error);
  res.status(500).json({
    error: {
      code: "internal_error",
      message: "An unexpected error occurred."
    }
  });
};
