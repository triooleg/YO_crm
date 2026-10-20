// Transport contract v1. Additive; frontend copies types, never imports API runtime.
export type TaxComponent = 'UNIFIED' | 'MILITARY' | 'ESV';
export type FiscalMissing = { code: string; month: string; rowId: string | null; currency: string | null; date: string | null };
export type FiscalPeriod = {
  month: string; receivedMinor: number | null; websiteReceivedMinor: number | null; ordinaryExpensesMinor: number | null;
  accruedTaxesMinor: number | null; taxPaidMinor: number | null;
  resultAfterAccrualMinor: number | null; cashResultMinor: number | null; incomplete: boolean;
};
export type FiscalTaxRow = {
  id: string; rootId: string | null; period: string; component: TaxComponent | null;
  kind: string; source: 'RECEIPT' | 'MONTHLY' | 'CORRECTION' | 'PENDING';
  orderId: string | null; paymentId: string | null; clientId: string | null;
  number: string | null; clientName: string | null; orderSource: string;
  date: string | null; incomeDate: string | null; receivedAt: string | null;
  valuationDate: string | null;
  valuationBasis: 'INCOME_DATE' | 'POSTING_EVIDENCE' | 'PERIOD_END_PRESENTATION' | 'UNKNOWN';
  uahAmountMinor: number | null; amountMinor: number | null; currency: string;
  policyId: string | null; status: string; incomplete: boolean;
  evidence: Record<string, unknown>; fxEvidence: Record<string, unknown> | null;
};
export type FiscalExpenseRow = {
  id: string; date: string; originalTimestamp: string; valuationDate: string;
  categoryId: string; categoryName: string; orderId: string | null; number: string | null;
  clientId: string | null; clientName: string | null; orderSource: string;
  notes: string | null; amountMinor: number | null; originalAmountMinor: number;
  originalCurrency: string; shipmentId: string | null;
  fxEvidence: Record<string,unknown> | null; isTaxPayment: boolean;
};
export type FiscalReport = {
  presentationFx?: { month: string; requestedDate: string; effectiveDate: string; provisional: boolean }[];
  version: 1; currency: string; timezone: 'Europe/Kyiv';
  current: FiscalPeriod; previous: FiscalPeriod; trend: FiscalPeriod[];
  expenseStructure: {
    rows: { kind: 'EXPENSE' | 'TAX'; categoryId: string | null; component: TaxComponent | null; amountMinor: number | null; percent: number | null }[];
    totalMinor: number | null; drawable: boolean; signedReconciliationMinor: number | null;
  };
  rows: FiscalTaxRow[]; missing: FiscalMissing[]; taxExpenseIds: string[];
  expenseValues: { expenseId: string; amountMinor: number | null; valuationDate: string; fxEvidence: Record<string,unknown> | null }[];
  expenseTable: { tab: 'expenses'; rows: FiscalExpenseRow[]; total: number; page: number; pageSize: number };
  recentExpenses: FiscalExpenseRow[];
  taxSummary: { currency: 'UAH'; accruedMinor: number | null; paidMinor: number | null; allocatedMinor: number | null; debtMinor: number | null; creditMinor: number | null; pendingCount: number; incomplete: boolean };
  sourceAnalytics: {
    websiteReceivedMinor: number | null; totalReceivedMinor: number | null;
    breakdown: { source: string; amountMinor: number | null }[];
    trend: { month: string; breakdown: { source: string; amountMinor: number | null }[] }[];
  };
  taxScope: { mode: 'GLOBAL_FOP'; requestedSource: string; sourceFilterApplied: false; note: string };
};
// fiscal.rows: all selected-month rows, before table filters. trend alone spans range.
// tab=taxes: report.table has filtered/sorted/paged FiscalTaxRow[], total/page/pageSize.
// taxComponent?: TaxComponent filters that table and export, never aggregate KPI/pie.
// expenseTable/recents use Kyiv month/date, date=YYYY-MM-DD, originalTimestamp=immutable ISO time.
// Cash expense rows include marked tax payments; those never enter ordinary-expense KPI/pie.
// expenseTable export uses all filtered rows; recents are the unfiltered latest five cash expenses.
export type TaxPolicyPreviewInput = {
  expectedRevision: number; effectiveFrom: string; group: 2 | 3;
  unifiedMode: 'PERCENT' | 'FIXED'; unifiedRateBps: number; fixedUnifiedMinor: number | null; fixedUnifiedWageRateBps?: number | null;
  militaryRateBps: number; esvRateBps: number; transitionEvidence?: string; supersedesId?: string;
};
export type TaxPolicyPreviewResponse = {
  previewRevision: number; fieldSignature: string;
  affectedPeriods: { month: string; state: 'OPEN' | 'CLOSED'; used: boolean }[];
  publicationBlocked: boolean; reasons: { code: string; month: string | null }[];
};
// POST /finance/taxes/policies/preview. Same fields as policy command except operationKey.
// existing GET /finance/taxes/orders/:id adds estimate + completeness; existing entries/incomplete retained.
export type TaxOrderEstimate = {
  amountMinor: number | null; currency: string; asOfDate: string;
  basis: 'ORDER_CREATED_AT'; policyId: string | null; effectiveFrom: string | null;
  incomplete: boolean; missing: string[];
};
export type TaxOrderCompleteness = { incomplete: boolean; missing: string[]; accruedUahMinor: number | null };
