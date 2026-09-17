# AGENTS.md — Singulary on Base44

## What this is
Singulary is a self-hosted AI app builder. pnpm monorepo: Vite + React frontend (`apps/web`, port 5173) and Express + SQLite backend (`apps/server`, port 3000). Shared workspace packages: `@singulary/shared`, `@singulary/inference`, `@singulary/agent`.

## Dev setup (docker-compose.base44.yml)
- **Single container** runs both the Vite dev server (5173 → host 3000) and the Express backend (port 3000 internal) via `pnpm dev` (concurrently).
- Vite proxies `/api` (including WebSocket upgrades) to `http://localhost:3000` — same container, so the proxy works as-is.
- A one-shot `setup` service installs deps and builds the three workspace packages before the app starts. Workspace packages export `dist/index.js` (tsup) and must be pre-built — `tsx watch` resolves them as regular npm packages, not from source.
- Source is bind-mounted at `/app`; edits hot-reload (Vite HMR for frontend, tsx watch for backend).
- SQLite lives at `/app/storage/singulary.sqlite` (on the bind mount, persists across restarts).

## Environment
- `SESSION_SECRET` — signs session cookies. A development placeholder is in `.env.base44-defaults`; the real value is delivered via `/run/base44/app.env` (last `env_file` entry, always wins). Generate with `openssl rand -base64 32`.
- `WEB_ORIGIN` — CORS origin for the backend, set to the preview's public URL.
- `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` — passed through from the platform so Vite accepts the preview hostname. `allowedHosts: true` is also set in `vite.config.ts`.

## First run
1. The app boots to a setup wizard — the first registered user becomes `instance_admin`.
2. AI provider keys are added in the UI (Admin → Providers), not via env vars.
3. Docker socket access is needed for project-container management features (Admin → Docker). The UI loads without it; only project creation/preview is affected.

## Verification
- `curl localhost:3000/api/health` → `{"ok":true,"name":"singulary","storage":"sqlite"}`
- Frontend loads at `/` and shows the setup wizard on first run.

## Non-obvious quirks
- `better-sqlite3` is a native module — the `node:22-bookworm` (full, not slim) image is used so build tools are available if prebuilt binaries are missing.
- `pnpm dev` uses `concurrently` (root devDependency) to run server + web together.
- Editing a shared package requires rebuilding it (`pnpm --filter @singulary/shared build`); tsx watch only watches server source.
