# DAG development architecture report

## Repository baseline

Yoleotard CRM is a pnpm TypeScript modular monolith: Next.js in `apps/web`, NestJS in `apps/api`, Prisma/PostgreSQL in `packages/database`, shared contracts in `packages/shared`, and Redis as infrastructure. CI installs frozen dependencies, validates Prisma and Compose, then runs `pnpm quality:check`.

The existing specialist review contracts in `.agents` remain authoritative. The DAG layer coordinates development work and evidence, but is not imported by the web app, API, database package, or production containers.

## Decision: DAG Lite

Use a dependency-free Node.js CLI with JSON state. A workflow server, queue, or database would add operational risk without improving this repository-local use case. The orchestrator invokes the installed Codex CLI, uses Git worktrees for write tasks, and persists inspectable local history.

- No CRM runtime, API, schema, business-rule, Compose, or deployment changes.
- Deterministic dependency/state logic with schema and cycle validation.
- Parallel execution only when declared affected paths do not overlap.
- Only `INTEGRATOR` combines implementation commits; nothing merges to `main`.
- Dangerous work waits for explicit human approval.
- At most three bounded fix cycles before human intervention.

## Execution model

`PENDING/BLOCKED -> READY -> RUNNING -> DONE` is the normal path. Approval-gated work enters `WAITING_APPROVAL`; failures enter `FAILED`, may create a bounded `FIX` node, and otherwise require a human. `CANCELLED` is terminal.

Analysis, test, and review agents run read-only. Implementation agents run in isolated worktrees and commit their assigned files. The integration node consumes commit hashes and performs semantic integration in its own worktree. Validation output and compact agent reports are stored under `.codex/dags/history`.

The bundled Orders demo is read-only: it analyzes frontend, backend, and persistence in parallel, then consolidates the findings. It must not modify product code, migrate data, touch production, or deploy.
