# Order expense cancellation

User scope: Orders page, expanded order Delivery and Finance tabs. Explicitly
cancel a saved atelier shipping expense and recalculate financial presentations.
No deployment, production cancellations, commits or pushes authorized.

## Existing contract and implementation boundary

Reuse DELETE /finance/expenses/:id, OWNER/ADMIN/ACCOUNTANT guards, tax settlement
protection and FinanceService.archiveExpense transaction. This archives rather
than deletes the ledger entry; a linked parcel has its atelier cost/link cleared
and updatedAt advanced. Order and finance reads already exclude archived expenses.
Preserve client payments, agreed price, customer shipping charge, deposit, FX,
tracking and shipment status. Do not infer links or duplicate expenses by amount.
An old parcel without a linked Expense cannot use this operation.

Add one domain confirmation/action component shared by both tabs. Use Mantine
controls and centralized Russian copy. Bind the exact Expense id. Ask explicit
confirmation with amount/currency; disable repeat clicks while pending. If the
DELETE succeeds but reading fails, only retry reading, never repeat DELETE.
Refresh parent order strictly, in place, preserving selected tab. Existing
Finance page archival and all backend/API/database contracts remain unchanged.

## Verification seams

- Mounted production OrderExpandedTabs + actual shared confirmation, through
  synthetic HTTP only: both entry points, exact id, independent same-amount
  expense retained, cancel confirmation, refresh-only recovery, tax rejection,
  readonly roles and desktop/mobile sizes. No real expense or provider mutation.
- Existing real FinanceService transaction tests and finance report models:
  archive/mirror/audit/locking/rollback/FX/archived exclusion and tax guard.
- Full quality:check; independent compatibility, regression, business, visual,
  Standards/Spec and release reviews. Keep installation explicitly unverified.

Compatibility planned review: Euclid PASS, existing API operation sufficient.
Baseline of all pre-existing dirty/untracked files: .local/expense-cancellation/baseline.json.
