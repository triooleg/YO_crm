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
unambiguous active order. Ambiguous order or payment matches are skipped and
recorded for operator review instead of guessing. When several client cards
share the same contact but KeyCRM supplies a stable buyer identifier,
synchronization creates a separate provider-scoped client, links that buyer
identifier and records a non-blocking merge suggestion for the operator. It
never merges client cards automatically. Without a stable buyer identifier the
ambiguous client match remains fail closed. Exact name/contact matches and exact
order matches are surfaced as reviewable suggestions with their evidence.
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

KeyCRM source dictionaries supply the initial order currency. For historical
orders, one unambiguous currency of completed payments may correct a stale
source currency; several completed-payment currencies fail closed. A later
currency change on an already linked or imported order is never applied
silently. Money is converted to integer minor units and invalid precision or
fractional quantities fail closed. Raw
provider order and buyer payloads are retained as provenance, while measurements
are never inferred from comments. Imported provider statuses remain in raw
provenance; existing YO_crm sales, production, payment and shipping workflow is
preserved on later synchronization. Manual deadlines, notes, addresses and
existing shipment records are not overwritten. Provider payment amount,
currency, order and receipt time are immutable after import; cancellation and
restoration change only the lifecycle projection and append an audit event.
Payments already cancelled before the first import are retained as voided
history when their currency matches the order. Foreign-currency cancellations
remain in raw provider evidence; if a matching Payment already exists its
cancellation lifecycle is still applied, but a missing foreign-currency
cancellation does not materialize a new Payment. All voided receipts remain
excluded from active projections.

The KeyCRM production-start custom field is optional. When it is absent, the
importer may calculate a provider-owned slot only when both a delivery/shipping
date and at least one product quantity are present. The expected-delivery custom
field takes precedence; otherwise the standard KeyCRM
`shipping.shipping_date` field is used without a custom-field UUID.
`shipping_date_actual` remains a response-compatibility fallback. Production ends three
calendar days before that date. Working backward uses six calendar days for one
costume, eight for two, and three additional days for every costume after the
second. The costume count is the sum of item quantities, not the number of
product rows. An explicit KeyCRM production start remains authoritative. Empty
items fail closed with an operator issue. This provider rule does not alter the
general YO_crm duration or shipping-lead settings, and it never overwrites a
manual, locked or differently owned production slot.

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

An APPLY run records an immutable before/after synchronization snapshot for
each changed order. The snapshot includes the order and provider-mutated child
records, the affected client and KeyCRM buyer link, plus invoices, expenses and
agreements that are not provider-owned but must prevent an unsafe late rollback.
Rollback uses the same client-merge, provider-order and order advisory locks as
normal writes and is offered only for `PARTIAL` or `FAILED` runs whose every
mutation is marked rollback-eligible. Any later business change makes the
snapshot mismatch and blocks the whole rollback before writes begin.

Rollback preserves history: a newly imported order is archived, provider
payments are voided, created clients are archived only when they have no other
use, and a created buyer link is retained with `rolledBackAt`. Existing orders,
clients, provider links and existing provider-owned children are restored from
their exact before snapshot. A matched order that gained a new item,
production slot or shipment is marked ineligible because those models do not
have a safe archive projection; the UI/API must surface the stored blocking
reason instead of promising a best-effort rollback. A later retry may reactivate
the archived provider order and explicitly reactivate the rolled-back buyer
link; ordinary synchronization never treats that rolled-back link as active.
Every completed rollback appends activity and audit evidence and never deletes
payments or business history.
