# Yoleotard CRM

Application releases follow [Semantic Versioning and the project release policy](docs/versioning.md).

Production CRM/ERP for Yoleotard. It unifies clients, athletes, orders,
production, payments, shipping, communication, files and audit history.

## Current stage

Phase 1 foundation: TypeScript monorepo, auth/session API, Prisma schema,
responsive CRM shell and Docker/Portainer deployment.

## Local development

1. Install Node.js 22+ and pnpm 11+.
2. Copy `.env.example` to `.env` and replace every `change-me`.
3. Run `pnpm install`.
4. Run `docker compose up -d postgres redis`.
5. Run `pnpm db:generate`, `pnpm db:migrate`, then `pnpm dev`.

- Web: `http://localhost:3500`
- API health: `http://localhost:4500/api/health`. The endpoint returns `ok` and
  machine-readable `dependencies` statuses for PostgreSQL, Redis, and upload
  storage; any required dependency marked `down` makes the response HTTP 503.
- OpenAPI: `http://localhost:4500/api/docs`

Read `PROJECT_BLUEPRINT.md`, `ROADMAP.md`, and `CHAT_HANDOFF.md` before
structural or deployment changes.
