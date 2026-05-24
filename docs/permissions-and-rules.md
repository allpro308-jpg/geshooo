# Permissions and Rules

Singulary treats groups as the source of truth for access control.

## Core Model

- Every user belongs to at least one group.
- Every user automatically gets an immutable personal group named `Personal space`.
- A personal group has `is_user_group = true`, contains only that user, and cannot be manually mutated.
- Workspaces are assigned to groups through `workspace_groups`.
- Group membership has a role:
  - `group_admin`: can create workspaces and projects where limits allow.
  - `group_member`: can edit existing workspaces and projects, but cannot create new projects.

## Rules

Rules are stored in `group_rules`. They can be layered; enforcement should always evaluate group rules before falling back to platform defaults.

Supported rule types:

- `provider_access`: allow or deny a provider for a group.
- `model_access`: allow or deny a model for a provider in a group.
- `token_quota`: set token limits per user and/or per group.
- `workspace_access`: describe access to a workspace.
- `workspace_limit`: set maximum workspaces for a group.
- `project_limit`: set maximum projects per workspace.

Personal groups are intended for per-user policy. Group-wide token limits do not apply to personal groups; use per-user limits there.

## Platform Defaults

`platform_settings` contains defaults used when no group rule overrides them:

- `max_workspaces_per_user`
- `max_projects_per_workspace`
- `default_token_quota`

## Admin API

All admin routes require an authenticated `instance_admin`.

### Groups

- `GET /api/admin/groups`
- `POST /api/admin/groups`
- `GET /api/admin/groups/:groupId/members`
- `POST /api/admin/groups/:groupId/members`
- `DELETE /api/admin/groups/:groupId/members/:userId`

`POST /members` accepts:

```json
{
  "userId": "usr_...",
  "role": "group_admin"
}
```

Personal user groups reject membership mutation.

### Workspace Access

- `GET /api/admin/workspace-access`
- `POST /api/admin/workspace-access`

```json
{
  "workspaceId": "wsp_...",
  "groupId": "grp_..."
}
```

### Rules

- `GET /api/admin/rules`
- `POST /api/admin/rules`

```json
{
  "groupId": "grp_...",
  "ruleType": "token_quota",
  "effect": "limit",
  "provider": "openai",
  "modelId": "gpt-4.1-mini",
  "maxTokensPerUser": 10000,
  "maxTokensPerGroup": 200000
}
```

### Provider Models

Providers are configured with OpenAI-compatible base URLs:

- `POST /api/admin/providers`
- `GET /api/admin/providers`
- `GET /api/admin/providers/:provider/models/all`
- `GET /api/admin/providers/:provider/models`

`/models/all` calls the configured provider `GET {baseUrl}/models`.

`/models` calls the same upstream endpoint and then applies Singulary model policy for `ALL`, `ALLOW`, or `DENY`.

## User API

- `GET /api/me/groups`

Returns the user's groups, role in each group, visible workspaces, and effective limits.
