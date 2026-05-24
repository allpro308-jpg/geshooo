import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { config } from "@/config";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('instance_admin', 'user', 'readonly')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organization_members (
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      is_user_group INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (organization_id, name)
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'group_member' CHECK (role IN ('group_admin', 'group_member')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS workspace_groups (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS group_rules (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      rule_type TEXT NOT NULL,
      effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny', 'limit')),
      provider TEXT,
      model_id TEXT,
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      max_tokens_per_user INTEGER,
      max_tokens_per_group INTEGER,
      max_workspaces INTEGER,
      max_projects_per_workspace INTEGER,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (organization_id, slug)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      type TEXT NOT NULL,
      runtime_kind TEXT NOT NULL,
      source_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, slug)
    );

    CREATE TABLE IF NOT EXISTS workspace_services (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      kind TEXT NOT NULL,
      image TEXT,
      internal_host TEXT NOT NULL,
      internal_port INTEGER,
      connection_env_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, slug)
    );

    CREATE TABLE IF NOT EXISTS provider_keys (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL,
      scope_id TEXT,
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_configs (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      base_url TEXT NOT NULL,
      encrypted_api_key TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_model_policies (
      provider TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK (mode IN ('all', 'allow', 'deny')),
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_model_policy_entries (
      provider TEXT NOT NULL REFERENCES provider_model_policies(provider) ON DELETE CASCADE,
      model_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (provider, model_id)
    );

    CREATE TABLE IF NOT EXISTS provider_access_policies (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('user', 'group', 'global')),
      scope_id TEXT,
      provider TEXT NOT NULL,
      effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL,
      title TEXT,
      model_provider TEXT,
      model_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      parent_snapshot_id TEXT REFERENCES snapshots(id) ON DELETE SET NULL,
      created_by_session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      message TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS env_vars (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL,
      scope_id TEXT,
      key TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      is_secret INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_records (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS token_budgets (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL,
      scope_id TEXT,
      provider TEXT,
      provider_key_id TEXT REFERENCES provider_keys(id) ON DELETE SET NULL,
      limit_tokens INTEGER NOT NULL,
      limit_usd REAL,
      period TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permission_policies (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL,
      scope_id TEXT,
      permission TEXT NOT NULL,
      effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS docker_config (
      id TEXT PRIMARY KEY CHECK (id = 'default'),
      connection_type TEXT NOT NULL CHECK (connection_type IN ('socket', 'tcp')),
      socket_path TEXT NOT NULL,
      tcp_host TEXT NOT NULL,
      tcp_port INTEGER NOT NULL,
      tcp_use_tls INTEGER NOT NULL,
      tcp_username TEXT,
      encrypted_tcp_password TEXT,
      encrypted_ca_cert TEXT,
      encrypted_client_cert TEXT,
      encrypted_client_key TEXT,
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      affected_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      status TEXT NOT NULL,
      requested_by TEXT NOT NULL REFERENCES users(id),
      resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
      content TEXT,
      tool_call_id TEXT,
      tool_calls_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_tool_calls (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES agent_messages(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      arguments_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const now = nowIso();
  try {
    db.prepare("ALTER TABLE agent_sessions ADD COLUMN title TEXT").run();
  } catch (err: any) {
    // Column might already exist
  }

  const defaults = [
    ["byok_enabled", "true"],
    ["global_provider_keys_enabled", "true"],
    ["require_approval_for_dangerous_tools", "true"],
    ["default_token_quota", "null"],
    ["max_workspaces_per_user", "null"],
    ["max_projects_per_workspace", "null"],
    ["preview_base_domain", "null"],
    ["preview_scheme", "\"http\""],
    ["agent_system_prompt", "You are an expert AI software developer agent inside Singulary, a containerized development environment.\nYou help the user develop, debug, and run their application inside a secure environment.\nYou have access to a set of filesystem tools, terminal tools, and platform management tools.\n\nFile operations:\n- Use write_file for NEW files or completely rewriting small files.\n- Use write_diff to surgically edit existing files. You MUST provide the exact targetContent string to replace, and the replacementContent.\n- Use read_file, list_files, delete_file, move_file, copy_file, and find to work with code.\n- NEVER access files or directories that match the project's .gitignore rules (e.g. node_modules, target, etc.).\n- Try to read files first before proposing changes to be highly accurate.\n\nTerminal execution:\n- You can run bash commands in the workspace using the shell tools (shell_open, shell_read, shell_wait, shell_kill).\n- Always verify your work after completing a task by running tests, lint checks, or builds if applicable.\n\nPlatform management:\n- Use project_settings to update the current project's installCommand, startCommand, or templateId.\n- Use container_restart to restart the project container when there's no hot reload or after changing settings.\n- Use ws_create_service to provision workspace services (databases, caches, etc.) from templates. Check available templates in the context below.\n- After creating a service, use the provided connection env key in the project's code.\n\nGuidelines:\n- Write modular, clean, and well-documented code.\n- Explain your implementation clearly and concisely to the user.\n- Use the project context below to understand the current state before making changes."]
  ];

  const insertDefault = db.prepare(
    "INSERT OR IGNORE INTO platform_settings (key, value, updated_by, updated_at) VALUES (?, ?, NULL, ?)"
  );
  for (const [key, value] of defaults) {
    insertDefault.run(key, value, now);
  }

  addColumnIfMissing("snapshots", "tree_sha", "TEXT");
  addColumnIfMissing("snapshots", "file_count", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("snapshots", "total_bytes", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("token_budgets", "provider", "TEXT");
  addColumnIfMissing("groups", "owner_user_id", "TEXT REFERENCES users(id) ON DELETE CASCADE");
  addColumnIfMissing("groups", "is_user_group", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("group_members", "role", "TEXT NOT NULL DEFAULT 'group_member'");
  addColumnIfMissing("workspace_services", "template_id", "TEXT");
  addColumnIfMissing("workspace_services", "config_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing("workspace_services", "encrypted_credentials", "TEXT");
  addColumnIfMissing("workspace_services", "container_id", "TEXT");
  addColumnIfMissing("workspace_services", "last_status", "TEXT NOT NULL DEFAULT 'pending'");
  addColumnIfMissing("workspace_services", "last_status_at", "TEXT");
  addColumnIfMissing("projects", "template_id", "TEXT");
  addColumnIfMissing("projects", "image", "TEXT");
  addColumnIfMissing("projects", "install_command", "TEXT");
  addColumnIfMissing("projects", "dev_command", "TEXT");
  addColumnIfMissing("projects", "start_command", "TEXT");
  addColumnIfMissing("projects", "dev_port", "INTEGER");
  addColumnIfMissing("projects", "container_id", "TEXT");
  addColumnIfMissing("projects", "last_status", "TEXT NOT NULL DEFAULT 'stopped'");
  addColumnIfMissing("projects", "host_port", "INTEGER");
  addColumnIfMissing("projects", "preview_token", "TEXT");
  // Backfill preview tokens for legacy projects.
  const tokenless = db
    .prepare("SELECT id FROM projects WHERE preview_token IS NULL OR preview_token = ''")
    .all() as Array<{ id: string }>;
  if (tokenless.length > 0) {
    const update = db.prepare("UPDATE projects SET preview_token = ? WHERE id = ?");
    for (const row of tokenless) {
      update.run(randomBytes(8).toString("hex"), row.id);
    }
  }
  db.exec(
    "UPDATE projects SET start_command = dev_command WHERE start_command IS NULL AND dev_command IS NOT NULL"
  );

  db.prepare(
    `INSERT OR IGNORE INTO docker_config (
      id,
      connection_type,
      socket_path,
      tcp_host,
      tcp_port,
      tcp_use_tls,
      tcp_username,
      encrypted_tcp_password,
      encrypted_ca_cert,
      encrypted_client_cert,
      encrypted_client_key,
      updated_by,
      updated_at
    )
    VALUES ('default', 'socket', '/var/run/docker.sock', 'localhost', 2375, 0, NULL, NULL, NULL, NULL, NULL, NULL, ?)`
  ).run(now);

  backfillPersonalGroups();
}

function addColumnIfMissing(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function backfillPersonalGroups(): void {
  const users = db.prepare("SELECT id, username, display_name FROM users").all() as Array<{
    id: string;
    username: string;
    display_name: string;
  }>;
  const organization = db.prepare("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1").get() as
    | { id: string }
    | undefined;
  if (!organization) return;

  const now = nowIso();
  const create = db.transaction(() => {
    for (const user of users) {
      const existing = db.prepare("SELECT id FROM groups WHERE owner_user_id = ? AND is_user_group = 1").get(user.id) as
        | { id: string }
        | undefined;
      const groupId = existing?.id ?? `grp_personal_${user.id.replace(/^usr_/, "")}`;
      if (!existing) {
        db.prepare(
          `INSERT OR IGNORE INTO groups (id, organization_id, owner_user_id, name, description, is_user_group, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
        ).run(groupId, organization.id, user.id, "Personal space", `Personal workspace group for ${user.display_name}`, now, now);
      }
      db.prepare(
        `INSERT OR IGNORE INTO group_members (group_id, user_id, role, created_at)
         VALUES (?, ?, 'group_admin', ?)`
      ).run(groupId, user.id, now);
    }
  });
  create();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

migrate();
