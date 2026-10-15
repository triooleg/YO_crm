---
status: accepted
---

# Previewed composition changes and archive-safe physical identities

Accepted for local implementation by the owner on 2026-10-15. Production
migration and deployment remain separately authorized actions.

## Context

The approved Designs/Measurements specification extends the existing OrderItem
and OrderItemInstance model. A physical costume must keep its identity, athlete,
snapshot and production/shipment history when quantities change. The previous
ordinal-tail reconciliation and automatic revival of archived ordinals cannot
express operator selection of particular costumes.

This extends [ADR 0005](0005-expand-orders-to-instances-and-multiple-shipments.md)
and the existing client/athlete/snapshot model. It does not introduce a second
Design aggregate or per-instance ledger.

## Decision

- Keep OrderItem as the commercial design and OrderItemInstance as each physical
  costume. Active item quantity equals active instance count. Archived items
  retain historical positive quantity while leaving the active composition.
- Archive metadata on items and measurement versions preserves explicit old
  references. A display size on an instance is independent of measurement values.
- Use server preview/apply with a fingerprint of the current order graph,
  received payments, production slot and shipment/document dependencies. Recheck
  the fingerprint under existing merge/client/order locks; stale changes require
  another preview. Commit composition, money delta, audit and operation result
  atomically. Never overwrite receipts or invoice/PDF snapshots to fit a new total.
- Preserve order adjustments and the existing deposit proportion. Show actual
  paid amounts and overpayment. Unknown settlement is unavailable, not zero.
- Store durable request keys scoped to an order. Matching retries return the
  recorded result; changed payload/actor with that key conflicts.
- Decreases archive explicitly selected eligible IDs; increases allocate new
  IDs/ordinals after the historical maximum. Manufactured, started or shipment-
  linked pieces cannot be removed through ordinary composition edits.
- All new assignments validate client/athlete/snapshot ownership. A batch is
  atomic with a conflict token per physical piece; shared snapshots are allowed.
  Creating a measurement version never silently moves historical references.
- KeyCRM retains provider identities and local composition intent. Reimport
  must not resurrect a tombstone or replace local quantities/assignments.

## Migration and rollback consequences

The expansion adds nullable metadata and a retry table without backfilling or
re-keying existing instances. Active consumers must migrate together before
archiving is enabled. Old application versions that ignore item archivedAt are
unsafe after the first archive operation; rollback must understand tombstones
or use a separately reviewed data recovery procedure. Do not drop columns or
erase operation/history records during application rollback.

Local isolated migration tests do not establish production readiness, external
provider completeness or real PostgreSQL concurrency performance. The approved
plan and validation report retain those evidence boundaries.
