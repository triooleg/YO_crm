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

## Orders, production and fulfilment

### Order

The commercial and operational record identified by unique `Order.number`.
Stored as `Order`; it belongs to one client and may reference one athlete and
one measurement snapshot. An order has independent sales, production, payment
and shipping statuses. Never infer one dimension solely from another.

Money is integer minor units plus an ISO currency. `priceMinor`,
`depositRequiredMinor`, `deliveryMinor`, `discountMinor` and
`productionCostMinor` are not floating-point major-unit amounts. The normal
custom-order deposit is supplied by the configured percentage, defaulting to 50
percent, with an authorized explicit override.

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

### Order Item Instance

One physical piece represented by an Order Item. It has a stable identity and
ordinal inside the item and may own its athlete, immutable measurement-snapshot
reference and production state. An active instance is not another priced line:
commercial price remains on the Order Item.

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
does not replace payment status.

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
`lastMessageAt` and unread counters drive inbox ordering and badges.

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

### Task, Note and Template

`WorkTask` is a Kanban task that may refer to a client and source message.
Client notes currently use `Client.notes`; task descriptions and message/internal
content are separate. `MessageTemplate` stores reusable communication text.

## Cross-cutting invariants

- Client and athlete remain separate; one client may own several athletes.
- Measurements are dated snapshots and referenced by orders, items and item
  instances.
- For every Order Item, its quantity equals the number of active Order Item
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
