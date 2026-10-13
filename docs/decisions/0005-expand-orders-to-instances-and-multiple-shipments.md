---
status: accepted
---

# Expand orders through instances before multiple shipments and structured history

The approved Orders-page redesign expands one selected order inside its table row
and keeps its user scope to nine tabs: «Основное», «Дизайны», «Индивидуальные
измерения», «Клиент», «Финансы», «Производство», «Доставка», «Заметки» and
«История». These tabs are views over one order aggregate; they do not define nine
new bounded contexts or authorize unrelated changes to Orders-page navigation,
auth, RBAC, provider contracts or other workspaces.

## Context and constraints

`OrderItem.quantity` currently represents several physical pieces with one set
of item-level production, athlete and measurement fields. `Order.shipment` and
`Shipment.orderId` are currently a one-to-one compatibility contract used by
the API, web, production, finance, KeyCRM rollback and tests. Notes, files and
history also exist in older flat or order-wide forms. Replacing all of these
shapes at once would make rollback and mixed-version operation unsafe.

The migration therefore uses expand/migrate/contract. Every expand is additive,
old and new projections coexist while consumers migrate, and a contract step is
allowed only after repository search, tests and release evidence show that no
supported consumer depends on the old shape. A database migration being applied
is not evidence that a contract step is safe.

## Decision

### 1. Expand Order Item into physical instances first

Add `OrderItemInstance` as the stable identity of one physical piece and
backfill ordinals `1..quantity` for every existing Order Item. Keep
`OrderItem.quantity` and the item-level athlete, measurement and production
fields as compatibility projections while API, production, measurement and UI
consumers move to instances. New and edited items reconcile instances in the
same transaction as quantity changes.

For each Order Item, the number of active instances must equal `quantity` at
every committed boundary. Increasing quantity creates instances. Decreasing it
archives only surplus instances with no production, shipment or other protected
history; otherwise the mutation fails closed. Ordinals are stable and are not
renumbered to hide archived history. Hard deletion is not a reconciliation
mechanism.

An instance may reference an athlete and exactly one immutable Measurement
snapshot. Editing measurements creates a new snapshot and moves only the
intended reference; neither the old snapshot nor references of sibling
instances are rewritten. `OrderItem.priceMinor` remains the unit price and the
line amount remains `quantity * priceMinor`. Instances carry no price, discount,
deposit, payment allocation or currency in this stage. Order-level totals,
delivery charges, discounts and required deposit remain owned by Order.

The item-level compatibility fields may be contracted only after all supported
writers and readers use instances and their aggregate projection is deterministic.
`quantity` remains the commercial count even after instance migration.

### 2. Migrate consumers before enabling multiple shipments

Shipment migration starts only after instance identity is stable enough to
allocate physical pieces. First add plural shipment contracts and migrate every
consumer while the database still enforces the existing one-to-one Shipment.
During this compatibility phase, `shipments` is the empty or single-element
projection of `shipment`; the singular relation, endpoint fields and KeyCRM
behavior remain authoritative and writable.

Only after all API, web, production, finance, KeyCRM, reporting and test
consumers use the plural contract may a later expand remove the unique
order-to-shipment restriction and permit several active Shipments. The singular
`shipment` projection is retained for mixed-version compatibility until its own
separate contract gate; it must never select an arbitrary row. If a legacy
projection cannot represent a multi-shipment order unambiguously, the old write
path fails closed rather than overwriting one shipment.

Each Shipment owns its carrier, tracking identity, lifecycle timestamps and
actual shipment-level cost. Order owns the commercial delivery charge. Order
shipping status, displayed tracking summary and shipment progress aggregate all
active Shipments and cannot be copied from whichever Shipment was read first.
Shipment costs may be summed only within the same ISO currency; a cross-currency
order summary requires immutable recorded conversion snapshots. Archiving a
Shipment removes it from active aggregates but retains its record and audit
history.

### 3. Add structured notes, files and history last

After instance and shipment identities are stable, expand flat text and
order-wide attachments into structured Order Notes, note revisions and scoped
Order Files. A note belongs to the Order and may additionally target an Order
Item, Order Item Instance or athlete. Visibility distinguishes internal notes
from customer wishes. Files retain uploader, storage identity, role and their
order-level provenance even when linked to a design or note.

Existing free text and files remain readable during migration and are never
silently deleted or reclassified by inference. Editing a structured note appends
a revision; archiving notes, files, instances or shipments never erases their
history. The «История» tab is a read projection over Activity and AuditLog with
actor attribution and links to affected records, not a second mutable source of
truth. Every important mutation in all three stages appends both operator-facing
Activity and forensic AuditLog evidence in the same transaction where practical.

## KeyCRM rollback snapshots

The rollback snapshot format must be versioned before its order graph expands.
Existing unversioned snapshots are treated as legacy version 1. New writes use
an explicit versioned envelope, and each reader supports only named versions
whose exact comparison and restore semantics it implements. A version that adds
instances, plural shipments, structured notes or scoped files must include those
records and their archive state in deterministic order.

Unknown versions, missing required members or a current graph that differs from
the recorded after-snapshot block the whole rollback before any write. There is
no best-effort downgrade to the old one-to-one or flat-text shape. Old snapshots
remain immutable; they are not rewritten in place merely to look current.
Rollback continues to archive or void newly created business records and append
Activity/AuditLog evidence instead of hard-deleting history.

## Consequences and gates

- The dependency order is fixed: Order Item Instances, then plural Shipment
  consumers and multi-shipment storage, then structured notes/files/history.
- Dual-read and dual-write periods are deliberate compatibility costs. They are
  bounded by explicit consumer inventories and contract gates, not dates.
- No stage may infer mutable measurements, duplicate money onto instances, add
  unlike currencies, hard-delete business records or bypass audit.
- The nine-tab expanded row may expose a capability only when its underlying
  authoritative model and permissions are ready; placeholder UI is not proof of
  migration completion.
- Related decisions remain authoritative, especially ADR-0003 for KeyCRM
  preview/apply and exact rollback behavior and ADR-0004 for official-rate money
  conversion.
