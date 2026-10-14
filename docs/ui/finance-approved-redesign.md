# Finance approved redesign — implementation contract

User specification: `D:/download/YO_CRM_Finance_Redesign_Codex_TZ.md`.
Approved visual reference: `D:/download/YO_CRM_Finance_Approved_Design.png` (1536×1024).
Canonical unchanged copies: `docs/ui/finance-redesign-spec.md`, `docs/ui/finance-approved-design.png`. Implementation/validation report: `docs/ui/finance-redesign-validation.md`.
Working base: `b41da28`, runtime 0.1.57. No deployment or production financial writes are authorized by this task.

## Architecture audit

- Route `/?section=finance` mounts `apps/web/components/finance-workspace.tsx` from the existing shell.
- `FinanceService.summary` currently reads monthly active Payment/Expense/Invoice data and all unarchived orders. Cash dates are Payment.receivedAt, Expense.incurredAt, Invoice.issueDate, with half-open UTC month boundaries.
- Its default-currency aggregation can silently omit foreign-currency amounts. New reporting is additive; existing payment/expense/invoice mutation contracts remain intact.
- `Number(order.number.slice(-4))` in the old Finance UI corrupts string order numbers. Render the complete string, with an explicit empty placeholder.
- `exchange-rates.ts` and ADR0004 own exact rational BigInt conversion and round-half-up. NBU supports EUR/USD/UAH; ECB supports EUR/USD only. The selected official cache is explicit and observations older than seven days fail closed.
- Payment original amount/currency is immutable; appliedAmountMinor/appliedCurrency and rate snapshot settle an order. Voided payments remain in history and are excluded from active totals.
- Expense is the expense ledger. OrderShipment.atelierExpenseId references an existing Expense; do not add shipment costs again. Customer shipping charges are not extra cash receipts.
- Invoice has independent status and snapshots; there is no individual invoice payment-allocation ledger or send-invoice endpoint. No fictional refund ledger or automatic invoice delivery is introduced.
- Finance read roles are OWNER/ADMIN/ACCOUNTANT. Payment creation is OWNER/ADMIN/MANAGER, not ACCOUNTANT; preserve API enforcement and expose only authorized actions.

## Reporting formulas and rate policy (before implementation)

1. Received: sum active receipts by receivedAt in the selected month, converting each original receipt exactly once to the display currency. Never add its applied amount as another receipt.
2. Expenses: sum unarchived Expense rows by incurredAt, converting each row once. Category totals, donut, KPI and matching export sum those same rounded row values.
3. Financial result: received minus expenses, not net profit. Previous comparison uses the immediately preceding complete month; zero baseline yields an explicit unavailable/new comparison, never infinity.
4. Order settlement: sum active amounts applied in the order currency using existing immutable applied values, then max(order price minus paid, 0). Convert order price/paid/balance once for display. Missing settlement evidence must not silently become zero.
5. Current debt cohort: unarchived orders excluding cancelled/completed sales, refunded payment status and returned shipments. Debt is a current order balance, independent of monthly cash receipts.
6. Expected payments: current positive balances with an existing forecast readiness/shipping deadline in the next 30 days from server today. Show the horizon, source date and forecast wording; do not fabricate a customer promise or dates. This current forecast does not pretend to reconstruct historical debt when another month is selected.
7. Invoices: period by issueDate, excluding archived/cancelled documents from active KPI. Count/total and unpaid-by-status remain separate from receipts. PAID documents have their known full paid amount and zero remaining; documents without an allocation source show an explicit unavailable paid/remaining value rather than allocating the same order receipts to multiple invoices.
8. Display conversion uses the administrator-selected current official cached observation, with provider/effective date/fetch date displayed. This is a reporting valuation under the existing current-cache rule, not a newly invented historical FX series. The report GET never refreshes rates or writes economic records. Missing/stale/unsupported rates are visible errors; no guessed rate or zero fallback. Original amounts and currencies remain available in detail/tooltips.
9. Server-side validated filters, bounded pagination, allowlisted stable sorting and CSV export share one reporting layer. Export must use the same filters, currency and rounded values; textual CSV cells are protected from spreadsheet-formula injection. Any export limit is explicit and must not silently truncate totals.

### Technical reporting boundaries

- Freeze the selected provider/cache observation and server business calendar day into a valuation version. Detail/page/export requests carry that version; a changed cache/day returns an explicit conflict and causes a complete report refresh, not a mixed valuation.
- Every source monetary field is converted separately and exactly. Order rows disclose `roundingDifferenceMinor = convertedPrice − convertedPaid − convertedBalance` (except overpayment); any one-minor-unit reconciliation is an explicit display rounding adjustment, never a receipt, expense or stored mutation. Debt and forecast use the same converted balance as their order rows.
- Month/currency/trend range control the top cash/invoice metrics and charts. Current debt/forecast remain labelled current cohorts. Search/status/client/date/category filters below the tabs scope the table and matching table export; they do not silently redefine the top month-only charts/KPI.
- Payment/debt table includes orders with active receipts in the selected month plus current positive debt. Its date column is the actual last received payment, blank when absent. Explicit last-payment date filters exclude absent dates. A forecast scope selects the current next-30-days cohort independently of the cash month.
- Forecast uses `requiredDeliveryAt` as the first available planned-readiness/deadline source, otherwise `productionSlot.endsAt`; dates are labelled forecasts. Window is `[server business today, today + 30 calendar days)`. Missing dates stay unforecasted; overdue balances remain debt, not a fabricated upcoming payment.
- Database reads are cursor-batched with narrow selects and a consistent read snapshot. Returned table pages are bounded. CSV export has a documented 50,000-row ceiling and errors above it rather than truncating; no partial totals are presented as complete.

## Implementation sequence

1. Add a read-only report/query seam and a pure money/metric seam while retaining `/finance` and all mutation routes.
2. Add month control with both arrows, year/month selection, persistent local EUR/USD/UAH display choice and guarded request sequencing.
3. Build six KPI cards, signed monthly bar chart (3/6/12 months), category donut and shared currency tooltips.
4. Build the three server-backed tables, filters/pagination/export and right expense/forecast informers.
5. Reuse existing expense/category/invoice dialogs and the existing payment endpoint. Do not retry a payment mutation automatically; disable duplicate submission while pending. Preserve operation currency independently of display currency.
6. Add order navigation to its Finance tab without breaking existing order deep links. Keep Finance CSS scoped; the old CSS also contains Settings/modal rules and cannot be deleted globally.
7. Compare PNG geometry at 1703×895, 1920×1080, 1440×900, 1366×768, tablet and mobile; record screenshots, console errors and limitations.

## Agreed verification seams from user specification §10

- Exact pure conversion/metric public interfaces: mixed currencies, applied amounts, half-up, overflow, missing/stale rates, zero comparison base, negative result.
- Read-only report API and export: UTC boundaries, void/refund/archive scope, shipping expense deduplication, category/KPI/export equality, pagination/sorting/filter validation, RBAC and zero economic writes.
- Browser workflows: both month arrows and picker, all EUR/USD/UAH amounts/charts/tooltips/tables/export, three tabs, CRUD dialogs without unsolicited financial writes, original order numbers, stale-response protection and neighboring-page regressions.
- Mandatory compatibility, regression, business/RBAC, visual, release-role reviews; `pnpm quality:check`; final report and local screenshots. No production deployment.

## Isolated prior work

Inbox follow-up stays uncommitted in `D:/CodexData/.codex/worktrees/orders-approved-redesign/YO_crm`: read-only blocked-send diagnostics, accessible saved-summary button, removal of channel counters and order-scope dropdown. It is not part of this Finance diff. Its final checks/reviews and handoff must be retained independently.
