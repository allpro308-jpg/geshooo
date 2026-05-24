import { Router } from "express";
import { z } from "zod";

import { db, nowIso } from "@/db/database";
import { mapProviderKey } from "@/db/mappers";
import { getPlatformSettings } from "@/modules/admin/platform-settings";
import { recordAudit } from "@/modules/audit/audit-service";
import { requireAuth } from "@/modules/auth/auth-middleware";
import { encryptSecret } from "@/shared/crypto/secrets";
import { HttpError } from "@/shared/errors/http-error";
import { createId } from "@/shared/ids/id";

const createProviderKeySchema = z.object({
  scopeType: z.enum(["user", "workspace", "organization", "global"]).default("user"),
  scopeId: z.string().optional(),
  provider: z.string().min(2).max(80),
  label: z.string().min(2).max(120),
  key: z.string().min(1)
});

export const providerKeyRouter = Router();

providerKeyRouter.use(requireAuth);

providerKeyRouter.get("/", (req, res) => {
  const rows = db
    .prepare(
      `SELECT *
       FROM provider_keys
       WHERE created_by = ?
          OR scope_type = 'global'
       ORDER BY updated_at DESC`
    )
    .all(req.user!.id);

  res.json({ providerKeys: rows.map((row) => mapProviderKey(row as Parameters<typeof mapProviderKey>[0])) });
});

providerKeyRouter.post("/", (req, res, next) => {
  try {
    const body = createProviderKeySchema.parse(req.body);
    const settings = getPlatformSettings();

    if (body.scopeType === "global" && req.user!.role !== "instance_admin") {
      throw new HttpError(403, "admin_required", "Only instance admins can create global provider keys.");
    }

    if (body.scopeType === "global" && !settings.globalProviderKeysEnabled) {
      throw new HttpError(403, "global_keys_disabled", "Global provider keys are disabled.");
    }

    if (body.scopeType !== "global" && !settings.byokEnabled) {
      throw new HttpError(403, "byok_disabled", "Bring your own key is disabled for this instance.");
    }

    const now = nowIso();
    const id = createId("key");
    const scopeId = body.scopeType === "user" ? req.user!.id : body.scopeId ?? null;

    db.prepare(
      `INSERT INTO provider_keys (id, scope_type, scope_id, provider, label, encrypted_key, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      body.scopeType,
      scopeId,
      body.provider.trim().toLowerCase(),
      body.label.trim(),
      encryptSecret(body.key),
      req.user!.id,
      now,
      now
    );

    recordAudit("provider_key.created", req.user!.id, {
      providerKeyId: id,
      provider: body.provider,
      scopeType: body.scopeType
    });

    const row = db.prepare("SELECT * FROM provider_keys WHERE id = ?").get(id);
    res.status(201).json({ providerKey: mapProviderKey(row as Parameters<typeof mapProviderKey>[0]) });
  } catch (error) {
    next(error);
  }
});
