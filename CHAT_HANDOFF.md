# Yoleotard CRM handoff

## Current state - 2026-08-07

Phase 0 infrastructure discovery and the deployable Phase 1 foundation are
complete.

## Infrastructure

- Server: `trio@192.168.31.219` (`homeserver`).
- Docker 28.4.0, Compose 2.39.2, Portainer and Nginx Proxy Manager.
- CRM web/API ports: 3500/4500.
- Existing proxy owns 80/443. Do not create another proxy.
- Stack directory: `/home/trio/yoleotard-crm`.
- Server-only `.env` has mode 600; never print or copy it into Git.

## Decisions

- TypeScript modular monolith: Next.js, NestJS, Prisma/PostgreSQL and Redis.
- Client and Athlete are separate; Measurement is an immutable snapshot.
- Money is integer minor units plus ISO currency.
- PostgreSQL and Redis have no production host ports.
- Public domain is undecided pending DNS/proxy review.

## Delivered

- Foundation commit: `f03c6a4`.
- Container startup fix: `93b1050`.
- Web runtime port fix: `bba03e8`.
- LAN web: `http://192.168.31.219:3500`.
- LAN API: `http://192.168.31.219:4500/api`.

## Verification

- Prisma schema validation and client generation passed.
- Contract tests: 7/7 passed.
- Monorepo TypeScript typecheck passed.
- NestJS/Next.js/Prisma production builds passed locally and in Docker.
- Local and Portainer compose configs validated.
- Server PostgreSQL, Redis and API health checks passed.
- LAN API health returned `{"ok":true,"service":"yoleotard-crm-api"}`.
- LAN dashboard returned HTTP 200 and contained the Yoleotard brand.

## Next step

Implement Phase 2 client/athlete/measurement vertical slice with authenticated
REST endpoints, audit activity and usable client screens.
