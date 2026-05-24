export type GlobalRole = "instance_admin" | "user" | "readonly";

export type User = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: GlobalRole;
  createdAt: string;
  updatedAt: string;
};

export type AuthUser = Omit<User, "createdAt" | "updatedAt">;

export type Workspace = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeKind =
  | "node"
  | "bun"
  | "deno"
  | "python"
  | "go"
  | "rust"
  | "php"
  | "static"
  | "database_sqlite"
  | "redis"
  | "custom_dockerfile"
  | "custom_compose";

export type Project = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  runtimeKind: RuntimeKind;
  sourcePath: string;
  templateId: string | null;
  image: string | null;
  installCommand: string | null;
  startCommand: string | null;
  containerId: string | null;
  lastStatus: ProjectStatus;
  createdAt: string;
  updatedAt: string;
};

export type ProjectTemplate = {
  id: string;
  name: string;
  description: string;
  category: "javascript" | "python" | "compiled" | "static" | "custom";
  runtimeKind: RuntimeKind;
  image: string;
  installCommand: string | null;
  startCommand: string | null;
  iconKey: string;
  hints: {
    workdir: string;
    depsVolumePath: string | null;
    commonPorts: number[];
  };
};

export type SnapshotKind =
  | "manual"
  | "agent_pre_write"
  | "agent_batch"
  | "before_command"
  | "checkpoint"
  | "rollback";

export type Snapshot = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  parentSnapshotId: string | null;
  createdBySessionId: string | null;
  createdByUserId: string | null;
  message: string;
  kind: SnapshotKind;
  treeSha: string;
  fileCount: number;
  totalBytes: number;
  createdAt: string;
};

export type SnapshotFileEntry = {
  path: string;
  blobSha: string;
  size: number;
};

export type SnapshotDiffEntry = {
  path: string;
  status: "added" | "removed" | "modified" | "unchanged";
  beforeSize: number | null;
  afterSize: number | null;
};

export type SnapshotDiff = {
  baseSnapshotId: string | null;
  targetSnapshotId: string;
  entries: SnapshotDiffEntry[];
};

export type ProjectStatus =
  | "stopped"
  | "starting"
  | "installing"
  | "running"
  | "exited"
  | "error"
  | "unknown";

export type PreviewMode = "direct" | "domain";

export type ProjectRuntimeInfo = {
  status: ProjectStatus;
  containerId: string | null;
  ipAddress: string | null;
  startedAt: string | null;
  exitCode: number | null;
  error: string | null;
  previewReady: boolean;
  detectedPorts: number[];
  exposedPorts: number[];
  preview: {
    mode: PreviewMode;
    /** Subdomain token (only meaningful for `domain` mode). */
    token: string | null;
    /** Configured base domain (only meaningful for `domain` mode). */
    baseDomain: string | null;
    /** Scheme used when building domain-mode URLs. */
    scheme: "http" | "https";
    /**
     * Per detected port, the full URL the frontend should load in the iframe.
     * In `direct` mode it points at the container bridge IP; in `domain` mode
     * it points at `<port>.<token>.<baseDomain>`.
     */
    urlsByPort: Record<number, string>;
  };
};

export type ProjectLogLevel = "info" | "warn" | "error";

export type ProjectLogLine = {
  level: ProjectLogLevel;
  stream: "stdout" | "stderr";
  text: string;
  timestamp: string;
};

export type ProjectLogStats = {
  total: number;
  info: number;
  warn: number;
  error: number;
};

export type ProjectShell = {
  id: string;
  projectId: string;
  label: string;
  status: "running" | "exited";
  createdAt: string;
  cols: number;
  rows: number;
};

export type ProjectEvent =
  | { type: "runtime"; runtime: ProjectRuntimeInfo }
  | { type: "logs"; lines: ProjectLogLine[]; stats: ProjectLogStats; mode: "append" | "snapshot" }
  | { type: "shells"; shells: ProjectShell[] }
  | { type: "presence"; clients: number; idleUntilEpochMs: number | null };

export type WorkspaceServiceKind =
  | "database_sqlite"
  | "database_postgres"
  | "database_mysql"
  | "database_mongo"
  | "redis"
  | "queue"
  | "object_storage"
  | "search"
  | "custom";

export type WorkspaceService = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  kind: WorkspaceServiceKind;
  templateId: string | null;
  image: string | null;
  internalHost: string;
  internalPort: number | null;
  connectionEnvKey: string | null;
  containerId: string | null;
  lastStatus: ServiceStatus;
  createdAt: string;
  updatedAt: string;
};

export type ServiceStatus =
  | "pending"
  | "creating"
  | "running"
  | "stopped"
  | "restarting"
  | "exited"
  | "error"
  | "destroyed"
  | "unknown";

export type ServiceTemplateField = {
  key: string;
  label: string;
  description?: string;
  type: "string" | "number" | "boolean" | "select" | "password" | "auto";
  defaultValue?: string | number | boolean | null;
  placeholder?: string;
  required?: boolean;
  min?: number;
  max?: number;
  options?: Array<{ value: string; label: string }>;
  secret?: boolean;
  generated?: boolean;
};

export type ServiceTemplate = {
  id: string;
  kind: WorkspaceServiceKind;
  name: string;
  description: string;
  iconKey: string;
  image: string;
  defaultPort: number;
  defaultEnvKey: string;
  fields: ServiceTemplateField[];
  connectionUriTemplate: string;
  envTemplate: Record<string, string>;
  category: "database" | "cache" | "queue" | "storage" | "search" | "custom";
};

export type ServiceCredential = {
  key: string;
  label: string;
  value: string;
  secret: boolean;
};

export type ServiceRuntimeInfo = {
  status: ServiceStatus;
  containerId: string | null;
  ipAddress: string | null;
  startedAt: string | null;
  exitCode: number | null;
  error: string | null;
  healthy: boolean | null;
  healthCheckedAt: string | null;
  healthMessage: string | null;
};

export type ServiceDetail = {
  service: WorkspaceService;
  template: ServiceTemplate | null;
  runtime: ServiceRuntimeInfo;
  connectionUri: string | null;
  credentials: ServiceCredential[];
  config: Record<string, unknown>;
};

export type ServiceLogLine = {
  stream: "stdout" | "stderr";
  text: string;
  timestamp: string;
};

export type FileEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number | null;
  modifiedAt: string;
};

export type FileContent = {
  content: string;
  size: number;
  binary: boolean;
};

export type ProjectEnvVar = {
  id: string;
  key: string;
  value: string | null;
  isSecret: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProviderScope = "user" | "workspace" | "organization" | "global";

export type ProviderKey = {
  id: string;
  scopeType: ProviderScope;
  scopeId: string | null;
  provider: string;
  label: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ProviderConfig = {
  id: string;
  provider: string;
  label: string;
  baseUrl: string;
  enabled: boolean;
  apiKeySet: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PlatformSettings = {
  byokEnabled: boolean;
  globalProviderKeysEnabled: boolean;
  requireApprovalForDangerousTools: boolean;
  defaultTokenQuota: number | null;
  maxWorkspacesPerUser: number | null;
  maxProjectsPerWorkspace: number | null;
  /**
   * When set, the platform builds preview URLs as
   * `<port>.<projectToken>.<previewBaseDomain>` and runs a host-based reverse
   * proxy that forwards to the container IP:port. Requires wildcard DNS
   * (`*.<previewBaseDomain>`) pointing at the platform host.
   *
   * When null, the platform returns the container's bridge IP directly and
   * the user's browser connects without going through the platform. This only
   * works when the browser can reach the Docker network (typically: a
   * Linux host running both Docker and the browser).
   */
  previewBaseDomain: string | null;
  /** `http` or `https`. Only used when previewBaseDomain is set. */
  previewScheme: "http" | "https";
  agentSystemPrompt?: string;
};

export type AdminUser = User & {
  groupCount: number;
  groups: Array<{
    id: string;
    name: string;
  }>;
};

export type Group = {
  id: string;
  organizationId: string;
  ownerUserId: string | null;
  name: string;
  description: string | null;
  isUserGroup: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export type GroupRole = "group_admin" | "group_member";

export type GroupMember = {
  groupId: string;
  userId: string;
  email: string;
  username: string;
  displayName: string;
  role: GlobalRole;
  groupRole: GroupRole;
  createdAt: string;
};

export type WorkspaceGroupAccess = {
  workspaceId: string;
  workspaceName: string;
  groupId: string;
  groupName: string;
  createdAt: string;
};

export type TokenBudgetScope = "user" | "group" | "workspace" | "organization" | "global";

export type TokenBudget = {
  id: string;
  scopeType: TokenBudgetScope;
  scopeId: string | null;
  scopeName: string;
  provider: string | null;
  providerKeyId: string | null;
  limitTokens: number;
  limitUsd: number | null;
  period: "daily" | "weekly" | "monthly" | "lifetime" | "custom";
  createdAt: string;
  updatedAt: string;
};

export type PermissionPolicy = {
  id: string;
  scopeType: "user" | "group" | "workspace" | "organization" | "global";
  scopeId: string | null;
  scopeName: string;
  permission: string;
  effect: "allow" | "deny";
  createdAt: string;
  updatedAt: string;
};

export type ProviderModelAccessMode = "all" | "allow" | "deny";

export type ProviderModelPolicy = {
  provider: string;
  mode: ProviderModelAccessMode;
  models: string[];
  updatedAt: string;
};

export type ProviderModelOption = {
  id: string;
  ownedBy?: string | null;
};

export type ProviderAccessPolicy = {
  id: string;
  scopeType: "user" | "group" | "global";
  scopeId: string | null;
  scopeName: string;
  provider: string;
  effect: "allow" | "deny";
  createdAt: string;
  updatedAt: string;
};

export type GroupRuleType =
  | "provider_access"
  | "model_access"
  | "token_quota"
  | "workspace_access"
  | "workspace_limit"
  | "project_limit";

export type GroupRule = {
  id: string;
  groupId: string;
  groupName: string;
  ruleType: GroupRuleType;
  effect: "allow" | "deny" | "limit";
  provider: string | null;
  modelId: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  maxTokensPerUser: number | null;
  maxTokensPerGroup: number | null;
  maxWorkspaces: number | null;
  maxProjectsPerWorkspace: number | null;
  createdAt: string;
  updatedAt: string;
};

export type MyGroup = Group & {
  groupRole: GroupRole;
  workspaces: Workspace[];
  limits: {
    maxWorkspaces: number | null;
    maxProjectsPerWorkspace: number | null;
  };
};

export type GroupConfig = {
  groupId: string;
  groupName: string;
  isUserGroup: boolean;
  limits: {
    maxWorkspaces: number | null;
    maxProjectsPerWorkspace: number | null;
  };
  tokenQuota: {
    enabled: boolean;
    limitTokens: number | null;
    limitUsd: number | null;
    period: "daily" | "weekly" | "monthly" | "lifetime";
  };
  providerAccess: {
    mode: "all" | "allow" | "deny";
    providers: string[];
  };
  modelAccess: {
    mode: "all" | "allow" | "deny";
    models: string[];
  };
};

export type DockerConnectionType = "socket" | "tcp";

export type DockerConfig = {
  connectionType: DockerConnectionType;
  socketPath: string;
  tcpHost: string;
  tcpPort: number;
  tcpUseTls: boolean;
  tcpUsername: string | null;
  tcpPasswordSet: boolean;
  caCertSet: boolean;
  clientCertSet: boolean;
  clientKeySet: boolean;
  updatedAt: string | null;
};

export type DockerConnectionCheck = {
  ok: boolean;
  message: string;
};

export type SetupStatus = {
  needsSetup: boolean;
  userCount: number;
};

export type DashboardSummary = {
  users: number;
  workspaces: number;
  projects: number;
  providerKeys: number;
  recentAuditEvents: AuditLog[];
};

export type AdminSummary = {
  users: number;
  groups: number;
  workspaces: number;
  projects: number;
  globalProviderKeys: number;
  providerConfigs: number;
  tokenBudgets: number;
  permissionPolicies: number;
  modelPolicies: number;
  settings: PlatformSettings;
};

export type AuditLog = {
  id: string;
  event: string;
  actorUserId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

// Agent chat types
export type AgentMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type AgentToolCall = {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string | null;
  completedAt: string | null;
};

export type ApprovalRequest = {
  id: string;
  sessionId: string;
  toolCallId: string;
  action: string;
  reason: string;
  riskLevel: 'high' | 'dangerous';
  affectedProjectId: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  metadata: Record<string, unknown>;
  createdAt: string;
  resolvedAt: string | null;
};

export type AgentMessage = {
  id: string;
  sessionId: string;
  role: AgentMessageRole;
  content: string | null;
  toolCallId: string | null;       // for role=tool responses
  toolCalls: AgentToolCall[] | null; // for role=assistant with tool calls
  createdAt: string;
};

export type AgentSession = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  userId: string;
  status: AgentSessionStatus;
  title: string | null;
  modelProvider: string | null;
  modelName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentSessionStatus =
  | 'idle'
  | 'running'
  | 'waiting_for_approval'
  | 'failed'
  | 'completed'
  | 'cancelled';

// Model selector types
export type ProviderModelInfo = {
  id: string;
  ownedBy: string | null;
};

export type ProviderWithModels = {
  provider: string;
  label: string;
  enabled: boolean;
  models: ProviderModelInfo[];
  quota: ProviderQuotaInfo | null;
  isPersonal?: boolean;
};

export type ProviderQuotaInfo = {
  globalLimit: number | null;
  globalUsed: number;
  userLimit: number | null;
  userUsed: number;
  period: string | null;
};

// SSE streaming event types
export type AgentStreamEvent =
  | { type: 'message_start'; messageId: string }
  | { type: 'content_delta'; delta: string }
  | { type: 'tool_call_start'; toolCall: AgentToolCall }
  | { type: 'tool_call_result'; toolCallId: string; result: unknown; status: 'completed' | 'failed' }
  | { type: 'approval_requested'; approval: ApprovalRequest }
  | { type: 'approval_resolved'; approvalId: string; status: 'approved' | 'rejected' | 'cancelled' }
  | { type: 'message_added'; message: AgentMessage; tempId?: string }
  | { type: 'message_end'; message: AgentMessage }
  | { type: 'error'; error: string }
  | { type: 'done' };
