import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url), cache = new Map();
export function load(file) {
  const filename = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src', file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const m = { exports: {} }; cache.set(filename, m);
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', js)(name => name.startsWith('.') ? load(path.resolve(path.dirname(filename), name + '.ts')) : require(name), m, m.exports);
  return m.exports;
}
const now = new Date('2026-11-03T12:00:00Z');
const entry = (id, amountMinor, extra = {}) => ({ id, rootId: 'root', periodId: 'oct', component: 'UNIFIED', kind: 'FINALIZE', amountMinor, orderId: 'o', paymentId: 'p', policyId: 'policy', snapshot: { incomeDate: '2026-10-12', receiptConfirmed: true }, ...extra });
const month = (m, entries = []) => ({ month: m, entries, periods: [{ id: m === '2026-10' ? 'oct' : m, month: m, state: 'OPEN' }], pendingStatuses: [], incomplete: false });
const data = () => ({ orders: [{ id: 'o', number: '400EUR', clientId: 'c', client: { displayName: 'Synthetic' } }], orderSources: { o: 'WEBSITE' },
  payments: [{ id: 'p', orderId: 'o', currency: 'EUR', amountMinor: 468368, receivedAt: new Date('2026-10-12T12:00:00Z') }],
  expenses: [{ id: 'e', categoryId: 'fabric', currency: 'EUR', amountMinor: 58168, incurredAt: nowForOctober() }, { id: 'tax', categoryId: 'tax', currency: 'UAH', amountMinor: 1000000, incurredAt: nowForOctober() }],
  ledger: { months: [month('2026-08'), month('2026-09'), month('2026-10', [entry('tax-accrued', 2051000)])], links: [{ expenseId: 'tax', component: 'UNIFIED' }] } });
function nowForOctober() { return new Date('2026-10-12T12:00:00Z'); }
const rate = async (currency, date) => ({ numerator: currency === 'UAH' ? '1' : '50', denominator: '1', provider: 'NBU', currency, incomeDate: date, effectiveDate: date, url: 'synthetic', raw: '', fetchedAt: now.toISOString() });

test('persistent evidence failures survive the report cache and cannot trigger older-day fallback',async()=>{
  const {FinanceReportService}=load('finance/finance-report.service.ts'),{projectFiscalReport}=load('finance/finance-fiscal-model.ts');
  let reads=0;const error=Object.assign(new Error('Invalid stored evidence'),{code:'FX_EVIDENCE_INVALID'});
  const service=new FinanceReportService({}, {historicalRate:async()=>{reads++;throw error;}});
  await assert.rejects(service.historicalRate('EUR','2026-10-12'),e=>e.code==='FX_EVIDENCE_INVALID');
  await assert.rejects(service.historicalRate('EUR','2026-10-12'),e=>e.code==='FX_EVIDENCE_INVALID');assert.equal(reads,1);
  const source=data();source.payments=[];source.expenses=[];reads=0;
  const report=await projectFiscalReport(source,{month:'2026-10',currency:'EUR',range:3},async(c,d)=>{reads++;if(d==='2026-10-12')throw error;return rate(c,d);},now);
  assert.equal(reads,1);assert.equal(report.rows[0].amountMinor,null);assert.ok(report.missing.some(x=>x.code==='FX_EVIDENCE_INVALID'));assert.equal(report.presentationFx.length,0);
});

test('actual persistent storage failure stays incomplete across service, memory cache and projection despite earlier READY',async t=>{
  const {HistoricalNbuService}=load('taxes/historical-nbu.service.ts'),{FinanceReportService}=load('finance/finance-report.service.ts'),{projectFiscalReport}=load('finance/finance-fiscal-model.ts');
  const reads=[];let fetches=0;t.mock.method(globalThis,'fetch',async()=>{fetches++;throw Error('no external provider allowed');});
  const nbu=new HistoricalNbuService({$queryRawUnsafe:async(sql,c,d)=>{
    reads.push(d);if(d==='2026-10-12')throw Error('synthetic storage outage');
    assert.ok(sql.startsWith('SELECT'));
    return [{status:'READY',provider:'NBU',currency:c,incomeDate:d,effectiveDate:d,numerator:'50',denominator:'1',fetchedAt:'2026-10-11T12:00:00.000Z',url:`https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=${c}&date=${d.replaceAll('-','')}&json`,raw:`[{"cc":"${c}","rate":50,"exchangedate":"${d.split('-').reverse().join('.')}"}]`}];
  }});
  const service=new FinanceReportService({}, {historicalRate:(c,d)=>nbu.rate(c,d)});
  const source=data();source.expenses=[];source.ledger.months[2].entries=[];
  source.payments=[{...source.payments[0],amountMinor:10000}];
  const r=await projectFiscalReport(source,{month:'2026-10',currency:'UAH',range:3},(c,d)=>service.historicalRate(c,d),now);
  assert.equal(r.current.receivedMinor,null);assert.equal(r.current.incomplete,true);
  assert.ok(r.missing.some(row=>row.code==='FX_STORAGE_UNAVAILABLE'));assert.deepEqual(r.presentationFx,[]);
  assert.deepEqual(reads,['2026-10-12']);assert.equal(fetches,0);
});

test('one fiscal report reconciles specified result, excludes linked tax cash once and retains receipt identity', async () => {
  const { projectFiscalReport } = load('finance/finance-fiscal-model.ts');
  const source = data(); source.payments.push(source.payments[0]); source.ledger.months[2].entries.push(source.ledger.months[2].entries[0]);
  const before = JSON.stringify(source);
  const r = await projectFiscalReport(source, { month: '2026-10', currency: 'EUR', range: 3 }, rate, now);
  assert.equal(r.current.receivedMinor, 468368);
  assert.equal(r.current.ordinaryExpensesMinor, 58168);
  assert.equal(r.current.accruedTaxesMinor, 41020);
  assert.equal(r.current.resultAfterAccrualMinor, 369180);
  assert.equal(r.current.taxPaidMinor, 20000);
  assert.equal(r.current.cashResultMinor, 390200);
  assert.equal(r.expenseStructure.totalMinor, 99188);
  assert.equal(r.expenseStructure.rows.reduce((n, row) => n + row.amountMinor, 0), 99188);
  assert.equal(r.expenseStructure.rows.reduce((n, row) => n + row.percent, 0), 100);
  assert.equal(r.rows.length, 1);
  assert.equal(JSON.stringify(source), before);
});

test('archived orders are excluded from fiscal cash, tax rows and pending reconciliation while monthly obligations remain', async () => {
  const { projectFiscalReport, fiscalTaxTable } = load('finance/finance-fiscal-model.ts');
  const source = data();
  source.orders[0].archivedAt = now;
  source.expenses = source.expenses.map(row => ({ ...row, orderId: 'o', order: { number: '400EUR' } }));
  source.ledger.months[2].entries.push(entry('monthly-esv',190234,{rootId:'monthly-esv-root',paymentId:null,orderId:null,component:'ESV',snapshot:{month:'2026-10'}}));
  source.ledger.months[2].pendingStatuses=[{rootId:'root',paymentId:'p',status:'RECEIPT_CONFIRMATION_REQUIRED'}];
  source.ledger.months[2].incomplete=true;
  const report=await projectFiscalReport(source,{month:'2026-10',currency:'EUR',range:3},rate,now);
  assert.equal(report.current.receivedMinor,0);
  assert.equal(report.current.ordinaryExpensesMinor,0);
  assert.equal(report.current.accruedTaxesMinor,3805);
  assert.equal(report.current.resultAfterAccrualMinor,-3805);
  assert.deepEqual(report.rows.map(row=>row.id),['monthly-esv']);
  assert.equal(fiscalTaxTable(report,{}).total,1);
  assert.equal(report.missing.some(row=>row.code==='TAX_CALCULATION_INCOMPLETE'),false);
  assert.equal(report.taxSummary.accruedMinor,190234);
  assert.equal(report.taxSummary.paidMinor,null);
  assert.equal(report.taxSummary.incomplete,true);
});

test('tax component/date/source filters page and export the same fiscal rows without filtering global KPI', async () => {
  const { projectFiscalReport, fiscalTaxTable } = load('finance/finance-fiscal-model.ts');
  const source = data(); source.ledger.months[2].entries.push(entry('military', 10000, { component: 'MILITARY' }));
  const q = { month: '2026-10', currency: 'EUR', range: 3, taxComponent: 'MILITARY', source: 'WEBSITE', from: '2026-10-01', orderId: 'o', search: '400EUR', pageSize: 10 };
  const r = await projectFiscalReport(source, q, rate, now), table = fiscalTaxTable(r, q);
  assert.equal(table.total, 1); assert.equal(table.rows[0].id, 'military');
  assert.equal(fiscalTaxTable(r, q, true).rows[0].amountMinor, 200);
  assert.equal(r.rows.length, 2); assert.equal(r.current.receivedMinor, 468368);
  assert.equal(r.current.websiteReceivedMinor, 468368);
  assert.equal(r.sourceAnalytics.breakdown.find(x => x.source === 'WEBSITE').amountMinor, 468368);
  assert.equal(r.taxScope.mode, 'GLOBAL_FOP');
});

test('fully reversed voided receipt is absent from active tax table and export while ledger totals stay intact', async () => {
  const { projectFiscalReport, fiscalTaxTable } = load('finance/finance-fiscal-model.ts');
  const source = data(); source.payments = []; source.expenses = [];
  source.ledger.months[2].entries = [
    entry('unified-final', 72960, { rootId: 'unified-root', snapshot: { incomeDate: '2026-10-21', receiptConfirmed: true, originalPayment: { voidedAt: null } } }),
    entry('unified-reverse', -72960, { rootId: 'unified-root', kind: 'REVERSE', snapshot: { incomeDate: '2026-10-21', receiptConfirmed: true, originalPayment: { voidedAt: '2026-10-23T07:23:53.674Z' } } }),
    entry('military-final', 14592, { rootId: 'military-root', component: 'MILITARY', snapshot: { incomeDate: '2026-10-21', receiptConfirmed: true, originalPayment: { voidedAt: null } } }),
    entry('military-reverse', -14592, { rootId: 'military-root', component: 'MILITARY', kind: 'REVERSE', snapshot: { incomeDate: '2026-10-21', receiptConfirmed: true, originalPayment: { voidedAt: '2026-10-23T07:23:53.674Z' } } }),
  ];
  const report = await projectFiscalReport(source, { month: '2026-10', currency: 'UAH', range: 3 }, rate, now);
  assert.equal(report.rows.length, 4);
  assert.equal(report.current.accruedTaxesMinor, 0);
  assert.equal(fiscalTaxTable(report, {}).total, 0);
  assert.equal(fiscalTaxTable(report, {}, true).rows.length, 0);
});

test('active and partially reversed receipt histories remain visible in the tax table', async () => {
  const { projectFiscalReport, fiscalTaxTable } = load('finance/finance-fiscal-model.ts');
  const source = data(); source.payments = []; source.expenses = [];
  source.ledger.months[2].entries = [
    entry('active-final', 10000, { rootId: 'active-root', snapshot: { incomeDate: '2026-10-21', receiptConfirmed: true, originalPayment: { voidedAt: null } } }),
    entry('active-correction', -10000, { rootId: 'active-root', kind: 'ADJUST', snapshot: { incomeDate: '2026-10-21', receiptConfirmed: true, originalPayment: { voidedAt: null } } }),
    entry('partial-final', 10000, { rootId: 'partial-root', snapshot: { incomeDate: '2026-10-21', receiptConfirmed: true, originalPayment: { voidedAt: null } } }),
    entry('partial-reverse', -9000, { rootId: 'partial-root', kind: 'REVERSE', snapshot: { incomeDate: '2026-10-21', receiptConfirmed: true, originalPayment: { voidedAt: '2026-10-23T07:23:53.674Z' } } }),
  ];
  const report = await projectFiscalReport(source, { month: '2026-10', currency: 'UAH', range: 3 }, rate, now);
  assert.equal(fiscalTaxTable(report, {}).total, 4);
});

test('current monthly ESV uses the latest available presentation rate without changing UAH liability', async () => {
  const { projectFiscalReport } = load('finance/finance-fiscal-model.ts');
  const source = data(); source.ledger.months[2].entries = [entry('esv',190234,{paymentId:null,orderId:null,component:'ESV',snapshot:{month:'2026-10'}})];
  const before=JSON.stringify(source), calls=[];
  const r=await projectFiscalReport(source,{month:'2026-10',currency:'EUR',range:3},async(c,d)=>{calls.push(d);if(d==='2026-10-19')throw Error('not published');return rate(c,d);},new Date('2026-10-19T12:00:00Z'));
  assert.equal(r.rows[0].uahAmountMinor,190234); assert.equal(r.rows[0].amountMinor,3805);
  assert.equal(r.rows[0].valuationDate,'2026-10-18');
  assert.equal(r.rows[0].fxEvidence.requestedDate,'2026-10-31');
  assert.equal(r.rows[0].fxEvidence.effectiveDate,'2026-10-18');
  assert.equal(r.rows[0].fxEvidence.fallbackUsed,true); assert.equal(r.rows[0].fxEvidence.provisional,true);
  assert.equal(r.current.accruedTaxesMinor,3805); assert.equal(r.current.incomplete,false);
  assert.equal(r.expenseStructure.drawable,true); assert.equal(r.expenseStructure.signedReconciliationMinor,0);
  assert.ok(calls.every(d=>d<='2026-10-19')); assert.equal(JSON.stringify(source),before);
});

test('display fallback aligns both currency legs on the last common official day and exports provenance', async () => {
  const { projectFiscalReport }=load('finance/finance-fiscal-model.ts'),{appendFiscalCsv}=load('finance/finance-fiscal-csv.ts');
  const source=data();source.expenses=[];source.ledger.months[2].entries=[];
  source.payments=[{...source.payments[0],currency:'USD',amountMinor:10000}];
  const calls=[],cash=[];
  const r=await projectFiscalReport(source,{month:'2026-10',currency:'EUR',range:3},async(c,d)=>{
    calls.push(c+':'+d);if(c==='EUR'&&d==='2026-10-12'||c==='USD'&&d==='2026-10-11')throw Error('missing');
    return {...await rate(c,d),numerator:c==='USD'?'40':'50'};
  },now,e=>cash.push(e));
  assert.equal(r.current.receivedMinor,8000);assert.equal(cash[0].rate.source.effectiveDate,'2026-10-10');
  assert.equal(cash[0].rate.display.effectiveDate,'2026-10-10');assert.equal(cash[0].date,'2026-10-12');
  assert.ok(calls.every(c=>calls.filter(x=>x===c).length===1));
  const csv=appendFiscalCsv('',r,cash);assert.match(csv,/Фактическая дата курса/);assert.match(csv,/2026-10-10/);assert.match(csv,/requestedDate/);
});

test('display fallback is bounded and invalid or conflicting dated evidence never silently falls back', async () => {
  const {projectFiscalReport}=load('finance/finance-fiscal-model.ts');
  const source=data();source.payments=[];source.expenses=[];
  let calls=0;
  const offline=await projectFiscalReport(source,{month:'2026-10',currency:'EUR',range:3},async()=>{calls++;throw Error('offline');},now);
  assert.equal(calls,32);assert.equal(offline.current.accruedTaxesMinor,null);assert.equal(offline.current.incomplete,true);
  assert.equal(offline.presentationFx.length,0);
  calls=0;
  const wrong=await projectFiscalReport(source,{month:'2026-10',currency:'EUR',range:3},async(c,d)=>{calls++;return {...await rate(c,d),effectiveDate:'2026-10-01'};},now);
  assert.equal(calls,1);assert.equal(wrong.rows[0].amountMinor,null);assert.ok(wrong.missing.some(r=>r.code==='FX_EVIDENCE_INVALID'));
  const stored=(n)=>({provider:'NBU',currency:'EUR',incomeDate:'2026-10-12',effectiveDate:'2026-10-12',numerator:String(n),denominator:'1',url:'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange',fetchedAt:now.toISOString(),raw:`[{"cc":"EUR","exchangedate":"12.10.2026","rate":${n}}]`});
  source.ledger.months[2].entries.push(entry('conflict',100,{snapshot:{incomeDate:'2026-10-12',rate:stored(49)}}));
  source.ledger.months[2].entries[0].snapshot.rate=stored(50);
  calls=0;const conflict=await projectFiscalReport(source,{month:'2026-10',currency:'EUR',range:3},async(c,d)=>{calls++;return rate(c,d);},now);
  assert.equal(calls,0);assert.equal(conflict.rows[0].amountMinor,null);assert.ok(conflict.missing.some(r=>r.code==='FX_EVIDENCE_CONFLICT'));
});

test('future monthly presentation, missing FX, correction evidence and closed snapshots remain explicit', async () => {
  const { projectFiscalReport } = load('finance/finance-fiscal-model.ts');
  const source = data(), monthly = entry('monthly', 190234, { paymentId: null, orderId: null, component: 'ESV', snapshot: { month: '2026-10' } });
  source.ledger.months[2].entries = [monthly];
  const requested = [];
  const r = await projectFiscalReport(source, { month: '2026-10', currency: 'EUR', range: 3 }, async (c, d) => { requested.push(d); return rate(c, d); }, new Date('2026-10-19T12:00:00Z'));
  assert.equal(r.rows[0].valuationDate, '2026-10-19'); assert.equal(r.rows[0].valuationBasis, 'PERIOD_END_PRESENTATION');
  assert.equal(r.rows[0].amountMinor, 3805); assert.equal(r.current.accruedTaxesMinor, 3805);
  assert.equal(r.current.resultAfterAccrualMinor, 406395); assert.equal(r.current.cashResultMinor, 390200);
  assert.ok(!requested.includes('2026-10-31'));
  source.ledger.months[2].entries = [entry('correction', -10000, { kind: 'ADJUST', snapshot: { evidence: 'approved', postingPeriod: '2026-10' } })];
  source.ledger.months[2].periods[0].state = 'CLOSED'; source.ledger.months[2].periods[0].closedSnapshot = { immutable: true };
  const before = JSON.stringify(source);
  const signed = await projectFiscalReport(source, { month: '2026-10', currency: 'EUR', range: 3 }, rate, now);
  assert.equal(signed.rows[0].amountMinor, -200); assert.equal(signed.rows[0].status, 'CLOSED');
  assert.equal(signed.expenseStructure.drawable, false); assert.equal(signed.expenseStructure.signedReconciliationMinor, 0);
  assert.equal(JSON.stringify(source), before);
  const missing = await projectFiscalReport(data(), { month: '2026-10', currency: 'UAH', range: 3 }, async () => { throw Error('offline'); }, now);
  assert.equal(missing.current.receivedMinor, null); assert.equal(missing.current.accruedTaxesMinor, 2051000);
  assert.equal(missing.current.cashResultMinor, null); assert.ok(missing.missing.some(x => x.code === 'HISTORICAL_FX_UNAVAILABLE'));
});

test('unsafe sums fail explicitly and accounting/ledger gaps never become complete zero', async () => {
  const { projectFiscalReport } = load('finance/finance-fiscal-model.ts');
  const source = data(); source.payments = [{ ...source.payments[0], id: 'a', currency: 'UAH', amountMinor: Number.MAX_SAFE_INTEGER }, { ...source.payments[0], id: 'b', currency: 'UAH', amountMinor: 1 }];
  await assert.rejects(projectFiscalReport(source, { month: '2026-10', currency: 'UAH', range: 3 }, rate, now), /безопасн/);
  source.payments = []; source.ledger.months[2].incomplete = true;
  const r = await projectFiscalReport(source, { month: '2026-10', currency: 'UAH', range: 3 }, rate, now);
  assert.equal(r.current.accruedTaxesMinor, null); assert.equal(r.current.resultAfterAccrualMinor, null);
  assert.equal(r.current.cashResultMinor, -3908400);
});

test('finance query accepts additive taxes tab/component and rejects invalid component/status', () => {
  const { normalizeFinanceQuery } = load('finance/finance-report-model.ts');
  assert.equal(normalizeFinanceQuery({ tab: 'taxes', taxComponent: 'ESV', status: 'CLOSED' }, now).taxComponent, 'ESV');
  assert.throws(() => normalizeFinanceQuery({ tab: 'taxes', taxComponent: 'VAT' }, now));
  assert.throws(() => normalizeFinanceQuery({ tab: 'taxes', status: 'FAKE' }, now));
});

test('finance public report adds fiscal and tax export from one read snapshot; tax read failure preserves old cash', async () => {
  const { FinanceReportService } = load('finance/finance-report.service.ts');
  let transactions = 0;
  const tx = {
    appSetting: { findMany: async () => [] }, order: { findMany: async () => [] },
    payment: { findMany: async () => [] }, expense: { findMany: async () => [] },
    invoice: { findMany: async () => [] }, expenseCategory: { findMany: async () => [] },
    $executeRawUnsafe: async sql => { assert.match(sql, /^(SAVEPOINT|ROLLBACK TO SAVEPOINT|RELEASE SAVEPOINT)/); return 0; },
    $queryRawUnsafe: async () => [],
  };
  const prisma = { $transaction: async (fn, options) => { transactions++; assert.equal(options.isolationLevel, 'RepeatableRead'); return fn(tx); } };
  const { TaxesService } = load('taxes/taxes.service.ts');
  const service = new FinanceReportService(prisma, new TaxesService(prisma, { rate }));
  const report = await service.report({ month: '2026-10', currency: 'UAH', tab: 'taxes', range: 3 });
  assert.equal(transactions, 1); assert.equal(report.current.receivedMinor, 0);
  assert.equal(report.fiscal.version, 1); assert.equal(report.fiscal.current.accruedTaxesMinor, null);
  assert.equal(report.table.tab, 'taxes'); assert.ok(report.table.rows.some(r => r.status === 'PERIOD_MISSING'));
  const csv = await service.report({ month: '2026-10', currency: 'UAH', tab: 'taxes', range: 3 }, true);
  assert.match(csv, /Фискальная сводка/); assert.match(csv, /PERIOD_MISSING/);
  tx.$queryRawUnsafe = async () => { throw Error('unavailable tax tables'); };
  const fallback = await service.report({ month: '2026-10', currency: 'UAH', range: 3 });
  assert.equal(fallback.current.receivedMinor, 0); assert.equal(fallback.fiscal.current.receivedMinor, null);
  assert.equal(fallback.fiscal.current.incomplete, true);
  assert.ok(fallback.fiscal.missing.some(x => x.code === 'FISCAL_UNAVAILABLE'));
});

test('policy preview is read-only, detects stale revision and frozen periods and rejects non-admin', async () => {
  const { TaxesService } = load('taxes/taxes.service.ts');
  const statements = [];
  const initial = { id: 'p', state: 'PUBLISHED', effectiveFrom: '2026-05-01', group: 3, unifiedMode: 'PERCENT', unifiedRateBps: 500, militaryRateBps: 100, esvRateBps: 2200, fixedUnifiedMinor: null, snapshot: {} };
  const tx = { $queryRawUnsafe: async sql => {
    statements.push(sql); assert.match(sql, /^SELECT/);
    if (sql.includes('AppSetting')) return [{ value: { enabled: true, revision: 7 } }];
    if (sql.includes('TaxPolicy')) return [initial];
    if (sql.includes('TaxPeriod')) return [{ id: 'frozen', month: '2030-01', state: 'CLOSED', used: true }];
    return [];
  } };
  const service = new TaxesService({ $transaction: async fn => fn(tx) }, {});
  const proposal = { expectedRevision: 6, effectiveFrom: '2030-01-01', group: 2, unifiedMode: 'FIXED', unifiedRateBps: 0, fixedUnifiedMinor: 100000, militaryRateBps: 1000, esvRateBps: 2200, transitionEvidence: 'synthetic official confirmation' };
  const r = await service.policyPreview(proposal, { id: 'owner', role: 'OWNER' });
  assert.equal(r.previewRevision, 7); assert.equal(r.publicationBlocked, true);
  assert.equal(r.affectedPeriods[0].month, '2030-01'); assert.equal(r.affectedPeriods[0].used, true);
  assert.ok(r.reasons.some(x => x.code === 'REVISION_MISMATCH'));
  assert.ok(r.reasons.some(x => x.code === 'PERIOD_ALREADY_FROZEN'));
  assert.match(r.fieldSignature, /^[a-f0-9]{64}$/);
  const changed = await service.policyPreview({ ...proposal, fixedUnifiedMinor: 100001 }, { id: 'owner', role: 'OWNER' });
  assert.notEqual(r.fieldSignature, changed.fieldSignature);
  const before = statements.length;
  await assert.rejects(() => service.policyPreview(proposal, { id: 'a', role: 'ACCOUNTANT' }), /прав/);
  assert.equal(statements.length, before);
});

test('order read preserves fixed price and exposes dated nullable estimate plus missing receipt capture', async () => {
  const { TaxesService } = load('taxes/taxes.service.ts');
  const order = { id: 'o', priceMinor: 40000, taxMinor: 1234, currency: 'EUR', createdAt: new Date('2026-06-01T12:00:00Z') };
  const tx = { order: { findUnique: async () => order }, payment: { findMany: async () => [{ id: 'partial', orderId: 'o', amountMinor: 10000, currency: 'EUR', receivedAt: new Date('2026-06-02T12:00:00Z') }] }, $queryRawUnsafe: async sql => sql.includes('TaxPolicy') ? [{ id: 'historic', effectiveFrom: '2026-05-01', state: 'PUBLISHED', group: 3 }] : [] };
  const service = new TaxesService({ $transaction: async fn => fn(tx) }, {}), before = JSON.stringify(order);
  const r = await service.order('o', { id: 'a', role: 'ACCOUNTANT' });
  assert.equal(r.estimate.policyId, 'historic'); assert.equal(r.estimate.asOfDate, '2026-06-01');
  assert.equal(r.estimate.amountMinor, null); assert.ok(r.estimate.missing.includes('PRICE_TAX_ALLOCATION_UNKNOWN'));
  assert.equal(r.incomplete, true); assert.equal(r.completeness.accruedUahMinor, null);
  assert.ok(r.completeness.missing.includes('APPROVED_BACKFILL_REQUIRED'));
  assert.equal(JSON.stringify(order), before);
});

test('native UAH tax summary reuses snapshot totals and explicit PAYMENT_LINK IDs; preview DTO omits command key', async () => {
  const { projectFiscalReport } = load('finance/finance-fiscal-model.ts');
  const source = data();
  source.ledger.months[2].totals = { accruedMinor: 2051000, paidMinor: 1000000, allocatedMinor: 500000, debtMinor: 1551000, creditMinor: 500000 };
  source.ledger.months[2].pendingCount = 0;
  const r = await projectFiscalReport(source, { month: '2026-10', currency: 'EUR', range: 3 }, rate, now);
  assert.deepEqual(r.taxSummary, { currency: 'UAH', accruedMinor: 2051000, paidMinor: 1000000, allocatedMinor: 500000, debtMinor: 1551000, creditMinor: 500000, pendingCount: 0, incomplete: false });
  assert.deepEqual(r.taxExpenseIds, ['tax']);
  const { TaxPolicyPreviewDto } = load('taxes/taxes.dto.ts');
  const { ParentMeasurementsValidationPipe } = load('parent-measurements/parent-measurements-validation.pipe.ts');
  const pipe = new ParentMeasurementsValidationPipe();
  const payload = { expectedRevision: 7, effectiveFrom: '2030-01-01', group: 3, unifiedMode: 'PERCENT', unifiedRateBps: 500, fixedUnifiedMinor: null, militaryRateBps: 100, esvRateBps: 2200 };
  assert.equal((await pipe.transform(payload, { type: 'body', metatype: TaxPolicyPreviewDto })).expectedRevision, 7);
  await assert.rejects(() => pipe.transform({ ...payload, operationKey: 'not-a-command' }, { type: 'body', metatype: TaxPolicyPreviewDto }), e => e.getStatus() === 400);
  await assert.rejects(() => pipe.transform({ ...payload, expectedRevision: undefined }, { type: 'body', metatype: TaxPolicyPreviewDto }), e => e.getStatus() === 400);
});

test('projected monthly evidence takes real root policy without modifying snapshot; undated corrections are incomplete', async () => {
  const { projectFiscalReport } = load('finance/finance-fiscal-model.ts');
  const source = data(), root = entry('root', null, { paymentId: null, kind: 'ROOT', snapshot: { policy: { id: 'historic-policy', esvRateBps: 2200 } } });
  source.ledger.months[2].entries = [root, entry('esv', 190234, { paymentId: null, component: 'ESV', snapshot: { basis: { wage: { minor: 864700 } } } })];
  const before = JSON.stringify(source);
  const r = await projectFiscalReport(source, { month: '2026-10', currency: 'UAH', range: 3 }, rate, now);
  assert.equal(r.rows[0].evidence.policy.esvRateBps, 2200); assert.equal(r.rows[0].evidence.basis.wage.minor, 864700);
  assert.equal(JSON.stringify(source), before);
  source.ledger.months[2].entries = [entry('undated', -100, { kind: 'ADJUST', snapshot: { evidence: 'no explicit posting date evidence' } })];
  const undated = await projectFiscalReport(source, { month: '2026-10', currency: 'UAH', range: 3 }, rate, now);
  assert.equal(undated.rows[0].date, null); assert.equal(undated.current.incomplete, true);
  assert.equal(undated.current.resultAfterAccrualMinor, null);
});

test('historical API reads deduplicate successes and failures and cap concurrent requests at four', async () => {
  const { projectFiscalReport } = load('finance/finance-fiscal-model.ts');
  const source = data(); source.expenses = []; source.ledger.months[2].entries = [];
  source.payments = Array.from({ length: 60 }, (_, i) => ({ id: String(i), orderId: 'o', amountMinor: 100, currency: 'USD', receivedAt: new Date(`2026-10-${String(1 + i % 10).padStart(2, '0')}T12:00:00Z`) }));
  const calls = new Map(); let active = 0, peak = 0;
  const r = await projectFiscalReport(source, { month: '2026-10', currency: 'UAH', range: 3 }, async (c,d) => {
    const key = c+':'+d; calls.set(key,(calls.get(key)??0)+1); active++; peak=Math.max(peak,active);
    await new Promise(resolve => setImmediate(resolve)); active--;
    if(d.endsWith('-05'))throw Error('offline');return rate(c,d);
  }, now);
  assert.equal(calls.size, 10); assert.ok([...calls.values()].every(n => n === 1));
  assert.ok(peak > 1 && peak <= 4); assert.equal(r.current.receivedMinor, 300000);
  assert.deepEqual(r.presentationFx,[{month:'2026-10',requestedDate:'2026-10-05',effectiveDate:'2026-10-04',provisional:false}]);
});

test('historical lookup time budget leaves honest pending instead of a multi-minute request', async t => {
  const { projectFiscalReport } = load('finance/finance-fiscal-model.ts');
  const source = data(); source.expenses = []; source.ledger.months[2].entries = [];
  source.payments = Array.from({ length: 25 }, (_, i) => ({ id: String(i), orderId: 'o', amountMinor: 100, currency: 'USD', receivedAt: new Date(`2026-10-${String(1+i).padStart(2,'0')}T12:00:00Z`) }));
  let elapsed = 0, calls = 0;
  t.mock.method(Date, 'now', () => elapsed);
  const r = await projectFiscalReport(source, { month: '2026-10', currency: 'UAH', range: 3 }, async (c,d) => { calls++;elapsed += 8000;return rate(c,d); }, now);
  assert.ok(calls <= 4); assert.equal(r.current.receivedMinor, null);
  assert.ok(r.missing.some(x => x.code === 'FX_LOOKUP_BUDGET_EXCEEDED'));
});

test('report and export cache both historical successes and short-lived failures across reads', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: now.getTime() });
  const { FinanceReportService } = load('finance/finance-report.service.ts'), { TaxesService } = load('taxes/taxes.service.ts');
  const policy = { id: 'policy', state: 'PUBLISHED', effectiveFrom: '2026-05-01', group: 3, unifiedMode: 'PERCENT' };
  const root = entry('root', null, { paymentId: null, orderId: null, kind: 'ROOT', component: 'ESV', snapshot: { month: '2026-10', policy } });
  const final = entry('monthly', 190234, { paymentId: null, orderId: null, component: 'ESV', snapshot: { basis: { wage: { minor: 864700 } } } });
  let inTx = false, count = 0, fail = true;
  const tx = { appSetting: { findMany: async () => [] }, order: { findMany: async () => [] }, payment: { findMany: async () => [] }, expense: { findMany: async () => [] }, invoice: { findMany: async () => [] }, expenseCategory: { findMany: async () => [] }, $executeRawUnsafe: async () => 0,
    $queryRawUnsafe: async (sql, ...args) => {
      if (sql.includes('AppSetting')) return [{ value: { enabled: true, revision: 1 } }];
      if (sql.includes('TaxPolicy')) return [policy];
      if (sql.includes('TaxPeriod') && !sql.includes('JOIN')) return args[0] === '2026-10' ? [{ id: 'oct', month: '2026-10', state: 'OPEN', snapshot: { policy } }] : [];
      if (sql.includes('JOIN')) return args[0] === '2026-10' ? [root,final] : [];
      if (sql.includes('kind=\'ROOT\'')) return args[0]?.includes('root') ? [root] : [];
      if (sql.includes('IN(\'FINALIZE\'')) return [final];
      return [];
    } };
  const prisma = { $transaction: async fn => { inTx = true;try { return await fn(tx); } finally { inTx = false; } } };
  const service = new FinanceReportService(prisma, new TaxesService(prisma, { rate: async (c,d) => { assert.equal(inTx,false);count++;if(fail)throw Error('offline');return rate(c,d); } }));
  const q = { month: '2026-10', currency: 'EUR', range: 3 };
  const first = await service.report(q); assert.equal(first.fiscal.rows[0].amountMinor,null);
  await service.report(q,true); assert.equal(count,32);
  fail=false;t.mock.timers.tick(31000);
  const refreshed=await service.report(q);assert.equal(refreshed.fiscal.rows[0].amountMinor,3805);assert.equal(count,33);
  await service.report(q,true);assert.equal(count,33);
});

test('receipt restore uses recognized income date and independent adjustment uses explicit posting evidence', async () => {
  const { projectFiscalReport } = load('finance/finance-fiscal-model.ts');
  const source = data(); source.ledger.months[2].entries = [entry('restore', 10000, { kind: 'RESTORE', snapshot: { lifecycle: true, incomeDate: '2026-10-12', postingPeriod: '2026-10' } }), entry('adjustment', -5000, { kind: 'ADJUST', snapshot: { independentCorrection: true, incomeDate: '2026-05-01', postingDate: '2026-10-15', evidence: 'approved' } })];
  const r = await projectFiscalReport(source, { month: '2026-10', currency: 'EUR', range: 3 }, rate, now);
  assert.equal(r.rows[0].valuationDate, '2026-10-12'); assert.equal(r.rows[0].valuationBasis, 'INCOME_DATE');
  assert.equal(r.rows[1].valuationDate, '2026-10-15'); assert.equal(r.rows[1].valuationBasis, 'POSTING_EVIDENCE');
});

test('monthly obligations have no invented UNKNOWN sales-source attribution', async () => {
  const { projectFiscalReport, fiscalTaxTable } = load('finance/finance-fiscal-model.ts');
  const source=data();source.orderSources.o='UNKNOWN';source.ledger.months[2].entries.push(entry('global-esv',190234,{paymentId:null,orderId:null,component:'ESV',snapshot:{basis:{wage:{minor:864700}}}}));
  const r=await projectFiscalReport(source,{month:'2026-10',currency:'UAH',range:3},rate,now);
  assert.equal(fiscalTaxTable(r,{source:'UNKNOWN'}).total,1);
  assert.equal(fiscalTaxTable(r,{}).total,2);
  assert.equal(r.current.accruedTaxesMinor,2241234);
});

test('immutable finalized and closed NBU evidence is reused offline; another target currency alone needs lookup', async () => {
  const { projectFiscalReport } = load('finance/finance-fiscal-model.ts');
  const source = data(), stored = { numerator:'500000',denominator:'10000',provider:'NBU',currency:'EUR',incomeDate:'2026-10-12',effectiveDate:'2026-10-12',url:'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=EUR&date=20261012&json',raw:'[{"cc":"EUR","rate":50.0000,"exchangedate":"12.10.2026"}]',fetchedAt:'2026-10-12T12:00:00Z' };
  source.ledger.months[2].entries[0].snapshot.rate=stored;
  const before=JSON.stringify(source);let calls=0;
  const offline=await projectFiscalReport(source,{month:'2026-10',currency:'EUR',range:3},async()=>{calls++;throw Error('offline');},now);
  assert.equal(offline.current.resultAfterAccrualMinor,369180);assert.equal(calls,0);
  assert.equal(offline.rows[0].fxEvidence.display.fetchedAt,stored.fetchedAt);
  const currencies=[];
  await projectFiscalReport(source,{month:'2026-10',currency:'USD',range:3},async(c,d)=>{currencies.push(c);return rate(c,d);},now);
  assert.deepEqual(currencies,['USD']);assert.equal(JSON.stringify(source),before);
  source.ledger.months[2].periods[0].state='CLOSED';source.ledger.months[2].periods[0].closedSnapshot={entries:[JSON.parse(JSON.stringify(source.ledger.months[2].entries[0]))]};
  delete source.ledger.months[2].entries[0].snapshot.rate;
  const closed=await projectFiscalReport(source,{month:'2026-10',currency:'EUR',range:3},async()=>{throw Error('offline');},now);
  assert.equal(closed.current.accruedTaxesMinor,41020);
  source.ledger.months[2].periods[0].closedSnapshot.entries[0].snapshot.rate.raw='[{"cc":"EUR","rate":50,"rate":60,"exchangedate":"12.10.2026"}]';
  const invalid=await projectFiscalReport(source,{month:'2026-10',currency:'EUR',range:3},async()=>{throw Error('offline');},now);
  assert.equal(invalid.current.accruedTaxesMinor,null);
});

test('expense table, recent map, pie and export share historical amounts while legacy amounts remain unchanged', async () => {
  const { projectFiscalReport } = load('finance/finance-fiscal-model.ts'), { buildFinanceReport,financeReportCsv } = load('finance/finance-report-model.ts');
  const source=data();source.expenses=[{id:'expense',categoryId:'fabric',category:{name:'Ткань'},amountMinor:10000,currency:'UAH',incurredAt:nowForOctober(),orderId:null}];
  const calls=[];
  const fiscal=await projectFiscalReport(source,{month:'2026-10',currency:'EUR',range:3},async(c,d)=>{calls.push(c+':'+d);return rate(c,d);},now);
  const row=fiscal.expenseValues.find(e=>e.expenseId==='expense');
  assert.equal(row.amountMinor,200);assert.equal(row.valuationDate,'2026-10-12');
  assert.equal(fiscal.current.ordinaryExpensesMinor,200);
  assert.equal(fiscal.expenseStructure.rows.find(r=>r.kind==='EXPENSE').amountMinor,200);
  assert.equal(calls.filter(k=>k==='EUR:2026-10-12').length,1);
  const cache={version:1,provider:'NBU',officialUrl:'synthetic',effectiveDate:'2026-11-03',fetchedAt:now.toISOString(),rates:[{baseCurrency:'EUR',quoteCurrency:'UAH',numerator:'40',denominator:'1',decimal:'40',sourceSeriesOrValcode:'EUR'}]};
  const legacy=buildFinanceReport({...source,orders:[],payments:[],invoices:[],categories:[]},{month:'2026-10',currency:'EUR',tab:'expenses'},{provider:'NBU',cache},now);
  assert.equal(legacy.table.rows[0].amountMinor,250);
  const csv=financeReportCsv(legacy,'expenses',fiscal.expenseValues);
  assert.match(csv,/Историческая сумма/);assert.match(csv,/"2,50"/);assert.match(csv,/"2,00"/);assert.match(csv,/2026-10-12/);
});

test('known provisional receipt amounts and later unresolved source retain incomplete row status', async () => {
  const { projectFiscalReport }=load('finance/finance-fiscal-model.ts');const source=data();
  source.ledger.months[2].entries[0].snapshot.receiptConfirmed=false;source.ledger.months[2].incomplete=true;
  const r=await projectFiscalReport(source,{month:'2026-10',currency:'UAH',range:3},rate,now);
  assert.equal(r.rows[0].amountMinor,2051000);assert.equal(r.rows[0].status,'RECEIPT_CONFIRMATION_REQUIRED');assert.equal(r.rows[0].incomplete,true);
  source.ledger.months[2].entries[0].snapshot.receiptConfirmed=true;
  source.ledger.months[2].pendingStatuses=[{rootId:'root',paymentId:'p',status:'CLOSED_PERIOD_RECONCILIATION_REQUIRED'}];
  const later=await projectFiscalReport(source,{month:'2026-10',currency:'UAH',range:3},rate,now);
  assert.equal(later.rows[0].status,'CLOSED_PERIOD_RECONCILIATION_REQUIRED');assert.equal(later.rows[0].incomplete,true);
});

test('Kyiv expense table, recents, filters and export include previous UTC-month edge from the same conversion', async () => {
  const { projectFiscalReport }=load('finance/finance-fiscal-model.ts'),{appendFiscalCsv}=load('finance/finance-fiscal-csv.ts');
  const source=data();source.payments=[];source.ledger.months=[month('2026-04'),month('2026-05'),month('2026-06')];
  const e=(id,incurredAt,amountMinor)=>({id,categoryId:'fabric',category:{name:'Ткань'},orderId:'o',order:{number:'400EUR'},orderShipment:{id:'shipment'},notes:'needle',currency:'UAH',amountMinor,incurredAt:new Date(incurredAt)});
  source.expenses=[e('june-edge','2026-05-31T22:30:00Z',10000),e('july-edge','2026-06-30T22:30:00Z',40000),...Array.from({length:10},(_,i)=>e('june-'+i,'2026-06-10T12:00:00Z',5000))];
  const calls=[];const q={month:'2026-06',currency:'EUR',range:3,tab:'expenses',sort:'amount',direction:'desc',pageSize:10,page:1,categoryId:'fabric',source:'WEBSITE',search:'needle',from:'2026-06-01',to:'2026-06-30'};
  const build=(extra={},exportAll=false)=>projectFiscalReport(source,{...q,...extra},async(c,d)=>{calls.push(c+':'+d);return rate(c,d);},now,undefined,exportAll);
  const r=await build();assert.equal(r.current.ordinaryExpensesMinor,1200);
  assert.equal(r.expenseTable.total,11);assert.equal(r.expenseTable.rows.length,10);
  const edge=r.expenseTable.rows[0];assert.equal(edge.id,'june-edge');assert.equal(edge.amountMinor,200);
  assert.equal(edge.date,'2026-06-01');assert.equal(edge.originalTimestamp,'2026-05-31T22:30:00.000Z');assert.equal(edge.originalAmountMinor,10000);assert.equal(edge.shipmentId,'shipment');
  assert.ok(r.recentExpenses.every(e=>e.date.startsWith('2026-06')));assert.ok(!r.recentExpenses.some(e=>e.id==='july-edge'));
  assert.equal(calls.filter(k=>k==='EUR:2026-06-01').length,1);
  assert.equal((await build({page:2})).expenseTable.rows.length,1);
  const exported=await build({},true);assert.equal(exported.expenseTable.rows.length,11);
  const csv=appendFiscalCsv('legacy columns remain',exported,[],true);assert.match(csv,/Расходы по календарю Киева/);assert.match(csv,/june-edge/);
  const fiscalSection=csv.split('Расходы по календарю Киева')[1];assert.ok(!fiscalSection.includes('july-edge'));
  assert.equal((await build({from:'2026-06-02'})).expenseTable.total,10);
});


test('receipt lifecycle ADJUST including zero uses recognized income day, distinct from explicit correction and monthly obligation', async () => {
 const {projectFiscalReport}=load('finance/finance-fiscal-model.ts');
 const source=data(); source.payments=[]; source.expenses=[];
 source.ledger.months[2].entries=[
  entry('receipt-adjust',10000,{kind:'ADJUST',snapshot:{lifecycle:true,incomeDate:'2026-10-12',postingPeriod:'2026-10',receiptConfirmed:true}}),
  entry('receipt-zero',0,{kind:'ADJUST',snapshot:{lifecycle:true,incomeDate:'2026-10-12',postingPeriod:'2026-10',receiptConfirmed:true}}),
  entry('manual-adjust',10000,{kind:'ADJUST',snapshot:{independentCorrection:true,incomeDate:'2026-10-12',postingDate:'2026-10-20',postingPeriod:'2026-10'}}),
  entry('exemption',-10000,{kind:'ADJUST',paymentId:null,component:'ESV',snapshot:{exemption:true,postingPeriod:'2026-10'}}),
  entry('monthly-esv',10000,{paymentId:null,component:'ESV',snapshot:{month:'2026-10'}}),
 ];
 const requested=[];
 const result=await projectFiscalReport(source,{month:'2026-10',currency:'EUR',range:3},async(c,d)=>{requested.push(d);return {...await rate(c,d),numerator:d==='2026-10-12'?'50':'100'}},now);
 const row=id=>result.rows.find(r=>r.id===id);
 assert.equal(row('receipt-adjust').valuationDate,'2026-10-12');assert.equal(row('receipt-adjust').valuationBasis,'INCOME_DATE');assert.equal(row('receipt-adjust').amountMinor,200);
 assert.equal(row('receipt-zero').valuationDate,'2026-10-12');assert.equal(row('receipt-zero').amountMinor,0);
 assert.equal(row('manual-adjust').valuationDate,'2026-10-20');assert.equal(row('manual-adjust').valuationBasis,'POSTING_EVIDENCE');assert.equal(row('manual-adjust').amountMinor,100);
 assert.equal(row('exemption').valuationDate,'2026-10-31');assert.equal(row('exemption').valuationBasis,'POSTING_EVIDENCE');assert.equal(row('exemption').amountMinor,-100);
 assert.equal(row('monthly-esv').valuationDate,'2026-10-31');assert.equal(row('monthly-esv').valuationBasis,'PERIOD_END_PRESENTATION');assert.equal(row('monthly-esv').amountMinor,100);
 assert.equal(result.current.accruedTaxesMinor,300);assert.deepEqual([...new Set(requested)].sort(),['2026-10-12','2026-10-20','2026-10-31']);
});

 test('expense fallback keeps recognition date and original UAH amount separate from actual FX day',async()=>{
 const {projectFiscalReport}=load('finance/finance-fiscal-model.ts');const source=data();source.payments=[];source.expenses=[{...source.expenses[0],currency:'UAH',amountMinor:10000}];source.ledger.months[2].entries=[];
 const before=JSON.stringify(source);const r=await projectFiscalReport(source,{month:'2026-10',currency:'EUR',range:3},async(c,d)=>{if(d==='2026-10-12')throw Error('not published');return rate(c,d);},now);
 assert.equal(r.expenseTable.rows[0].date,'2026-10-12');assert.equal(r.expenseTable.rows[0].valuationDate,'2026-10-11');assert.equal(r.expenseTable.rows[0].amountMinor,200);assert.equal(r.expenseTable.rows[0].originalAmountMinor,10000);assert.equal(r.current.ordinaryExpensesMinor,200);assert.equal(JSON.stringify(source),before);
 });
