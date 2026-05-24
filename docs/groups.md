# Groups

Singulary uses **groups** as the source of truth for access control. Every user belongs to at least one group.

## Personal Groups
Every user automatically gets an immutable personal group named `Personal space`. A personal group has `is_user_group = true`, contains only that user, and cannot be manually mutated. Personal groups are intended for per-user policy.

## Custom Groups
You can create custom groups for teams, organizations, or external contractors. 

### Roles
Group membership comes with roles:
- `group_admin`: Can create workspaces and projects where limits allow.
- `group_member`: Can edit existing workspaces and projects, but cannot create new projects.

Workspaces are assigned to groups through `workspace_groups`.
