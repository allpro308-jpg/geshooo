import { createHash, randomBytes } from "node:crypto";

import type { AuthUser, User } from "@singulary/shared";

import { db, nowIso, slugify } from "@/db/database";
import { mapUser } from "@/db/mappers";
import { recordAudit } from "@/modules/audit/audit-service";
import { hashPassword, verifyPassword } from "@/shared/crypto/passwords";
import { HttpError } from "@/shared/errors/http-error";
import { createId } from "@/shared/ids/id";

const sessionDays = 14;
const webSocketTokenTtlMs = 60_000;

const webSocketAuthTokens = new Map<string, { userId: string; expiresAt: number }>();

type UserRow = {
  id: string;
  email: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: User["role"];
  created_at: string;
  updated_at: string;
};

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    role: user.role
  };
}

export function userCount(): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  return row.count;
}

export async function createAdminUser(input: {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}): Promise<User> {
  const email = input.email.trim().toLowerCase();
  const username = slugify(input.username);
  if (!email || !username || input.password.length < 8) {
    throw new HttpError(400, "invalid_admin_input", "Email, username, and an 8+ character password are required.");
  }

  const existing = db
    .prepare("SELECT id FROM users WHERE email = ? OR username = ?")
    .get(email, username);
  if (existing) {
    throw new HttpError(409, "user_exists", "A user with that email or username already exists.");
  }

  const now = nowIso();
  const userId = createId("usr");
  const organizationId = createId("org");
  const personalGroupId = createId("grp");
  const displayName = input.displayName?.trim() || input.username.trim();
  const passwordHash = await hashPassword(input.password);

  const create = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, email, username, display_name, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'instance_admin', ?, ?)`
    ).run(userId, email, username, displayName, passwordHash, now, now);

    db.prepare(
      `INSERT INTO organizations (id, name, slug, owner_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(organizationId, "Personal", "personal", userId, now, now);

    db.prepare(
      `INSERT INTO organization_members (organization_id, user_id, role, created_at)
       VALUES (?, ?, 'owner', ?)`
    ).run(organizationId, userId, now);

    db.prepare(
      `INSERT INTO groups (id, organization_id, owner_user_id, name, description, is_user_group, created_at, updated_at)
       VALUES (?, ?, ?, 'Personal space', ?, 1, ?, ?)`
    ).run(personalGroupId, organizationId, userId, `Personal workspace group for ${displayName}`, now, now);

    db.prepare(
      `INSERT INTO group_members (group_id, user_id, role, created_at)
       VALUES (?, ?, 'group_admin', ?)`
    ).run(personalGroupId, userId, now);
  });

  create();
  recordAudit("user.admin_created", userId, { email, username });

  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow;
  return mapUser(row);
}

export async function authenticate(email: string, password: string): Promise<User> {
  const row = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as UserRow | undefined;

  if (!row || !(await verifyPassword(password, row.password_hash))) {
    throw new HttpError(401, "invalid_credentials", "Invalid email or password.");
  }

  return mapUser(row);
}

export function createSession(userId: string): { id: string; token: string; expiresAt: string } {
  const id = createId("ses");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, userId, tokenHash, expiresAt, nowIso());

  return { id, token, expiresAt };
}

export function createWebSocketAuthToken(userId: string): { token: string; expiresAt: string } {
  pruneExpiredWebSocketAuthTokens();

  const token = randomBytes(32).toString("base64url");
  const expiresAtMs = Date.now() + webSocketTokenTtlMs;
  webSocketAuthTokens.set(token, { userId, expiresAt: expiresAtMs });

  return { token, expiresAt: new Date(expiresAtMs).toISOString() };
}

export function resolveWebSocketAuthToken(token: string | null | undefined): string | null {
  if (!token) return null;

  const entry = webSocketAuthTokens.get(token);
  webSocketAuthTokens.delete(token);

  if (!entry || entry.expiresAt <= Date.now()) {
    return null;
  }

  return entry.userId;
}

export function resolveSession(token: string | undefined): AuthUser | null {
  if (!token) {
    return null;
  }

  const row = db
    .prepare(
      `SELECT sessions.id as session_id, users.*
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`
    )
    .get(hashToken(token), nowIso()) as (UserRow & { session_id: string }) | undefined;

  if (!row) {
    return null;
  }

  return toAuthUser(mapUser(row));
}

export function destroySession(token: string | undefined): void {
  if (!token) {
    return;
  }

  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function pruneExpiredWebSocketAuthTokens(): void {
  const now = Date.now();
  for (const [token, entry] of webSocketAuthTokens) {
    if (entry.expiresAt <= now) {
      webSocketAuthTokens.delete(token);
    }
  }
}
