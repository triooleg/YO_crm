# Yoleotard CRM handoff

## Current state - 2026-08-07

Project initialized from the approved master prompt. Phase 0 discovery is
complete and Phase 1 foundation is in progress.

## Infrastructure

- Server: `trio@192.168.31.219` (`homeserver`).
- Docker 28.4.0, Compose 2.39.2, Portainer and Nginx Proxy Manager.
- Ports 3000/3100/3200/3300/3400 and 4000/4100/4400 are occupied.
- CRM reserves web 3500 and API 4500.
- Existing proxy owns 80/443. Do not create another proxy.
- Deploy archive into `/home/trio/yoleotard-crm`; keep server-only `.env`.

## Decisions

- TypeScript modular monolith: Next.js, NestJS, Prisma/PostgreSQL and Redis.
- Client and Athlete are separate; Measurement is an immutable snapshot.
- Money is integer minor units plus ISO currency.
- PostgreSQL and Redis have no production host ports.
- Public domain is undecided pending DNS/proxy review.

## Verification

Pending dependency install, Prisma validation, typecheck, tests and builds.

## Next step

Finish and verify Phase 1, deploy and smoke test, then implement Phase 2.
