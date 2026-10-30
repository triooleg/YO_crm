import { BadRequestException } from '@nestjs/common';
import { ORDER_SOURCES, matchesOrderSource, normalizeOrderSourceFilter, type OrderSource } from '../orders/order-source';
import { ACCOUNTING_START, convertMinor, integer, kyivDate, safeMinor, monthsBetween, dateOnly, type Component } from '../taxes/tax-math';
import { parseHistoricalRate, type HistoricalRate } from '../taxes/historical-nbu.service';
import type { TaxEntry, TaxPeriod, Row } from '../taxes/tax-store';
import type { FinanceReportQuery } from './finance-report-model';
import type { FiscalExpenseRow, FiscalMissing, FiscalPeriod, FiscalReport, FiscalTaxRow } from './finance-fiscal.types';

export type FiscalLedgerMonth = { month: string; entries: TaxEntry[]; periods: TaxPeriod[]; incomplete: boolean; pendingStatuses: Row[]; pendingCount?: number; totals?: { accruedMinor: number; paidMinor: number; allocatedMinor: number; debtMinor: number; creditMinor: number } };
export type FiscalLedger = { months: FiscalLedgerMonth[]; links: { expenseId: string; component: Component }[]; unavailable?: boolean };
export type FiscalSources = {
  orders: { id: string; number: string; clientId: string; client: { displayName: string }; archivedAt?: Date | string | null }[];
  orderSources?: Record<string, OrderSource>;
  payments: { id: string; orderId: string | null; amountMinor: number; currency: string; receivedAt: Date | string; voidedAt?: Date | string | null }[];
  expenses: { id: string; categoryId: string; category?: { name: string }; amountMinor: number; currency: string; incurredAt: Date | string; archivedAt?: Date | string | null; orderId?: string | null; order?: { number: string } | null; notes?: string | null; orderShipment?: { id: string } | null }[];
  ledger: FiscalLedger;
};
export type FiscalRateReader = (currency: string, date: string) => Promise<HistoricalRate>;
const sum = (values: number[]) => safeMinor(values.reduce((n, value) => n + BigInt(integer(value, true)), 0n));
const nullableSum = (values: (number | null)[]) => values.some(v => v === null) ? null : sum(values as number[]);
const unique = <T extends { id: string }>(rows: T[]) => [...new Map(rows.map(row => [row.id, row])).values()];
const monetary = new Set(['FINALIZE', 'REVERSE', 'RESTORE', 'ADJUST']);
const monthOffset = (month: string, offset: number) => { const d = new Date(month + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + offset); return d.toISOString().slice(0, 7); };
const periodEnd = (month: string) => new Date(Date.parse(monthOffset(month, 1) + '-01T00:00:00Z') - 86400000).toISOString().slice(0, 10);
function taxEventDate(e: TaxEntry, month: string) {
  const isCorrection = (e.kind === 'ADJUST' && e.snapshot.lifecycle !== true) || Boolean(e.snapshot.independentCorrection) || e.snapshot.exemption !== undefined;
  const monthly = !e.paymentId && !isCorrection;
  const basis: FiscalTaxRow['valuationBasis'] = isCorrection ? 'POSTING_EVIDENCE' : monthly ? 'PERIOD_END_PRESENTATION' : 'INCOME_DATE';
  let date: string | null = monthly ? periodEnd(month) : isCorrection ? e.snapshot.postingDate ?? (e.snapshot.postingPeriod ? periodEnd(e.snapshot.postingPeriod) : null) : e.snapshot.incomeDate ?? null;
  try { if (date) dateOnly(date); } catch { date = null; }
  return { isCorrection, monthly, basis, date };
}
function validatedStoredRate(value: unknown): HistoricalRate | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as HistoricalRate;
  try {
    if (r.provider !== 'NBU' || typeof r.currency !== 'string' || !/^[A-Z]{3}$/.test(r.currency) || r.incomeDate !== r.effectiveDate || typeof r.raw !== 'string' || typeof r.url !== 'string' || typeof r.fetchedAt !== 'string' || !Number.isFinite(Date.parse(r.fetchedAt)) || !/^\d+$/.test(r.numerator) || !/^\d+$/.test(r.denominator)) return null;
    dateOnly(r.incomeDate); convertMinor(1,r);
    if (r.currency === 'UAH') return r.raw === 'UAH=1' && BigInt(r.numerator) === BigInt(r.denominator) ? r : null;
    if (new URL(r.url).origin !== 'https://bank.gov.ua') return null;
    const parsed = parseHistoricalRate(r.raw,r.currency,r.incomeDate,r.url);
    return BigInt(parsed.numerator)*BigInt(r.denominator) === BigInt(r.numerator)*BigInt(parsed.denominator) ? r : null;
  } catch { return null; }
}

/** One immutable read projection. Rates are external boundary calls after the report transaction. */
export async function projectFiscalReport(data: FiscalSources, query: FinanceReportQuery, readRate: FiscalRateReader, now = new Date(), onCashValuation?: (evidence: Record<string,unknown>) => void, exportExpenses = false): Promise<FiscalReport> {
  const month = query.month!, currency = query.currency!, today = kyivDate(now), missing: FiscalMissing[] = [];
  const activeOrders = data.orders.filter(order => !order.archivedAt), activeOrderIds = new Set(activeOrders.map(order => order.id));
  const belongsToActiveOrder = (orderId?: string | null) => !orderId || activeOrderIds.has(orderId);
  const activePayments = unique(data.payments).filter(payment => !payment.voidedAt && belongsToActiveOrder(payment.orderId));
  const activePaymentIds = new Set(activePayments.map(payment => payment.id));
  const activeExpenses = unique(data.expenses).filter(expense => !expense.archivedAt && belongsToActiveOrder(expense.orderId));
  const activeLedgerMonths = data.ledger.months.map(ledger => {
    const uniqueEntries = unique(ledger.entries);
    const entries = uniqueEntries.filter(event => belongsToActiveOrder(event.orderId));
    const activeRootIds = new Set(entries.map(event => event.rootId ?? event.id));
    const pendingStatuses = ledger.pendingStatuses.filter(status => {
      if (status.orderId && !belongsToActiveOrder(status.orderId)) return false;
      if (status.rootId && !activeRootIds.has(status.rootId)) return false;
      if (status.paymentId && !activePaymentIds.has(status.paymentId)) return false;
      return true;
    });
    const unlistedPendingCount = Math.max(0, (ledger.pendingCount ?? ledger.pendingStatuses.length) - ledger.pendingStatuses.length);
    const pendingCount = pendingStatuses.length + unlistedPendingCount;
    return { ...ledger, entries, pendingStatuses, pendingCount, projectionChanged: entries.length !== uniqueEntries.length || pendingStatuses.length !== ledger.pendingStatuses.length, incomplete: pendingCount > 0 || (ledger.incomplete && ledger.pendingStatuses.length === 0) };
  });
  const presentationFx: { month: string; requestedDate: string; effectiveDate: string; provisional: boolean }[] = [];
  const rates = new Map<string, Promise<HistoricalRate | null>>(), rateFailures = new Map<string,string>(), rateStartedAt = Date.now();
  const addMissing = (code: string, m: string, rowId: string | null = null, c: string | null = null, date: string | null = null) => {
    if (!missing.some(x => x.code === code && x.month === m && x.rowId === rowId && x.currency === c && x.date === date)) missing.push({ code, month: m, rowId, currency: c, date });
  };
  // Persisted, parser-validated original-date NBU evidence remains usable when offline.
  const stored = new Map<string,HistoricalRate>();
  for (const ledger of [...activeLedgerMonths].reverse()) {
    const frozenEntries = ledger.periods.flatMap(p => Array.isArray(p.closedSnapshot?.entries) ? p.closedSnapshot!.entries as TaxEntry[] : []);
    for (const event of [...ledger.entries,...frozenEntries].filter(e => monetary.has(e.kind))) {
      const r = validatedStoredRate(event.snapshot?.rate); if (!r) continue;
      const key=r.currency+':'+r.incomeDate, prior=stored.get(key);
      if(prior && BigInt(prior.numerator)*BigInt(r.denominator)!==BigInt(r.numerator)*BigInt(prior.denominator)) {
        rateFailures.set(key,'FX_EVIDENCE_CONFLICT'); rates.set(key,Promise.resolve(null));
      } else if(!rateFailures.has(key)) { stored.set(key,r);rates.set(key,Promise.resolve(r)); }
    }
  }
  const getRate = (c: string, date: string) => {
    const key = c + ':' + date;
    if (!rates.has(key)) {
      const overBudget = rates.size >= 1024 || Date.now() - rateStartedAt > 15000;
      if (overBudget) rateFailures.set(key,'FX_LOOKUP_BUDGET_EXCEEDED');
      rates.set(key, overBudget ? Promise.resolve(null) : readRate(c, date).then(r => {
      // A successful response for the wrong date/currency is not historical evidence.
      if (r.currency !== c || r.incomeDate !== date || r.effectiveDate !== date || r.provider !== 'NBU') { rateFailures.set(key,'FX_EVIDENCE_INVALID'); return null; }
      try { convertMinor(1, r); return r; }
      catch { rateFailures.set(key,'FX_EVIDENCE_INVALID'); return null; }
      }).catch((reason: unknown) => {
        const code = reason && typeof reason === 'object' ? (reason as {code?:unknown}).code : null;
        if (code === 'FX_EVIDENCE_INVALID' || code === 'FX_EVIDENCE_CONFLICT' || code === 'FX_STORAGE_UNAVAILABLE') rateFailures.set(key,code);
        return null;
      }));
    }
    return rates.get(key)!;
  };
  const convert = async (amount: number, source: string, date: string | null, m: string, id: string, monthly = false) => {
    integer(amount, true);
    if (source === currency) return { value: amount, rate: null };
    if (!date) { addMissing('VALUATION_DATE_MISSING', m, id, source); return { value: null, rate: null }; }
    // Only a current monthly liability may use today's provisional presentation.
    // Receipt recognition and the immutable UAH ledger never use this resolver.
    if (date > today && !(monthly && m === today.slice(0,7))) { addMissing('FUTURE_PRESENTATION_DATE', m, id, currency, date); return { value: null, rate: null }; }
    const cutoff = date > today ? today : date;
    let failedCurrency = currency;
    for (let back = 0; back <= 31; back++) {
      const effectiveDate = new Date(Date.parse(cutoff+'T00:00:00Z') - back*86400000).toISOString().slice(0,10);
      // Both legs must use the same official day; never combine two dates.
      const [a,b] = await Promise.all([source === 'UAH' ? null : getRate(source,effectiveDate),currency === 'UAH' ? null : getRate(currency,effectiveDate)]);
      const failure = [source,currency].filter(c=>c!=='UAH').map(c=>({c,code:rateFailures.get(c+':'+effectiveDate)})).find(x=>x.code);
      if (failure) { addMissing(failure.code!,m,id,failure.c,effectiveDate); return {value:null,rate:null}; }
      if (source !== 'UAH' && !a || currency !== 'UAH' && !b) { failedCurrency = !a && source !== 'UAH' ? source : currency; continue; }
      const ratio = { numerator: String(BigInt(a?.numerator ?? '1') * BigInt(b?.denominator ?? '1')), denominator: String(BigInt(a?.denominator ?? '1') * BigInt(b?.numerator ?? '1')) };
      const fallbackUsed=effectiveDate!==date,provisional=date>today;
      if(fallbackUsed&&!presentationFx.some(r=>r.month===m&&r.requestedDate===date&&r.effectiveDate===effectiveDate)) presentationFx.push({month:m,requestedDate:date,effectiveDate,provisional});
      return { value: convertMinor(amount, ratio), rate: { source:a,display:b,...ratio,requestedDate:date,effectiveDate,fallbackUsed,provisional } };
    }
    addMissing('HISTORICAL_FX_UNAVAILABLE',m,id,failedCurrency,date); return {value:null,rate:null};
  };
  const activeExpenseIds = new Set(activeExpenses.map(expense => expense.id));
  const links = new Map(data.ledger.links.filter(link => activeExpenseIds.has(link.expenseId)).map(l => [l.expenseId, l]));
  const orders = new Map(activeOrders.map(o => [o.id, o]));
  const origin = (id: string | null) => id ? data.orderSources?.[id] ?? 'UNKNOWN' : 'UNKNOWN';
  const months = monthsBetween(monthOffset(month, -Math.max((query.range ?? 6) - 1, 1)), month);
  // Bounded, deduplicated historical lookups; prioritize current then previous months.
  const requests = new Map<string, { currency: string; date: string }>();
  const request = (c: string, date: string) => { if (c !== 'UAH' && date <= today) requests.set(c + ':' + date, { currency: c, date }); };
  for (const m of [...months].reverse()) {
    for (const p of activePayments.filter(p => kyivDate(p.receivedAt).slice(0,7) === m)) if (p.currency !== currency) { request(p.currency,kyivDate(p.receivedAt)); request(currency,kyivDate(p.receivedAt)); }
    for (const e of activeExpenses.filter(e => kyivDate(e.incurredAt).slice(0,7) === m)) if (e.currency !== currency) { request(e.currency,kyivDate(e.incurredAt)); request(currency,kyivDate(e.incurredAt)); }
    if (currency !== 'UAH') for (const e of unique(activeLedgerMonths.find(p => p.month === m)?.entries ?? []).filter(e => monetary.has(e.kind))) { const {date}=taxEventDate(e,m); if(date) request(currency,date); }
  }
  const queue = [...requests.values()]; let next = 0;
  await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{while(next<queue.length){const r=queue[next++]!;await getRate(r.currency,r.date);}}));
  const projected: FiscalPeriod[] = [], allRows: FiscalTaxRow[] = [];
  const expenseValues = new Map<string,FiscalReport['expenseValues'][number]>();
  const breakdowns: { month: string; breakdown: { source: string; amountMinor: number | null }[] }[] = [];
  const categoryValues = new Map<string, (number | null)[]>(), componentValues = new Map<Component, (number | null)[]>();
  for (const m of months) {
    const ledger = activeLedgerMonths.find(row => row.month === m);
    const startMissing = missing.length;
    const taxPending = !ledger || ledger.incomplete || data.ledger.unavailable || m < ACCOUNTING_START.slice(0, 7);
    if (!ledger || data.ledger.unavailable) addMissing('TAX_LEDGER_UNAVAILABLE', m);
    if (m < ACCOUNTING_START.slice(0, 7)) addMissing('BEFORE_ACCOUNTING_START', m);
    if (ledger?.incomplete) addMissing('TAX_CALCULATION_INCOMPLETE', m);
    const income: (number | null)[] = [], ordinary: (number | null)[] = [], paid: (number | null)[] = [], accrued: (number | null)[] = [];
    const sourceValues = new Map<string, (number | null)[]>(ORDER_SOURCES.map(s => [s, []]));
    for (const p of activePayments.filter(p => kyivDate(p.receivedAt).slice(0, 7) === m)) {
      const v = await convert(p.amountMinor, p.currency, kyivDate(p.receivedAt), m, p.id);
      onCashValuation?.({kind:'PAYMENT',id:p.id,date:kyivDate(p.receivedAt),originalAmountMinor:p.amountMinor,originalCurrency:p.currency,displayAmountMinor:v.value,displayCurrency:currency,rate:v.rate});
      income.push(v.value); sourceValues.get(origin(p.orderId))!.push(v.value);
    }
    for (const e of activeExpenses.filter(e => kyivDate(e.incurredAt).slice(0, 7) === m)) {
      const v = await convert(e.amountMinor, e.currency, kyivDate(e.incurredAt), m, e.id);
      expenseValues.set(e.id,{expenseId:e.id,amountMinor:v.value,valuationDate:v.rate?.effectiveDate??kyivDate(e.incurredAt),fxEvidence:v.rate});
      onCashValuation?.({kind:links.has(e.id)?'TAX_PAYMENT':'EXPENSE',id:e.id,date:kyivDate(e.incurredAt),originalAmountMinor:e.amountMinor,originalCurrency:e.currency,displayAmountMinor:v.value,displayCurrency:currency,rate:v.rate});
      if (links.has(e.id)) paid.push(v.value);
      else { ordinary.push(v.value); if (m === month) { const values = categoryValues.get(e.categoryId) ?? []; values.push(v.value); categoryValues.set(e.categoryId, values); } }
    }
    const entries = unique(ledger?.entries ?? []), periodMap = new Map((ledger?.periods ?? []).map(p => [p.id, p]));
    let undatedAccrual = false;
    for (const e of entries.filter(e => monetary.has(e.kind))) {
      const { isCorrection, monthly, basis, date } = taxEventDate(e,m);
      if (!date) { undatedAccrual = true; addMissing('VALUATION_DATE_MISSING', m, e.id, 'UAH'); }
      const v = e.amountMinor === null ? { value: null, rate: null } : await convert(e.amountMinor, 'UAH', date, m, e.id,monthly);
      if (e.amountMinor === null) addMissing('TAX_AMOUNT_MISSING', m, e.id);
      accrued.push(v.value);
      if (m === month) { const values = componentValues.get(e.component) ?? []; values.push(v.value); componentValues.set(e.component, values); }
      const order = e.orderId ? orders.get(e.orderId) : undefined;
       const receipt = e.paymentId ? activePayments.find(p => p.id === e.paymentId) : undefined;
      const pending = ledger?.pendingStatuses.find(p => p.rootId === (e.rootId ?? e.id) || p.paymentId && p.paymentId === e.paymentId);
      const provisionalStatus = pending?.status ?? (e.paymentId && e.snapshot.receiptConfirmed === false ? 'RECEIPT_CONFIRMATION_REQUIRED' : null);
      allRows.push({ id: e.id, rootId: e.rootId, period: m, component: e.component, kind: e.kind, source: isCorrection ? 'CORRECTION' : monthly ? 'MONTHLY' : 'RECEIPT', orderId: e.orderId, paymentId: e.paymentId, clientId: order?.clientId ?? null, number: order?.number ?? null, clientName: order?.client.displayName ?? null, orderSource: origin(e.orderId), date, incomeDate: e.snapshot.incomeDate ?? null, receivedAt: receipt ? new Date(receipt.receivedAt).toISOString() : null, valuationDate: v.rate?.effectiveDate ?? date, valuationBasis: basis, uahAmountMinor: e.amountMinor, amountMinor: v.value, currency, policyId: e.policyId, status: provisionalStatus ?? (v.value === null ? 'VALUATION_PENDING' : !date ? 'DATE_EVIDENCE_MISSING' : periodMap.get(e.periodId)?.state === 'CLOSED' ? 'CLOSED' : 'CALCULATED'), incomplete: Boolean(provisionalStatus) || v.value === null || !date, evidence: { ...e.snapshot, policy: e.snapshot.valuationPolicy ?? e.snapshot.policy ?? entries.find(root => root.id === e.rootId)?.snapshot?.policy ?? periodMap.get(e.periodId)?.snapshot?.policy ?? null }, fxEvidence: v.rate });
    }
    for (const p of ledger?.pendingStatuses ?? []) {
       const root = entries.find(e => e.id === p.rootId), payment = activePayments.find(row => row.id === (p.paymentId ?? root?.paymentId)), orderId = root?.orderId ?? payment?.orderId ?? null, order = orderId ? orders.get(orderId) : undefined;
      allRows.push({ id: String(p.draftId ?? p.rootId ?? p.paymentId ?? `${m}:${p.component ?? 'coverage'}:${p.status}`) + ':pending', rootId: p.rootId ?? null, period: m, component: p.component ?? root?.component ?? null, kind: 'PENDING', source: 'PENDING', orderId, paymentId: p.paymentId ?? root?.paymentId ?? null, clientId: order?.clientId ?? null, number: order?.number ?? null, clientName: order?.client.displayName ?? null, orderSource: origin(orderId), date: p.incomeDate ?? null, incomeDate: p.incomeDate ?? null, receivedAt: payment ? new Date(payment.receivedAt).toISOString() : null, valuationDate: null, valuationBasis: 'UNKNOWN', uahAmountMinor: null, amountMinor: null, currency, policyId: root?.policyId ?? null, status: String(p.status), incomplete: true, evidence: p, fxEvidence: null });
    }
    const receivedMinor = nullableSum(income), ordinaryExpensesMinor = nullableSum(ordinary), taxPaidMinor = nullableSum(paid), accruedTaxesMinor = taxPending || undatedAccrual ? null : nullableSum(accrued);
    const breakdown = ORDER_SOURCES.map(source => ({ source, amountMinor: nullableSum(sourceValues.get(source)!) }));
    breakdowns.push({ month: m, breakdown });
    const resultAfterAccrualMinor = nullableSum([receivedMinor, ordinaryExpensesMinor === null ? null : -ordinaryExpensesMinor, accruedTaxesMinor === null ? null : -accruedTaxesMinor]);
    const cashResultMinor = nullableSum([receivedMinor, ordinaryExpensesMinor === null ? null : -ordinaryExpensesMinor, taxPaidMinor === null ? null : -taxPaidMinor]);
    projected.push({ month: m, receivedMinor, websiteReceivedMinor: breakdown.find(x => x.source === 'WEBSITE')!.amountMinor, ordinaryExpensesMinor, accruedTaxesMinor, taxPaidMinor, resultAfterAccrualMinor, cashResultMinor, incomplete: Boolean(taxPending || missing.length > startMissing) });
  }
  const current = projected.find(p => p.month === month)!, previous = projected.find(p => p.month === monthOffset(month, -1))!;
  // Legacy expense tables retain UTC membership. Reuse conversions, including the Kyiv edge.
  const exposedExpenseIds = new Set(activeExpenses.filter(e=>(kyivDate(e.incurredAt).slice(0,7)===month||new Date(e.incurredAt).toISOString().slice(0,7)===month)).map(e=>e.id));
  for (const e of activeExpenses.filter(e=>exposedExpenseIds.has(e.id)&&!expenseValues.has(e.id))) {
    const date=kyivDate(e.incurredAt),v=await convert(e.amountMinor,e.currency,date,date.slice(0,7),e.id);
    expenseValues.set(e.id,{expenseId:e.id,amountMinor:v.value,valuationDate:v.rate?.effectiveDate??date,fxEvidence:v.rate});
    onCashValuation?.({kind:links.has(e.id)?'TAX_PAYMENT':'EXPENSE',id:e.id,date,originalAmountMinor:e.amountMinor,originalCurrency:e.currency,displayAmountMinor:v.value,displayCurrency:currency,rate:v.rate});
  }
  const expenseRows: FiscalExpenseRow[] = activeExpenses.filter(e=>kyivDate(e.incurredAt).slice(0,7)===month).map(e=>{
    const v=expenseValues.get(e.id)!,order=e.orderId?orders.get(e.orderId):undefined;
    return {id:e.id,date:kyivDate(e.incurredAt),originalTimestamp:new Date(e.incurredAt).toISOString(),valuationDate:v.valuationDate,categoryId:e.categoryId,categoryName:e.category?.name??'',orderId:e.orderId??null,number:e.order?.number??order?.number??null,clientId:order?.clientId??null,clientName:order?.client.displayName??null,orderSource:origin(e.orderId??null),notes:e.notes??null,amountMinor:v.amountMinor,originalAmountMinor:e.amountMinor,originalCurrency:e.currency,shipmentId:e.orderShipment?.id??null,fxEvidence:v.fxEvidence,isTaxPayment:links.has(e.id)};
  });
  const expenseTable=buildFiscalExpenseTable(expenseRows,query,exportExpenses);
  const recentExpenses=[...expenseRows].sort((a,b)=>b.originalTimestamp.localeCompare(a.originalTimestamp)||a.id.localeCompare(b.id)).slice(0,5);
  const native = activeLedgerMonths.find(p => p.month === month), nativeIncomplete = !native || native.incomplete || Boolean(data.ledger.unavailable), totals = native?.totals;
  const projectionChanged = Boolean(native?.projectionChanged);
  const projectedAccrued = native ? sum(native.entries.filter(e => monetary.has(e.kind)).map(e => e.amountMinor ?? 0)) : null;
  const taxSummary: FiscalReport['taxSummary'] = projectionChanged
    ? { currency: 'UAH', accruedMinor: nativeIncomplete ? null : projectedAccrued, paidMinor: null, allocatedMinor: null, debtMinor: null, creditMinor: null, pendingCount: native?.pendingCount ?? 0, incomplete: true }
    : { currency: 'UAH', accruedMinor: nativeIncomplete ? null : totals?.accruedMinor ?? null, paidMinor: totals?.paidMinor ?? null, allocatedMinor: nativeIncomplete ? null : totals?.allocatedMinor ?? null, debtMinor: nativeIncomplete ? null : totals?.debtMinor ?? null, creditMinor: totals?.creditMinor ?? null, pendingCount: native?.pendingCount ?? native?.pendingStatuses.length ?? 0, incomplete: nativeIncomplete || !totals };
  const structureRows: FiscalReport['expenseStructure']['rows'] = [...categoryValues].map(([categoryId, values]) => ({ kind: 'EXPENSE', categoryId, component: null, amountMinor: nullableSum(values), percent: null }));
  structureRows.push(...[...componentValues].map(([component, values]) => ({ kind: 'TAX' as const, categoryId: null, component, amountMinor: nullableSum(values), percent: null })));
  const totalMinor = nullableSum([current.ordinaryExpensesMinor, current.accruedTaxesMinor]);
  const drawable = totalMinor !== null && totalMinor > 0 && structureRows.every(r => r.amountMinor !== null && r.amountMinor >= 0);
  if (drawable) {
    // Largest remainder in basis points: exact 100.00%, stable ties, no floating-point money.
    const portions = structureRows.map((r, i) => ({ i, floor: BigInt(r.amountMinor!) * 10000n / BigInt(totalMinor!), remainder: BigInt(r.amountMinor!) * 10000n % BigInt(totalMinor!) }));
    let rest = 10000 - sum(portions.map(p => Number(p.floor)));
    for (const p of [...portions].sort((a, b) => a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1)) { if (rest-- > 0) p.floor++; }
    for (const p of portions) structureRows[p.i]!.percent = Number(p.floor) / 100;
  }
  return { version: 1, currency, timezone: 'Europe/Kyiv', presentationFx, current, previous, taxSummary, expenseTable, recentExpenses, trend: projected.slice(-(query.range ?? 6)), expenseStructure: { rows: structureRows, totalMinor, drawable, signedReconciliationMinor: totalMinor === null || structureRows.some(r => r.amountMinor === null) ? null : sum([totalMinor, -sum(structureRows.map(r => r.amountMinor!))]) }, rows: allRows.filter(r => r.period === month), expenseValues: [...expenseValues.values()].filter(e=>exposedExpenseIds.has(e.expenseId)), missing, taxExpenseIds: [...links.keys()].sort(), sourceAnalytics: { websiteReceivedMinor: current.websiteReceivedMinor, totalReceivedMinor: current.receivedMinor, breakdown: breakdowns.find(p => p.month === month)!.breakdown, trend: breakdowns.slice(-(query.range ?? 6)) }, taxScope: { mode: 'GLOBAL_FOP', requestedSource: query.source || 'ALL', sourceFilterApplied: false, note: 'GLOBAL_KPIS_SOURCE_FILTER_TABLES_ONLY_MONTHLY_UNALLOCATED_GLOBAL' } };
}

function buildFiscalExpenseTable(allRows: FiscalExpenseRow[], query: FinanceReportQuery, exportAll: boolean): FiscalReport['expenseTable'] {
  const search=query.search?.trim().toLocaleLowerCase('ru-RU'),sourceFilter=normalizeOrderSourceFilter(query.source);
  const rows=allRows.filter(r=>matchesOrderSource(r.orderSource as OrderSource,sourceFilter)&&(!query.categoryId||r.categoryId===query.categoryId)&&(!query.orderId||r.orderId===query.orderId)&&(!query.clientId||r.clientId===query.clientId)&&(!query.from||r.date>=query.from)&&(!query.to||r.date<=query.to)&&(!search||r.id.toLocaleLowerCase('ru-RU')===search||[r.number,r.categoryName,r.clientName,r.notes].some(v=>v?.toLocaleLowerCase('ru-RU').includes(search))));
  const keys:Record<string,keyof FiscalExpenseRow>={date:'originalTimestamp',number:'number',client:'clientName',amount:'amountMinor',category:'categoryName'},key=keys[query.sort??'date']??'originalTimestamp';
  rows.sort((a,b)=>{const x=a[key],y=b[key];if(x===null)return y===null?a.id.localeCompare(b.id):1;if(y===null)return -1;return (typeof x==='number'&&typeof y==='number'?(x<y?-1:x>y?1:0):String(x).localeCompare(String(y),'ru',{numeric:true}))*(query.direction==='asc'?1:-1)||a.id.localeCompare(b.id);});
  if(exportAll&&rows.length>50000)throw new BadRequestException('Экспорт ограничен 50 000 строками. Уточните фильтры.');
  const pageSize=query.pageSize??10,page=Math.min(query.page??1,Math.max(1,Math.ceil(rows.length/pageSize)));
  return {tab:'expenses',rows:exportAll?rows:rows.slice((page-1)*pageSize,page*pageSize),total:rows.length,page,pageSize};
}

export function fiscalTaxTable(fiscal: FiscalReport, query: FinanceReportQuery, exportAll = false) {
  const search = query.search?.trim().toLocaleLowerCase('ru-RU'), sourceFilter = normalizeOrderSourceFilter(query.source);
  const receiptRoots = new Map<string,FiscalTaxRow[]>();
  for (const row of fiscal.rows) if (row.source === 'RECEIPT' && row.rootId) receiptRoots.set(row.rootId,[...(receiptRoots.get(row.rootId)??[]),row]);
  const fullyReversedVoidedRoots = new Set([...receiptRoots].filter(([,events]) => {
    const latest = events.at(-1), original = latest?.evidence.originalPayment;
    if (!original || typeof original !== 'object' || !(original as Record<string,unknown>).voidedAt) return false;
    if (events.some(event => !Number.isSafeInteger(event.uahAmountMinor))) return false;
    return events.reduce((total,event)=>total+BigInt(event.uahAmountMinor!),0n)===0n;
  }).map(([rootId])=>rootId));
  const rows = fiscal.rows.filter(r => !(r.rootId && fullyReversedVoidedRoots.has(r.rootId)) && (!query.taxComponent || r.component === query.taxComponent) && (!sourceFilter || r.orderId !== null && matchesOrderSource(r.orderSource as OrderSource, sourceFilter)) && (!query.orderId || r.orderId === query.orderId) && (!query.clientId || r.clientId === query.clientId) && (!query.status || r.status === query.status) && (!query.from || r.date !== null && r.date >= query.from) && (!query.to || r.date !== null && r.date <= query.to) && (!search || [r.id, r.number, r.clientName, r.component, r.status, r.orderId, r.paymentId].some(v => v?.toLocaleLowerCase('ru-RU').includes(search))));
  const key = ({ number: 'number', client: 'clientName', amount: 'amountMinor', status: 'status', category: 'component' } as const)[query.sort as 'number'] ?? 'date';
  rows.sort((a, b) => { const av = a[key], bv = b[key]; if (av === null) return bv === null ? a.id.localeCompare(b.id) : 1; if (bv === null) return -1; return (typeof av === 'number' && typeof bv === 'number' ? (av < bv ? -1 : av > bv ? 1 : 0) : String(av).localeCompare(String(bv), 'ru', { numeric: true })) * (query.direction === 'asc' ? 1 : -1) || a.id.localeCompare(b.id); });
  if (exportAll && rows.length > 50000) throw new BadRequestException('Экспорт ограничен 50 000 строками. Уточните фильтры.');
  const pageSize = query.pageSize ?? 10, page = Math.min(query.page ?? 1, Math.max(1, Math.ceil(rows.length / pageSize)));
  return { tab: 'taxes', rows: exportAll ? rows : rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
}

/** Explicit isolation boundary: tax failure never substitutes legacy/current FX as fiscal truth. */
export function unavailableFiscalReport(query: FinanceReportQuery, code = 'FISCAL_UNAVAILABLE'): FiscalReport {
  const period = (month: string): FiscalPeriod => ({ month, receivedMinor: null, websiteReceivedMinor: null, ordinaryExpensesMinor: null, accruedTaxesMinor: null, taxPaidMinor: null, resultAfterAccrualMinor: null, cashResultMinor: null, incomplete: true });
  const month = query.month!, trend = monthsBetween(monthOffset(month, -(query.range ?? 6) + 1), month).map(period);
  return { version: 1, currency: query.currency!, timezone: 'Europe/Kyiv', current: period(month), previous: period(monthOffset(month, -1)), trend, taxSummary: { currency: 'UAH', accruedMinor: null, paidMinor: null, allocatedMinor: null, debtMinor: null, creditMinor: null, pendingCount: 0, incomplete: true }, expenseStructure: { rows: [], totalMinor: null, drawable: false, signedReconciliationMinor: null }, rows: [], expenseValues: [], expenseTable: { tab: 'expenses', rows: [], total: 0, page: 1, pageSize: query.pageSize ?? 10 }, recentExpenses: [], missing: [{ code, month, rowId: null, currency: null, date: null }], taxExpenseIds: [], sourceAnalytics: { websiteReceivedMinor: null, totalReceivedMinor: null, breakdown: ORDER_SOURCES.map(source => ({ source, amountMinor: null })), trend: trend.map(p => ({ month: p.month, breakdown: ORDER_SOURCES.map(source => ({ source, amountMinor: null })) })) }, taxScope: { mode: 'GLOBAL_FOP', requestedSource: query.source || 'ALL', sourceFilterApplied: false, note: 'GLOBAL_KPIS_SOURCE_FILTER_TABLES_ONLY_MONTHLY_UNALLOCATED_GLOBAL' } };
}
