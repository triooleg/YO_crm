# Tax frontend handoff

Implemented against backend contract read from tax-backend/.local/tax-contract.md on 2026-10-19. Exact typed transport is `apps/web/lib/tax-accounting.ts`; prefix `/api/finance/taxes`. Initial accounting date is **2026-05-01 inclusive**, not an editable substitute for registration date. No calculations or fixture data in production runtime.

Exports: `TaxSettingsPanel({role})`, `TaxFinancePanel({role,month,onNavigate?,onSaved?})`, `TaxOrderPanel({orderId,role})`. Callback `onNavigate` accepts only `('orders', context:Record<string,string>)`. `onSaved` refreshes external cash after actual Expense creation/link/correction/cancellation. All panels return null before fetching for roles other than OWNER/ADMIN/ACCOUNTANT. Settings publication/backfill apply/period close/exemption/correction publication restricted to OWNER/ADMIN. Backend remains permission authority.

Panels independently fetch, report their errors and never reset finance workspace. Integrator owns insertion and canonical CHAT_HANDOFF update. No integration files, global CSS, dependencies, credentials, commit, deployment or production data touched by frontend work. Browser fixture only runs locally and never forwards API requests to real customers.

Unknown transport outcomes retain operationKey and command payload on retry; changed payload is rejected until original command resolves. API 409 requires refresh/review. Report amounts remain UAH; source Payment currency and stored snapshots are separately visible and exported. No summed mixed currencies.

Official wage shape verified in backend tax-math.ts: `{version,from,to,minor,source,verifiedAt}`; `to` is exclusive. Receipt snapshot alignment verified in taxes.service.ts: roots originalAmountMinor/originalCurrency; finalized originalPayment and grossMinor; historical rate evidence numerator/denominator/incomeDate/effectiveDate/url. Human-readable evidence only; raw NBU/JSON/internal keys are not rendered. Pending hint states automatic retry for original income date.

Existing `/api/finance/report` options/categories and eligible unbound UAH expense rows provide searchable selections. Manual ID exists only inside advanced link fallback. Root/link choices come from current report. Expense drill-through uses `search=id&period=<incurredAt UTC month>&currency=UAH&tab=expenses`; integrator implements existing expense-table exact-ID search. Missing expense date renders a notice instead of a dead link. The established UTC cash calendar is intentionally distinct from Kyiv tax periods.

Integration must still validate responses from the completed backend through the assembled local app. Synthetic browser evidence is not actual API/database proof. Independent mandatory review roles, full root quality gate, canonical handoff and integration smoke belong to main. No production/deploy authorization.

## Final local frontend evidence

`$env:YO_TAX_BROWSER='1'; node --test apps/web/tests/tax-accounting.test.mjs apps/web/tests/tax-browser.test.mjs`: **12 PASS, 0 FAIL, 0 SKIP**, including a TypeScript program rooted explicitly at all three exported panels (unintegrated files are not silently omitted).

Real Chromium renders actual React/Mantine/theme and existing root CSS. Loopback-only synthetic API; zero customer writes and zero external requests. Scenarios: forbidden roles make zero tax calls; source currency vs UAH totals; incomplete/partial-period warnings; month/quarter/year; CSV; order navigation; expense drill-through; independent report/settings failures; obsolete response suppression; May 1/current/future policy/official wage; owner/admin/accountant restrictions; searched expense linking; integer allocation; 409; failed transport retry with identical operationKey/body; external cash refresh; backfill preview then explicitly confirmed apply; period revision on close. Raw NBU snapshot is not rendered. Cash drill-through UTC midnight boundary is covered separately.

Screenshots: `.local/tax-frontend-browser/finance-1920.png`, `finance-1366.png`, `finance-768.png`, `finance-390.png`, `settings-390.png`. Request/error receipts: `.local/tax-frontend-browser/evidence.json` (`errors:[]`, `blocked:[]`). `git diff --check` scoped to owned files PASS. Full project build/quality and actual completed backend smoke intentionally left to main; no root build against the in-progress API was attempted.

Copy all source files listed in `.local/tax-frontend-delivery/manifest.json`. For shared i18n, **merge only** `.local/tax-frontend-delivery/taxAccountingUi-export.ts` at the end; preserve other workers' exports. Canonical CHAT_HANDOFF remains integration-owned and was not changed here.
