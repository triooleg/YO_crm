# Clients workspace refresh

Status: implementation; production deployment and production mutations NOT authorized.
Base: c91c747e01af9239ef1bd36aba02e62950567d83. Source: owner-supplied
YO_CRM_Clients_Codex_Package.zip, approved TZ and PNG extracted under ignored .local/clients-package.

## Audit before implementation

| Capability | Existing | Required extension |
|---|---|---|
| Clients, athletes, immutable measurements, orders | Stable relational models and IDs | Reuse, no parallel storage |
| Client list | Legacy array, search and month filter | Opt-in bounded table projection, sorting and aggregates |
| Client detail | All orders/files eagerly loaded | Opt-in compact overview, lazy conversations/files |
| Order photos/history | Existing authenticated history API and image policy | Reuse for selected client, filters and recent orders |
| Client notes | Current note plus existing audit/activity | Edit same note; explicit visibility metadata, no second journal |
| Duplicate candidates | Per-client 200-candidate heuristic | Server-wide normalized contact evidence, name weak only |
| Merge/split | Pair transaction, locks, snapshots, redirects | Atomic batch, reviewed fields, stale preview validation |
| Client files during merge | Missing exact file provenance | Backward-compatible provenance plus routing protection |
| Old merged client links | Inbound redirects exist; detail read fails | Canonical read resolution with order ownership validation |
| Inbox navigation | Existing client context and draft guard | Exact conversation round-trip and preserved client filters |

## Execution and compatibility

INTEGRATOR owns bounded API read projections, controller wiring, history filters,
profile/notes contracts and integration. Isolated workers own merge safety,
Clients UI, and navigation, respectively. Workers deliver uncommitted patches;
only INTEGRATOR integrates them. No commit/push/deploy is authorized.

Legacy GET /clients array and legacy detail remain compatible; new views are
explicit opt-ins. Counts include nonarchived orders, including cancelled, and
use actual client IDs. Money stays integer minor units, distinct currencies
and actual received payments remain distinguishable. No provider sending or
measurement reassignment is part of this feature.

No new tables are planned. A narrow additive ClientFile routing trigger may be
needed to protect merge/upload races; it will be tested locally only. No
speculative indexes: query counts and plans first. Notes default to internal;
visibility does not send or expose notes through a public API.

## Validation and acceptance

- Regression tests for legacy list/detail and immutable merge/split provenance.
- Bounded list/detail, 15/20/50 rows, filters, stable sorting and empty pages.
- Exact client/conversation URL round-trip, stale requests and draft guards.
- Atomic batch rollback, stale preview, files, identity conflicts and RBAC.
- Existing order photo presenter, missing photos, quantities and currencies.
- Full tests, typecheck, build, quality gate; independent compatibility,
  regression, business/security, visual and release reviews.
- Desktop/mobile screenshots against approved PNG (excluding annotations).
- Local performance measurements at 20/50 rows; no production data writes.

Final evidence and limitations: clients-workspace-verification-2026-11-03.md and
CHAT_HANDOFF.md. Local acceptance PASS; deployment remains unauthorized.

## Merge safety decision after independent review

The approved token covers scalar profiles, exact ownership IDs and bindings,
identity and AI settings. Nested messages/payments/measurements retain parent
foreign keys; their aggregated counts are informational and new arrivals do not
invalidate the approval. They receive no new locking triggers. ClientFile is
the only new routed relation: its BEFORE STATEMENT shared advisory window runs
before row routing. Merge/split take the exclusive window; payment add/void take
the shared window before their existing order lock. A runtime catalog guard
rejects merge/split when required file protection is unavailable. Native local
PostgreSQL tests exercise multi-connection lock edges; PGlite alone is not
accepted as concurrency proof. No production schema has been changed.

## Read model evidence (local, before UI integration)

New projection tests were observed failing before implementation, then passing.
An isolated PostgreSQL/PGlite fixture has 10,000 synthetic clients and 50,000
synthetic orders. It uses the existing Order(clientId, createdAt) index and
Conversation(clientId, channel) unique index. Both 20- and 50-row pages execute
five SQL/read operations: one aggregated page, one flat bounded client lookup,
and three filter dictionaries. There are no per-row relation fetches. Local
sample times after those existing indexes: 230 ms / 166 ms, respectively;
these are test-engine measurements, not production latency promises. EXPLAIN
ANALYZE JSON is retained in ignored .local/clients-performance.json.

Overview keeps original currency groups and computes selected report currency
with the existing cached rational conversion functions. Missing/stale rates
produce unknown totals, never zero. Actual nonvoided receipts are separate
from order value. No external fetch or financial mutation is introduced.
