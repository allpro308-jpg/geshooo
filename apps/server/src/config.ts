import path from "node:path";

const storageRoot =
  process.env.STORAGE_ROOT ?? path.resolve(process.cwd(), "storage");

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  databasePath:
    process.env.DATABASE_PATH ??
    path.resolve(storageRoot, "singulary.sqlite"),
  storageRoot,
  sessionSecret:
    process.env.SESSION_SECRET ??
    "development-only-change-this-session-secret",
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173"
};

export const isProduction = config.nodeEnv === "production";
