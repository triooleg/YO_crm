# Yoleotard CRM agent guide

## Mission

Build the internal production CRM/ERP used by Yoleotard for the complete
client-to-delivery lifecycle. This is Yoleotard-specific, not generic SaaS.

## Continuity

Read `CHAT_HANDOFF.md`, `PROJECT_BLUEPRINT.md`, and `ROADMAP.md` before
changes. Update the handoff after meaningful implementation or deployment.

## Business rules

- Client and athlete are separate; one client may manage several athletes.
- Measurements are immutable dated snapshots; orders reference snapshots.
- Normal custom-order deposit is 50 percent.
- Production slots remain tentative until the required deposit is received.
- Money is integer minor units plus ISO currency; never floating point.
- Business history, payments, messages, files and audit events do not disappear.
- Sales, production, payment and shipping statuses are separate dimensions.
- UI and stored text are Unicode-safe and mobile-friendly.

## Architecture and quality

- pnpm TypeScript monorepo; Next.js web, NestJS REST API, Prisma/PostgreSQL, Redis.
- Modular monolith only; no microservices or Kubernetes.
- Enforce permissions in API guards/services, not only UI.
- Use Argon2id and secure HttpOnly cookies.
- Prefer archive/soft delete and audit important mutations.
- For fixes and risky rules: failing test first, then implementation.
- Before completion run typecheck, tests, build and affected live smoke paths.

## Deployment

Target `trio@192.168.31.219`, directory `/home/trio/yoleotard-crm`, compose
project `yoleotard-crm`. Reuse saved credentials from
`D:\Projects\Yo_ai_manager\.local\server.ssh.json` without displaying them.
The existing Nginx Proxy Manager owns 80/443; never add another proxy.

# Р”РѕРїРѕР»РЅРµРЅРёРµ Рє РїСЂР°РІРёР»Р°Рј: СЂСѓСЃСЃРєРёР№ РёРЅС‚РµСЂС„РµР№СЃ

- РћСЃРЅРѕРІРЅРѕР№ СЏР·С‹Рє РїРѕР»СЊР·РѕРІР°С‚РµР»СЊСЃРєРѕРіРѕ РёРЅС‚РµСЂС„РµР№СЃР° вЂ” СЂСѓСЃСЃРєРёР№.
- Р’СЃРµ РЅРѕРІС‹Рµ РєРЅРѕРїРєРё, Р·Р°РіРѕР»РѕРІРєРё, СЃС‚Р°С‚СѓСЃС‹, РѕС€РёР±РєРё Рё РїСѓСЃС‚С‹Рµ СЃРѕСЃС‚РѕСЏРЅРёСЏ РґРѕР±Р°РІР»СЏСЋС‚СЃСЏ
  С‡РµСЂРµР· С†РµРЅС‚СЂР°Р»РёР·РѕРІР°РЅРЅС‹Р№ СЃР»РѕРІР°СЂСЊ `apps/web/lib/i18n.ts`.
- РђРЅРіР»РёР№СЃРєРёРµ enum-РєРѕРґС‹ СЂР°Р·СЂРµС€РµРЅС‹ С‚РѕР»СЊРєРѕ РєР°Рє РІРЅСѓС‚СЂРµРЅРЅРёРµ СЃС‚Р°Р±РёР»СЊРЅС‹Рµ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂС‹.
- Р”Р»СЏ РєР°Р¶РґРѕРіРѕ РЅРѕРІРѕРіРѕ enum-РєРѕРґР° РѕР±СЏР·Р°С‚РµР»СЊРЅР° СЂСѓСЃСЃРєР°СЏ РѕС‚РѕР±СЂР°Р¶Р°РµРјР°СЏ РїРѕРґРїРёСЃСЊ.
- РџРѕР»СЊР·РѕРІР°С‚РµР»СЊСЃРєРёРµ РёРјРµРЅР°, Р°РґСЂРµСЃР° Рё СЃРѕРѕР±С‰РµРЅРёСЏ РЅРµ РїРµСЂРµРІРѕРґСЏС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё.
- Production web URL: `https://crm.yoleotard.com/`.

## Mandatory review agents

Before a meaningful change is called complete, follow `.agents/README.md`.
Regression, business-rule, visual, and release reviews are mandatory. A release
must not be deployed while any reviewer reports a blocking finding or while
`pnpm quality:check` fails. Existing working behavior is a compatibility
contract unless the user explicitly approves its replacement.

## Engineering Skills Workflow

Use the project-local Matt Pocock skills for substantial engineering work, with
`CONTEXT.md` and relevant records in `docs/decisions/` as domain sources.

GitHub Issues is the configured tracker (`docs/agents/issue-tracker.md`), the
canonical triage labels are in `docs/agents/triage-labels.md`, and domain-doc
consumer rules are in `docs/agents/domain.md`.

- Use `grill-with-docs` before an ambiguous complex feature and `to-spec` after
  a feature has already been discussed enough to formalize.
- Use `to-tickets` for independently executable work with dependencies,
  `implement` for an approved spec or ticket, and `wayfinder` for initiatives
  too large for one session.
- Use `tdd` at a testable seam, `diagnosing-bugs` for difficult regressions,
  `code-review` before completing substantial code changes, and
  `improve-codebase-architecture` for surveys that stop before refactoring.
- Matt's `code-review` is supplemental. It never replaces the compatibility,
  regression, business/security, visual and release roles in `.agents/README.md`.
- The existing DAG remains the execution orchestrator for parallel substantial
  work. Matt skills clarify, specify and guide work; they do not replace DAG
  worktrees, role contracts or the INTEGRATOR-only merge boundary.
- Keep `CONTEXT.md` synchronized when canonical domain language changes and add
  an ADR only for a durable, cross-module decision.
- Apply the lightest workflow that fits the task. Handle trivial copy, icon and
  isolated CSS edits directly.
- Project instructions override vendored skill defaults. Any vendored step that
  says to commit means prepare and report an uncommitted diff until the current
  user request explicitly authorizes a commit. The same explicit authorization
  rule applies to issues, push, merge, deploy and production mutations.
- A temporary file produced by `handoff` supplements continuity; update the
  canonical `CHAT_HANDOFF.md` after meaningful implementation or deployment.
- Vendored `code-review` compares committed history. When commit authorization
  is absent, review the complete staged, unstaged and untracked diff directly
  against the chosen base on both Standards and Spec axes, then run all roles in
  `.agents/README.md`.
## Repository map and commands

- `apps/web`: Next.js user interface. `apps/api`: NestJS REST API.
- `packages/database`: Prisma schema and migrations. `packages/shared`: shared contracts.
- `tools/dag`: development-only DAG orchestrator. `.codex/agents`: DAG role contracts.
- Install with `pnpm install --frozen-lockfile`; use Node 22+ and the pinned pnpm version.
- Run local apps with `pnpm dev`; use `pnpm test`, `pnpm typecheck`, `pnpm build`, and
  `pnpm quality:check`. There is no separate root lint script; do not invent one.
- Run DAG tooling tests separately with `pnpm dag:test`.
- Codex context routing, budgets, cache, optional MCP tools, and rollback are documented in
  `docs/codex/tooling.md`; these are development-only and must not enter CRM runtime images.
- Database commands are `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:deploy`, and
  `pnpm db:seed`. Never run deploy/seed against production without explicit scope and approval.
- Validate local Compose with `docker compose config`; deployment variants are
  `docker-compose.yml`, `docker-compose.portainer.yml`, and `docker-compose.backup-test.yml`.
- NEVER replace production logic or production data with mock implementations unless explicitly requested.

Before changing code, inspect the owning module, its tests, shared contracts, current Git status,
and the continuity documents. Preserve unrelated dirty changes and production compatibility.
Keep REST DTOs, shared types, frontend consumers, Prisma writes, authorization, audit history,
and documented provider/webhook contracts backward compatible unless an approved migration says otherwise.

## Git and DAG workflow

- Never use `git add .`; stage only explicit files belonging to the assigned task.
- Implementation DAG nodes work in isolated Git worktrees and commit only their assigned paths.
- Only the `INTEGRATOR` role may combine commits. Agents must not merge directly to `main`.
- DAG definitions and runtime state live under `.codex/dags`; execution history is local and ignored.
- DAG nodes should declare the narrowest useful `context_strategy`; search symbols and references
  before broad reads, and pass compact dependency summaries instead of complete transcripts.
- Human approval is mandatory before destructive migrations/deletions, auth or payment changes,
  credential handling, production infrastructure changes, or large public API changes.
