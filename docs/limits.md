# Limits and Token Quotas

To prevent runaway costs and manage usage in multi-user environments, Singulary provides a robust token budget and limits system.

## Token Budgets
Token budgets restrict LLM usage for users, groups, workspaces, or organizations.
Budgets can be set per period:
- Daily
- Weekly
- Monthly
- Lifetime

Token limits can be configured globally, or scoped to a specific group. Note that group-wide token limits do not apply to personal groups; you must use per-user limits for those.

## Platform Settings
The platform also enforces limits on entities to maintain system stability:
- `max_workspaces_per_user`: Maximum workspaces a user can create.
- `max_projects_per_workspace`: Maximum projects within a single workspace.

These limits can be overridden by specific group rules.
