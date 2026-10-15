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
