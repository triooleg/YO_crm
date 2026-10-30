# Sales statistics implementation plan — 2026-10-18

Authority: user-supplied `YO_CRM_Sales_Statistics_Codex_TZ.md` and approved PNG.
Base: `a80a9b3`. Local implementation only: no commit, push, deployment, production
query, migration, data backfill, payment mutation or integration change authorized.

## Architecture and database plan

No schema change or migration is required. Existing Order, OrderItem,
OrderItemInstance, Payment, Expense, Client and ClientMergeRedirect are sufficient.
Read compact projections in cursor batches within one RepeatableRead snapshot;
resolve canonical clients and aggregate on the server, never from a UI page.
Keep the operational Overview component unchanged behind a mode wrapper. Add
dedicated read-only statistics/report, drill-down and CSV export endpoints.
Existing business writers, status transitions and integrations remain unchanged.
If a schema/index change proves necessary, stop that dependent work and seek
approval with the exact migration first. No such change is currently proposed.

## Agreed methodology

- Distinct order IDs by creation date in Europe/Kyiv. Default sales cohort excludes
  archives, cancelled orders and REFUNDED payment status. Explicit all-status mode
  can inspect excluded current records; the inclusion rule remains visible.
  RETURNED shipping status alone does not erase a sale or invent a refund.
- User clarified: count **all physical products, including accessories**. Sum
  active OrderItem.quantity exactly once. Instances validate consistency; never
  add their count to quantity. Missing items mean zero known products, not one.
- Geography uses normalized Order.country only, never silent client fallback.
  Unknown country is separate, excluded from the distinct known-country KPI.
- Proven source classification reuses order-source, not client channel, payment
  method, order type or the mere existence of a KeyCRM import.
- Canonical clients use active merge redirects, guarded against cycles. First
  order uses the entire nonarchived eligible order history before report filters,
  ordered by createdAt then ID. Historical archives are not guessed to be sales.
- Repeat-orders KPI counts non-first orders. Repeat-client share counts distinct
  selected clients with a repeat order / selected clients. Monthly client stacks
  assign each client once: new if first order falls in month, returning if before.
- Sport pie counts products by item.discipline then order.discipline then UNKNOWN;
  orders-by-sport are distinct but overlapping and are explicitly labelled.
  Order types are stored enums, not inferred from names or quantity (no fake TRIO).
- Order amount is persisted priceMinor: delivery/tax/services included, discounts
  already applied. This does not reconstruct an earlier order-price revision.
  Cash uses original nonvoid receipts by receivedAt, independent of order-created
  date; REFUNDED status does not create an invented negative cash transaction.
  Debt follows existing active-debt cohort and applied payment evidence; expenses
  use incurredAt and remain distinct from customer delivery charges.
- Historical FX uses the selected official provider, event business date, exact
  rational rates and existing BigInt half-up conversion. Missing historical rates
  invalidate affected monetary totals/averages rather than becoming zero. A
  bounded read-only historical adapter may fetch official reference observations
  outside DB transactions; it must not refresh the operational finance cache.
  ECB never silently substitutes NBU for UAH. Report/export share one valuation
  manifest. Original amounts and snapshots are never rewritten.

## Access and interactions

Reuse session/role guards. OWNER/ADMIN receive full statistics; MANAGER receives
counts with monetary data removed server-side, including exports, tooltips and
client lifetime totals. ACCOUNTANT uses the financial read projection, without
gaining existing Orders/Clients-detail permissions. PRODUCTION receives no sales
analytics data. Existing role capabilities remain authoritative.

Applied filters live in URL, draft controls apply explicitly. Back/forward/reload,
five meaningful tabs, period arrows, per-chart metric/range, sortable rankings,
interactive SVG map and keyboard alternatives, source/sport/period drill-down,
full country/client lists and CSV use the same server predicate. Statistics own
paginated read-only drill-down avoids pretending unsupported main Orders filters
exist. Individual allowed records link through existing CRM navigation.

## Execution and tests

Use dependency DAG with disjoint isolated worker paths and MAIN as INTEGRATOR.
Default DAG auto-commit is not authorized; preserve worker uncommitted diffs and
integrate explicit task files only. No merges to main, issues or remote writes.

User's twelve test scenarios define agreed seams: report/CSV API contract and UI
navigation. Apply failing-test-first vertical slices to counts, canonical/repeat,
event dates, FX and RBAC; keep calculations server-owned. Run focused checks,
then full tests/types/build/quality and mandatory compatibility, regression,
business/security, visual and release reviews. Compare real browser screenshots
against approved PNG at 1536x1024, 1920x1080, 1366x768, tablet and mobile; report
synthetic-boundary vs real-database evidence honestly. Runtime uses real Prisma
data; synthetic fixtures are tests only. No live deployment is part of acceptance.

## Review refinements

- Client delivery geography uses the selected order/cash cohort: one known ISO
  code, an explicit list for several countries, and a separate unknown marker.
  It never silently falls back to Client.country.
- First/returning monthly-client drill predicates are distinct from first/repeat
  order predicates. Cash drill rows use receipt dates and receipt amounts.
- TOP-5 country complements carry the original five ISO keys into the month
  drill. The server applies the exact complement, including unknown geography.
- Physical-product drill filters item discipline within a mixed order. Whole
  order KPIs intentionally retain whole-order quantities and costs.
- Lifetime receipts include all actual nonvoid payments of the canonical client,
  including archived/refunded/cancelled orders. Lifetime order value and first
  order still use eligible sale history. Payment-only client/country groups are
  retained in receipt rankings even when missing FX makes their amount null.
- FX dependencies come from the same pure report projection, not every unrelated
  historic client. Current/previous period ranges precede lifetime history within
  the fixed global HTTP budget; incomplete lifetime values remain null.
