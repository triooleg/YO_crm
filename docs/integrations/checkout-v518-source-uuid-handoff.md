# CheckoutV2 5.1.8: canonical source UUID handoff

Status: RC protocol; external plugin implementation and deployment remain
pending. This document authorizes neither PHP edits nor a production rollout.
It describes the implemented direct-canonical / held-marked-KeyCRM design, not the
old proposal that held KeyCRM only after a direct Order already existed.

## Evidence and boundary

Read-only inspection on 2026-10-20 of
`D:/Projects/CheckoutV2/yoleotard-checkout-invoice/` (main plugin header line 5:
version 5.1.8). Line references below belong to these exact bytes:

| File relative to plugin root | SHA256 |
| --- | --- |
| `includes/class-yo-checkout-keycrm.php` | `a8003a7349dad5dad4afe999477877c7a5f397cb7375f56154cdd0bfe32b9b9e` |
| `includes/class-yo-checkout-yocrm.php` | `381d1aa2dd3a7d3a92eb321ff8d7208a7c9ba711cf28ba9b027f7aeaafc339d3` |
| `yoleotard-checkout-invoice.php` | `93202a253bb6d47de7fccee0a150510af0a7f378c7a8ac504af9bdde0bb946bc` |

CRM implementation belongs to the clean `website-checkout-tax-rc/YO_crm` tree.
Its API advances d3f3f0c on local base commit `029366f8c69b9d026186247379dd7472ffe0f5bc`, recovered from the immutable tax-aware source bundle
whose manifest SHA256 is
`7156988d4a7c3493e5816749698658089a6d5ba0406aa42140a656fed7a45408`.
The finance dirty working tree is a source guide, not the integration baseline.
Do not replace the installed tax-aware API with the earlier taxless candidate.
Actual API/PG acceptance results are bound in the separate RC report.

## Ownership and wire contract

The direct website endpoint owns the only CRM Order and its native Payment.
KeyCRM remains an external parallel destination, not a second CRM importer for
this cohort. No automatic alias adoption or identity rewriting is permitted.

```text
KeyCRM source_uuid = yo-checkout:v1:<sourceAccount>:<canonicalCheckoutId>
direct sourceAccount = <sourceAccount>
direct order.externalId = <canonicalCheckoutId>
```

`sourceAccount` is a pinned lowercase ASCII DNS hostname, without scheme, path,
port or trailing dot; use the same validated value in both channels. Do not
silently change it when WordPress home URL/settings change. The canonical ID is
a positive decimal string, no leading zero, at most 20 digits, minted from a
server-owned checkout record. The marker contains no name, email, telephone,
address, session token or payment credential. A local numeric ID is correlation
metadata, not authentication; credentials stay server-side.

The 1..20-digit rule is this agreed protocol's restriction, not a claim about
KeyCRM's maximum `source_uuid` length. No external maximum is asserted here.
The API's direct-order validator and KeyCRM formatter/parser must use the same
canonical account/ID helper (API implementation owned by Averroes), including
identical rejection of leading zeros, malformed hosts and overlength IDs. The
plugin's equivalent formatter needs shared synthetic contract vectors; do not
allow a more permissive direct ID that cannot round-trip through the marker.

Never derive identity from KeyCRM's numeric `id`, display `order_id`, customer,
date, amount, cart similarity or a browser-supplied ID. Equal domains alone do
not establish equal orders; `source_id` alone does not establish a domain.

## Persist identity before either external write

Proposed new private metadata keys (names are a handoff proposal, not existing
5.1.8 fields):

| Key | Durable meaning |
| --- | --- |
| `yo_crm_canonical_checkout_id` | Immutable canonical owner ID, shared by verified continuations/attempts only. |
| `yo_crm_canonical_source_account` | Immutable site account paired with that ID. |
| `yo_crm_delivery_state` | Versioned durable delivery state: pinned ownership mode/cohort, payload revision/hash, immutable receipt evidence, pending/acknowledged channels, canonical CRM ID, attempts/next retry and bounded error codes. |

Initialize the pair once under an atomic server-side ownership lock. Concurrent
drafts/workers must resolve one authoritative owner; last-writer-wins postmeta
updates alone do not prove this. Persist identity plus pending delivery intent
before any external request. Use an atomic durable record or a recoverable
prepared-state protocol; a crash between writes must never permit unjournalled
external delivery. Reject inconsistent existing metadata instead of resetting it.

Relevant existing paths:

- `includes/class-yo-checkout-payment-attempt.php`,
  `YO_Checkout_Payment_Attempt_Service::create`, lines 50-90: clones selected
  metadata and sets `payment_attempt_root_id`/`payment_attempt_source_id`. Resolve
  and inherit the pinned canonical pair before the child can dispatch. The
  existing copy whitelist does not yet contain the proposed keys.
- `includes/class-yo-checkout-submission.php`,
  `YO_Checkout_Submission_Service::create`, lines 11-51: a new submission records
  `checkout_submission_root_id`, `checkout_previous_local_id` and supersession.
  A shared submission root is not by itself proof of the same business order.
  Verified continuation of an unpaid checkout retains its owner. An explicit
  append-checkout/new-business purchase gets a new canonical identity even for
  the same contact, browser or submission lineage, whether the previous purchase
  is paid or still unpaid. Never collapse distinct purchases through a shared
  root or contact heuristic.
- `class-yo-checkout-keycrm.php::ensure_keycrm_order`, lines 554-713: posted,
  session/browser and contact reuse can transfer `order_id` between drafts;
  contact/broad reuse is explicit at 674-693. For the new direct-owned cohort,
  these heuristics cannot transfer canonical ownership or overwrite a different
  remote order. Require a verified existing canonical binding; otherwise hold
  for manual review. Do not retrofit markers onto old orders guessed by contact.
- `yoleotard-checkout-invoice.php`, lines 2941-2982:
  `card_provider_for_order`, `payment_attempt_root_id`,
  `western_bid_after_monobank_failure_is_armed`, and
  `arm_western_bid_after_monobank_failure` scope provider fallback to an attempt
  root. Monobank -> Western Bid must preserve the canonical pair. Switching
  provider must never switch all customers, create another CRM owner or erase a
  previously acknowledged receipt.

Changing only `order.externalId` is insufficient. The actual 5.1.8 item ID at
`class-yo-checkout-yocrm.php:95` is
`<local_id>:item-<index+1>:<product-or-product>:<configuration>`; payment ID at
163 is `<local_id>:<provider-or-card>:<reference-or-payment>`. Both must stop
depending on the current draft/attempt local ID.

Persist a line token when a canonical checkout line is first created, before its
first send. A suitable wire shape is `<canonicalCheckoutId>:line:<stableToken>`;
the token belongs to that line instance, not its array index, product SKU or
editable configuration. Carry the tokens in durable cart/line data through
`payment_attempt_root_id` copies and verified draft reuse. Reordering `[A,B]` to
`[B,A]` preserves the exact IDs for A/B, including two separate lines with the
same product/configuration. New lines get new tokens; removed tokens are not
recycled. Do not rewrite identities already acknowledged by the API; historical
noncanonical deliveries require explicit reconciliation rather than silent
rekeying.

Likewise use a persisted canonical receipt identity, for example
`<canonicalCheckoutId>:receipt:<stableReceiptToken>`, allocated once for the
verified successful charge. Persist its provider/reference alongside it. Failed
provider attempts create no CRM receipt; Monobank failure followed by Western
Bid success creates one receipt whose identity survives subsequent polls,
draft changes and retries. A genuinely second successful charge is a separate
fact requiring conflict/manual reconciliation, not reuse of that token or an
automatic second receipt accepted by this one-receipt endpoint.

The direct API scopes item/payment IDs as JSON tuples with the canonical order
ID; tuple encoding prevents delimiter collisions but cannot repair unstable
plugin IDs. An unpaid-bank send followed by paid-card fallback must retain all
existing line IDs and add only the successful receipt, avoiding false
source-line-removal conflicts. Source line removal remains subject to the target
API's history-preserving rules, not permission to delete records.

## KeyCRM payload sites requiring the identical marker

All paths below are in `includes/class-yo-checkout-keycrm.php`. Resolve the
canonical pair once, pass it explicitly to payload builders, and assert it at
the request boundary. The main `get_order_data` at lines 3428-3430 currently
returns a fixed meta whitelist without `local_id` or the proposed pair; builders
cannot safely infer the owner from its current output.

| Function / current lines | Required treatment |
| --- | --- |
| `keycrm_build_order_payload`, 725-779; `source_id` at 767 | Include exact `source_uuid` for direct-owned dual mode in bank and card payloads. Current code emits no marker. |
| `keycrm_create_order`, 1098-1169; independent payload at 1135 | Update this separate builder too. Preserve marker across POST at 1148, SKU retry 1151, fee-as-product fallback 1162 and its SKU retry 1165. |
| `keycrm_update_existing_order`, 924-1004 | Preserve marker through PUT 937; refreshed-buyer rebuild/PUT 941-943; SKU retry 948-949; fee fallback PUT 977; second buyer rebuild/PUT 981-983. |
| Same update function, 951-968 and 985-999 | Remote-not-found recreation and buyer retries at 957/961 and 988/992 retain canonical pair; clearing remote `order_id` must not clear identity. |
| `ensure_keycrm_order`, 696-711 | Initial create 702 and invalid-buyer retry 706 pass the pinned pair. |
| `ensure_keycrm_card_order`, 1276-1317; `ensure_keycrm_order_after_successful_card_payment`, 1320 | Existing-order update 1285 and fresh create 1308 use that same pair; clearing buyer/order metadata at 1298-1300 cannot remint it. |
| `keycrm_try_clear_order_products_before_replace`, 904-915 | Retain marker from base payload during the auxiliary clear PUT; do not clear/reassign remote identity. |
| `keycrm_update_product_images`, 1007-1036 | Currently builds a products-only PUT. Preserve/verify the existing marker; never erase it or mutate another canonical owner's remote order. |
| `keycrm_update_order_comment`, 1269-1273 | Comment-only PUT must preserve existing marker; no ownership inference from text. |
| `keycrm_add_payment`, 1245-1266 | Payment subresource must be bound to the verified remote owner; it does not create another direct CRM receipt. |

Fallback helpers `keycrm_payload_with_fallback_skus` (1057),
`keycrm_payload_without_zero_quantity_products` (1047), and full product sync
(835) must preserve marker bytes. Do not silently drop `source_uuid` to work
around an external validation/duplicate response. Ambiguous remote success after
timeout requires exact source-ID/marker reconciliation, not a new identity.
No live KeyCRM contract probe is asserted by this source review.

## Direct payload, payment and tax evidence

`includes/class-yo-checkout-yocrm.php::build_payload` currently uses the current
local ID for order (126), items (95) and receipt (163). Bind them to the persisted
canonical owner/line/receipt evidence instead. `externalNumber` (127) is display
metadata only. `sync_order` (176-210) must reuse this identity and persist the
acknowledged canonical CRM Order ID; a 2xx response is not sufficient without a
valid successful body and canonical ID. Validate that replay returns the same ID.
The current Idempotency-Key at 190 is not a substitute for durable server identity.

The existing direct builder reads net `price_eur`, informational `discount_eur`,
delivery, card fee and final totals at lines 83-87 and 152-169:

```text
chargedMinor = net itemsMinor + deliveryMinor + cardFeeMinor
paid card payment.amountMinor = actual gross card_total_amount in minor units
unpaid bank chargedMinor = bank_total_amount; cardFeeMinor = 0
```

Do not subtract discount twice or cap it at the net price. The normal bank path
in the main plugin at 2193-2200 sets card fee to zero; the direct builder currently
reads fee unconditionally at 84. Ensure no stale card fee enters bank payloads.
The KeyCRM `taxes` property at 1141-1146 represents the customer card surcharge,
not FOP tax or merchant expense. Fee-as-product fallback changes transport shape,
not gross paid evidence or canonical identity.

Freeze successful provider/reference, gross, currency and receivedAt once from
verified payment evidence. Current builder at 169 falls back from missing
`paid_at` to request time: this must not produce a new receipt date on each retry.
Do not select an old Monobank reference merely because it remains populated after
Western Bid succeeds (current precedence is 78-80). A second successful charge
must be surfaced for reconciliation, never silently overwrite the first receipt.

The target API creates native Payment and invokes native `capturePayment` using
the same transaction/order lock. No external FX fetch belongs inside that
transaction. Initial capture preserves native `receiptConfirmed:false` and
pending manual bank gross/date confirmation; website paid status and source UUID
are not human confirmation. Do not auto-confirm or invent tax settlement.
Unpaid bank creates no Payment and no receipt tax entries. Native monthly tax
accruals remain independent. No tax/rate/policy/provider activation or historical
backfill is authorized by this plugin handoff.

## Modes and explicit activation cohort

Reserved namespace is opt-in **dual mode only**: both KeyCRM and direct YO CRM
enabled, direct configuration validated, durable delivery ready, and cohort
activation coordinated with the API. Current independent flags are defined in
the main plugin at 345-351 and defaults 486-487. YO disabled, unknown mode,
incomplete configuration, KeyCRM-only or YO-only must not newly emit the reserved
prefix. Preserve legacy source UUID behavior outside the opted-in cohort.

`WEBSITE_ORDERS_KEYCRM_SOURCE_MAP` is the approved explicit API cohort map:

```json
[
  {
    "connectionKey": "approved-keycrm-connection",
    "sourceId": "12",
    "sourceAccount": "calendar.yoleotard.com",
    "effectiveFrom": "2026-11-01T00:00:00Z"
  }
]
```

This is a synthetic contract example, not an instruction to activate source 12
or use this date; the implementation's validated sourceId type must match.
Match exact connection/source/account and agreed immutable order-created timestamp
against the cutoff; never move old orders into the cohort using updatedAt or
import time. Pin the plugin's ownership mode for existing deliveries. After a
dual-owned order has been marked, disabling YO/configuration failure must retain
its pending delivery and issue visibility, not strip marker or revert ownership.

For activated mapped orders, missing/mismatched/malformed markers are held with
bounded issues before linked/freshness/fuzzy paths. Valid reserved markers are
also held before legacy import even if direct has not arrived. Outside the
activation cohort preserve old orders/other sources; explicit reserved markers
remain reserved and must not become permission for legacy creation.

Never activate a source shared by simultaneous legacy-only and direct-owned new
orders without a deterministic discriminator. Use a separately approved source
ID/cohort instead; an unknown/unconfigured mode must not be silently funnelled
into a cohort that holds all missing markers forever. Existing imported records
are preserved, not automatically deleted/adopted. Reconcile preexisting duplicates
manually before enabling their ownership cohort.

## Durable outbox and visible deferred state

Current main-plugin entry points: `sync_bank_invoice_yocrm` (4379-4390),
`deferred_yocrm_finalizer` (4503-4543), `queue_deferred_payment_finalizer` (4074),
and `retry_payment_background_job` (4270-4277). The current retry helper stops
scheduling after eight attempts; this alone is not proof of durable delivery.

Persist a protected outbox record before dispatch, including pinned identity,
revision/hash, immutable receipt evidence and per-channel acknowledgement. Use a
worker lease/CAS and a durable rescan so a crash or missing WP-Cron event cannot
erase intent. Keep retries bounded per run with backoff; exhausted/nonretryable
deliveries remain visible, resumable and unacknowledged. Prevent an older unpaid
snapshot from running after an acknowledged paid snapshot. Do not use a generic
sync_done flag to suppress a later paid revision. Never put Bearer secrets in
outbox diagnostics; customer payload is private and access-controlled.

KeyCRM held issues need a visible pending-direct/awaiting-delivery state. If
direct exists, include its exact canonical CRM Order ID as correlation evidence;
if absent, retain account/canonical ID and the held external identity. A later
direct acknowledgement must be inspectable and a reviewed recheck can record
the same CRM ID. A SKIP is not delivery completion and a held issue is not proof
that direct POST succeeded. Provide operator visibility/resume for exhausted
plugin deliveries and unresolved CRM issues; do not auto-resolve them by age.

There is **no timeout fallback to legacy import**, automatic adoption, marker
removal or payment replay through KeyCRM. Persisted ownership remains authoritative
until an explicit reviewed reconciliation, including after plugin restarts or
settings changes.

## Deterministic races and acceptance tests

| Arrival/failure | Required outcome |
| --- | --- |
| KeyCRM first, direct absent | Hold issue, no CRM Order/Payment/tax entry; later direct creates canonical owner. |
| Direct first | Direct creates canonical owner; KeyCRM held issue references its exact CRM ID. |
| Concurrent channels / linked KeyCRM retry | Shared API merge/order locking and guard before lookup; one direct owner, no adoption. |
| Concurrent direct retries / response lost after commit | Same canonical tuple and immutable receipt replay; one Payment, no duplicate ROOT/SOURCE. |
| Activated mapped missing/wrong marker | Hold with visible reason, zero legacy business writes. |
| Pre-cutoff / other connection or source / legacy-only cohort | Established legacy import remains compatible. |
| Provider fallback / verified draft continuation | Same account/order/line identity; successful receipt evidence pinned; no global provider switch. |
| Worker crash / restart / ninth attempt / configuration disabled | Pending intent survives and is visible/resumable; no silent completion or legacy fallback. |

Plugin tests must execute the actual PHP payload builders with synthetic WordPress
fixtures and capture every POST/PUT/rebuild path listed above. Assert identical
marker bytes on all retries/fallbacks, including card and bank, and no reserved
prefix on new non-dual orders. Test atomic canonical initialization races, verified
attempt inheritance, unrelated same-contact purchases, altered browser markers,
stale paid_at/provider references, bank stale fee, discount greater than net,
stable lines, old unpaid revisions after paid, and malformed/NUL JSON rejection.
Include an explicit bank -> new payment-attempt draft -> Monobank failure ->
Western Bid success -> replay test: order and each existing line keep byte-equal
canonical IDs and only one receipt is sent. Reorder the cart between deliveries
and assert line identity is preserved without a removal conflict; test duplicate
product/configuration lines independently. An explicit append/new checkout by
the same contact must produce a different canonical owner and line namespace.
Run identical valid/invalid account/ID vectors through the common API helper and
plugin formatter, including numeric boundaries, leading zeros and host changes.

Actual isolated PostgreSQL API proof must cover both arrival orders and concurrent
transactions, guard-before-linked-import, all cohort boundaries, direct replay,
one native Payment plus expected group-3 ROOT/SOURCE pairs, no Payment/receipt tax
for unpaid bank, and tax-audit-trigger failure rolling back the entire direct
ingest. Use native published policy/config commands and synthetic immutable READY
FX evidence; block provider HTTP. Separately verify worker/cache restart behavior
and preservation of pending manual receipt confirmation. Mock concurrency alone
does not certify PostgreSQL locking or constraints.

Completion of this document is not plugin implementation evidence. The remaining
external work is the agreed plugin protocol implementation/validation and its
separately authorized deployment, coordinated with the completed reviewed
tax-aware API release. No plugin, production data, credentials or server was
changed to prepare this handoff.
