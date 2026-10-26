# ESV monthly audit - 2026-10-26

Read-only audit requested by owner; no application, policy, payment, ledger or production changes.

Production SQL (BEGIN READ ONLY, ROLLBACK): published group3 policy effective2026-05-01, esvRateBps2200. Each month2026-05 through2026-10 has exactly1 ESV ROOT and1 FINALIZE, net190234 UAH minor; zero payment/order links. Private receipt: .local/v092-deploy/esv-readonly-audit-20261026.json.

Code: tax-math.ts monthlyAmount computes monthly official minimum wage864700 *2200/10000=190234. capturePayment only generates UNIFIED and MILITARY. catchUpMonthly uses month:<month>:ESV, skips already-finalized roots. Finance fiscal projection converts and sums ledger amounts; it does not calculate ESV from revenue.

Live browser: Finance October2026 expense structure ESV37.61EUR,3.82percent; tax accrual table shows Monthly obligation, period2026-10, ESV1902.34UAH=37.61EUR, Calculated. Percentage in expense structure is share of expenses, not tax rate. Currency presentation changes with historical FX; native UAH liability remains fixed. Browser console empty; temporary tab closed. Screenshot private .local/esv-audit-20261026.png.

Tests: node --test tests/tax-math.test.mjs tests/tax-integration-fiscal.test.mjs tests/tax-policy-wage-formula.test.mjs (apps/api):43 passed,0failed,0skipped. Includes monthly ESV independent of orders and finance presentation preserving UAH liability.

Official verification: https://tr.tax.gov.ua/media-ark/news-ark/print-1057149.html confirms2026 minimum1902.34UAH/month,5707.02quarter, quarterly due date before20th of next month; monthly/advance payment permitted. https://tax.gov.ua/media-tsentr/novini/print-999526.html confirms2026 wage8647UAH and22percent basis. No defect found in the checked scope. No deploy performed.
