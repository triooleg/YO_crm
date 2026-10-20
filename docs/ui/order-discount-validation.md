# Order discount editor — 0.4.0

## Behavior

Both discount amounts in the order Finance tab open the same compact Mantine
dialog. Operators can replace the discount with an amount in the order currency
or a percentage. Zero removes it. The server previews the resulting total,
required deposit, balance and overpayment before explicit confirmation.

The percentage resolves once, in integer basis points, with BigInt half-up
rounding against the authoritative amount before discount (`priceMinor +
discountMinor`), including delivery, services and legacy adjustments. The stored
discount remains an amount; later composition changes do not dynamically reapply
the percentage. Existing currency conversion converts the amount normally.

The API rechecks eligibility under existing order/client locks and a whole-order
version token. Actor-bound namespaced operation keys protect repeated requests.
Payments and invoice snapshots are retained. Existing deposit coverage and
tentative-slot confirmation rules remain active; preview explains any confirmation.
KeyCRM preserves manual discount intent while retaining ownership of independent
provider item/base updates. Currency mismatches and invalid replacement totals
fail safely through the established import flow.

After an acknowledged save, a failed screen refresh retries reads only. The
expanded order and Finance tab remain mounted. Creation, bulk archive and the
legacy failed-read fallback also refresh the order list in the background.
Initial navigation and intentional filtering still use their normal load path;
an order legitimately excluded by a filter or archive may leave the visible list.

## Verification

- Browser/API seam: 13 PASS, synthetic records only, including fixed/percent,
  both links, invalid input/server blockers, detail/list failures after commit,
  unchanged mounted order/tab, creation/archive/recovery.
- Six actual browser frames at 1366/390 pixels; independent local visual PASS
  within the captured dialog and discount-summary scope. Private frames/logs
  are under `.local/order-discount-deploy/`.
- Input/actual editor state tests cover integer precision and retry safety.
- First integrated quality run: 1590 PASS (1078 API, 488 web, 24 database),
  typecheck and API/Next production builds PASS. This predates the final narrow
  import-rollback closure; final acceptance is recorded below before release.

An independent compatibility review found that a same-value manual discount
confirmation must invalidate an earlier import rollback snapshot. Closed with a
monotonic Order version update (financial fields unchanged), covering old import
restore/archive and identical-key retry. Independent focused 5/5 PASS; broader
actual-service fixtures 126/126 PASS. Final integrated quality: **1594 PASS**
(1082 API, 488 web, 24 database), types and API/Next production builds PASS;
restored generated ambient file to tracked baseline and web typecheck PASS.
Compatibility, business/security, Standards and Spec source checks are accepted;
local visual and browser evidence remain bounded to the scopes above.
No real customer discount was changed to exercise tests. Production deployment
and read-only live acceptance are separate from the local evidence above.

No schema migration, seed or business-data backfill is part of this release.
The previously completed 319 profile confirmations must not be replayed.


## Deployment and live verification

Deployed **0.4.0 / c187304d4df8c6e43cf303e465b53afe93baaa67**, immutable tag
`crm-v0.4.0`. Exact GitHub Quality and CRM Release workflows succeeded. Previous
0.3.1 tag is retained; it was never installed independently. API and web were built
and recreated; PostgreSQL, Redis, storage/private configuration and all 36 applied
migrations stayed unchanged. A fresh verified FULL backup preceded the switch.

The first guard stopped before app shutdown because Docker returned identical
mounts in a different array order. A narrowly reviewed private-helper correction
canonicalized comparison, with 16 offline guards; original failure evidence was
retained. The separately approved retry and strict post-checks passed without
business rebaseline, migration, seed, restore or data backfill.

Actual live read-only acceptance: **23 checks, 16 screenshots, zero errors and no
unavailable paths**, at 1366/390 pixels. Both discount entry points, real server
preview and cancellation, current/selected/cleared photo, actual external image
fallback, Overview and Finance source panels passed. Root and health returned
HTTP 200 with dependencies up. Full post window preserved all columns of 22
business tables plus the operation ledger and complete migration tracker; old/new
app logs were clean. Received payments, invoices and prior 319 profile confirmations
were retained. No customer discount was saved and no image uploaded for live proof.

Private actual screenshots/receipt:
`.local/order-discount-deploy/actual-v040-2026-10-15T19-18-07-060Z/`.
API image `40e3cb2e4bb83126ab7abe3f0420152469315d8eade273dd9401e8fe1c9f82e8`;
web image `39eabc71debdbec5894452316b9f5490889da36aec7d88e08fc3083a7ec9ab55`.
Local intercepted-browser mutation tests and simulated actual-service transaction
fixtures remain distinct from live preview/cancel proof; no real-PG concurrency
rehearsal or customer financial mutation is claimed.

Independent live visual review inspected all 16 supplied frames: scoped PASS, no
blocking visual finding. Compatibility, business/security, regression and visual
roles remain distinct from the final release gate; exact execution/acceptance
receipts are retained privately in `independent-release.md`.
