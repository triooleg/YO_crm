# 0006 — Proven order origin shared by CRM analytics

Status: Accepted for this implementation,2026-10-15. No deployment implied.

## Context

Order import identity, customer contact channels and payment methods do not establish
where an order was placed. Existing KeyCRM Activity records preserve the order's
source. The owner confirmed source12 «Вебсайт» in the existing connection means
yoleotard.com. Three independently implemented heuristics would produce inconsistent
counts and financial attribution.

## Decision

Use one conservative read-only server classifier and additive normalized categories.
Pin the confirmed alias to account + raw source ID + persisted source name; unsupported
or contradictory provenance remains UNKNOWN. No stored order type/source/backfill is
changed. Count distinct orders by createdAt; attribute actual nonvoid receipts to the
linked order's category by receivedAt using ADR0004 valuation rules. Reuse existing
RBAC. Keep legacy Orders array reads; expose explicitly requested paged reads with
whole-cohort facets and hydrate rich relations only for selected page IDs.

## Consequences / rollback

No schema migration or economic writes. Removing the new read projections and UI
restores prior behavior without reverting business data. Source evidence is queried
in bounded batches; the conservative100-event provenance cap and linear candidate
aggregate pass are documented limits. A new direct checkout integration must provide
its own persisted proof before it can classify orders as WEBSITE. Financial refund
semantics remain unchanged; a refund status is not an invented cash ledger entry.

See [source policy](../website-sales-source-policy.md), [ADR0003](0003-keycrm-order-sync-boundary.md)
and [ADR0004](0004-official-exchange-rate-conversion.md).
