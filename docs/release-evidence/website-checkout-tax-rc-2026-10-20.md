# Checkout → tax-aware YO CRM: local release candidate

Date2026-10-20. Branch `codex/website-checkout-tax-rc`.
Final independent verdict: **RELEASE_CANDIDATE_READY (LOCAL ONLY)**.
No unresolved local source blocker. External plugin acceptance and separate
deployment permission remain required. Exact40-file release gate is retained in
`.local/website-tax-rc/release-final.md` and JSON.
No push, deployment, live provider/production DB access, real tokens/passwords or
CheckoutV2 edits. The API is not claimed installed on production.

## Supported source line

Base commit: `029366f8c69b9d026186247379dd7472ffe0f5bc`.
This is a NEW local recovery anchor, not a claim this Git SHA was deployed.
The last verified installed source was snapshot
`7156988d4a7c3493e5816749698658089a6d5ba0406aa42140a656fed7a45408`:
all1097 manifest file hashes were matched against immutable source.tar.gz, then
all1097 staged Git blobs verified byte-for-byte, including original mixed EOL.
The archive SHA256 is `91a988dd60e98f904e405b64a22181381ad5dad2d00b322f70b713c7cb1f16c1`.
No runtime sources were assembled from the dirty finance working tree.
Reachable Git main lacked this tax-aware state; clean old d3f3f0c could not safely
replace the installed CRM. Its website feature was ported minimally instead.
Source/image/time provenance is recorded in
[baseline JSON](website-tax-aware-baseline-2026-10-20.json).
A fresh authorized server inventory remains part of the future deployment, not
a live-check claim made here. No server credentials were used for this recovery.

Of1097 baseline files,1083 remain byte-identical;14 owned originals change.
Schema43, all migration bytes, native tax/payment services, parent module,
finance/statistics logic, source routes/permissions and dependency lockfile remain
unchanged. Added files and exact owned list appear below. No DB schema migration
is introduced by this integration.

## Behavior

Authenticated bounded v1 POST `/api/integrations/website/orders`, account allowlist,
constant-time shared Bearer comparison, structured private errors, scoped canonical
idempotency, normalized clients/merge redirects, ready-made physical items and
operator-preserving updates. External HTTPS images display through the current
helper, preserving local images, managed-empty/archive cohorts and KeyCRM rules.
No old UI redesign was copied.

Paid card creates one native Payment and mandatory native tax capture in the same
order-locked transaction. The fixed gross charge already includes delivery/card
surcharge; net prices already include the displayed discount. No second addition,
fee-as-tax component or merchant expense. Unpaid bank creates no Payment/receipt
tax entries. Native manual receipt confirmation remains false until its existing
workflow confirms evidence. Group3 has TWO ROOT + TWO SOURCE component records
per one receipt, not four business payments. Replays add none.

Canonical marker is shared by direct and KeyCRM:
`yo-checkout:v1:<sourceAccount>:<canonicalCheckoutId>`.
Reserved-marked KeyCRM import is HELD before financial/link/fuzzy writes, even
before direct exists. Direct creates the single canonical business order;
subsequent holds refer to its ID. Explicit connection/source/account/time cohorts
hold missing/mismatched markers, invalid map/malformed marker fails closed,
legacy outside-cohort behavior stays. Raw provider evidence is stored privately
and redacted from issue responses. No fuzzy merge, adoption or history rewriting.
See [ADR0010](../decisions/0010-direct-canonical-checkout-import.md).

## Executed checks

- Frozen install and Prisma generation PASS, Node24.16.0/pnpm11.16.0.
- Actual isolated native PostgreSQL16.15, loopback24169, database
  website_checkout_rc_test:43 finished real migration checksums,71 tables,
  no seed. No production data copied. Provision receipt retained privately.
- MAIN actual `node scripts/website-checkout-test-db.mjs --env-file <private> --run`:
  native0,12PASS/0fail/0skip. Real Nest feature-module factory/current validation,
  real Prisma/PostgreSQL; no AppModule/workers/.env discovery. KeyCRM HTTP only
  uses synthetic transport; settings/encryption/preview/lease/processStep are real.
- Concurrent first HTTP receipts/replays and unpaid→paid retain one Order/Payment
  and expected component roots/sources. Two same-buyer/day/equal-amount IDs remain
  separate orders. Direct-first and KeyCRM-first converge; the race explicitly
  waits for TWO real PostgreSQL advisory-lock waiters before releasing a barrier.
- Actual PostgreSQL triggers reject Payment, TaxEntry SOURCE and TAX_CAPTURE audit
  inserts in separate cases; complete client/order/payment/tax/activity/audit
  fingerprints remain unchanged after each failed HTTP ingest.
- Real401/403/503/400/413 and internal500 responses plus captured Nest logs are
  bounded and free of known synthetic shared/provider/encryption/DB secrets and
  private email/body/error markers. No unhandled raw Prisma details returned.
- UAH gross21500 includes cardFee500 once; native reconciliation yields UNIFIED1075
  and MILITARY215, no separate card-fee component. Historical EUR evidence is
  supplied only through the native test cache API; external NBU calls are blocked.
  receiptConfirmed:false/manual confirmation remains intact. Repeated local PG
  runs retain append-only synthetic evidence, not destructive cleanup.
- Full `corepack pnpm quality:check` WITH YO_WEBSITE_POSTGRES=1 and the guarded
  private test URL: native0, **2282PASS /12 existing opt-in skips**. API1638PASS/
  5skip, WEB618PASS/7skip, database26PASS. The new PG suite executed, not skipped.
  Typecheck, Nest production build and Next production build PASS; parent route
  remains in the built graph. No broader repeat required without new source drift.
- Actual Compose `config --quiet` PASS for normal and Portainer files using only
  isolated copies of sample envs. Official standalone Compose5.6.0 binary SHA256
  `8aeaa0055e660e12cf07cd70680dc8333957fe6718528b91ec3da084eab62483`
  matched official checksums. No Docker daemon/services/build/pull/global install.
- Actual current React/Mantine OrderDesigns+existing CSS,1920/390 synthetic image
  transport: PASS. Independent reviewer inspected both PNGs/current four source
  hashes. This is bounded component proof, not authenticated production UI smoke.
- Independent compatibility/Spec, business/security, Standards and visual reviews
  PASS on frozen code; final release gate is RELEASE_CANDIDATE_READY.
  RED/canonical-profile and earlier provisional findings are retained, superseded
  by the final exact-source green evidence.

## Evidence boundaries and remaining prerequisites

No real payment/card provider, KeyCRM account or installed plugin round-trip was
performed. Those are the SAME remaining external plugin implementation/acceptance
prerequisite, not claimed API proof. Actual PostgreSQL concurrency and tax capture
are now verified; the earlier old-main/no-tax/fake-only blockers are closed.

Current CheckoutV2v5.1.8 still needs the pinned canonical site/order/line/receipt
identity, source_uuid on ALL dual-mode create/update/rebuild/retry/fallback paths,
durable direct outbox and safe mode/draft ownership. Exact sender paths, source
hashes, metadata/lifetime rules and regression matrix:
[CheckoutV2 handoff](../integrations/checkout-v518-source-uuid-handoff.md).
No PHP patch was made in this task.

Production deployment requires separate explicit permission. A local RC/commit
is not installation, release activation, an authorization to run real import,
a bank confirmation or tax backfill. Existing taxes still require their native
receipt-evidence workflow. No new rates/assumptions are introduced.

## Future controlled deployment

The [operator contract](../integrations/website-orders.md) contains exact JSON,
endpoint/config/curl, guarded local-test commands and the full rollout/rollback
sequence. In order: finish plugin acceptance; fresh source/image/schema inventory;
review RC and staging full checks; explicit permission and verified FULL backup;
drain old workers/pause delivery; build/install exact RC through existing Compose
and Nginx Proxy Manager; configure protected token/allowlist/cohort cutoff; approved
smoke/counters/hold-queue recovery; only then enable real dual delivery. Rollback
must pause both channels before any older importer, and must not restore a stale
DB over newly accepted orders. No step here has been executed on production.

The owned local PostgreSQL cluster was stopped after all checks (native0);
append-only synthetic test data and restart instructions remain available locally.

## Exact feature paths

- `.env.example`
- `.env.portainer.example`
- `CHAT_HANDOFF.md`
- `CONTEXT.md`
- `apps/api/src/app.module.ts`
- `apps/api/src/keycrm/keycrm.service.ts`
- `apps/api/src/keycrm/website-checkout-correlation.ts`
- `apps/api/src/main.ts`
- `apps/api/src/orders/order-source.ts`
- `apps/api/src/website-orders/website-orders-contract.ts`
- `apps/api/src/website-orders/website-orders-errors.ts`
- `apps/api/src/website-orders/website-orders-security.ts`
- `apps/api/src/website-orders/website-orders.controller.ts`
- `apps/api/src/website-orders/website-orders.module.ts`
- `apps/api/src/website-orders/website-orders.service.ts`
- `apps/api/tests/fixtures/checkout-v518.json`
- `apps/api/tests/fixtures/website-orders-database.mjs`
- `apps/api/tests/fixtures/website-orders.mjs`
- `apps/api/tests/keycrm-runtime.test.mjs`
- `apps/api/tests/website-checkout-plugin-contract.test.mjs`
- `apps/api/tests/website-keycrm-correlation.test.mjs`
- `apps/api/tests/website-orders-contract.test.mjs`
- `apps/api/tests/website-orders-http.test.mjs`
- `apps/api/tests/website-orders-postgres.test.mjs`
- `apps/api/tests/website-orders-provenance.test.mjs`
- `apps/api/tests/website-orders-security.test.mjs`
- `apps/api/tests/website-orders-service.test.mjs`
- `apps/api/tests/website-test-loader.mjs`
- `apps/web/components/orders-dashboard.tsx`
- `apps/web/lib/order-composition-view.ts`
- `apps/web/tests/keycrm-order-presentation.test.mjs`
- `apps/web/tests/order-composition-view.test.mjs`
- `docker-compose.portainer.yml`
- `docs/decisions/0010-direct-canonical-checkout-import.md`
- `docs/examples/website-order-v1.json`
- `docs/integrations/checkout-v518-source-uuid-handoff.md`
- `docs/integrations/website-orders.md`
- `docs/release-evidence/website-checkout-tax-rc-2026-10-20.md`
- `docs/release-evidence/website-tax-aware-baseline-2026-10-20.json`
- `scripts/website-checkout-test-db.mjs`
