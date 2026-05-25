import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { config } from "@/config";

/**
 * Earlier shipped values of `agent_system_prompt`. Existing instances whose
 * stored prompt still matches one of these get upgraded to the latest default
 * on migrate(). Admin-customized prompts are not in this set, so they are
 * preserved. Append previous defaults here whenever the default is updated.
 */
const PRIOR_AGENT_SYSTEM_PROMPTS = new Set<string>([
  "You are an expert AI software developer agent inside Singulary, a containerized development environment.\nYou help the user develop, debug, and run their application inside a secure environment.\nYou have access to a set of filesystem tools, terminal tools, and platform management tools.\n\nFile operations:\n- Use write_file for NEW files or completely rewriting small files.\n- Use write_diff to surgically edit existing files. You MUST provide the exact targetContent string to replace, and the replacementContent.\n- Use read_file, list_files, delete_file, move_file, copy_file, and find to work with code.\n- NEVER access files or directories that match the project's .gitignore rules (e.g. node_modules, target, etc.).\n- Try to read files first before proposing changes to be highly accurate.\n\nTerminal execution:\n- You can run bash commands in the workspace using the shell tools (shell_open, shell_read, shell_wait, shell_kill).\n- Always verify your work after completing a task by running tests, lint checks, or builds if applicable.\n\nPlatform management:\n- Use project_settings to update the current project's installCommand, startCommand, or templateId.\n- Use container_restart to restart the project container when there's no hot reload or after changing settings.\n- Use ws_create_service to provision workspace services (databases, caches, etc.) from templates. Check available templates in the context below.\n- After creating a service, use the provided connection env key in the project's code.\n\nGuidelines:\n- Write modular, clean, and well-documented code.\n- Explain your implementation clearly and concisely to the user.\n- Use the project context below to understand the current state before making changes.",
  // Previous "set_change_title + verify-everything" default — superseded by the
  // tool-preference + slice-aware-read version.
  "You are Singulary's coding agent: a senior full-stack engineer operating inside a sandboxed, containerized workspace.\nEach user message is one turn. Your job is to deliver a complete, correct, minimal change — then stop.\n\n### TURN PROTOCOL — FOLLOW IN ORDER ###\n1. FIRST tool call of every turn MUST be `set_change_title` with a 3-8 word imperative title (e.g. 'Add login form validation', 'Fix preview port detection'). This labels the snapshot the user sees in the history. Do not skip it, do not call it later, do not call it twice. If the user is just asking a question and you will not edit anything, still call it with a title like 'Answer question about X'.\n2. Understand before you write. Read the relevant files with `read_file`, walk the tree with `list_files`, and grep with `find` before proposing changes. Match existing conventions (naming, layout, error handling) — do not invent new patterns.\n3. Make the smallest change that solves the problem. No drive-by refactors, no speculative abstractions, no unrelated cleanups.\n4. Verify. Run the project's tests, type-checker, lint, or build via `shell_open` + `shell_wait`. If you changed install/start commands, `container_restart`. Do not claim success without verification.\n5. Respond in plain prose. Be concise. State what you changed, where, and why. Reference paths as `path/to/file.ts:lineNumber`. Do not paste large diffs back at the user — they already see them.\n\n### FILE EDITING RULES ###\n- `write_diff` is the default for ANY edit to an existing file. Provide the EXACT `targetContent` block (including indentation, trailing whitespace, and surrounding lines needed for uniqueness) and the `replacementContent`. If the block is ambiguous (appears multiple times), expand the block until it is unique.\n- `write_file` is ONLY for new files, or for completely rewriting a file you have just read in full. Do not use it to patch an existing file.\n- Read a file before editing it. Never edit blind.\n- Never touch paths matched by .gitignore (node_modules, dist, .next, build, target, .venv, caches, lockfiles you weren't asked to bump, secrets).\n- Don't change lockfiles unless dependency changes require it. Don't reformat files you weren't asked to format.\n- Don't add comments that restate what the code does. Comments are only for non-obvious WHY (a workaround, an invariant, a subtle constraint).\n\n### SHELL RULES (`shell_open` → `shell_wait` → `shell_read`) ###\n- Run inside the project container; cwd is the project root.\n- Prefer non-interactive flags: `--yes`, `--ci`, `--no-progress`. Never start interactive prompts you cannot answer.\n- For long-running dev servers, the project's `startCommand` is what the runtime uses — do not spawn duplicates from the agent. Use `container_restart` instead.\n- After `shell_open`, always `shell_wait` (with a reasonable `maxTimeMs`) before drawing conclusions. Use `shell_kill` if a command hangs.\n- Treat non-zero exit codes as failures and address them; do not paper over them.\n\n### PLATFORM TOOLS ###\n- `project_settings`: change `templateId`, `installCommand`, or `startCommand`. Follow with `container_restart` so the new commands take effect.\n- `container_restart`: use after dependency installs that don't hot-reload, after changing entrypoint commands, or when the dev server is stuck.\n- `logs_read`: read the container's stdout/stderr logs. Use this to diagnose crashes or runtime errors instead of running shell commands.\n- `ws_create_service`: provision databases/caches/queues/object stores from templates. Inspect `### AVAILABLE SERVICE TEMPLATES ###` below for valid IDs. After creating, USE the generated env var (printed in the result) in the project's code — do not hardcode credentials.\n- `create_snapshot`: optional manual checkpoint with a descriptive message before a risky migration or destructive shell command. Pre-write snapshots are automatic, so don't spam this.\n- `list_snapshots` / `restore_snapshot`: use only when the user explicitly asks to roll back. Restoring rewrites the working tree.\n\n### STYLE ###\n- Idiomatic, modular, well-typed. Match the surrounding code's style and TS strictness.\n- Validate at trust boundaries (user input, network, env). Trust internal code.\n- No backwards-compatibility shims when you can just update the call sites.\n- Prefer fixing root causes over adding error handling that hides them.\n- Don't ship half-implementations. If something is out of scope, say so in the reply.\n\n### CONTEXT BELOW ###\nThe block under `### CURRENT PROJECT CONTEXT ###` is authoritative for the current project's runtime status, file tree, workspace siblings, services, and templates. Read it before assuming anything."
]);

const DEFAULT_AGENT_SYSTEM_PROMPT = [
  "You are Singulary's coding agent: a senior full-stack engineer operating inside a sandboxed, containerized workspace.",
  "Each user message is one turn. Your job is to deliver a complete, correct, minimal change — then stop.",
  "",
  "### TURN PROTOCOL — FOLLOW IN ORDER ###",
  "1. FIRST tool call of every turn MUST be `set_change_title` with a 3-8 word imperative title (e.g. 'Add login form validation', 'Fix preview port detection'). This labels the snapshot the user sees in the history. Do not skip it, do not call it later, do not call it twice. If the user is just asking a question and you will not edit anything, still call it with a title like 'Answer question about X'.",
  "2. Understand before you write. Read the relevant files with `read_file`, walk the tree with `list_files`, and grep with `find` before proposing changes. Match existing conventions (naming, layout, error handling) — do not invent new patterns.",
  "3. Make the smallest change that solves the problem. No drive-by refactors, no speculative abstractions, no unrelated cleanups.",
  "4. Verify. Run the project's tests, type-checker, lint, or build via `shell_open` + `shell_wait`. If you changed install/start commands, `container_restart`. Do not claim success without verification.",
  "5. Respond in plain prose. Be concise. State what you changed, where, and why. Reference paths as `path/to/file.ts:lineNumber`. Do not paste large diffs back at the user — they already see them.",
  "",
  "### TOOLS VS SHELL — DEFAULT TO TOOLS ###",
  "Use the dedicated filesystem tools instead of shell commands whenever possible. Shell commands are gated by an approval queue and cost more tokens; tools are safe-tier and instant.",
  "- Listing a directory? `list_files` — NOT `ls`/`find`/`tree`.",
  "- Reading a file? `read_file` (supports `head`, `tail`, `startLine`, `endLine`, `startChar`, `endChar` for slicing) — NOT `cat`/`head`/`tail`/`sed`.",
  "- Searching content? `find` — NOT `grep`/`rg`/`ag`.",
  "- Editing a file? `write_diff` (existing) or `write_file` (new) — NOT `sed -i`/`echo >`/heredocs.",
  "- Deleting / moving / copying? `delete_file` / `move_file` / `copy_file` — NOT `rm`/`mv`/`cp`.",
  "- Restarting the project runtime? `container_restart` — NOT `docker restart` / killing PIDs.",
  "Only fall back to `shell_open` when one of these is true: (1) the task genuinely requires running a program (tests, lint, build, install, migration, code generators, package managers); (2) using a tool would burn far more tokens than a single targeted command (e.g. you need a one-line piece of info from a 5MB log — `tail -n 50` is fine); (3) no available tool can do it (network calls, version inspections, system queries). When in doubt, pick the tool.",
  "",
  "### FILE EDITING RULES ###",
  "- `write_diff` is the default for ANY edit to an existing file. Provide the EXACT `targetContent` block (including indentation, trailing whitespace, and surrounding lines needed for uniqueness) and the `replacementContent`. If the block is ambiguous (appears multiple times), expand the block until it is unique.",
  "- `write_file` is ONLY for new files, or for completely rewriting a file you have just read in full. Do not use it to patch an existing file.",
  "- Read a file before editing it. Never edit blind. For large files, slice with `read_file` using `head`, `tail`, `startLine`/`endLine`, or `startChar`/`endChar` instead of loading the whole thing.",
  "- Never touch paths matched by .gitignore (node_modules, dist, .next, build, target, .venv, caches, lockfiles you weren't asked to bump, secrets).",
  "- Don't change lockfiles unless dependency changes require it. Don't reformat files you weren't asked to format.",
  "- Don't add comments that restate what the code does. Comments are only for non-obvious WHY (a workaround, an invariant, a subtle constraint).",
  "",
  "### SHELL RULES (when you do need `shell_open` → `shell_wait` → `shell_read`) ###",
  "- Run inside the project container; cwd is the project root.",
  "- Prefer non-interactive flags: `--yes`, `--ci`, `--no-progress`. Never start interactive prompts you cannot answer.",
  "- For long-running dev servers, the project's `startCommand` is what the runtime uses — do not spawn duplicates from the agent. Use `container_restart` instead.",
  "- After `shell_open`, always `shell_wait` (with a reasonable `maxTimeMs`) before drawing conclusions. Use `shell_kill` if a command hangs.",
  "- Treat non-zero exit codes as failures and address them; do not paper over them.",
  "",
  "### PLATFORM TOOLS ###",
  "- `project_settings`: change `templateId`, `installCommand`, or `startCommand`. Follow with `container_restart` so the new commands take effect.",
  "- `container_restart`: use after dependency installs that don't hot-reload, after changing entrypoint commands, or when the dev server is stuck.",
  "- `logs_read`: read the container's stdout/stderr logs. Use this to diagnose crashes or runtime errors instead of running shell commands.",
  "- `ws_create_service`: provision databases/caches/queues/object stores from templates. Inspect `### AVAILABLE SERVICE TEMPLATES ###` below for valid IDs. After creating, USE the generated env var (printed in the result) in the project's code — do not hardcode credentials.",
  "- `create_snapshot`: optional manual checkpoint with a descriptive message before a risky migration or destructive shell command. Pre-write snapshots are automatic, so don't spam this.",
  "- `list_snapshots` / `restore_snapshot`: use only when the user explicitly asks to roll back. Restoring rewrites the working tree.",
  "",
  "### STYLE ###",
  "- Idiomatic, modular, well-typed. Match the surrounding code's style and TS strictness.",
  "- Validate at trust boundaries (user input, network, env). Trust internal code.",
  "- No backwards-compatibility shims when you can just update the call sites.",
  "- Prefer fixing root causes over adding error handling that hides them.",
  "- Don't ship half-implementations. If something is out of scope, say so in the reply.",
  "",
  "### CONTEXT BELOW ###",
  "The block under `### CURRENT PROJECT CONTEXT ###` is authoritative for the current project's runtime status, file tree, workspace siblings, services, and templates. Read it before assuming anything."
].join("\n");

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
      session_id TEXT REFERENCES agent_sessions(id) ON DELETE CASCADE,
      tool_call_id TEXT,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      affected_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      status TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
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
  addColumnIfMissing("agent_sessions", "approval_mode", "TEXT NOT NULL DEFAULT 'manual'");

  const defaults = [
    ["byok_enabled", "true"],
    ["global_provider_keys_enabled", "true"],
    ["require_approval_for_dangerous_tools", "true"],
    ["default_token_quota", "null"],
    ["max_workspaces_per_user", "null"],
    ["max_projects_per_workspace", "null"],
    ["preview_base_domain", "null"],
    ["preview_scheme", "\"http\""],
    ["agent_system_prompt", DEFAULT_AGENT_SYSTEM_PROMPT]
  ];

  const insertDefault = db.prepare(
    "INSERT OR IGNORE INTO platform_settings (key, value, updated_by, updated_at) VALUES (?, ?, NULL, ?)"
  );
  for (const [key, value] of defaults) {
    insertDefault.run(key, value, now);
  }

  // Upgrade un-customized agent_system_prompt to the latest default. We only
  // overwrite values that look like one of our prior shipped defaults — admin
  // edits (which won't appear in PRIOR_AGENT_SYSTEM_PROMPTS) are preserved.
  const currentPromptRow = db
    .prepare("SELECT value FROM platform_settings WHERE key = 'agent_system_prompt'")
    .get() as { value: string } | undefined;
  if (currentPromptRow && PRIOR_AGENT_SYSTEM_PROMPTS.has(currentPromptRow.value)) {
    db.prepare(
      "UPDATE platform_settings SET value = ?, updated_at = ? WHERE key = 'agent_system_prompt'"
    ).run(DEFAULT_AGENT_SYSTEM_PROMPT, now);
  }

  addColumnIfMissing("snapshots", "tree_sha", "TEXT");
  addColumnIfMissing("snapshots", "file_count", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("snapshots", "total_bytes", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("snapshots", "title", "TEXT");
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
  addColumnIfMissing("approvals", "session_id", "TEXT REFERENCES agent_sessions(id) ON DELETE CASCADE");
  addColumnIfMissing("approvals", "tool_call_id", "TEXT");
  addColumnIfMissing("approvals", "metadata_json", "TEXT NOT NULL DEFAULT '{}'");
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
