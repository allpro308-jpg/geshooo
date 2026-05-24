import type { NextFunction, Request, Response } from "express";

import { isProduction } from "@/config";
import { HttpError } from "@/shared/errors/http-error";

import { resolveSession } from "./auth-service";

export const sessionCookieName = "singulary_session";

export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  req.user = resolveSession(req.cookies?.[sessionCookieName]) ?? undefined;
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new HttpError(401, "unauthorized", "Authentication is required."));
    return;
  }
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== "instance_admin") {
    next(new HttpError(403, "forbidden", "Instance admin access is required."));
    return;
  }
  next();
}

export function sessionCookieOptions(expiresAt?: string) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt ? new Date(expiresAt) : undefined
  };
}
