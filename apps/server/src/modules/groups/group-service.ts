import type { GroupRule, MyGroup } from "@singulary/shared";

import { db, nowIso } from "@/db/database";
import { mapWorkspace } from "@/db/mappers";
import { getPlatformSettings } from "@/modules/admin/platform-settings";
import { createId } from "@/shared/ids/id";

export function getPersonalGroupId(userId: string): string {
  const row = db.prepare("SELECT id FROM groups WHERE owner_user_id = ? AND is_user_group = 1").get(userId) as
    | { id: string }
    | undefined;

  if (row) return row.id;

  const organization = db
    .prepare("SELECT organization_id FROM organization_members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1")
    .get(userId) as { organization_id: string } | undefined;

  if (!organization) {
    throw new Error("User has no organization.");
  }

  const now = nowIso();
  const groupId = createId("grp");
  db.prepare(
    `INSERT INTO groups (id, organization_id, owner_user_id, name, description, is_user_group, created_at, updated_at)
     VALUES (?, ?, ?, 'Personal space', 'Personal workspace group', 1, ?, ?)`
  ).run(groupId, organization.organization_id, userId, now, now);
  db.prepare(
    `INSERT INTO group_members (group_id, user_id, role, created_at)
     VALUES (?, ?, 'group_admin', ?)`
  ).run(groupId, userId, now);
  return groupId;
}

export function attachWorkspaceToGroup(workspaceId: string, groupId: string): void {
  db.prepare("INSERT OR IGNORE INTO workspace_groups (workspace_id, group_id, created_at) VALUES (?, ?, ?)").run(
    workspaceId,
    groupId,
    nowIso()
  );
}

export function listMyGroups(userId: string): MyGroup[] {
  const rows = db
    .prepare(
      `SELECT groups.*, group_members.role as group_role
       FROM groups
       JOIN group_members ON group_members.group_id = groups.id
       WHERE group_members.user_id = ?
       ORDER BY groups.is_user_group DESC, groups.name ASC`
    )
    .all(userId) as Array<{
    id: string;
    organization_id: string;
    owner_user_id: string | null;
    name: string;
    description: string | null;
    is_user_group: number;
    group_role: MyGroup["groupRole"];
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((row) => {
    const workspaceRows = db
      .prepare(
        `SELECT workspaces.*
         FROM workspaces
         JOIN workspace_groups ON workspace_groups.workspace_id = workspaces.id
         WHERE workspace_groups.group_id = ?
         ORDER BY workspaces.updated_at DESC`
      )
      .all(row.id);

    return {
      id: row.id,
      organizationId: row.organization_id,
      ownerUserId: row.owner_user_id,
      name: row.is_user_group ? "Personal space" : row.name,
      description: row.description,
      isUserGroup: row.is_user_group === 1,
      memberCount: countGroupMembers(row.id),
      groupRole: row.group_role,
      workspaces: workspaceRows.map((workspace) => mapWorkspace(workspace as Parameters<typeof mapWorkspace>[0])),
      limits: resolveGroupLimits(row.id, row.is_user_group === 1),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  });
}

export function resolveGroupLimits(groupId: string, isUserGroup: boolean): MyGroup["limits"] {
  const settings = getPlatformSettings();
  const workspaceRule = db
    .prepare(
      `SELECT max_workspaces
       FROM group_rules
       WHERE group_id = ? AND rule_type = 'workspace_limit' AND max_workspaces IS NOT NULL
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .get(groupId) as { max_workspaces: number } | undefined;
  const projectRule = db
    .prepare(
      `SELECT max_projects_per_workspace
       FROM group_rules
       WHERE group_id = ? AND rule_type = 'project_limit' AND max_projects_per_workspace IS NOT NULL
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .get(groupId) as { max_projects_per_workspace: number } | undefined;

  return {
    maxWorkspaces: workspaceRule?.max_workspaces ?? (isUserGroup ? settings.maxWorkspacesPerUser : null),
    maxProjectsPerWorkspace: projectRule?.max_projects_per_workspace ?? settings.maxProjectsPerWorkspace
  };
}

export function listGroupRules(): GroupRule[] {
  const rows = db
    .prepare(
      `SELECT group_rules.*, groups.name as group_name, workspaces.name as workspace_name
       FROM group_rules
       JOIN groups ON groups.id = group_rules.group_id
       LEFT JOIN workspaces ON workspaces.id = group_rules.workspace_id
       ORDER BY group_rules.updated_at DESC`
    )
    .all() as Array<{
    id: string;
    group_id: string;
    group_name: string;
    rule_type: GroupRule["ruleType"];
    effect: GroupRule["effect"];
    provider: string | null;
    model_id: string | null;
    workspace_id: string | null;
    workspace_name: string | null;
    max_tokens_per_user: number | null;
    max_tokens_per_group: number | null;
    max_workspaces: number | null;
    max_projects_per_workspace: number | null;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    groupId: row.group_id,
    groupName: row.group_name,
    ruleType: row.rule_type,
    effect: row.effect,
    provider: row.provider,
    modelId: row.model_id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    maxTokensPerUser: row.max_tokens_per_user,
    maxTokensPerGroup: row.max_tokens_per_group,
    maxWorkspaces: row.max_workspaces,
    maxProjectsPerWorkspace: row.max_projects_per_workspace,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function countGroupMembers(groupId: string): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM group_members WHERE group_id = ?").get(groupId) as { count: number };
  return row.count;
}
