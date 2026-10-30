# Yoleotard CRM domain context

This glossary names concepts as they exist in the current code. The Prisma
schema is the storage source of truth; API services own validation,
authorization and transitions. Update this file when the canonical meaning of a
term changes, not for routine implementation details.

## People and access

### Client

The buyer or contact responsible for communication and orders. Stored as
`Client` in `packages/database/prisma/schema.prisma`; managed by
`apps/api/src/clients/`. A client can have many athletes, orders and
conversations. `Customer` is business language only and is not a separate model.

Do not confuse a client with a CRM `User`, who is a staff account, or with an
`Athlete`, who wears the product. A channel-scoped external identifier is not an
email address.

### Client Merge Redirect

A durable link from an archived duplicate client to the active canonical
client selected by an operator. The merge window keeps redirect chains stable,
and database ownership
guards route concurrent direct writes to the canonical client while making the
archived source immutable. It preserves old contact identities for inbound
routing without reactivating the duplicate; it is not another client or a copy
of the conversation history.

### Client Merge Operation

An immutable provenance record for one operator-approved client merge. It
records which pre-existing relations moved and the client values before and
after the merge, so that the archived source can be restored without guessing
ownership or deleting later business history. A split ends the active redirect;
it does not erase the merge operation or its audit trail. Merges created before
this provenance existed support only a conservative channel split.

### Athlete

The person for whom an item is made. Stored as `Athlete` and owned by one
`Client`. One client may manage several athletes. `Gymnast` is not a separate
entity: an athlete's `discipline` records the sport when known.

### User

A CRM staff account with a `UserRole`. API guards and services enforce access;
UI visibility alone is never authorization.

### Website API key

A named, revocable credential for the website orders integration, bound to one
canonical `sourceAccount`. It is not a staff session and grants no general CRM
access. OWNER creates or revokes it after current-password verification. Only
its versioned digest and public metadata persist; the secret is returned once.
Rotation creates a parallel credential and preserves the old key until explicit
revocation. The existing server environment token remains an independent legacy
fallback with its original source allowlist. See ADR0011.

## Measurements

### Measurement

An immutable, dated snapshot for one athlete. Stored as `Measurement` with
`measuredAt`, `unit` (default `cm`), core columns `height`, `chest`, `waist`,
`hips`, `torso`, and the complete numbered set in JSON `values`. Orders and
order items reference the snapshot they use. Editing order measurements creates
a new snapshot and moves the references; it does not overwrite history.

The current form uses `m1` through `m17`; `m1`, `m2`, `m3` and `m15` are
required, every entered value is at least 1 and uses a 0.5 cm step. The exact
labels and supported height presets live in
`apps/web/components/measurement-panel.tsx`; validation lives in
`apps/api/src/clients/clients.dto.ts` and the client/order services. Do not add
conversions, ranges or formulas without confirmed business rules.

`Measurement Set` is a UI phrase for one `Measurement` snapshot, not another
model.

A Measurement may be soft-archived for future selection. Archiving changes only
archive metadata; historical explicit references and immutable values remain
readable. A new version can be copied from a historical snapshot without moving
other order or instance references.

### Measurement Definition

The meaning of the numbered fields belonging to a snapshot, distinct from its
capture source or its date. A legacy snapshot retains the original sleeve
measurement convention. `PARENT_BODY_V1` means body measurements without
allowances: number 6 is pure sleeve length. Copying a version does not silently
reinterpret or arithmetically adjust that number.

### Parent Measurement Participant

A representative submitting measurements for their own children within an
order invitation. This is neither a CRM staff user nor a replacement client or
athlete profile. Sharing the invitation admits another independent participant;
it does not share the first participant's children or measurement history.

### Parent Measurement Submission

A confirmed version supplied by a participant and linked to the existing client,
athlete and order. An unfinished draft is not a confirmed snapshot. Received,
staff-verified and assigned to a physical item are separate states; receipt
alone does not approve measurements or choose a costume for the child.

## Orders, production and fulfilment

### Order

The commercial and operational record identified by unique `Order.number`.
Stored as `Order`; it belongs to one client and may reference one athlete and
one measurement snapshot. An order has independent sales, production, payment
and shipping statuses. Never infer one dimension solely from another.

The current user-visible business number is `YO-<positive integer>` and uses
one sequence across manual, KeyCRM and website orders. Historical canonical
`KC-<positive integer>` numbers belong to the same sequence and are migrated
to the equivalent `YO-` value with collision checks and audit history. A
WordPress `WEB-` value is a technical external identity and must not advance
the business sequence.

Money is integer minor units plus an ISO currency. `priceMinor`,
`depositRequiredMinor`, `deliveryMinor`, `discountMinor` and
`productionCostMinor` are not floating-point major-unit amounts. The normal
custom-order deposit is supplied by the configured percentage, defaulting to 50
percent, with an authorized explicit override.

An order discount is the stored integer `discountMinor`, not a persistent percent
mode. A manual percentage command resolves once against `priceMinor + discountMinor`
(the authoritative amount before the existing discount, including delivery and
services), in integer basis points with half-up rounding. Replacing the discount
preserves other adjustments: new total = old total + old discount - new discount.
Later composition changes preserve the stored amount; currency changes convert it
through the established order-money conversion. Manual discount intent is audited
and protected from provider overwrite, without rewriting receipts or invoice snapshots.

An order owns a frozen delivery-address snapshot that is independent from the
client profile. Saving the snapshot requires either a usable street/address
line or an explicitly entered full address; city or country alone is not a
delivery address. Legacy rows with `deliveryAddressSet = false` continue to
display the current client address until an operator saves an order snapshot.
Editing this snapshot does not mutate the client profile, shipment, statuses,
payments or referenced measurement snapshots.

`READY_MODEL`, `ACCESSORY`, `WEBSITE_SALE` and `STOCK_SALE` are quick sales of existing stock. They never
require a production slot, regardless of whether the sale came from the site,
Instagram, Facebook, WhatsApp or another channel. Channel/source does not imply
the order type during normal order creation: a custom order received through
social media still follows the normal production workflow. The owner-approved
administrative correction is a bounded exception for legacy imported data: it
may reclassify only the exact previewed snapshot of active KeyCRM orders whose
own provider source resolves to WEBSITE and that already have a tracking number. Any concurrent change invalidates the
preview and requires a new review before apply.

### Order Item

One commercial line inside an order, stored as `OrderItem`. It owns the product
or design description, quantity and unit `priceMinor`; its line amount is
`quantity * priceMinor`. Pair and group orders use items to group equal products,
while operationally distinct physical pieces are Order Item Instances.

An archived Order Item retains its original quantity and references as history;
it does not participate in active totals, production coverage or current item
lists. Its optional discipline overrides the order discipline only for that
design. Composition mutations preserve existing order adjustments by applying a
line delta rather than replacing the order total with a sum of item amounts.

### Order Item Instance

One physical piece represented by an Order Item. It has a stable identity and
ordinal inside the item and may own its athlete, immutable measurement-snapshot
reference and production state. An active instance is not another priced line:
commercial price remains on the Order Item.

Its optional standardHeight is a display size independent of the assigned
immutable measurement snapshot. Equal display sizes do not merge physical IDs.
Shrinking selects explicit instance IDs to archive. Growing creates new IDs and
ordinals after the historical maximum; it never reactivates archived instances.

### Order Composition Operation

An immutable retry record for one previewed change of order composition. Stored
as OrderCompositionOperation with a key unique inside the order, actor, request
hash and minimal result. A repeated matching request returns the same operation;
reusing its key for another payload conflicts. The record, active quantities,
financial delta and audit are committed in the same transaction. It is not a
payment ledger and does not grant a refund or mutate historical invoice snapshots.

### Imported Order Provenance

An order imported from another system carries a scoped
`sourceSystem + sourceAccount + externalId` identity. The same scoped identity
is used for provider-owned items and payments so a repeated synchronization is
idempotent. `externalData` is evidence of the provider state, not permission to
derive measurements or overwrite independent YO_crm workflow statuses.

### KeyCRM Sync Run

An audited server-side preview or apply run for KeyCRM orders. Apply requires a
completed preview from the same configuration revision and date range. A run
continues without an open browser, records per-order issues and never exposes the
stored API token. KeyCRM buyer links are connection-scoped and follow an active
client merge redirect to the canonical client. Ambiguous contact matches with a
stable provider buyer ID create a distinct provider-scoped client plus an
operator merge suggestion; they are never merged automatically. Ambiguity
without a stable buyer ID remains fail closed. One completed-payment currency
may correct a stale historical source currency only before the order is linked;
later currency changes are blocked to preserve its financial history.
When KeyCRM does not provide the optional custom production-start field, an
imported production slot is calculated from the configured expected-delivery
custom field or, as fallback, KeyCRM's standard `shipping.shipping_date`. The production
end is three calendar days before that date. The backward duration is six days
for one costume, eight for two, and three additional days for every costume
after the second. Costume count is the sum of order-item quantities. Missing
items remain an operator issue instead of being treated as one costume.

### Design and Leotard

There is currently no standalone `Design` or `Leotard` model. The requested or
chosen product is represented by order/item descriptions, names and
`modelImagePath`. Do not invent lifecycle or persistence for a design without an
approved data-model decision.

### Production Slot

The dated capacity reservation for an order, stored as `ProductionSlot` with
`startsAt`, `endsAt`, `capacity`, `tentative` and `locked`. A slot remains
tentative until active payments, converted to the order currency when needed,
reach the required deposit. The
configured duration seeds the initial slot. Manual slot changes enforce date
ordering, shipping lead and the deposit gate through
`apps/api/src/orders/production-rules.ts` and `orders.service.ts`.
The KeyCRM import calculation above is provider-specific and does not change
these general production settings or manual scheduling rules.
Ready-model and accessory orders are excluded from this schedule even if a
legacy record still has historical production-slot data.

`Production Schedule` means the set of production slots. `Production Stage`
means `ProductionStatus`; it is not a separate entity.

### Shipment

A fulfilment record for all or part of an order, with carrier, tracking number,
cost and shipped/delivered timestamps. An order may ultimately require several
Shipments; its shipping status and shipping summary are aggregate order
projections, not attributes copied from an arbitrary Shipment.

The customer delivery charge and the atelier's carrier expense are independent
amounts and may use different supported currencies. A customer charge has its
original amount/currency and an applied amount in the order currency, with the
official conversion evidence retained. Unrelated shipment edits do not revalue
that applied charge. Only the applied customer charge contributes to commercial
order totals; the carrier expense is an original-currency Expense, counted once
in expense reporting and never added to the client's debt.

### Structured Order Note

An authored, categorized note attached to an order and optionally to an Order
Item, Order Item Instance or athlete. Its revisions and attachments remain part
of order history; customer wishes and internal notes are distinct visibility
meanings rather than interchangeable free text.

### Order File

A retained file belonging to an order and optionally classified for a design,
note or other order context. Replacing or archiving a file does not erase its
business provenance or audit evidence.

### Order History

The chronological projection of order Activities and Audit Logs, including the
actor and affected business object. It is not a separately editable narrative
and does not replace the authoritative records that produced each event.

## Finance

### Payment

An economically immutable receipt against an order, stored as `Payment` with
minor-unit amount, currency, method, received time and optional reference.
Those economic fields are never rewritten. A provider may later void or restore
the receipt; `voidedAt` and `voidReason` are the current projection of that
lifecycle, while every transition is retained in `AuditLog`. Voided receipts
remain in history but are excluded from operational totals. A payment may use a
supported currency different from the order currency. In that case its original
minor-unit amount and currency remain immutable, while the amount applied to the
order and an immutable official exchange-rate snapshot are stored with the
payment. The order service derives `paymentStatus` from active amounts applied in
the order currency and confirms a tentative production slot when the required
deposit is reached.

`Deposit` and `Balance` are calculated concepts: the required deposit is
`Order.depositRequiredMinor`; paid and remaining amounts derive from payments
and order totals. They are not separate models. `REFUNDED` exists as a payment
status, but the current schema has no standalone refund transaction model.

### Invoice

An order document stored as `Invoice`, with number, status, language, currency,
issue/due dates, seller/customer/item snapshots and `totalMinor`. Invoice status
does not replace payment status. New invoices may reference a document template,
but the selected template, fields and order data are copied into immutable JSON
snapshots when the invoice is created. Later order or template edits therefore do
not rewrite an issued client document; editing an open invoice updates only its
own snapshots. New template-only invoices carry `documentOptions.immutable` and
are issued on explicit save. Their content cannot be edited through the legacy
draft route. PDF and escaped declarative HTML artifacts are retained atomically
with the Invoice in private, invoice-keyed `AppSetting` records; authorized reads
return the original artifacts. Legacy invoices keep their existing renderer and
editing rules.

For new order-numbered invoices, the customer-facing number is the order number
frozen as `documentOptions.displayNumber` with `numberSource: "ORDER"`. The SQL
`Invoice.number` remains an independent unique registration key so multiple
documents for one order retain separate IDs and retry/audit history. Public
projections and download filenames use the frozen customer-facing number;
older documents without this provenance keep their original number.

When the template enables its logo, new invoice previews embed the same image
used by the CRM header (or its built-in BrandMark fallback). The API reads only
the local, validated branding asset, converts it to a bounded PNG and embeds it
in the frozen HTML/PDF. Later branding changes do not alter saved documents.

An Invoice Preview is an actor-scoped, expiring frozen proposal. It creates no
Invoice or numbering reservation. Explicit save is idempotent and revalidates
that the order and template are active while retaining the previewed contents.
Copy creates a separate document from current order data and a selected template,
with `sourceInvoiceId` lineage. Invoice archive hides the active-list entry and
retains its artifact and audit history.

### Document Template and Order Document

`DocumentTemplate` is an administrator-managed structured layout for an invoice,
customer card, order summary or another client-facing order document. Templates
select keys from the server-owned public field catalogue and may store seller and
payment text. They cannot execute HTML, JavaScript or arbitrary template code.

`OrderDocument` is a generated non-invoice document linked to one active order.
It stores the selected template and allowed order data as immutable snapshots;
the historical document remains readable when source data changes. Invoices keep
their established numbering, status and payment semantics and are not folded into
this generic model.

### Official Exchange Rate

An administrator-selected ECB or NBU observation cached in `AppSetting` with
its official URL, effective date, fetch time and exact rational value. NBU
supports the EUR/USD/UAH matrix through EUR/UAH and USD/UAH; ECB supports only
EUR/USD. An explicit order-currency change converts all order and item monetary
fields atomically and records the complete rate provenance. Orders with payment
or invoice history, monetary shipment costs or KeyCRM ownership fail closed and
are not rewritten.

## Communication

### Conversation

One client dialogue in one `ContactChannel`. Stored as `Conversation`, unique by
`clientId + channel`; provider mappings may also use `externalId + channel`.
Inbox chronology follows the last real received or sent message, not draft
creation or whether a reply is still awaited. Unread and waiting are separate
attention indicators.

### Inbox spam

A reversible client-level classification that hides a client from the normal
Inbox without deleting the client, conversations or orders. The Spam view
retains the conversation and allows returning the client to the normal Inbox;
this is not a provider-side block or a change to AI mode.

### Message

A record inside a conversation with direction (`INBOUND`, `OUTBOUND`, or
`INTERNAL`), status, content, type, provider IDs, timestamps, optional reply
reference and metadata. Messages and business history are retained; supported
removal flows preserve audit/history semantics.

### Channel and integrations

`ContactChannel` contains website, Chatwoot, Instagram, Facebook, WhatsApp,
email, Telegram and manual/referral sources. The operational unified inbox
supports Facebook, Instagram, WhatsApp, Chatwoot and Gmail/email through
`apps/api/src/communications/`. Meta Messenger and Instagram identity is scoped
by channel, connected receiver/account and customer identifier; the provider
message ID identifies a message inside that conversation.

Ordinary inbound messages and the current Chatwoot/email synchronized outbound
paths retain `WebhookEnvelope` records with a payload hash. Meta `message_echo`
persists the echoed `Message` without an envelope. Meta control events update
target-message metadata and keep limited audit evidence without always creating
an envelope.
`MessageDeliveryAttempt.clientRequestId` makes CRM sends idempotent.
`Message.externalId` plus the conversation scope prevents provider duplicates.
`MessageAttachment` describes received/synced media; `CommunicationAttachment`
reserves an operator upload before it is claimed by a message. UI refresh uses
bounded polling; provider webhooks remain the inbound source of truth.

### Shipment notification

**Shipment notification**: An explicitly approved customer notice about one parcel and one version of its waybill, with independently confirmed chat and email outcomes. It is not a shipment status change or a payment.
_Avoid_: Automatic shipment message, client-wide tracking broadcast.

**Waybill revision**: A distinct version of a parcel's carrier, waybill number or verified tracking link; returning to an earlier number is still a new revision. Changes to parcel charges or delivery progress alone are not a new waybill revision.

**Order delivery email**: The recipient address for delivery notices on a particular order, which can differ from the client's general contact email. A general contact address used instead requires explicit operator confirmation.

### Task, Note and Template

`WorkTask` is a Kanban task that may refer to a client and source message.
Client notes currently use `Client.notes`; task descriptions and message/internal
content are separate. `MessageTemplate` stores reusable communication text.

## Cross-cutting invariants

- Client and athlete remain separate; one client may own several athletes.
- Measurements are dated snapshots and referenced by orders, items and item
  instances.
- For every active Order Item, its quantity equals the number of active Order Item
  Instances; archived instances preserve history but do not count.
- Sales, production, payment and shipping statuses stay independent.
- Production commitment is gated by the required deposit.
- Money uses integer minor units and ISO currency. Orders own commercial totals,
  adjustments and required deposits; Order Items own unit prices; Order Item
  Instances do not duplicate money.
- Order shipping status, tracking and cost summaries aggregate all active
  Shipments. Amounts in different currencies are never added without a recorded
  conversion snapshot.
- Important mutations append `Activity` and `AuditLog` records.
- Business records are never hard-deleted through ordinary workflows. History,
  payments, messages, files, instances, shipments and notes are archived or
  retained rather than silently erased.
- User-facing text is Russian through `apps/web/lib/i18n.ts`; customer names,
  addresses and messages are preserved in their original language.

## Canonical references

- Product boundaries: `PROJECT_BLUEPRINT.md`
- Current delivery state: `ROADMAP.md` and `CHAT_HANDOFF.md`
- Architecture and persistence: `docs/ARCHITECTURE.md`, `docs/DATABASE.md`
- Schema: `packages/database/prisma/schema.prisma`
- API business rules: `apps/api/src/clients/`, `apps/api/src/orders/`,
  `apps/api/src/finance/`, `apps/api/src/communications/`
- UI language and current visual implementation: `apps/web/lib/i18n.ts`,
  `apps/web/components/crm-shell.tsx`, `apps/web/app/*.css`
- Durable decisions: `docs/decisions/`

### Order Origin / Order Source

The proven origin of an Order, independently of Client.source, conversation channel,
payment method, import transport and fulfillment OrderType. One server classifier
(`apps/api/src/orders/order-source.ts`) provides WEBSITE/MANUAL/INSTAGRAM/FACEBOOK/CHAT/
WHATSAPP/VIBER/EMAIL/OTHER/UNKNOWN
for Orders, Overview and Finance. The owner-confirmed KeyCRM source12 alias is pinned
to the existing account and persisted order provenance; uncertain/conflicting history
remains UNKNOWN. Counts use unique Order.id and creation month. Cash uses unique valid
Payment.id and receivedAt, valued through the existing reporting FX policy; it never
substitutes order price. See [source policy](docs/website-sales-source-policy.md) and
[ADR0006](docs/decisions/0006-proven-order-origin-for-analytics.md).

### Operational status presentation

Stored sales, production, payment and shipping dimensions remain independent.
Read projections distinguish tracking existence from complete dispatch. Explicit
root tracking/factual dispatch retains the approved legacy whole-order meaning;
otherwise active child parcels require known unique item-instance coverage before
an entire order is displayed as dispatched. A sent child alone leaves unfinished
production visible; LOST/RETURNED remain explicit. No factual date is invented.
COMPLETED sales are historical, excluded from the production working list, and
cannot create/edit a slot or restart planning/work through status/instance writes.
An explicit unsent READY_TO_SHIP sale belongs to the ready KPI/filter. Refunded or
cancelled payments are not operationally awaiting payment. Display normalization
never changes stored statuses, historical slots, payments or audit records.


## FOP tax accounting

The business has one implicit Ukrainian FOP tax profile, independent of staff
User identities, Client country, KeyCRM accounts and the commercial Order.taxMinor.
The confirmed accounting start is 2026-05-01 inclusive in Europe/Kyiv. A TaxPolicy
is a dated immutable version of the group, unified-tax rule, military levy and ESV
rate. The current approved scheme is group3 without VAT: 5% unified tax and 1%
military levy against actual receipts; ESV is monthly and independent of orders.
A future group2 policy uses fixed monthly unified tax and its distinct military
levy formula. A new policy never revalues used historical periods.

A TaxPeriod freezes the policy and statutory bases for its month and can retain
an immutable closing snapshot. A TaxEntry root identifies one Payment/component
or month/component. Its append-only events retain source changes, historical NBU
valuation, pending retries, final calculation and explicit corrections. Roots,
source markers and drafts are not money. A CRM receipt void is not automatically
proof of a legal refund. Gross amount and recognized income date can need explicit
reconciliation; pending evidence makes the tax report incomplete.

TaxExpenseAllocation distinguishes a link to one actual UAH Expense from its
allocations and reversals. Accrual does not create a cash Expense or change the
client's debt. Actual tax payment is counted once per linked Expense; allocations
may settle another month's liability, and unused payment remains credit. Generic
expense mutation cannot silently change a linked tax payment. The existing cash
report keeps its established UTC calendar and currency policy; tax income dates
and periods use Kyiv, with original currency/date/rate evidence preserved.

See [ADR0009](docs/decisions/0009-fop-tax-ledger-and-cash-expenses.md) and the
[approved implementation plan](docs/plans/fop-tax-accounting.md). The module is
internal accounting support, not a tax declaration or bank-payment integration.

## Canonical Website Checkout

A direct-authoritative website purchase identified by canonical site account and
immutable numeric checkout ID, separate from buyer identity and KeyCRM order ID.
Reserved `yo-checkout:v1:<account>:<id>` records from KeyCRM are held for the direct
writer; they never create a second Order/Payment/tax source. Order receipt capture
uses the installed native tax ledger and retains manual confirmation/FX rules.
See ADR0010 and `docs/integrations/website-orders.md`. A held provider snapshot is
private reconciliation evidence, not another sale or a customer-facing error.

## Backup and recovery

### Backup

A private recoverable snapshot represented by existing Backup metadata and durable storage artifacts. DATA protects the whole CRM PostgreSQL database and persistent uploads; FULL additionally carries portable application/compatibility material. Checksum verification, cross-store consistency, successful download, offsite replication and a restore drill are separate claims. Legacy v1/v2 archives remain supported; expanded composition is versioned explicitly.

### Recovery job

A queued operation carried by existing Backup metadata and executed by the external host recovery agent. The web API authorizes and audits requests but never receives Docker control or restores a live database. Backup, archive import, isolated drill and retention share exclusive execution. A production recovery plan is a request/runbook, not permission to erase or switch production data. See ADR0012.

### External conversation coverage

CRM messages are the locally ingested conversation history. A remote media URL is not a durable local file. Chatwoot is a separately hosted database/media system; its coverage must be declared and verified independently. Database ciphertext does not replace separately preserved encryption keys.

### Workstation transfer

Saving an already completed backup to the owner's computer. Manual transfer is
an explicit download; automatic transfer is periodic retrieval by a paired computer.
Transfer does not create a snapshot. A verified transfer proves matching bytes,
not that the archive has been successfully restored.

### Reserved backup source

An archive referenced by a queued or running recovery check. Retention must
preserve a reserved source. Once deletion has been claimed, new checks cannot
accept that source; an interrupted deletion requires reconciliation.
