import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');
const compile = name => ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const labels = url(compile('i18n'));
const report = url(compile('finance-report').replaceAll("'./order-source-values.mjs'", JSON.stringify(new URL('../lib/order-source-values.mjs', import.meta.url).href)));
const { fiscalReceiptConfirmationCount, fiscalPresentationNotice, fiscalAmountLabel, fiscalComparison, fiscalExpenseAmount, financeExpenseTable, financeRecentExpenses } = await import(url(compile('finance-tax-integration').replaceAll("'./finance-report'", JSON.stringify(report)).replaceAll("'./i18n'", JSON.stringify(labels))));

test('unknown fiscal amounts are visibly distinct from real zero amounts', () => {
  assert.equal(fiscalAmountLabel(null, 'EUR'), 'Не рассчитано');
  assert.equal(fiscalAmountLabel(undefined, 'UAH'), 'Не рассчитано');
  assert.match(fiscalAmountLabel(0, 'EUR'), /0,00/);
  assert.match(fiscalAmountLabel(-1, 'USD'), /-0,01/);
});

test('no precise comparison is reported when either tax period is incomplete', () => {
  assert.equal(fiscalComparison(100, 50, true, false), null);
  assert.equal(fiscalComparison(100, null, false, false), null);
  assert.equal(fiscalComparison(369180, 351600, false, false), 5);
  assert.equal(fiscalComparison(100, 0, false, false), null);
});

test('expense display uses the same dated server value as fiscal totals, retaining unknown and zero', () => {
  const row={id:'expense-1',amountMinor:2400};
  assert.equal(fiscalExpenseAmount({fiscal:{expenseValues:[{expenseId:row.id,amountMinor:2000}]}},row),2000);
  assert.equal(fiscalExpenseAmount({fiscal:{expenseValues:[{expenseId:row.id,amountMinor:null}]}},row),null);
  assert.equal(fiscalExpenseAmount({fiscal:{expenseValues:[{expenseId:row.id,amountMinor:0}]}},row),0);
  assert.equal(fiscalExpenseAmount({fiscal:{expenseValues:[]}},row),null);
  assert.equal(fiscalExpenseAmount({},row),2400);
});


test('tax subsystem failure preserves legacy cash rows and pagination without pretending their valuation is historical', () => {
 const legacy={tab:'expenses',rows:[{id:'known-expense',amountMinor:2400}],page:2,pageSize:10,total:12};
 const recent=[legacy.rows[0]];
 const unavailable={missing:[{code:'FISCAL_UNAVAILABLE'}],expenseValues:[],expenseTable:{tab:'expenses',rows:[],page:1,pageSize:10,total:0},recentExpenses:[]};
 const report={table:legacy,recentExpenses:recent,fiscal:unavailable};
 assert.strictEqual(financeExpenseTable(report),legacy);
 assert.strictEqual(financeRecentExpenses(report),recent);
 assert.equal(fiscalExpenseAmount(report,legacy.rows[0]),null);
 const emptyFiscal={...unavailable,missing:[]};
 assert.strictEqual(financeExpenseTable({...report,fiscal:emptyFiscal}),emptyFiscal.expenseTable);
 assert.strictEqual(financeRecentExpenses({...report,fiscal:emptyFiscal}),emptyFiscal.recentExpenses);
});

 test('prior available rate notice exposes actual dates and distinguishes provisional current-month presentation',()=>{
 assert.equal(fiscalPresentationNotice({}), '');
 const row={month:'2026-10',requestedDate:'2026-10-31',effectiveDate:'2026-10-18',provisional:true};
 assert.match(fiscalPresentationNotice({fiscal:{presentationFx:[row]}}),/2026-10-18/);
 assert.match(fiscalPresentationNotice({fiscal:{presentationFx:[row]}}),/предварительное/);
 assert.doesNotMatch(fiscalPresentationNotice({fiscal:{presentationFx:[{...row,provisional:false}]}}),/предварительное/);
 });

test('receipt confirmation warning counts payments once across both tax components and event rows',()=>{
 const row={period:'2026-10',paymentId:'one-payment',status:'RECEIPT_CONFIRMATION_REQUIRED',source:'PENDING'};
 const fiscal={current:{month:'2026-10',incomplete:true},rows:[{...row,component:'UNIFIED',source:'RECEIPT'},{...row,component:'MILITARY',source:'PENDING'},row,{...row,period:'2026-09',paymentId:'older'},{...row,paymentId:'already-confirmed',status:'CALCULATED'}]};
 assert.equal(fiscalReceiptConfirmationCount({fiscal}),1);
 assert.equal(fiscalReceiptConfirmationCount({fiscal:{...fiscal,rows:[...fiscal.rows,{...row,paymentId:'second-payment'}]}}),2);
 assert.equal(fiscalReceiptConfirmationCount({fiscal:{...fiscal,rows:[...fiscal.rows,{...row,paymentId:'awaiting-rate',status:'NBU_RETRY_PENDING'}]},table:{rows:[]}}),1);
});

test('receipt warning ignores confirmed historical events while new receipts or FX keep the current month incomplete',()=>{
 const historical={period:'2026-10',paymentId:'confirmed-payment',source:'RECEIPT',status:'RECEIPT_CONFIRMATION_REQUIRED',kind:'FINALIZE',evidence:{receiptConfirmed:false}};
 const confirmed={...historical,kind:'ADJUST',status:'CALCULATED',evidence:{receiptConfirmed:true}};
 const fiscal={current:{month:'2026-10',incomplete:true},rows:[historical,{...historical,component:'MILITARY'},confirmed]};
 const before=structuredClone(fiscal);
 assert.equal(fiscalReceiptConfirmationCount({fiscal}),0);
 const pending={...historical,paymentId:'new-payment',source:'PENDING',kind:'PENDING'};
 assert.equal(fiscalReceiptConfirmationCount({fiscal:{...fiscal,rows:[...fiscal.rows,pending,{...pending,component:'MILITARY'}]}}),1);
 assert.equal(fiscalReceiptConfirmationCount({fiscal:{...fiscal,rows:[...fiscal.rows,{...pending,status:'NBU_RETRY_PENDING'}]}}),0);
 assert.deepEqual(fiscal,before);
});
test('complete, unavailable and unrelated pending tax reports never claim an unconfirmed receipt',()=>{
 assert.equal(fiscalReceiptConfirmationCount({}),0);
 assert.equal(fiscalReceiptConfirmationCount({fiscal:{current:{month:'2026-10',incomplete:false},rows:[{period:'2026-10',paymentId:'stale',status:'RECEIPT_CONFIRMATION_REQUIRED'}]}}),0);
 assert.equal(fiscalReceiptConfirmationCount({fiscal:{current:{month:'2026-10',incomplete:true},rows:[{period:'2026-10',paymentId:'missing-rate',status:'NBU_RETRY_PENDING'},{period:'2026-10',paymentId:null,status:'RECEIPT_CONFIRMATION_REQUIRED'}]}}),0);
});
