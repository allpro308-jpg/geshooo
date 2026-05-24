# Workspaces and Projects

In Singulary, environments are organized into Workspaces and Projects.

## Workspaces
A **Workspace** is a full product or system area. It acts as a grouping for related projects and services.
Workspaces own:
- Projects
- Shared environment variables
- Docker networks
- Workspace secrets
- Shared context documents
- Runtime policies

Example: A workspace called "SaaS Analytics Platform" might contain a frontend project, a backend API project, a Redis cache, and a PostgreSQL database.

## Projects
A **Project** is a runnable unit inside a workspace.
Projects keep runtime metadata such as `node`, `python`, `static`, or `custom_dockerfile`.

Examples:
- React frontend
- Elysia backend
- PostgreSQL database
- CLI package
