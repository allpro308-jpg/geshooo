import { db } from "@/db/database";
import { getPlatformSettings } from "@/modules/admin/platform-settings";
import { HttpError } from "@/shared/errors/http-error";

/**
 * Centralized policy + quota evaluation. Called before risky operations
 * (currently: model calls). Throws HttpError on deny so the caller can pass
 * the message through to the user.
 */

export interface PolicyContext {
  userId: string;
  workspaceId: string | null;
  provider: string;
  model: string;
  /** Expected token usage if available; defaults to 0 (use after-call accounting only). */
  expectedTokens?: number;
}

export function assertProviderAllowed(ctx: PolicyContext): void {
  const groupIds = userGroupIds(ctx.userId);
  const rows = db
    .prepare(
      `SELECT scope_type, scope_id, effect
       FROM provider_access_policies
       WHERE provider = ?
         AND (
           scope_type = 'global'
           OR (scope_type = 'user' AND scope_id = ?)
           OR (scope_type = 'group' AND scope_id IN (${placeholders(groupIds.length)}))
         )`
    )
    .all(ctx.provider, ctx.userId, ...groupIds) as Array<{
    scope_type: "global" | "user" | "group";
    scope_id: string | null;
    effect: "allow" | "deny";
  }>;

  // Most specific deny wins, then most specific allow.
  const order: Record<string, number> = { user: 0, group: 1, global: 2 };
  rows.sort((a, b) => order[a.scope_type] - order[b.scope_type]);
  for (const row of rows) {
    if (row.effect === "deny") {
      throw new HttpError(
        403,
        "provider_denied",
        `Provider '${ctx.provider}' is denied for this user.`
      );
    }
    if (row.effect === "allow") return; // explicit allow short-circuits remaining denies
  }
}

export function assertModelAllowed(ctx: PolicyContext): void {
  const policy = db
    .prepare("SELECT mode FROM provider_model_policies WHERE provider = ?")
    .get(ctx.provider) as { mode: "all" | "allow" | "deny" } | undefined;
  const mode = policy?.mode ?? "all";
  if (mode === "all") return;
  const entries = db
    .prepare("SELECT model_id FROM provider_model_policy_entries WHERE provider = ?")
    .all(ctx.provider) as Array<{ model_id: string }>;
  const listed = entries.some((e) => e.model_id === ctx.model);
  if (mode === "allow" && !listed) {
    throw new HttpError(
      403,
      "model_denied",
      `Model '${ctx.model}' is not in the allow list for provider '${ctx.provider}'.`
    );
  }
  if (mode === "deny" && listed) {
    throw new HttpError(
      403,
      "model_denied",
      `Model '${ctx.model}' is in the deny list for provider '${ctx.provider}'.`
    );
  }
}

export function assertTokenQuotaNotExceeded(ctx: PolicyContext): void {
  const platform = getPlatformSettings();
  const groupIds = userGroupIds(ctx.userId);

  const budgets = db
    .prepare(
      `SELECT scope_type, scope_id, provider, limit_tokens, period
       FROM token_budgets
       WHERE (provider IS NULL OR provider = ?)
         AND (
           scope_type = 'global'
           OR (scope_type = 'user' AND scope_id = ?)
           OR (scope_type = 'group' AND scope_id IN (${placeholders(groupIds.length)}))
           OR (scope_type = 'workspace' AND scope_id = ?)
         )`
    )
    .all(ctx.provider, ctx.userId, ...groupIds, ctx.workspaceId ?? "") as Array<{
    scope_type: "global" | "user" | "group" | "workspace";
    scope_id: string | null;
    provider: string | null;
    limit_tokens: number;
    period: "daily" | "weekly" | "monthly" | "lifetime" | "custom";
  }>;

  for (const budget of budgets) {
    const since = periodStart(budget.period);
    const used = totalTokensUsed(budget, since, ctx);
    if (used >= budget.limit_tokens) {
      throw new HttpError(
        403,
        "token_quota_exceeded",
        `Token quota exhausted for ${budget.scope_type} scope (${used}/${budget.limit_tokens} tokens this ${budget.period}).`
      );
    }
  }

  // Implicit per-user default quota.
  if (platform.defaultTokenQuota && !budgets.some((b) => b.scope_type === "user" && b.provider === null)) {
    const since = periodStart("monthly");
    const row = db
      .prepare("SELECT SUM(total_tokens) as used FROM usage_records WHERE user_id = ? AND created_at >= ?")
      .get(ctx.userId, since) as { used: number | null };
    const used = row?.used ?? 0;
    if (used >= platform.defaultTokenQuota) {
      throw new HttpError(
        403,
        "token_quota_exceeded",
        `Default monthly quota exhausted (${used}/${platform.defaultTokenQuota} tokens).`
      );
    }
  }
}

export function assertCanCallModel(ctx: PolicyContext): void {
  assertProviderAllowed(ctx);
  assertModelAllowed(ctx);
  assertTokenQuotaNotExceeded(ctx);
}

// --- helpers ---------------------------------------------------------------

function userGroupIds(userId: string): string[] {
  const rows = db
    .prepare("SELECT group_id FROM group_members WHERE user_id = ?")
    .all(userId) as Array<{ group_id: string }>;
  return rows.map((r) => r.group_id);
}

function placeholders(n: number): string {
  if (n === 0) return "''"; // safe no-op for an empty IN list
  return new Array(n).fill("?").join(", ");
}

function periodStart(period: "daily" | "weekly" | "monthly" | "lifetime" | "custom"): string {
  const now = new Date();
  if (period === "lifetime" || period === "custom") return "1970-01-01T00:00:00.000Z";
  const out = new Date(now);
  if (period === "daily") {
    out.setUTCHours(0, 0, 0, 0);
  } else if (period === "weekly") {
    const day = out.getUTCDay();
    out.setUTCDate(out.getUTCDate() - day);
    out.setUTCHours(0, 0, 0, 0);
  } else {
    out.setUTCDate(1);
    out.setUTCHours(0, 0, 0, 0);
  }
  return out.toISOString();
}

function totalTokensUsed(
  budget: { scope_type: string; scope_id: string | null; provider: string | null },
  since: string,
  ctx: PolicyContext
): number {
  const filters: string[] = ["created_at >= ?"];
  const params: Array<string | null> = [since];
  if (budget.provider) {
    filters.push("provider = ?");
    params.push(budget.provider);
  }
  if (budget.scope_type === "user" && budget.scope_id) {
    filters.push("user_id = ?");
    params.push(budget.scope_id);
  } else if (budget.scope_type === "workspace" && budget.scope_id) {
    filters.push("workspace_id = ?");
    params.push(budget.scope_id);
  } else if (budget.scope_type === "group" && budget.scope_id) {
    // group: sum tokens for any user in the group
    filters.push(
      "user_id IN (SELECT user_id FROM group_members WHERE group_id = ?)"
    );
    params.push(budget.scope_id);
  }
  // global has no extra filter
  const sql = `SELECT SUM(total_tokens) as used FROM usage_records WHERE ${filters.join(" AND ")}`;
  const row = db.prepare(sql).get(...params) as { used: number | null };
  // ctx unused here but kept for future per-provider/per-model partitioning.
  void ctx;
  return row?.used ?? 0;
}
