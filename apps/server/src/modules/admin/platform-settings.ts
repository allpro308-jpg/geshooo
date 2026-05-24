import type { PlatformSettings } from "@singulary/shared";

import { db, nowIso } from "@/db/database";

type SettingRow = {
  key: string;
  value: string;
};

export function getPlatformSettings(): PlatformSettings {
  const rows = db.prepare("SELECT key, value FROM platform_settings").all() as SettingRow[];
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  return {
    byokEnabled: values.byok_enabled !== "false",
    globalProviderKeysEnabled: values.global_provider_keys_enabled !== "false",
    requireApprovalForDangerousTools: values.require_approval_for_dangerous_tools !== "false",
    defaultTokenQuota: parseNullableNumber(values.default_token_quota),
    maxWorkspacesPerUser: parseNullableNumber(values.max_workspaces_per_user),
    maxProjectsPerWorkspace: parseNullableNumber(values.max_projects_per_workspace),
    previewBaseDomain: parseNullableString(values.preview_base_domain),
    previewScheme: parseScheme(values.preview_scheme),
    agentSystemPrompt: values.agent_system_prompt || ""
  };
}

function parseNullableString(value: string | undefined): string | null {
  if (!value || value === "null") return null;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
    return null;
  } catch {
    return value.trim() || null;
  }
}

function parseScheme(value: string | undefined): "http" | "https" {
  const parsed = parseNullableString(value);
  return parsed === "https" ? "https" : "http";
}

export function updatePlatformSettings(input: Partial<PlatformSettings>, updatedBy: string): PlatformSettings {
  const updates: Array<[string, string]> = [];

  if (input.byokEnabled !== undefined) {
    updates.push(["byok_enabled", String(input.byokEnabled)]);
  }
  if (input.globalProviderKeysEnabled !== undefined) {
    updates.push(["global_provider_keys_enabled", String(input.globalProviderKeysEnabled)]);
  }
  if (input.requireApprovalForDangerousTools !== undefined) {
    updates.push(["require_approval_for_dangerous_tools", String(input.requireApprovalForDangerousTools)]);
  }
  if (input.defaultTokenQuota !== undefined) {
    updates.push(["default_token_quota", input.defaultTokenQuota === null ? "null" : String(input.defaultTokenQuota)]);
  }
  if (input.maxWorkspacesPerUser !== undefined) {
    updates.push(["max_workspaces_per_user", input.maxWorkspacesPerUser === null ? "null" : String(input.maxWorkspacesPerUser)]);
  }
  if (input.maxProjectsPerWorkspace !== undefined) {
    updates.push([
      "max_projects_per_workspace",
      input.maxProjectsPerWorkspace === null ? "null" : String(input.maxProjectsPerWorkspace)
    ]);
  }
  if (input.previewBaseDomain !== undefined) {
    const normalized = input.previewBaseDomain
      ? input.previewBaseDomain.trim().replace(/^\.+|\.+$/g, "").toLowerCase() || null
      : null;
    updates.push(["preview_base_domain", normalized === null ? "null" : JSON.stringify(normalized)]);
  }
  if (input.previewScheme !== undefined) {
    const scheme = input.previewScheme === "https" ? "https" : "http";
    updates.push(["preview_scheme", JSON.stringify(scheme)]);
  }
  if (input.agentSystemPrompt !== undefined) {
    updates.push(["agent_system_prompt", input.agentSystemPrompt]);
  }

  const now = nowIso();
  const statement = db.prepare(
    `INSERT INTO platform_settings (key, value, updated_by, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  );

  const write = db.transaction(() => {
    for (const [key, value] of updates) {
      statement.run(key, value, updatedBy, now);
    }
  });
  write();

  return getPlatformSettings();
}

function parseNullableNumber(value: string | undefined): number | null {
  if (!value || value === "null") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
