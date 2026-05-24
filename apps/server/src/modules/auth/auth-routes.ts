import { Router } from "express";
import { z } from "zod";

import { recordAudit } from "@/modules/audit/audit-service";

import { requireAuth, sessionCookieName, sessionCookieOptions } from "./auth-middleware";
import { authenticate, createSession, createWebSocketAuthToken, destroySession } from "./auth-service";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const authRouter = Router();

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

authRouter.get("/ws-token", requireAuth, (req, res) => {
  res.json(createWebSocketAuthToken(req.user!.id));
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = await authenticate(body.email, body.password);
    const session = createSession(user.id);
    recordAudit("user.login", user.id);
    res.cookie(sessionCookieName, session.token, sessionCookieOptions(session.expiresAt));
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", (req, res) => {
  destroySession(req.cookies?.[sessionCookieName]);
  res.clearCookie(sessionCookieName, sessionCookieOptions());
  res.status(204).send();
});
