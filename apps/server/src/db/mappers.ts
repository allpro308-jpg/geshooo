import type { AuditLog, Project, ProviderKey, User, Workspace, WorkspaceService } from "@singulary/shared";

type UserRow = {
  id: string;
  email: string;
  username: string;
  display_name: string;
  role: User["role"];
  created_at: string;
  updated_at: string;
};

export function mapUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

type WorkspaceRow = {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export function mapWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

type ProjectRow = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  runtime_kind: Project["runtimeKind"];
  source_path: string;
  template_id: string | null;
  image: string | null;
  install_command: string | null;
  start_command: string | null;
  container_id: string | null;
  last_status: Project["lastStatus"] | null;
  created_at: string;
  updated_at: string;
};

export function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    slug: row.slug,
    runtimeKind: row.runtime_kind,
    sourcePath: row.source_path,
    templateId: row.template_id,
    image: row.image,
    installCommand: row.install_command,
    startCommand: row.start_command,
    containerId: row.container_id,
    lastStatus: row.last_status ?? "stopped",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

type WorkspaceServiceRow = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  kind: WorkspaceService["kind"];
  template_id: string | null;
  image: string | null;
  internal_host: string;
  internal_port: number | null;
  connection_env_key: string | null;
  container_id: string | null;
  last_status: WorkspaceService["lastStatus"] | null;
  created_at: string;
  updated_at: string;
};

export function mapWorkspaceService(row: WorkspaceServiceRow): WorkspaceService {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    templateId: row.template_id,
    image: row.image,
    internalHost: row.internal_host,
    internalPort: row.internal_port,
    connectionEnvKey: row.connection_env_key,
    containerId: row.container_id,
    lastStatus: row.last_status ?? "pending",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

type ProviderKeyRow = {
  id: string;
  scope_type: ProviderKey["scopeType"];
  scope_id: string | null;
  provider: string;
  label: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export function mapProviderKey(row: ProviderKeyRow): ProviderKey {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    provider: row.provider,
    label: row.label,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

type AuditRow = {
  id: string;
  event: string;
  actor_user_id: string | null;
  metadata: string;
  created_at: string;
};

export function mapAudit(row: AuditRow): AuditLog {
  return {
    id: row.id,
    event: row.event,
    actorUserId: row.actor_user_id,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.created_at
  };
}
