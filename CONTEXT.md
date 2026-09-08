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

### Order Item

One line inside an order, stored as `OrderItem`. It carries name, quantity,
minor-unit price, optional model image, production status, athlete and
measurement references. Pair and group orders use items to keep athletes and
measurement snapshots separate.

### Design and Leotard

There is currently no standalone `Design` or `Leotard` model. The requested or
chosen product is represented by order/item descriptions, names and
`modelImagePath`. Do not invent lifecycle or persistence for a design without an
approved data-model decision.

### Production Slot

The dated capacity reservation for an order, stored as `ProductionSlot` with
`startsAt`, `endsAt`, `capacity`, `tentative` and `locked`. A slot remains
tentative until payments in the order currency reach the required deposit. The
configured duration seeds the initial slot. Manual slot changes enforce date
ordering, shipping lead and the deposit gate through
`apps/api/src/orders/production-rules.ts` and `orders.service.ts`.

`Production Schedule` means the set of production slots. `Production Stage`
means `ProductionStatus`; it is not a separate entity.

### Shipment

The optional one-to-one fulfilment record for an order. Stored as `Shipment`
with carrier, tracking number, costs and shipped/delivered timestamps. Shipping
status is an order dimension controlled by shipment flows.

## Finance

### Payment

An immutable receipt against an order, stored as `Payment` with minor-unit
amount, currency, method, received time and optional reference. Payments must
match the order currency. The order service derives `paymentStatus` from the
sum of payments in that currency and confirms a tentative production slot when
the required deposit is reached.

`Deposit` and `Balance` are calculated concepts: the required deposit is
`Order.depositRequiredMinor`; paid and remaining amounts derive from payments
and order totals. They are not separate models. `REFUNDED` exists as a payment
status, but the current schema has no standalone refund transaction model.

### Invoice

An order document stored as `Invoice`, with number, status, language, currency,
issue/due dates, seller/customer/item snapshots and `totalMinor`. Invoice status
does not replace payment status.

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
- Measurements are dated snapshots and referenced by orders/items.
- Sales, production, payment and shipping statuses stay independent.
- Production commitment is gated by the required deposit.
- Money uses integer minor units and ISO currency.
- Important mutations append `Activity` and `AuditLog` records.
- Business history, payments, messages and files are archived or retained rather
  than silently erased.
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
