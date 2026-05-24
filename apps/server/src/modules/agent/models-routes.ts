import type { ProviderModelInfo, ProviderQuotaInfo, ProviderWithModels } from "@singulary/shared";
import { Router } from "express";

import { db } from "@/db/database";
import { getPlatformSettings } from "@/modules/admin/platform-settings";
import { requireAuth } from "@/modules/auth/auth-middleware";
import {
  defaultProviderUrl,
  getProviderLabel,
  listProviderModelsRaw
} from "@/modules/inference/inference-service";

export const modelsRouter = Router();

modelsRouter.use(requireAuth);

modelsRouter.get("/", async (req, res, next) => {
  try {
    const userId = req.user!.id;

    const configs = db
      .prepare("SELECT * FROM provider_configs WHERE enabled = 1 ORDER BY provider ASC")
      .all() as Array<{ id: string; provider: string; label: string; base_url: string }>;

    const personalKeys = db
      .prepare(
        "SELECT id, provider, label FROM provider_keys WHERE scope_type = 'user' AND scope_id = ? ORDER BY created_at ASC"
      )
      .all(userId) as Array<{ id: string; provider: string; label: string }>;

    const platformSettings = getPlatformSettings();
    const defaultQuota = platformSettings.defaultTokenQuota;

    const userUsageRow = db
      .prepare("SELECT SUM(total_tokens) as used FROM usage_records WHERE user_id = ?")
      .get(userId) as { used: number | null };
    const userUsed = userUsageRow?.used ?? 0;

    const globalUsageRow = db.prepare("SELECT SUM(total_tokens) as used FROM usage_records").get() as {
      used: number | null;
    };
    const globalUsed = globalUsageRow?.used ?? 0;

    const userBudget = db
      .prepare("SELECT limit_tokens, period FROM token_budgets WHERE scope_type = 'user' AND scope_id = ?")
      .get(userId) as { limit_tokens: number; period: string } | undefined;
    const userLimit = userBudget ? userBudget.limit_tokens : defaultQuota;
    const period = userBudget ? userBudget.period : "monthly";

    const providers: ProviderWithModels[] = [];

    for (const conf of configs) {
      const providerName = conf.provider;

      const policyRow = db
        .prepare("SELECT mode FROM provider_model_policies WHERE provider = ?")
        .get(providerName) as { mode: string } | undefined;
      const policyMode = (policyRow?.mode ?? "all") as "all" | "allow" | "deny";

      const entriesRows = db
        .prepare("SELECT model_id FROM provider_model_policy_entries WHERE provider = ?")
        .all(providerName) as Array<{ model_id: string }>;
      const policyModels = new Set(entriesRows.map((e) => e.model_id));

      const allModels = await listProviderModelsRaw(providerName);
      const filteredModels: ProviderModelInfo[] = allModels
        .filter((model) => {
          if (policyMode === "all") return true;
          const isListed = policyModels.has(model.id);
          return policyMode === "allow" ? isListed : !isListed;
        })
        .map((m) => ({ id: m.id, ownedBy: m.ownedBy }));

      const provUsageRow = db
        .prepare("SELECT SUM(total_tokens) as used FROM usage_records WHERE user_id = ? AND provider = ?")
        .get(userId, providerName) as { used: number | null };
      const provUsed = provUsageRow?.used ?? 0;

      const providerBudget = db
        .prepare(
          "SELECT limit_tokens FROM token_budgets WHERE scope_type = 'user' AND scope_id = ? AND provider = ?"
        )
        .get(userId, providerName) as { limit_tokens: number } | undefined;
      const providerLimit = providerBudget ? providerBudget.limit_tokens : null;

      const quota: ProviderQuotaInfo = {
        globalLimit: null,
        globalUsed,
        userLimit: providerLimit ?? userLimit,
        userUsed: providerLimit ? provUsed : userUsed,
        period
      };

      providers.push({
        provider: providerName,
        label: conf.label,
        enabled: true,
        models: filteredModels,
        quota,
        isPersonal: false
      });
    }

    for (const pkey of personalKeys) {
      // Personal keys still need a base URL; fall back to global config or known defaults.
      if (!defaultProviderUrl(pkey.provider) && !configs.find((c) => c.provider === pkey.provider)) {
        continue;
      }
      const allModels = await listProviderModelsRaw(pkey.id);
      const baseLabel = getProviderLabel(pkey.provider);
      providers.push({
        provider: pkey.id,
        label: pkey.label || `${baseLabel} (Personal)`,
        enabled: true,
        models: allModels.map((m) => ({ id: m.id, ownedBy: m.ownedBy })),
        quota: {
          globalLimit: null,
          globalUsed: 0,
          userLimit: null,
          userUsed: 0,
          period: "indefinite (BYOK)"
        },
        isPersonal: true
      });
    }

    res.json({ providers });
  } catch (err) {
    next(err);
  }
});
