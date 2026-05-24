import { Router } from "express";
import { z } from "zod";

import { sessionCookieName, sessionCookieOptions } from "@/modules/auth/auth-middleware";
import { createAdminUser, createSession, userCount } from "@/modules/auth/auth-service";
import { HttpError } from "@/shared/errors/http-error";

const completeSetupSchema = z.object({
  email: z.string().email(),
  username: z.string().min(2),
  password: z.string().min(8),
  displayName: z.string().optional()
});

export const setupRouter = Router();

setupRouter.get("/status", (_req, res) => {
  const count = userCount();
  res.json({ needsSetup: count === 0, userCount: count });
});

setupRouter.post("/complete", async (req, res, next) => {
  try {
    if (userCount() > 0) {
      throw new HttpError(409, "setup_already_complete", "Initial setup has already been completed.");
    }

    const body = completeSetupSchema.parse(req.body);
    const user = await createAdminUser(body);
    const session = createSession(user.id);
    res.cookie(sessionCookieName, session.token, sessionCookieOptions(session.expiresAt));
    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});
