# Yoleotard CRM

## What This Is

A production CRM/ERP for Yoleotard's international costume business, centralizing
clients, athletes, orders, production, payments, shipments and history.

## Core Value

The owner can immediately see what requires action and the complete reliable
history behind every client and order.

## Requirements

### Validated

- [x] Foundation, deployment and health checks.
- [x] Clients, athletes and immutable measurements.
- [x] Orders, production, finance and shipping workflows.
- [x] Audit closures F-01 through F-09 implemented with focused contract tests.

### Active

- [x] API session security, RBAC and least-privilege CRM/production read routes.
- [ ] Global web authentication lifecycle and role-aware navigation (deferred for focused testing).
- [ ] Unified client communications and message timeline.
- [x] Internal message templates and persisted Chatwoot/e-mail channel settings.
- [ ] External Chatwoot/e-mail ingestion and delivery (pending credentials and integration).
- [ ] Responsive Unicode-safe interface.
- [x] Docker configuration, executable backup/restore scripts and dependency-aware health checks.

### Out of Scope

- Generic multi-tenant SaaS - this is Yoleotard-first.
- Kubernetes and microservices - unnecessary complexity.
- Native mobile apps - responsive/PWA-ready web is sufficient.
- Direct KeyCRM dependency - imports are allowed, coupling is not.

## Context

Ubuntu/Debian homeserver at `192.168.31.219` with Docker, Portainer and Nginx
Proxy Manager. Existing projects use archive-over-SSH deployment, server-only
secrets, separate compose stacks and health checks.

## Constraints

- **Integrity**: Business history survives archive and correction.
- **Security**: Internet-accessible; database and Redis stay private.
- **Operations**: Reuse proxy and avoid occupied ports/stacks.
- **UX**: Daily tasks work quickly on desktop and phone.
- **Finance**: Integer minor units and explicit currencies.

## Key Decisions

| Decision | Rationale | Outcome |
|---|---|---|
| TypeScript modular monolith | Proven stack without distributed complexity | Adopted |
| Next.js + NestJS + Prisma | Clear UI/API/data boundaries | Adopted |
| Ports 3500/4500 | Confirmed free in discovery | Adopted |
| Immutable measurements | Historically correct sizing evidence | Adopted |

## Evolution

Review requirements, decisions and framing at every phase and milestone.

---
*Last updated: 2026-08-13 after local implementation of audit closures F-01 through F-09; deployment and live smoke not asserted*
