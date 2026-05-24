import type { GroupConfig } from "@singulary/shared";

import { db, nowIso } from "@/db/database";
import { createId } from "@/shared/ids/id";

type GroupRow = {
  id: string;
  name: string;
  is_user_group: number;
};

type RuleRow = {
  id: string;
  rule_type: string;
  effect: string;
  provider: string | null;
  model_id: string | null;
  max_tokens_per_user: number | null;
  max_tokens_per_group: number | null;
  max_workspaces: number | null;
  max_projects_per_workspace: number | null;
};

type BudgetRow = {
  id: string;
  scope_id: string | null;
  provider: string | null;
  limit_tokens: number;
  limit_usd: number | null;
  period: GroupConfig["tokenQuota"]["period"];
};

function getGroup(groupId: string): GroupRow | null {
  return db
    .prepare("SELECT id, name, is_user_group FROM groups WHERE id = ?")
    .get(groupId) as GroupRow | null;
}

export function getGroupConfig(groupId: string): GroupConfig {
  const group = getGroup(groupId);
  if (!group) {
    throw new Error(`Group ${groupId} not found`);
  }

  const rules = db.prepare("SELECT * FROM group_rules WHERE group_id = ?").all(groupId) as RuleRow[];

  const workspaceRule = rules.find((rule) => rule.rule_type === "workspace_limit" && rule.max_workspaces != null);
  const projectRule = rules.find((rule) => rule.rule_type === "project_limit" && rule.max_projects_per_workspace != null);

  const providerAccessRules = rules.filter((rule) => rule.rule_type === "provider_access" && rule.provider);
  const modelAccessRules = rules.filter((rule) => rule.rule_type === "model_access" && rule.model_id);

  const providerMode = inferAccessMode(providerAccessRules.map((rule) => rule.effect));
  const modelMode = inferAccessMode(modelAccessRules.map((rule) => rule.effect));

  const budget = db
    .prepare("SELECT * FROM token_budgets WHERE scope_type = 'group' AND scope_id = ? ORDER BY updated_at DESC LIMIT 1")
    .get(groupId) as BudgetRow | undefined;

  return {
    groupId: group.id,
    groupName: group.is_user_group ? "Personal space" : group.name,
    isUserGroup: group.is_user_group === 1,
    limits: {
      maxWorkspaces: workspaceRule?.max_workspaces ?? null,
      maxProjectsPerWorkspace: projectRule?.max_projects_per_workspace ?? null
    },
    tokenQuota: {
      enabled: Boolean(budget),
      limitTokens: budget?.limit_tokens ?? null,
      limitUsd: budget?.limit_usd ?? null,
      period: budget?.period ?? "monthly"
    },
    providerAccess: {
      mode: providerMode,
      providers: providerAccessRules
        .filter((rule) => rule.effect === (providerMode === "deny" ? "deny" : "allow"))
        .map((rule) => rule.provider as string)
    },
    modelAccess: {
      mode: modelMode,
      models: modelAccessRules
        .filter((rule) => rule.effect === (modelMode === "deny" ? "deny" : "allow"))
        .map((rule) => rule.model_id as string)
    }
  };
}

function inferAccessMode(effects: string[]): "all" | "allow" | "deny" {
  if (effects.length === 0) return "all";
  if (effects.includes("deny")) return "deny";
  return "allow";
}

export function saveGroupConfig(groupId: string, config: Omit<GroupConfig, "groupId" | "groupName" | "isUserGroup">, createdBy: string): GroupConfig {
  const group = getGroup(groupId);
  if (!group) {
    throw new Error(`Group ${groupId} not found`);
  }

  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM group_rules WHERE group_id = ?").run(groupId);
    db.prepare("DELETE FROM token_budgets WHERE scope_type = 'group' AND scope_id = ?").run(groupId);

    if (config.limits.maxWorkspaces != null) {
      db.prepare(
        `INSERT INTO group_rules (id, group_id, rule_type, effect, max_workspaces, created_by, created_at, updated_at)
         VALUES (?, ?, 'workspace_limit', 'limit', ?, ?, ?, ?)`
      ).run(createId("rul"), groupId, config.limits.maxWorkspaces, createdBy, now, now);
    }

    if (config.limits.maxProjectsPerWorkspace != null) {
      db.prepare(
        `INSERT INTO group_rules (id, group_id, rule_type, effect, max_projects_per_workspace, created_by, created_at, updated_at)
         VALUES (?, ?, 'project_limit', 'limit', ?, ?, ?, ?)`
      ).run(createId("rul"), groupId, config.limits.maxProjectsPerWorkspace, createdBy, now, now);
    }

    if (config.providerAccess.mode !== "all") {
      const effect = config.providerAccess.mode === "deny" ? "deny" : "allow";
      for (const provider of config.providerAccess.providers) {
        db.prepare(
          `INSERT INTO group_rules (id, group_id, rule_type, effect, provider, created_by, created_at, updated_at)
           VALUES (?, ?, 'provider_access', ?, ?, ?, ?, ?)`
        ).run(createId("rul"), groupId, effect, provider, createdBy, now, now);
      }
    }

    if (config.modelAccess.mode !== "all") {
      const effect = config.modelAccess.mode === "deny" ? "deny" : "allow";
      for (const modelId of config.modelAccess.models) {
        db.prepare(
          `INSERT INTO group_rules (id, group_id, rule_type, effect, model_id, created_by, created_at, updated_at)
           VALUES (?, ?, 'model_access', ?, ?, ?, ?, ?)`
        ).run(createId("rul"), groupId, effect, modelId, createdBy, now, now);
      }
    }

    if (config.tokenQuota.enabled && config.tokenQuota.limitTokens != null) {
      db.prepare(
        `INSERT INTO token_budgets (id, scope_type, scope_id, limit_tokens, limit_usd, period, created_at, updated_at)
         VALUES (?, 'group', ?, ?, ?, ?, ?, ?)`
      ).run(
        createId("bdg"),
        groupId,
        config.tokenQuota.limitTokens,
        config.tokenQuota.limitUsd,
        config.tokenQuota.period,
        now,
        now
      );
    }
  });
  tx();

  return getGroupConfig(groupId);
}
