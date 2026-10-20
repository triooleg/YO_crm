# Website checkout API — tax-aware release candidate

Endpoint: `POST /api/integrations/website/orders` under `https://crm.yoleotard.com`.
The candidate is local: no production endpoint installation or push is claimed.
Base commit `029366f8c69b9d026186247379dd7472ffe0f5bc` anchors all1097 exact Git blobs
from last verified installed CRM0.9.0 snapshot
`7156988d4a7c3493e5816749698658089a6d5ba0406aa42140a656fed7a45408`.
It preserves the installed tax/parent/statistics/finance/single-order import code.
No tax policy, ledger schema, migration, production data or passwords changed.

## Configuration

All variables are API server-side; examples contain no real secrets:

```dotenv
WEBSITE_ORDERS_API_TOKEN=<32-512-character-shared-secret>
WEBSITE_ORDERS_SOURCE_ACCOUNTS=calendar.yoleotard.com
WEBSITE_ORDERS_KEYCRM_SOURCE_MAP=[{"connectionKey":"configured-keycrm-connection","sourceId":"12","sourceAccount":"calendar.yoleotard.com","effectiveFrom":"2026-10-20T00:00:00Z"}]
```

The source-map example is SYNTHETIC, not an instruction to activate that cutoff.
Use the exact current KeyCRM connection key, source ID, hostname and an explicitly
chosen activation time for the new direct-authoritative cohort. Empty map `[]`
keeps nonreserved legacy imports unchanged. Malformed configuration holds imports
with an issue, never silently falls back. Before-cutoff/other-source legacy work
remains compatible; post-cutoff missing/mismatched markers are held.

Generate a shared token locally with
`node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"`.
Copy it directly into protected API runtime and WordPress Checkout → CRM settings.
Never log, commit, screenshot or include it in request bodies. Empty/invalid
server token or empty account allowlist disables ingestion503; wrong Bearer401,
unlisted source403. Source accounts are stable lowercase ASCII DNS hostnames.
Portainer Compose passes all3 variables; normal Compose retains env_file.

Plugin URL is the full endpoint, API token is the shared value, source account
must equal the allowlisted hostname (empty plugin field currently uses home_url).
Do not enable dual traffic until the separate plugin handoff is implemented:
[canonical source_uuid handoff](checkout-v518-source-uuid-handoff.md).

## Deterministic two-channel ownership

Wire marker: `yo-checkout:v1:<sourceAccount>:<canonicalCheckoutId>`.
Canonical ID is a positive1–20-digit decimal string, no leading zero. The direct
validator and KeyCRM parser use the SAME pure formatter. Item/payment IDs remain
opaque scoped strings and are persisted as unambiguous JSON tuples with order ID.

**Direct delivery is the canonical CRM Order/Payment writer.** A reserved marker
always holds KeyCRM import before freshness/link/fuzzy/financial writes, even if
no direct record exists yet. This is intentional, not alias adoption:

- KeyCRM-first: retain exact provider payload privately in a sync issue and await
  direct POST; no second Order/Payment/tax source is created.
- Direct-first: hold refers to existing canonical Order ID; provider repetition
  does not rewrite it. Both races converge to one canonical direct record.
- Malformed reserved marker, invalid map and active-cohort missing/mismatched
  marker fail closed. No timeout-based legacy fallback or contact/day/amount merge.
- Hold details retain raw provider evidence server-side; public issues() strips
  keycrmPayload. There is no automatic delete, legacy adoption or historical
  backfill. Existing externally linked conflicts require manual review.

The plugin MUST pin direct-authority mode, durable outbox/retry and identity before
either external write. Reserved markers belong only to that opted-in cohort;
KeyCRM-only checkouts must not be stranded awaiting a disabled direct channel.
Current CheckoutV2v5.1.8 does not yet implement this protocol. That remains the
external release blocker; no PHP change is included in this repository task.

## Request v1

Bearer authentication, JSON max256KiB. Full synthetic example:
[website-order-v1.json](../examples/website-order-v1.json).

| Field | Meaning |
| --- | --- |
| contractVersion | numeric1 |
| sourceAccount | canonical hostname, max253 |
| order | canonical externalId, orderedAt ISO+timezone, checkoutMode card/bank_invoice, paymentStatus paid/unpaid, currency EUR/USD/UAH; optional externalNumber, updatedAt, notes, HTTPS sourceUrl |
| customer | fullName plus email or phone; optional country/city/addressLine1/addressLine2/postalCode |
| delivery | amountMinor; optional serviceName/addressText |
| totals | itemsMinor, discountMinor, deliveryMinor, cardFeeMinor, chargedMinor |
| items | 1–100 unique rows; externalId/name/quantity1–100/unitPriceMinor, optional productId/sku/originalPriceMinor/discountMinor/HTTPS imageUrl/selectedServices/reductions/adjustedMeasurements/properties/notes |
| payment | required for paid: amountMinor=chargedMinor, currency/status/receivedAt; optional externalId/provider/reference/notes |

Money0..2147483647 integer minor units; max500 physical pieces. Unknown contract
fields, invalid dates, noncanonical IDs, unsafe Unicode/NUL and malformed JSON
fail before persistence. Optional empty strings/PHP arrays are supported.
Checkout sends NET prices: itemsMinor=sum(qty*unitPriceMinor),
chargedMinor=itemsMinor+deliveryMinor+cardFeeMinor. Discounts and selected services
are already included; do not subtract/add them again. delivery.amountMinor must
match totals.deliveryMinor. The fixed order price is the final customer charge.
Card surcharge is retained source revenue evidence, NOT an extra tax component
or atelier expense. Images stay external HTTPS; local operator image wins.

## Native tax/payment behavior

READY_MODEL order, deposit0; no production slot, fake athlete/measurement/invoice.
Paid card creates one native CARD Payment and calls mandatory
TaxesService.capturePayment(tx, payment.id, WEBSITE_CREATE) in the SAME locked
transaction. Failure rolls back the entire ingest. Unpaid bank_invoice requires
cardFeeMinor0 and creates neither Payment nor receipt tax entries.

Under the existing enabled group3 policy, one payment has TWO component ROOTs and
TWO SOURCE entries (UNIFIED/MILITARY), not duplicate business receipts. Unchanged
replay adds none. Native worker/cache reconciliation and manual receipt confirmation
are preserved: capture does NOT automatically confirm gross/date evidence or
reopen closed periods. Accounting start/policies/rates remain unchanged.

Payment amount/currency/date cannot be overwritten/voided/downgraded by replay.
Client contacts normalize and merge redirects resolve; ambiguous identities fail
closed. Nonempty manual client fields and compatible delivery/item overrides stay.
Dispatched/archived/terminal orders and assigned/produced/shipped pieces are
protected. Source-line removal returns409; history is never deleted. Physical
instance shrink archives only unused pieces, old identities never reactivate.

## Responses

HTTP200 create/update/replay:
`{ok:true,created,orderId,orderNumber,clientId,paymentStatus,warnings:[]}`.
Warnings may be LOCAL_DELIVERY_PRESERVED / LOCAL_ITEM_PRESERVED.
Errors: `{ok:false,code:WEBSITE_...,message:<bounded static Russian text>}`.
400 invalid contract/totals;401 credentials;403 scope;409 data conflict;
413 size;503 disabled;500 unexpected. No PII, raw provider/Prisma errors or secrets
are returned/logged by this endpoint. Body identity owns idempotency, independent
of the optional plugin Idempotency-Key header. Transient retries retain the same
identity/payload;409 requires review.

```bash
curl --fail-with-body -X POST https://crm.yoleotard.com/api/integrations/website/orders \
  -H "Authorization: Bearer $WEBSITE_ORDERS_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @docs/examples/website-order-v1.json
```

Write tests require an approved synthetic staging account, not production by default.

## Reproduce local PostgreSQL proof

Use a dedicated loopback PostgreSQL16 DB named exactly website_checkout_rc_test.
Apply the repository's43 migrations to that synthetic DB only; never run seed.
Store its private URL in a supplied local file as DATABASE_URL=... . The runner
checks host/name/schema/table count/migration SHA256 before test writes:

```text
node scripts/website-checkout-test-db.mjs --env-file <private-synthetic-env-file> --run
```

No repository .env discovery, AppModule/worker boot or live provider calls.
The suite uses actual Nest feature module/current validation, Prisma transactions,
SQL lock contention/triggers and native tax policy commands. Only KeyCRM HTTP
transport is synthetic. Repeated runs retain append-only synthetic evidence.
For full quality, set WEBSITE_TEST_DATABASE_URL to that URL and
YO_WEBSITE_POSTGRES=1 in the temporary process, then `corepack pnpm quality:check`.
Do not expose those variables in logs; unset afterward.

## Controlled rollout — not executed

1. Finish and acceptance-test the plugin handoff, including stable lines/receipts,
   retries, fallback and missing-marker cohorts. Confirm exact current server
   source/image identity against this known installed base before deployment.
2. Review the RC commit, run frozen install/full quality/PG tests on staging;
   obtain separate explicit deployment approval. Produce and verify FULL backup
   and preserve current source/images, environment and schema43 fingerprints.
3. Drain/pause old KeyCRM runs and plugin delivery. Build exact RC images with the
   existing Compose/Nginx Proxy Manager; no new proxy/password/DB schema needed.
   All API workers must be upgraded before enabling the new reserved cohort.
4. Set protected token/allowlist and reviewed source-map cutoff; release the
   tested plugin outbox/direct-authority cohort only after unauthorized/disabled
   and explicit approved staging create/replay/paid/bank/dual-order smoke pass.
5. Reconcile canonical order/payment/ROOT/SOURCE/audit counts, issue privacy and
   held queue recovery. Preserve taxes/policies/closed periods/cache and old routes.
6. Rollback: pause both delivery and KeyCRM imports first. Old API cannot safely
   process the new marker cohort. Do not restore an old DB over accepted orders;
   review new provenance and choose forward recovery or a bounded reviewed rollback.
