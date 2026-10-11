---
status: accepted
---

# Keep KeyCRM order synchronization behind a preview/apply boundary

YO_crm needs to import all historical KeyCRM orders and permit later incremental
synchronization without turning KeyCRM into the owner of YO_crm production
workflow. Provider identifiers are scoped by the configured connection and are
stored on orders, order items and payments. A repeated run therefore updates the
same provider-owned records instead of creating duplicates. A KeyCRM buyer may
link to an existing YO_crm client by one exact contact match. An existing manual
order is linked only when the client, order date, total and currency identify one
unambiguous active order. Ambiguous client, order or payment matches are skipped
and recorded for operator review instead of guessing or creating a duplicate.
The order records whether it was imported or linked to an existing order, so a
later synchronization keeps preserving manual order items while imported-only
items remain updateable. A linked order remains attached to its canonical YO_crm
client even if the provider contacts later become ambiguous. Its currency cannot
be silently changed by a later provider response. Links follow an active client
merge redirect so synchronization never writes new orders onto an archived
duplicate.

KeyCRM buyer links participate in the same reversible provenance as orders when
client cards are merged. A split restores their prior owner. For legacy merges,
resynchronization resolves the stored link through the durable merge redirect
without moving it, so a later split remains possible.

Every write run requires a completed dry run made with the same configuration
revision and date range. Runs are server-owned, resumable, rate-limited and
audited. Each order is committed in its own transaction under a provider-order
lock, so one malformed order is recorded as an issue without rolling back the
rest of the page. The API token remains encrypted on the server and the provider
host is fixed in code.

KeyCRM source dictionaries supply order currency. Money is converted to integer
minor units and invalid precision or fractional quantities fail closed. Raw
provider order and buyer payloads are retained as provenance, while measurements
are never inferred from comments. Imported provider statuses remain in raw
provenance; existing YO_crm sales, production, payment and shipping workflow is
preserved on later synchronization. Manual deadlines, notes, addresses and
existing shipment records are not overwritten. Provider payment amount,
currency, order and receipt time are immutable after import; cancellation and
restoration change only the lifecycle projection and append an audit event.
Payments already cancelled before the first import are retained as voided
history instead of being dropped, and remain excluded from active projections.
If a provider cancellation lowers the active total below the deposit for an
already confirmed production slot, synchronization does not silently roll
production backward: it records an operator issue and activity. Repeated
provider updates append full before/after order and item snapshots to the audit
log, including the retained raw provider payload. Business records are not
deleted merely because a provider line is later absent.

Every configured connection receives a random stable connection key. A token
replacement is accepted only before any orders have been imported, or when the
submitted token is exactly the current token. KeyCRM exposes no documented,
stable account identifier, so rotating to a different token after import needs
a separate operator-confirmed migration instead of an unsafe identity guess.
Background workers claim a run with a
database lease (`FOR UPDATE SKIP LOCKED`), release it between bounded steps and
back off temporary provider failures so another queued run can proceed.
Configuration writes and sync-run creation use the same advisory lock and reread
the current token, connection identity and revision after acquiring it.
Concurrent saves therefore receive distinct revisions, and a new run cannot be
created from stale settings or make APPLY accept a preview from another revision.
Connection-test results use the same lock and are persisted only if that revision
is still current. Preview and apply use the same fail-closed currency guard for a
linked manual order.

The existing shipping-carrier enum remains unchanged for application rollback
compatibility. Recognized KeyCRM carriers may create a shipment; unknown carrier
names and tracking codes are retained in additive text fields on the order and
in raw provenance without introducing an enum value older clients cannot read.

Rollback of the application can stop future synchronization, but the migration
is additive and imported business history remains. Removing imported records is
a separate audited migration, not part of this integration.
