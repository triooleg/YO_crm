import type { TaxPolicyPreviewResponse, TaxOrderEstimate, TaxOrderCompleteness } from './tax-integration-contract';
import { taxAccountingUi, taxCsvUi } from './i18n';

/** Tax UI transport: backend owns calculations, snapshots, RBAC and CAS. */
export const TAX_ACCOUNTING_START = '2026-05-01';
export type TaxComponent = 'UNIFIED' | 'MILITARY' | 'ESV';
export type TaxRange = 'MONTH' | 'QUARTER' | 'YEAR';
export type TaxTotals = { accruedMinor: number; paidMinor: number; allocatedMinor: number; debtMinor: number; creditMinor: number };
export type TaxWage = { version: string; from: string; to: string; minor: number; source: string; verifiedAt: string };
export type TaxPolicy = { id: string; effectiveFrom: string; group: 3 | 2; unifiedMode: 'PERCENT' | 'FIXED'; unifiedRateBps: number; fixedUnifiedMinor: number | null; fixedUnifiedWageRateBps?: number | null; militaryRateBps: number; esvRateBps: number; state: string; snapshot: Record<string, unknown>; createdAt: string };
export type TaxSettings = { revision: number; accountingStartDate: string; enabled: boolean; timezone: string; policies: TaxPolicy[]; wageCatalog: TaxWage[]; currentPolicy: TaxPolicy | null; futurePolicies: TaxPolicy[] };
export type TaxEntry = { id: string; periodId: string; originalPeriodId: string | null; policyId: string; paymentId: string | null; orderId: string | null; component: TaxComponent; kind: 'ROOT' | 'SOURCE' | 'FINALIZE' | 'REVERSE' | 'RESTORE' | 'ADJUST' | 'DRAFT' | 'RESOLVE'; rootId: string | null; reversesEntryId: string | null; sourceKey: string; operationKey: string; payloadHash: string; amountMinor: number | null; baseMinor: number | null; snapshot: Record<string, unknown>; createdAt: string };
export type TaxSettlement = { id: string; kind: 'PAYMENT_LINK' | 'ALLOCATE' | 'REVERSE_ALLOCATION' | 'CORRECT_LINK'; expenseId: string | null; linkId: string | null; rootId: string | null; reversesId: string | null; component: TaxComponent; amountMinor: number; incurredAt: string | null; snapshot: Record<string, unknown>; operationKey: string; createdAt: string };
export type TaxPeriod = { id: string; month: string; policyId: string; state: 'OPEN' | 'CLOSED'; revision: number; snapshot: Record<string, unknown>; closedAt: string | null; closedSnapshot: unknown };
export type TaxResults = { currency: 'UAH'; timezone: 'Europe/Kyiv'; receivedMinor: number | null; nonTaxExpensesMinor: number | null; taxCashExpensesMinor: number; cashResultMinor: number | null; resultAfterAccrualMinor: number | null; incomplete: boolean; missingRates: { currency: string; incomeDate: string }[]; fxEvidence: { numerator: string; denominator: string; currency: string; incomeDate: string; effectiveDate: string; url: string; fetchedAt: string; provider: 'NBU'; raw: string }[] };
export type TaxReport = { currency: 'UAH'; accountingStartDate: string; from: string; to: string; incomplete: boolean; pendingCount: number; totals: TaxTotals; components: Record<TaxComponent, TaxTotals>; entries: TaxEntry[]; settlements: TaxSettlement[]; settlementOptions: TaxSettlement[]; results: TaxResults; periods: TaxPeriod[]; subsequentCorrections: TaxEntry[] };
export type TaxOrderReport = { orderId: string; incomplete: boolean; entries: TaxEntry[]; estimate?: TaxOrderEstimate; completeness?: TaxOrderCompleteness };
export type TaxBackfill = { token: string; count: number; unreconciledCount: number; payments: { id: string; orderId: string; amountMinor: number; currency: string; receivedAt: string; missingRate: boolean }[]; currencyTotals: unknown; pendingRates: unknown };
export type TaxCommand = { expectedRevision: number; operationKey: string };
export type TaxPolicyInput = Pick<TaxPolicy, 'effectiveFrom' | 'group' | 'unifiedMode' | 'unifiedRateBps' | 'fixedUnifiedMinor' | 'fixedUnifiedWageRateBps' | 'militaryRateBps' | 'esvRateBps'> & { transitionEvidence?: string; supersedesId?: string };
export type TaxSettlementInput = { component: TaxComponent; expenseId?: string; categoryId?: string; amountMinor?: number; incurredAt?: string; notes?: string };
export type TaxFinanceOptions = { options: { categories: { id: string; name: string; active?: boolean }[] }; table: { rows: { id: string; date: string; categoryName: string; notes: string | null; originalAmountMinor: number; originalCurrency: string; orderId: string | null; shipmentId: string | null }[] } };
export type TaxNavigate = (section: 'orders', context: Record<string, string>) => void;
export const canReadTaxes = (role: string) => ['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(role);
export const canManageTaxes = (role: string) => ['OWNER', 'ADMIN'].includes(role);
export class TaxRequestError extends Error { constructor(public status: number) { super('tax-request-failed'); } }
export function taxAmount(value: number | null | undefined, currency = 'UAH'): string {
  if (value == null || !Number.isSafeInteger(value) || !/^[A-Z]{3}$/.test(currency)) return '—';
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, minimumFractionDigits: 2 }).format(value / 100);
}
export function parseTaxMinor(value: string, signed = false): number | null {
  if (!(signed ? /^-?\d+(?:[.,]\d{1,2})?$/ : /^\d+(?:[.,]\d{1,2})?$/).test(value.trim())) return null;
  const [whole = '', fraction = ''] = value.trim().replace(',', '.').replace('-', '').split('.');
  const result = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * (value.trim().startsWith('-') ? -1n : 1n);
  return result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER) ? null : Number(result);
}
export function taxMajorInput(value: number | null | undefined): string { return value == null ? '' : `${value < 0 ? '-' : ''}${Math.trunc(Math.abs(value) / 100)}.${String(Math.abs(value % 100)).padStart(2, '0')}`; }
export function taxMonth(value: string): boolean { return /^\d{4}-(0[1-9]|1[0-2])$/.test(value); }
export function taxDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().startsWith(value); }
export function taxBounds(month: string, range: TaxRange): { from: string; to: string } {
  if (!taxMonth(month)) throw new TaxRequestError(400);
  const year = month.slice(0, 4), m = Number(month.slice(5));
  const start = range === 'YEAR' ? 1 : range === 'QUARTER' ? Math.floor((m - 1) / 3) * 3 + 1 : m;
  const end = range === 'YEAR' ? 12 : range === 'QUARTER' ? start + 2 : m;
  return { from: `${year}-${String(start).padStart(2, '0')}`, to: `${year}-${String(end).padStart(2, '0')}` };
}
export function taxEvidenceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname ? url.href : undefined; } catch { return undefined; }
}
export function taxEntrySource(entry: TaxEntry) {
  const s = entry.snapshot, original = s.originalPayment && typeof s.originalPayment === 'object' ? s.originalPayment as Record<string, unknown> : s.state && typeof s.state === 'object' ? s.state as Record<string, unknown> : s;
  return { amountMinor: typeof s.originalAmountMinor === 'number' ? s.originalAmountMinor : typeof original.amountMinor === 'number' ? original.amountMinor : null, currency: typeof s.originalCurrency === 'string' ? s.originalCurrency : typeof original.currency === 'string' ? original.currency : null, incomeDate: typeof s.incomeDate === 'string' ? s.incomeDate : null };
}
export function taxExpenseHref(id: string, incurredAt: string | null): string | undefined {
  if (!incurredAt || !Number.isFinite(Date.parse(incurredAt))) return undefined;
  // The existing cash report uses UTC months, independently of Kyiv tax periods.
  const month = new Date(incurredAt).toISOString().slice(0, 7);
  return `/?${new URLSearchParams({ section: 'finance', tab: 'expenses', search: id, period: month, currency: 'UAH' })}`;
}
export function taxCsv(report: TaxReport): string {
  const cell = (v: unknown) => { const text = String(v ?? ''); return '"' + (typeof v === 'string' && /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"'; };
  const rows: unknown[][] = [[...taxCsvUi.summaryHeaders]];
  for (const [component, c] of Object.entries(report.components)) rows.push([report.from + ' / ' + report.to, taxAccountingUi.components[component as TaxComponent], c.accruedMinor, c.paidMinor, c.allocatedMinor, c.debtMinor, c.creditMinor, report.incomplete ? taxCsvUi.incomplete : taxCsvUi.complete]);
  rows.push([], [...taxCsvUi.entryHeaders]);
  const exportedIds = new Set<string>();
  for (const e of [...report.entries, ...report.subsequentCorrections]) {
    if (exportedIds.has(e.id)) continue;
    exportedIds.add(e.id);
    rows.push([e.orderId, e.paymentId, taxAccountingUi.components[e.component], e.baseMinor, e.amountMinor, taxAccountingUi.kinds[e.kind], JSON.stringify(e.snapshot)]);
  }
  rows.push([], [taxCsvUi.accountingStart, report.accountingStartDate], [taxCsvUi.pending, report.pendingCount]);
  return '\ufeff' + rows.map(row => row.map(cell).join(';')).join('\r\n');
}
export function createTaxApi(fetcher: typeof fetch = fetch) {
  async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, prefix = '/api/finance/taxes'): Promise<T> {
    const response = await fetcher(`${prefix}${path}`, { method, credentials: 'include', cache: 'no-store', signal,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new TaxRequestError(response.status);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
  return {
    financeOptions: (month: string, search: string, signal?: AbortSignal) => request<TaxFinanceOptions>(`/report?${new URLSearchParams({ month, currency: 'UAH', range: '3', tab: 'expenses', page: '1', pageSize: '100', scope: 'all', search })}`, 'GET', undefined, signal, '/api/finance'),
    settings: (signal?: AbortSignal) => request<TaxSettings>('/settings', 'GET', undefined, signal),
    enable: (input: { enabled: boolean } & TaxCommand) => request<TaxSettings>('/settings', 'POST', input),
    policyPreview: (input: TaxPolicyInput & { expectedRevision: number }, signal?: AbortSignal) => request<TaxPolicyPreviewResponse>('/policies/preview', 'POST', input, signal),
    policy: (input: TaxPolicyInput & TaxCommand) => request<TaxSettings>('/policies', 'POST', input),
    report: (month: string, range: TaxRange, signal?: AbortSignal) => request<TaxReport>(`/report?${new URLSearchParams(taxBounds(month, range))}`, 'GET', undefined, signal),
    order: (orderId: string, signal?: AbortSignal) => request<TaxOrderReport>(`/orders/${encodeURIComponent(orderId)}`, 'GET', undefined, signal),
    preview: (input: { from: string; to: string }) => request<TaxBackfill>('/backfill/preview', 'POST', input),
    backfill: (input: { from: string; to: string; token: string } & TaxCommand) => request('/backfill/apply', 'POST', input),
    confirm: (rootId: string, input: { grossMinor: number; incomeDate: string; evidence: string; postingPeriod?: string } & TaxCommand) => request(`/sources/${encodeURIComponent(rootId)}/confirm`, 'POST', input),
    settlement: (input: TaxSettlementInput & TaxCommand) => request('/settlements', 'POST', input),
    allocate: (input: { linkId: string; rootId: string; amountMinor: number } & TaxCommand) => request('/allocations', 'POST', input),
    reverseAllocation: (id: string, input: { reason: string } & TaxCommand) => request(`/allocations/${encodeURIComponent(id)}/reverse`, 'POST', input),
    close: (month: string, input: { completenessEvidence: string } & TaxCommand) => request(`/periods/${encodeURIComponent(month)}/close`, 'POST', input),
    exemption: (month: string, input: { reason: string; evidence: string; exempt: boolean } & TaxCommand) => request(`/periods/${encodeURIComponent(month)}/exemption`, 'POST', input),
    correction: (input: { rootId: string; period: string; amountMinor: number; reason: string; evidence: string } & TaxCommand) => request('/corrections', 'POST', input),
    publish: (id: string, input: TaxCommand) => request(`/corrections/${encodeURIComponent(id)}/publish`, 'POST', input),
    correctSettlement: (id: string, input: { reason: string; amountMinor?: number; incurredAt?: string; cancel?: boolean } & TaxCommand) => request(`/settlements/${encodeURIComponent(id)}/correct`, 'POST', input),
  };
}
export type TaxApi = ReturnType<typeof createTaxApi>;
