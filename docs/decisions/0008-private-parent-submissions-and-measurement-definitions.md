---
status: accepted
---

# Private parent submissions and explicit measurement definitions

Accepted for both local stages by the owner on 2026-10-19. Production release,
migrations and public launch remain separately authorized actions.

## Context

A group order can contain several designs and physical costumes. A shared
parent invitation must not expose other children's data. Existing dated
Measurement snapshots and OrderItemInstance references already own production
measurement identity; a parallel parent measurement system would drift from
those records.

The original measurement chart defines sleeve number 6 with a 2 cm allowance.
The owner explicitly chose pure body sleeve length for the new parent form,
with a separate manager annotation. Reusing the same unversioned number would
silently alter historical interpretation across Orders, Clients and Inbox.

## Decision

Keep Athlete, Measurement and OrderItemInstance canonical. A public invitation
only admits independent private participant sessions. Drafts belong to that
participant; explicit submit atomically appends a canonical Measurement and an
immutable submission/provenance record. A shared invitation exposes no team
roster. Manager review and explicit assignment remain separate from receipt.

Add nullable Measurement.definitionVersion. Null retains the original legacy
meaning; PARENT_BODY_V1 denotes the pure-body definition. Every copy/edit/view
consumer preserves the stored source definition. There is no automatic ±2 cm
conversion. Parent-body WIP assignment changes require version-bound staff
confirmation and a reason, including changes made through pre-existing writers.

## Consequences

Historical values and production identities remain intact. Parent submissions
cannot be split across an order and athlete owned by different clients. Owner
changes invalidate invitation lineage; authority is re-established explicitly.
Approved range versions and acknowledged outliers are frozen in each submission.

After accepting parent-body snapshots, rolling back to a reader that assumes
all number-6 values include allowance is unsafe. Disable public intake while
keeping definition-aware readers, accepted data, history and audit. Do not drop
the additive tables or restore an older database over new submissions.

Related: [ADR 0005](0005-expand-orders-to-instances-and-multiple-shipments.md),
[ADR 0007](0007-previewed-order-composition-and-archive.md),
[approved plan](../plans/parent-measurements.md),
[operating guide](../parent-measurements.md).
