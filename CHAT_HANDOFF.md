# Yoleotard CRM handoff

## Current state - 2026-08-07

Phase 0 discovery and deployable Phase 1 foundation are complete. The production
web interface is deployed in Russian.

## Infrastructure

- Server: `trio@192.168.31.219` (`homeserver`).
- Docker 28.4.0, Compose 2.39.2, Portainer and Nginx Proxy Manager.
- Production web: `https://crm.yoleotard.com/`.
- LAN web/API: ports 3500/4500.
- Public `/api` proxy is not configured; do not assume it exists.
- Stack directory: `/home/trio/yoleotard-crm`.
- Server-only `.env` has mode 600; never print or copy it into Git.

## Decisions

- TypeScript modular monolith: Next.js, NestJS, Prisma/PostgreSQL and Redis.
- Primary interface language is Russian; user-facing strings and enum labels
  belong in `apps/web/lib/i18n.ts`.
- Stable database/API enum identifiers remain English internally.
- Client-entered names, addresses and messages remain in their original language.
- Client and Athlete are separate; Measurement is an immutable snapshot.
- Money is integer minor units plus ISO currency.
- PostgreSQL and Redis have no production host ports.

## Delivered

- Foundation: `f03c6a4`.
- Deployment fixes: `93b1050`, `bba03e8`.
- Russian localization and production origin: `b113c85`.

## Verification

- Contract tests: 9/9 passed after localization.
- Monorepo typecheck and production build passed.
- Docker production build passed.
- PostgreSQL, Redis and API are healthy.
- `https://crm.yoleotard.com/` returned HTTP 200.
- Public page contains `Доброе утро`, `Клиенты`, `Заказы`, `Производство`.
- LAN API health returned `{"ok":true,"service":"yoleotard-crm-api"}`.

## Next step

Implement Phase 2 client/athlete/measurement vertical slice in Russian. Before
finalizing its information architecture, review redacted KeyCRM screenshots of
the client list, client card and related tabs.
