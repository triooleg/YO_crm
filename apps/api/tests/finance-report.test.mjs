import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
function load(path) {
  const filename = new URL(path, import.meta.url);
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
  vm.runInNewContext(source,{module,exports:module.exports,require:(name)=>name==='@nestjs/common'?{BadRequestException:Error,ConflictException:Error,ServiceUnavailableException:Error,Injectable:()=>x=>x}:name==='../orders/order-source'?load('../src/orders/order-source.ts'):name==='./exchange-rates'?load('../src/finance/exchange-rates.ts'):name==='../prisma.service'?{}:require(name),Date,Intl,Buffer,console});
  return module.exports;
}
const report = load('../src/finance/finance-report-model.ts');
const date = value => new Date(value);
const now = date('2026-10-15T10:00:00Z');
const cache = {version:1,provider:'NBU',officialUrl:'https://bank.gov.ua',effectiveDate:'2026-10-15',fetchedAt:now.toISOString(),rates:[{baseCurrency:'EUR',quoteCurrency:'UAH',numerator:'50',denominator:'1',decimal:'50',sourceSeriesOrValcode:'EUR'},{baseCurrency:'USD',quoteCurrency:'UAH',numerator:'40',denominator:'1',decimal:'40',sourceSeriesOrValcode:'USD'}]};
const payment = (id, amountMinor, currency='EUR', receivedAt='2026-10-01T00:00:00Z',extra={})=>({id,orderId:'o',amountMinor,currency,receivedAt:date(receivedAt),method:'BANK_TRANSFER',...extra});
const order = extra=>({id:'o',number:'KC-602',clientId:'c',client:{displayName:'Клиент'},priceMinor:10000,currency:'EUR',salesStatus:'NEW_LEAD',paymentStatus:'PARTIAL',shippingStatus:'NOT_READY',requiredDeliveryAt:date('2026-10-20T12:00:00Z'),...extra});
const expense = (id,amountMinor,currency='EUR')=>({id,categoryId:'delivery',category:{name:'Доставка'},amountMinor,currency,incurredAt:date('2026-10-10T12:00:00Z'),orderId:'o',order:{number:'KC-602'},orderShipment:{id:'s'}});
const base = extra=>({orders:[order()],payments:[payment('p',2000)],expenses:[expense('e',1000)],invoices:[],categories:[{id:'delivery',name:'Доставка'}],...extra});
const build = (data=base(),query={})=>report.buildFinanceReport(data,{month:'2026-10',currency:'EUR',range:6,tab:'payments',page:1,pageSize:10,...query},{provider:'NBU',cache},now);
test('report conversion is exact half-up, supports aggregate range and fails on unsafe totals',()=>{
  assert.equal(report.convertReportMinor(1,{numerator:'1',denominator:'2'}),1);
  assert.equal(report.convertReportMinor(3_000_000_000,{numerator:'1',denominator:'1'}),3_000_000_000);
  assert.throws(()=>report.convertReportMinor(Number.MAX_SAFE_INTEGER,{numerator:'2',denominator:'1'}));
});
test('mixed original receipts counted once; applied snapshot settles order only; shipping expense once',()=>{
  const result=build(base({payments:[payment('p',2500,'USD',undefined,{appliedCurrency:'EUR',appliedAmountMinor:2000})],expenses:[expense('e',1250,'USD')]}));
  assert.equal(result.current.receivedMinor,2000);
  assert.equal(result.current.expensesMinor,1000);
  assert.equal(result.current.resultMinor,1000);
  assert.equal(result.table.rows[0].paidMinor,2000);
  assert.equal(result.categoryBreakdown[0].amountMinor,result.current.expensesMinor);
  assert.equal(result.debtMinor,8000);
  assert.equal(result.forecastMinor,8000);
  assert.equal(result.table.rows[0].number,'KC-602');
});

test('cash income, monthly trend and result use only actual active original receipts',()=>{
  const data=base({
    orders:[order({priceMinor:1000000}),order({id:'unpaid',priceMinor:2000000,paymentStatus:'UNPAID'})],
    payments:[],
    invoices:['DRAFT','ISSUED','PAID'].map((status,index)=>({id:`invoice-${index}`,number:`INV-${index}`,orderId:'o',order:{number:'KC-602',clientId:'c',client:{displayName:'Клиент'}},issueDate:now,currency:'EUR',totalMinor:500000,status})),
  });
  const snapshot=JSON.stringify(data);
  for(const [currency,received,previous,expenses] of [['EUR',2000,300,1000],['USD',2500,375,1250],['UAH',100000,15000,50000]]){
    const empty=build(data,{currency});
    assert.equal(empty.current.receivedMinor,0);
    assert.equal(empty.current.resultMinor,-expenses);
    assert.ok(empty.debtMinor>0&&empty.forecastMinor>0&&empty.invoiceTotalMinor>0);
    assert.ok(empty.monthlyTrend.every(month=>month.receivedMinor===0));
    const paid=build({...data,payments:[
      payment('actual',2500,'USD',undefined,{appliedCurrency:'EUR',appliedAmountMinor:1999}),
      payment('previous',300,'EUR','2026-09-30T23:59:59Z'),
      payment('future',500,'EUR','2026-11-01T00:00:00Z'),
      payment('voided',999999,'EUR',undefined,{voidedAt:now}),
    ]},{currency});
    assert.equal(paid.current.receivedMinor,received);
    assert.equal(paid.current.resultMinor,received-expenses);
    assert.equal(paid.previous.receivedMinor,previous);
    assert.equal(paid.previous.resultMinor,previous);
    assert.deepEqual(Array.from(paid.monthlyTrend,month=>[month.month,month.receivedMinor,month.resultMinor]),[
      ['2026-05',0,0],['2026-06',0,0],['2026-07',0,0],['2026-08',0,0],
      ['2026-09',previous,previous],['2026-10',received,received-expenses],
    ]);
    assert.equal(paid.table.rows.find(row=>row.id==='o').originalPaidMinor,2799);
  }
  assert.equal(JSON.stringify(data),snapshot);
});
test('half-open months, void/archive exclusions, current debt cohort and forecast horizon',()=>{
  const result=build(base({orders:[order(),order({id:'cancel',salesStatus:'CANCELLED'}),order({id:'completed',salesStatus:'COMPLETED'}),order({id:'refunded',paymentStatus:'REFUNDED'}),order({id:'returned',shippingStatus:'RETURNED'}),order({id:'old',requiredDeliveryAt:date('2026-10-01T00:00:00Z')})],payments:[payment('a',300,'EUR','2026-09-30T23:59:59Z'),payment('b',200),payment('void',999,'EUR',undefined,{voidedAt:now}),payment('next',500,'EUR','2026-11-01T00:00:00Z')],expenses:[expense('e',1000),{...expense('arch',999),archivedAt:now}]}));
  assert.equal(result.current.receivedMinor,200);
  assert.equal(result.previous.receivedMinor,300);
  assert.equal(result.current.resultMinor,-800);
  assert.equal(result.debtMinor,19000);
  assert.equal(result.forecastMinor,9000);
});
test('archived orders contribute no payments, expenses, invoices, debt or source analytics',()=>{
  const archivedOrder=order({id:'archived',number:'YO-ARCHIVED',archivedAt:now,priceMinor:50000});
  const archivedExpense={...expense('archived-expense',700),orderId:'archived',order:{number:'YO-ARCHIVED'}};
  const archivedInvoice={id:'archived-invoice',number:'INV-ARCHIVED',orderId:'archived',order:{number:'YO-ARCHIVED',clientId:'c',client:{displayName:'Клиент'}},issueDate:now,currency:'EUR',totalMinor:5000,status:'ISSUED'};
  const result=build(base({
    orders:[order(),archivedOrder],
    payments:[payment('active-payment',2000),payment('archived-payment',5000,'EUR',undefined,{orderId:'archived'})],
    expenses:[expense('active-expense',1000),archivedExpense],
    invoices:[archivedInvoice],
    orderSources:{o:'MANUAL',archived:'WEBSITE'},
  }));
  assert.equal(result.current.receivedMinor,2000);
  assert.equal(result.current.expensesMinor,1000);
  assert.equal(result.current.resultMinor,1000);
  assert.equal(result.sourceAnalytics.websiteReceivedMinor,0);
  assert.equal(result.invoiceCount,0);
  assert.equal(result.table.rows.some(row=>row.id==='archived'),false);
});
test('missing applied evidence and stale/missing/unsupported rates never become zero',()=>{
  assert.throws(()=>build(base({payments:[payment('p',100,'USD')]})),/применён/);
  assert.throws(()=>report.buildFinanceReport(base({expenses:[expense('e',100,'USD')]}),{month:'2026-10',currency:'EUR'},{provider:'NBU',cache:null},now),/курс/);
  assert.throws(()=>report.buildFinanceReport(base({expenses:[expense('e',100,'USD')]}),{month:'2026-10',currency:'EUR'},{provider:'NBU',cache:{...cache,effectiveDate:'2026-09-01'}},now),/устарел/);
});
test('all currency outputs, filters, stable pagination and CSV agree without mutations',()=>{
  const data=base(),snapshot=JSON.stringify(data);
  const eur=build(data),usd=build(data,{currency:'USD'}),uah=build(data,{currency:'UAH'});
  assert.equal(usd.current.receivedMinor,2500);assert.equal(uah.current.receivedMinor,100000);
  assert.equal(usd.table.rows[0].balanceMinor,10000);
  assert.equal(usd.recentExpenses[0].amountMinor,1250);
  assert.equal(usd.monthlyTrend.at(-1).expensesMinor,1250);
  assert.equal(usd.forecastMinor,usd.upcoming[0].balanceMinor);
  assert.equal(build(data,{search:'absent'}).table.total,0);
  assert.equal(build(data,{search:'absent'}).current.receivedMinor,eur.current.receivedMinor);
  assert.equal(build(data,{from:'2026-10-02'}).table.total,0);
  assert.equal(JSON.stringify(data),snapshot);
  const csv=report.financeReportCsv(usd,'payments');assert.match(csv,/USD/);assert.match(csv,/100,00/);
  assert.match(report.csvCell('=SUM(A1)'),/^"'=/);
});
test('invoice paid/balance unknown unless PAID, cancelled not KPI; valuation conflicts explicit',()=>{
  const result=build(base({invoices:['DRAFT','PAID','CANCELLED'].map((status,index)=>({id:String(index),number:'INV-'+index,orderId:'o',order:{number:'KC-602',clientId:'c',client:{displayName:'Клиент'}},issueDate:now,currency:'EUR',totalMinor:500,status}))}),{tab:'invoices'});
  assert.equal(result.invoiceCount,2);assert.equal(result.invoiceTotalMinor,1000);assert.equal(result.unpaidInvoiceCount,1);
  assert.equal(result.table.rows.find(row=>row.status==='DRAFT').paidMinor,null);
  assert.equal(result.table.rows.find(row=>row.status==='PAID').balanceMinor,0);
  assert.throws(()=>build(base(),{valuationVersion:'outdated'}),/обнов/);
});
test('irrelevant closed foreign orders do not require FX or settlement evidence',()=>{
  const data=base({orders:[order(),order({id:'closed',salesStatus:'CANCELLED',currency:'UAH'})],payments:[payment('p',2000),payment('old',500,'USD','2020-01-01T00:00:00Z',{orderId:'closed'})]});
  const result=report.buildFinanceReport(data,{month:'2026-10',currency:'EUR'},{provider:'NBU',cache:null},now);
  assert.equal(result.table.total,1);assert.equal(result.debtMinor,8000);
  assert.throws(()=>report.buildFinanceReport({...data,payments:[...data.payments,payment('new',500,'USD',undefined,{orderId:'closed'})]},{month:'2026-10',currency:'EUR'},{provider:'NBU',cache:null},now),/курс/);
});
test('CSV preserves every supported minor unit at safe integer boundaries and signed adjustments',()=>{
  const result=build();result.table.rows=[{id:'huge',number:'KC-602',amountMinor:9007199254740990,paidMinor:0,balanceMinor:9007199254740990,roundingDifferenceMinor:-1}];
  const csv=report.financeReportCsv(result,'payments');
  assert.match(csv,/90071992547409,90/);assert.doesNotMatch(csv,/90071992547409,91/);assert.match(csv,/'-0,01/);
});
test('unsupported provider pair and invalid calendar inputs fail explicitly',()=>{
  const ecb={...cache,provider:'ECB',rates:[{baseCurrency:'EUR',quoteCurrency:'USD',numerator:'5',denominator:'4',decimal:'1.25',sourceSeriesOrValcode:'EXR'}]};
  assert.throws(()=>report.createReportConverter('UAH',{provider:'ECB',cache:ecb},now)(100,'EUR'),/не поддерживает/);
  for(const query of [{month:'2026-13'},{from:'2026-02-30'},{from:'2026-10-10',to:'2026-10-01'},{page:1.5},{sort:'DROP TABLE'},{status:'CANCELLED',tab:'payments'}])assert.throws(()=>build(base(),query));
});
test('export over documented ceiling fails, never silently truncates matching records',()=>{
  const data=base({expenses:Array.from({length:50001},(_,index)=>expense(String(index),1))});
  const page=build(data,{tab:'expenses'});assert.equal(page.table.total,50001);assert.equal(page.table.rows.length,10);
  assert.throws(()=>report.buildFinanceReport(data,{month:'2026-10',currency:'EUR',tab:'expenses'},{provider:'NBU',cache},now,true),/50 000/);
});


test('cancelled foreign invoice needs FX only when its document is requested',()=>{
  const invoice={id:'cancelled',number:'CANCELLED-USD',orderId:'o',order:order(),issueDate:now,totalMinor:1000,currency:'USD',status:'CANCELLED'};
  const data=base({invoices:[invoice]});
  const valuation={provider:'NBU',cache:null};
  for(const tab of ['payments','expenses']) for(const exportAll of [false,true]) {
    const result=report.buildFinanceReport(data,{month:'2026-10',currency:'EUR',tab},valuation,now,exportAll);
    assert.equal(result.current.receivedMinor,2000);
    assert.equal(result.current.expensesMinor,1000);
    assert.equal(result.invoiceCount,0);
  }
  assert.throws(()=>report.buildFinanceReport(data,{month:'2026-10',currency:'EUR',tab:'invoices'},valuation,now),/курс/);
  const visible=build(data,{tab:'invoices'});
  assert.equal(visible.table.rows[0].status,'CANCELLED');
  assert.equal(visible.table.rows[0].amountMinor,800);
  assert.equal(visible.invoiceCount,0);
  assert.throws(()=>report.buildFinanceReport(base({invoices:[{...invoice,status:'ISSUED'}]}),{month:'2026-10',currency:'EUR'},valuation,now),/курс/);
});

test('tax cash expense deep link finds its exact source by ID without changing cash totals or partial search',()=>{
 const data=base({expenses:[expense('tax-cash-source',1000),expense('other',500)]});
 const linked=build(data,{tab:'expenses',search:'tax-cash-source'});
 assert.equal(linked.table.total,1);assert.equal(linked.table.rows[0].id,'tax-cash-source');assert.equal(linked.current.expensesMinor,1500);
 assert.equal(build(data,{tab:'expenses',search:'tax-cash'}).table.total,0);
});
