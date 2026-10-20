# Domain documentation

YO_crm uses a single root domain glossary at `CONTEXT.md` because the deployed
system is one modular monolith with shared business invariants. Read it before
changing domain terminology, schema relationships, status transitions or
cross-module workflows.

Durable decisions live in `docs/decisions/`. Read only decisions relevant to the
area being changed. If a proposal contradicts one, identify the conflict before
implementation. Add an ADR only when a hard-to-reverse choice affects multiple
modules, data, API contracts, communications, authorization, production or AI
architecture.

The existing focused documents in `docs/`, `.planning/` and continuity files
remain canonical for their scopes. This setup does not create parallel
`architecture/`, `domain/` or `specs/` trees.
