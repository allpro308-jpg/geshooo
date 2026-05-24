import fs from "node:fs";

import type {
  AdminUser,
  DockerConfig,
  DockerConnectionCheck,
  Group,
  GroupMember,
  PermissionPolicy,
  ProviderAccessPolicy,
  ProviderConfig,
  ProviderModelOption,
  ProviderModelPolicy,
  TokenBudget
} from "@singulary/shared";
import { Router } from "express";
import { z } from "zod";

import { db, nowIso } from "@/db/database";
import { mapProviderKey, mapUser, mapWorkspace } from "@/db/mappers";
import { recordAudit } from "@/modules/audit/audit-service";
import { requireAdmin, requireAuth } from "@/modules/auth/auth-middleware";
import { DockerError, dockerRequest } from "@/modules/docker/docker-client";
import { getGroupConfig, saveGroupConfig } from "@/modules/groups/group-config";
import {
  invalidateModelsCache,
  listProviderModelsRaw,
  resolveInferenceClient
} from "@/modules/inference/inference-service";
import { decryptSecret, encryptSecret } from "@/shared/crypto/secrets";
import { HttpError } from "@/shared/errors/http-error";
import { createId } from "@/shared/ids/id";

import { getPlatformSettings, updatePlatformSettings } from "./platform-settings";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/summary", (_req, res) => {
  res.json({
    users: count("users"),
    groups: count("groups"),
    workspaces: count("workspaces"),
    projects: count("projects"),
    globalProviderKeys: scalar("SELECT COUNT(*) as count FROM provider_keys WHERE scope_type = 'global'"),
    providerConfigs: count("provider_configs"),
    tokenBudgets: count("token_budgets"),
    permissionPolicies: count("permission_policies"),
    modelPolicies: count("provider_model_policies"),
    settings: getPlatformSettings()
  });
});

adminRouter.get("/settings", (_req, res) => {
  res.json({ settings: getPlatformSettings() });
});

adminRouter.patch("/settings", (req, res, next) => {
  try {
    const body = z
      .object({
        byokEnabled: z.boolean().optional(),
        globalProviderKeysEnabled: z.boolean().optional(),
        requireApprovalForDangerousTools: z.boolean().optional(),
        defaultTokenQuota: z.number().int().positive().nullable().optional(),
        maxWorkspacesPerUser: z.number().int().positive().nullable().optional(),
        maxProjectsPerWorkspace: z.number().int().positive().nullable().optional(),
        previewBaseDomain: z
          .string()
          .max(240)
          .regex(/^[a-zA-Z0-9.-]+$/, "Invalid hostname")
          .nullable()
          .optional(),
        previewScheme: z.enum(["http", "https"]).optional()
      })
      .parse(req.body);

    const settings = updatePlatformSettings(body, req.user!.id);
    recordAudit("admin.settings_updated", req.user!.id, body);
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/users", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT users.*,
              COUNT(group_members.group_id) as group_count
       FROM users
       LEFT JOIN group_members ON group_members.user_id = users.id
       GROUP BY users.id
       ORDER BY users.created_at DESC`
    )
    .all() as Array<Parameters<typeof mapUser>[0] & { group_count: number }>;

  const users: AdminUser[] = rows.map((row) => ({
    ...mapUser(row),
    groupCount: row.group_count,
    groups: listUserGroups(row.id)
  }));

  res.json({ users });
});

adminRouter.patch("/users/:userId", (req, res, next) => {
  try {
    const body = z.object({ role: z.enum(["instance_admin", "user", "readonly"]) }).parse(req.body);
    const userId = z.string().min(1).parse(req.params.userId);
    const now = nowIso();

    const result = db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(body.role, now, userId);
    if (result.changes === 0) {
      throw new HttpError(404, "user_not_found", "User not found.");
    }

    recordAudit("admin.user_role_updated", req.user!.id, { userId, role: body.role });
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    res.json({ user: mapUser(row as Parameters<typeof mapUser>[0]) });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/workspaces", (_req, res) => {
  const rows = db.prepare("SELECT * FROM workspaces ORDER BY updated_at DESC").all();
  res.json({ workspaces: rows.map((row) => mapWorkspace(row as Parameters<typeof mapWorkspace>[0])) });
});

adminRouter.get("/groups", (_req, res) => {
  const groups = listGroups();
  res.json({ groups });
});

adminRouter.post("/groups", (req, res, next) => {
  try {
    const body = z.object({ name: z.string().min(2).max(120), description: z.string().max(2000).optional() }).parse(req.body);
    const organization = db.prepare("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
    if (!organization) {
      throw new HttpError(400, "missing_organization", "No organization exists for this instance.");
    }

    const id = createId("grp");
    const now = nowIso();
    db.prepare(
      `INSERT INTO groups (id, organization_id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, organization.id, body.name.trim(), body.description?.trim() || null, now, now);

    recordAudit("admin.group_created", req.user!.id, { groupId: id, name: body.name });
    res.status(201).json({ group: listGroups().find((group) => group.id === id) });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/groups/:groupId/members", (req, res) => {
  const groupId = z.string().min(1).parse(req.params.groupId);
  const rows = db
    .prepare(
      `SELECT group_members.group_id,
              group_members.user_id,
              group_members.role as group_role,
              group_members.created_at,
              users.email,
              users.username,
              users.display_name,
              users.role
       FROM group_members
       JOIN users ON users.id = group_members.user_id
       WHERE group_members.group_id = ?
       ORDER BY users.email ASC`
    )
    .all(groupId) as Array<{
    group_id: string;
    user_id: string;
    group_role: GroupMember["groupRole"];
    created_at: string;
    email: string;
    username: string;
    display_name: string;
    role: GroupMember["role"];
  }>;

  const members: GroupMember[] = rows.map((row) => ({
    groupId: row.group_id,
    userId: row.user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    groupRole: row.group_role,
    createdAt: row.created_at
  }));

  res.json({ members });
});

adminRouter.post("/groups/:groupId/members", (req, res, next) => {
  try {
    const groupId = z.string().min(1).parse(req.params.groupId);
    const body = z.object({ userId: z.string().min(1), role: z.enum(["group_admin", "group_member"]).default("group_member") }).parse(req.body);
    ensureMutableGroup(groupId);
    ensureExists("users", body.userId, "user_not_found", "User not found.");

    db.prepare(
      `INSERT INTO group_members (group_id, user_id, role, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(group_id, user_id) DO UPDATE SET role = excluded.role`
    ).run(
      groupId,
      body.userId,
      body.role,
      nowIso()
    );
    recordAudit("admin.group_member_added", req.user!.id, { groupId, userId: body.userId });
    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/groups/:groupId/members/:userId", (req, res, next) => {
  try {
    const groupId = z.string().min(1).parse(req.params.groupId);
    const userId = z.string().min(1).parse(req.params.userId);
    const body = z.object({ role: z.enum(["group_admin", "group_member"]) }).parse(req.body);
    ensureMutableGroup(groupId);

    const result = db
      .prepare("UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?")
      .run(body.role, groupId, userId);

    if (result.changes === 0) {
      throw new HttpError(404, "member_not_found", "Member not found in this group.");
    }
    recordAudit("admin.group_member_role_updated", req.user!.id, { groupId, userId, role: body.role });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

adminRouter.delete("/groups/:groupId/members/:userId", (req, res) => {
  const groupId = z.string().min(1).parse(req.params.groupId);
  const userId = z.string().min(1).parse(req.params.userId);
  ensureMutableGroup(groupId);
  db.prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?").run(groupId, userId);
  recordAudit("admin.group_member_removed", req.user!.id, { groupId, userId });
  res.status(204).send();
});

adminRouter.get("/groups/:groupId/config", (req, res, next) => {
  try {
    const groupId = z.string().min(1).parse(req.params.groupId);
    ensureExists("groups", groupId, "group_not_found", "Group not found.");
    res.json({ config: getGroupConfig(groupId) });
  } catch (error) {
    next(error);
  }
});

adminRouter.put("/groups/:groupId/config", (req, res, next) => {
  try {
    const groupId = z.string().min(1).parse(req.params.groupId);
    ensureMutableGroup(groupId);
    const body = z
      .object({
        limits: z.object({
          maxWorkspaces: z.number().int().positive().nullable(),
          maxProjectsPerWorkspace: z.number().int().positive().nullable()
        }),
        tokenQuota: z.object({
          enabled: z.boolean(),
          limitTokens: z.number().int().positive().nullable(),
          limitUsd: z.number().positive().nullable(),
          period: z.enum(["daily", "weekly", "monthly", "lifetime"])
        }),
        providerAccess: z.object({
          mode: z.enum(["all", "allow", "deny"]),
          providers: z.array(z.string().min(1))
        }),
        modelAccess: z.object({
          mode: z.enum(["all", "allow", "deny"]),
          models: z.array(z.string().min(1))
        })
      })
      .parse(req.body);

    const config = saveGroupConfig(
      groupId,
      {
        limits: body.limits,
        tokenQuota: body.tokenQuota,
        providerAccess: {
          mode: body.providerAccess.mode,
          providers: body.providerAccess.providers.map(normalizeProvider)
        },
        modelAccess: body.modelAccess
      },
      req.user!.id
    );
    recordAudit("admin.group_config_updated", req.user!.id, { groupId });
    res.json({ config });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/provider-keys", (_req, res) => {
  const rows = db.prepare("SELECT * FROM provider_keys ORDER BY updated_at DESC").all();
  res.json({ providerKeys: rows.map((row) => mapProviderKey(row as Parameters<typeof mapProviderKey>[0])) });
});

adminRouter.get("/providers", (_req, res) => {
  res.json({ providers: listProviderConfigs() });
});

adminRouter.post("/providers", (req, res, next) => {
  try {
    const body = z
      .object({
        provider: z.string().min(2).max(80),
        label: z.string().min(2).max(120),
        baseUrl: z.string().url(),
        apiKey: z.string().min(1),
        enabled: z.boolean().default(true)
      })
      .parse(req.body);
    const now = nowIso();
    const id = createId("pvd");
    const provider = normalizeProvider(body.provider);

    db.prepare(
      `INSERT INTO provider_configs (id, provider, label, base_url, encrypted_api_key, enabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET
         label = excluded.label,
         base_url = excluded.base_url,
         encrypted_api_key = excluded.encrypted_api_key,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`
    ).run(id, provider, body.label.trim(), normalizeBaseUrl(body.baseUrl), encryptSecret(body.apiKey), body.enabled ? 1 : 0, req.user!.id, now, now);

    invalidateModelsCache(provider);
    recordAudit("admin.provider_config_saved", req.user!.id, { provider });
    res.status(201).json({ provider: getProviderConfig(provider) });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/provider-keys/global", (req, res, next) => {
  try {
    const settings = getPlatformSettings();
    if (!settings.globalProviderKeysEnabled) {
      throw new HttpError(403, "global_keys_disabled", "Global provider keys are disabled.");
    }

    const body = z
      .object({
        provider: z.string().min(2).max(80),
        label: z.string().min(2).max(120),
        key: z.string().min(1)
      })
      .parse(req.body);

    const now = nowIso();
    const id = createId("key");
    db.prepare(
      `INSERT INTO provider_keys (id, scope_type, scope_id, provider, label, encrypted_key, created_by, created_at, updated_at)
       VALUES (?, 'global', NULL, ?, ?, ?, ?, ?, ?)`
    ).run(id, body.provider.trim().toLowerCase(), body.label.trim(), encryptSecret(body.key), req.user!.id, now, now);

    recordAudit("admin.global_provider_key_created", req.user!.id, { providerKeyId: id, provider: body.provider });
    const row = db.prepare("SELECT * FROM provider_keys WHERE id = ?").get(id);
    res.status(201).json({ providerKey: mapProviderKey(row as Parameters<typeof mapProviderKey>[0]) });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/token-budgets", (_req, res) => {
  res.json({ tokenBudgets: listTokenBudgets() });
});

adminRouter.post("/token-budgets", (req, res, next) => {
  try {
    const body = z
      .object({
        scopeType: z.enum(["user", "group", "workspace", "organization", "global"]),
        scopeId: z.string().nullable().optional(),
        provider: z.string().nullable().optional(),
        providerKeyId: z.string().nullable().optional(),
        limitTokens: z.number().int().positive(),
        limitUsd: z.number().positive().nullable().optional(),
        period: z.enum(["daily", "weekly", "monthly", "lifetime", "custom"]).default("monthly")
      })
      .parse(req.body);

    const id = createId("bdg");
    const now = nowIso();
    db.prepare(
      `INSERT INTO token_budgets (id, scope_type, scope_id, provider, provider_key_id, limit_tokens, limit_usd, period, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      body.scopeType,
      body.scopeType === "global" ? null : body.scopeId ?? null,
      body.provider ? normalizeProvider(body.provider) : null,
      body.providerKeyId ?? null,
      body.limitTokens,
      body.limitUsd ?? null,
      body.period,
      now,
      now
    );

    recordAudit("admin.token_budget_created", req.user!.id, {
      budgetId: id,
      scopeType: body.scopeType,
      provider: body.provider ?? null,
      limitTokens: body.limitTokens
    });
    res.status(201).json({ tokenBudget: listTokenBudgets().find((budget) => budget.id === id) });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/permission-policies", (_req, res) => {
  res.json({ permissionPolicies: listPermissionPolicies() });
});

adminRouter.get("/provider-access", (_req, res) => {
  res.json({ providerAccessPolicies: listProviderAccessPolicies() });
});

adminRouter.post("/provider-access", (req, res, next) => {
  try {
    const body = z
      .object({
        scopeType: z.enum(["user", "group", "global"]),
        scopeId: z.string().nullable().optional(),
        provider: z.string().min(2).max(80),
        effect: z.enum(["allow", "deny"])
      })
      .parse(req.body);
    const id = createId("pac");
    const now = nowIso();
    db.prepare(
      `INSERT INTO provider_access_policies (id, scope_type, scope_id, provider, effect, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, body.scopeType, body.scopeType === "global" ? null : body.scopeId ?? null, normalizeProvider(body.provider), body.effect, now, now);
    recordAudit("admin.provider_access_policy_created", req.user!.id, {
      providerAccessPolicyId: id,
      provider: body.provider,
      scopeType: body.scopeType,
      effect: body.effect
    });
    res.status(201).json({ providerAccessPolicy: listProviderAccessPolicies().find((policy) => policy.id === id) });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/permission-policies", (req, res, next) => {
  try {
    const body = z
      .object({
        scopeType: z.enum(["user", "group", "workspace", "organization", "global"]),
        scopeId: z.string().nullable().optional(),
        permission: z.string().min(3).max(160),
        effect: z.enum(["allow", "deny"])
      })
      .parse(req.body);

    const id = createId("pol");
    const now = nowIso();
    db.prepare(
      `INSERT INTO permission_policies (id, scope_type, scope_id, permission, effect, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, body.scopeType, body.scopeType === "global" ? null : body.scopeId ?? null, body.permission, body.effect, now, now);

    recordAudit("admin.permission_policy_created", req.user!.id, {
      policyId: id,
      permission: body.permission,
      effect: body.effect
    });
    res.status(201).json({ permissionPolicy: listPermissionPolicies().find((policy) => policy.id === id) });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/model-access", (_req, res) => {
  res.json({ policies: listProviderModelPolicies() });
});

adminRouter.patch("/model-access/:provider", (req, res, next) => {
  try {
    const provider = normalizeProvider(req.params.provider);
    const body = z.object({ mode: z.enum(["all", "allow", "deny"]) }).parse(req.body);
    const policy = upsertProviderModelPolicy(provider, body.mode, req.user!.id);
    recordAudit("admin.provider_model_policy_updated", req.user!.id, { provider, mode: body.mode });
    res.json({ policy });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/model-access/:provider/models", (req, res, next) => {
  try {
    const provider = normalizeProvider(req.params.provider);
    const body = z.object({ modelId: z.string().min(1).max(240) }).parse(req.body);
    upsertProviderModelPolicy(provider, existingProviderModelMode(provider), req.user!.id);
    db.prepare(
      "INSERT OR IGNORE INTO provider_model_policy_entries (provider, model_id, created_at) VALUES (?, ?, ?)"
    ).run(provider, body.modelId.trim(), nowIso());
    recordAudit("admin.provider_model_rule_added", req.user!.id, { provider, modelId: body.modelId });
    res.status(201).json({ policy: getProviderModelPolicy(provider) });
  } catch (error) {
    next(error);
  }
});

adminRouter.delete("/model-access/:provider/models/:modelId", (req, res) => {
  const provider = normalizeProvider(req.params.provider);
  const modelId = z.string().min(1).parse(req.params.modelId);
  db.prepare("DELETE FROM provider_model_policy_entries WHERE provider = ? AND model_id = ?").run(provider, modelId);
  recordAudit("admin.provider_model_rule_removed", req.user!.id, { provider, modelId });
  res.status(204).send();
});

adminRouter.post("/providers/:provider/test", async (req, res, next) => {
  try {
    const provider = normalizeProvider(req.params.provider);
    const { client } = resolveInferenceClient(provider);
    const startedAt = Date.now();
    const models = await client.listModels({ timeoutMs: 5000 });
    res.json({
      ok: true,
      message: `Provider responded with ${models.length} model(s) in ${Date.now() - startedAt} ms.`,
      sampleModels: models.slice(0, 5).map((m) => m.id),
      latencyMs: Date.now() - startedAt
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.json({ ok: false, message });
  }
});

adminRouter.get("/providers/:provider/models/all", async (req, res, next) => {
  try {
    const provider = normalizeProvider(req.params.provider);
    const query = typeof req.query.query === "string" ? req.query.query : "";
    const models = await listProviderModels(provider, query, false);
    res.json({ models });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/providers/:provider/models", async (req, res, next) => {
  try {
  const provider = normalizeProvider(req.params.provider);
  const query = typeof req.query.query === "string" ? req.query.query : "";
    const models = await listProviderModels(provider, query, true);
  res.json({ models });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/docker-config", (_req, res) => {
  res.json({ dockerConfig: getDockerConfig() });
});

adminRouter.patch("/docker-config", (req, res, next) => {
  try {
    const body = z
      .object({
        connectionType: z.enum(["socket", "tcp"]),
        socketPath: z.string().min(1).max(500).optional(),
        tcpHost: z.string().min(1).max(240).optional(),
        tcpPort: z.number().int().positive().max(65535).optional(),
        tcpUseTls: z.boolean().optional(),
        tcpUsername: z.string().max(240).nullable().optional(),
        tcpPassword: z.string().nullable().optional(),
        caCert: z.string().nullable().optional(),
        clientCert: z.string().nullable().optional(),
        clientKey: z.string().nullable().optional()
      })
      .parse(req.body);

    const current = getDockerConfigRow();
    const now = nowIso();
    db.prepare(
      `UPDATE docker_config
       SET connection_type = ?,
           socket_path = ?,
           tcp_host = ?,
           tcp_port = ?,
           tcp_use_tls = ?,
           tcp_username = ?,
           encrypted_tcp_password = ?,
           encrypted_ca_cert = ?,
           encrypted_client_cert = ?,
           encrypted_client_key = ?,
           updated_by = ?,
           updated_at = ?
       WHERE id = 'default'`
    ).run(
      body.connectionType,
      body.socketPath ?? current.socket_path,
      body.tcpHost ?? current.tcp_host,
      body.tcpPort ?? current.tcp_port,
      body.tcpUseTls === undefined ? current.tcp_use_tls : body.tcpUseTls ? 1 : 0,
      body.tcpUsername === undefined ? current.tcp_username : body.tcpUsername || null,
      secretUpdate(body.tcpPassword, current.encrypted_tcp_password),
      secretUpdate(body.caCert, current.encrypted_ca_cert),
      secretUpdate(body.clientCert, current.encrypted_client_cert),
      secretUpdate(body.clientKey, current.encrypted_client_key),
      req.user!.id,
      now
    );

    recordAudit("admin.docker_config_updated", req.user!.id, { connectionType: body.connectionType });
    res.json({ dockerConfig: getDockerConfig() });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/docker-config/check", async (_req, res) => {
  const check = await checkDockerConnection();
  res.json({ check });
});

function listGroups(): Group[] {
  const rows = db
    .prepare(
      `SELECT groups.*,
              COUNT(group_members.user_id) as member_count
       FROM groups
       LEFT JOIN group_members ON group_members.group_id = groups.id
       GROUP BY groups.id
       ORDER BY groups.name ASC`
    )
    .all() as Array<{
    id: string;
    organization_id: string;
    owner_user_id: string | null;
    name: string;
    description: string | null;
    is_user_group: number;
    member_count: number;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    description: row.description,
    isUserGroup: row.is_user_group === 1,
    memberCount: row.member_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function listUserGroups(userId: string): AdminUser["groups"] {
  const rows = db
    .prepare(
      `SELECT groups.id, groups.name
       FROM groups
       JOIN group_members ON group_members.group_id = groups.id
       WHERE group_members.user_id = ?
       ORDER BY groups.name ASC`
    )
    .all(userId) as Array<{ id: string; name: string }>;

  return rows;
}

function listProviderModelPolicies(): ProviderModelPolicy[] {
  const providers = new Set<string>();
  const configRows = db.prepare("SELECT DISTINCT provider FROM provider_configs").all() as Array<{ provider: string }>;
  const policyRows = db.prepare("SELECT DISTINCT provider FROM provider_model_policies").all() as Array<{ provider: string }>;

  for (const row of configRows) providers.add(normalizeProvider(row.provider));
  for (const row of policyRows) providers.add(normalizeProvider(row.provider));

  return Array.from(providers)
    .sort()
    .map((provider) => getProviderModelPolicy(provider));
}

function getProviderModelPolicy(provider: string): ProviderModelPolicy {
  const policy = db
    .prepare("SELECT provider, mode, updated_at FROM provider_model_policies WHERE provider = ?")
    .get(provider) as { provider: string; mode: ProviderModelPolicy["mode"]; updated_at: string } | undefined;
  const modelRows = db
    .prepare("SELECT model_id FROM provider_model_policy_entries WHERE provider = ? ORDER BY model_id ASC")
    .all(provider) as Array<{ model_id: string }>;

  return {
    provider,
    mode: policy?.mode ?? "all",
    models: modelRows.map((row) => row.model_id),
    updatedAt: policy?.updated_at ?? ""
  };
}

function upsertProviderModelPolicy(
  provider: string,
  mode: ProviderModelPolicy["mode"],
  updatedBy: string
): ProviderModelPolicy {
  const now = nowIso();
  db.prepare(
    `INSERT INTO provider_model_policies (provider, mode, updated_by, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET mode = excluded.mode, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(provider, mode, updatedBy, now);
  return getProviderModelPolicy(provider);
}

function existingProviderModelMode(provider: string): ProviderModelPolicy["mode"] {
  const row = db.prepare("SELECT mode FROM provider_model_policies WHERE provider = ?").get(provider) as
    | { mode: ProviderModelPolicy["mode"] }
    | undefined;
  return row?.mode ?? "all";
}

async function listProviderModels(provider: string, query: string, applyPolicy: boolean): Promise<ProviderModelOption[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const models = await fetchProviderModels(provider);
  const policy = getProviderModelPolicy(provider);
  const modelSet = new Set(policy.models);

  return models
    .filter((model) => {
      if (!applyPolicy || policy.mode === "all") return true;
      const isListed = modelSet.has(model.id);
      return policy.mode === "allow" ? isListed : !isListed;
    })
    .filter((model) => !normalizedQuery || model.id.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 80);
}

async function fetchProviderModels(provider: string): Promise<ProviderModelOption[]> {
  const config = getProviderConfigRow(provider);
  if (!config || config.enabled !== 1) {
    throw new HttpError(404, "provider_not_configured", "Provider is not configured or is disabled.");
  }
  const models = await listProviderModelsRaw(provider);
  return models.map((m) => ({ id: m.id, ownedBy: m.ownedBy }));
}

type DockerConfigRow = {
  connection_type: DockerConfig["connectionType"];
  socket_path: string;
  tcp_host: string;
  tcp_port: number;
  tcp_use_tls: number;
  tcp_username: string | null;
  encrypted_tcp_password: string | null;
  encrypted_ca_cert: string | null;
  encrypted_client_cert: string | null;
  encrypted_client_key: string | null;
  updated_at: string | null;
};

function getDockerConfigRow(): DockerConfigRow {
  return db.prepare("SELECT * FROM docker_config WHERE id = 'default'").get() as DockerConfigRow;
}

function getDockerConfig(): DockerConfig {
  const row = getDockerConfigRow();
  return {
    connectionType: row.connection_type,
    socketPath: row.socket_path,
    tcpHost: row.tcp_host,
    tcpPort: row.tcp_port,
    tcpUseTls: row.tcp_use_tls === 1,
    tcpUsername: row.tcp_username,
    tcpPasswordSet: Boolean(row.encrypted_tcp_password),
    caCertSet: Boolean(row.encrypted_ca_cert),
    clientCertSet: Boolean(row.encrypted_client_cert),
    clientKeySet: Boolean(row.encrypted_client_key),
    updatedAt: row.updated_at
  };
}

async function checkDockerConnection(): Promise<DockerConnectionCheck> {
  const row = getDockerConfigRow();

  if (row.connection_type === "socket") {
    if (!fs.existsSync(row.socket_path)) {
      return { ok: false, message: `Docker socket was not found at ${row.socket_path}.` };
    }
  }

  try {
    const version = await dockerRequest<{ Version?: string; ApiVersion?: string; Os?: string; Arch?: string }>({
      method: "GET",
      path: "/v1.41/version"
    });
    const info = await dockerRequest<{ Containers?: number; ContainersRunning?: number; Images?: number; ServerVersion?: string }>({
      method: "GET",
      path: "/v1.41/info"
    }).catch(() => undefined);

    const v = version.Version ?? version.ApiVersion ?? "unknown";
    const arch = version.Arch ?? "?";
    const os = version.Os ?? "?";
    const containers = info?.Containers ?? 0;
    const running = info?.ContainersRunning ?? 0;
    const images = info?.Images ?? 0;

    return {
      ok: true,
      message: `Docker ${v} (${os}/${arch}). ${containers} container(s), ${running} running, ${images} image(s).`
    };
  } catch (error) {
    if (error instanceof DockerError) {
      return { ok: false, message: `Docker returned ${error.status}: ${error.message}` };
    }
    const message = error instanceof Error ? error.message : "Unknown connection error.";
    return { ok: false, message };
  }
}

function secretUpdate(value: string | null | undefined, current: string | null): string | null {
  if (value === undefined) return current;
  if (value === null || value === "") return null;
  return encryptSecret(value);
}

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

type ProviderConfigRow = {
  id: string;
  provider: string;
  label: string;
  base_url: string;
  encrypted_api_key: string;
  enabled: number;
  created_at: string;
  updated_at: string;
};

function getProviderConfigRow(provider: string): ProviderConfigRow | undefined {
  return db.prepare("SELECT * FROM provider_configs WHERE provider = ?").get(provider) as ProviderConfigRow | undefined;
}

function getProviderConfig(provider: string): ProviderConfig | null {
  const row = getProviderConfigRow(provider);
  return row ? mapProviderConfig(row) : null;
}

function listProviderConfigs(): ProviderConfig[] {
  const rows = db.prepare("SELECT * FROM provider_configs ORDER BY provider ASC").all() as ProviderConfigRow[];
  return rows.map(mapProviderConfig);
}

function mapProviderConfig(row: ProviderConfigRow): ProviderConfig {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    baseUrl: row.base_url,
    enabled: row.enabled === 1,
    apiKeySet: Boolean(row.encrypted_api_key),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listTokenBudgets(): TokenBudget[] {
  const rows = db.prepare("SELECT * FROM token_budgets ORDER BY updated_at DESC").all() as Array<{
    id: string;
    scope_type: TokenBudget["scopeType"];
    scope_id: string | null;
    provider: string | null;
    provider_key_id: string | null;
    limit_tokens: number;
    limit_usd: number | null;
    period: TokenBudget["period"];
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    scopeName: resolveScopeName(row.scope_type, row.scope_id),
    provider: row.provider,
    providerKeyId: row.provider_key_id,
    limitTokens: row.limit_tokens,
    limitUsd: row.limit_usd,
    period: row.period,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function listPermissionPolicies(): PermissionPolicy[] {
  const rows = db.prepare("SELECT * FROM permission_policies ORDER BY updated_at DESC").all() as Array<{
    id: string;
    scope_type: PermissionPolicy["scopeType"];
    scope_id: string | null;
    permission: string;
    effect: PermissionPolicy["effect"];
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    scopeName: resolveScopeName(row.scope_type, row.scope_id),
    permission: row.permission,
    effect: row.effect,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function listProviderAccessPolicies(): ProviderAccessPolicy[] {
  const rows = db.prepare("SELECT * FROM provider_access_policies ORDER BY updated_at DESC").all() as Array<{
    id: string;
    scope_type: ProviderAccessPolicy["scopeType"];
    scope_id: string | null;
    provider: string;
    effect: ProviderAccessPolicy["effect"];
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    scopeName: resolveScopeName(row.scope_type, row.scope_id),
    provider: row.provider,
    effect: row.effect,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function resolveScopeName(scopeType: string, scopeId: string | null): string {
  if (scopeType === "global" || !scopeId) {
    return "Global";
  }

  const tableByScope: Record<string, { table: string; column: string }> = {
    user: { table: "users", column: "email" },
    group: { table: "groups", column: "name" },
    workspace: { table: "workspaces", column: "name" },
    organization: { table: "organizations", column: "name" }
  };
  const target = tableByScope[scopeType];
  if (!target) {
    return scopeId;
  }

  const row = db.prepare(`SELECT ${target.column} as name FROM ${target.table} WHERE id = ?`).get(scopeId) as
    | { name: string }
    | undefined;
  return row?.name ?? scopeId;
}

function count(table: string): number {
  return scalar(`SELECT COUNT(*) as count FROM ${table}`);
}

function scalar(sql: string): number {
  const row = db.prepare(sql).get() as { count: number };
  return row.count;
}

function ensureExists(table: "users" | "groups", id: string, code: string, message: string): void {
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
  if (!row) {
    throw new HttpError(404, code, message);
  }
}

function ensureMutableGroup(groupId: string): void {
  const row = db.prepare("SELECT id, is_user_group FROM groups WHERE id = ?").get(groupId) as
    | { id: string; is_user_group: number }
    | undefined;
  if (!row) {
    throw new HttpError(404, "group_not_found", "Group not found.");
  }
  if (row.is_user_group === 1) {
    throw new HttpError(403, "personal_group_immutable", "Personal user groups cannot be mutated.");
  }
}
