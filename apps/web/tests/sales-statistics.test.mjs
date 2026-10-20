import test from 'node:test';
import assert from 'node:assert/strict';
import * as sales from '../lib/sales-statistics.ts';
import { parseSalesSelection, salesApiQuery, salesUrl, shiftSalesPeriod, salesMoney, salesExportFilename, salesCountrySeries } from '../lib/sales-statistics.ts';

test('default is twelve calendar months through current month in Kyiv', () => {
  const state = parseSalesSelection('', new Date('2026-10-18T10:00:00Z'));
  assert.equal(state.from, '2025-11-01'); assert.equal(state.to, '2026-10-31');
});

test('archived receipt links retain audit identity but open the client; accountant stays in analytics', () => {
  const row = { orderId: 'old-order', clientId: 'canonical-client', orderArchived: true };
  assert.equal(typeof sales.salesRecordTarget, 'function');
  assert.deepEqual(sales.salesRecordTarget(row, true), { section: 'clients', id: 'canonical-client' });
  assert.deepEqual(sales.salesRecordTarget({ ...row, orderArchived: false }, true), { section: 'orders', id: 'old-order' });
  assert.deepEqual(sales.salesRecordTarget({ orderId: 'legacy-order', clientId: 'c' }, true), { section: 'orders', id: 'legacy-order' });
  assert.equal(sales.salesRecordTarget(row, false), null);
  assert.equal(sales.salesRecordTarget({ ...row, clientId: null }, true), null);
});
test('clamps invalid enums, dates and pagination; never consumes global tab', () => {
  const state = parseSalesSelection('?tab=clients&statTab=invalid&statMonths=5&statPage=-3&from=2026-02-30&statMetric=bogus', new Date('2026-10-18T10:00:00Z'));
  assert.equal(state.tab,'countries'); assert.equal(state.months,6); assert.equal(state.page,1);
  assert.equal(state.metric,'orders'); assert.equal(state.from,'2025-11-01');
});
test('URL roundtrip preserves unrelated route state and every applied selection', () => {
  const state = parseSalesSelection('?from=2026-01-03&to=2026-06-24&currency=USD&statTab=clients&source=OTHER&statPage=3&statDirection=asc&statRanking=received&statRepeat=repeat&statDrill=clients&country=UNKNOWN&statScope=all');
  const url = salesUrl('/?section=overview&tab=legacy&theme=light',state);
  assert.deepEqual(parseSalesSelection(url.split('?')[1]),state);
  assert.equal(new URL(url,'https://crm.test').searchParams.get('tab'),'legacy');
  const api = salesApiQuery(state,'manifest-1');
  assert.equal(api.get('tab'),'clients'); assert.equal(api.get('valuationVersion'),'manifest-1');
  assert.equal(api.has('statTab'),false); assert.equal(api.has('section'),false);
});
test('period arrows shift an inclusive span of calendar months, clamping month ends', () => {
  const full = parseSalesSelection('?from=2025-11-01&to=2026-10-31');
  assert.deepEqual(shiftSalesPeriod(full,1),{from:'2026-11-01',to:'2027-10-31'});
  const partial = parseSalesSelection('?from=2026-01-31&to=2026-02-28');
  assert.deepEqual(shiftSalesPeriod(partial,1),{from:'2026-03-31',to:'2026-04-30'});
});
test('money distinguishes missing valuation from actual zero, filename cannot contain path characters', () => {
  assert.equal(salesMoney(null,'EUR'),'—'); assert.notEqual(salesMoney(0,'EUR'),'—');
  assert.match(salesExportFilename(parseSalesSelection('')), /^sales-statistics_[\d-]+_[\d-]+_EUR\.csv$/);
});
test('page size follows server enum rather than accepting arbitrary integers', () => {
  for (const size of [10,25,50,100]) assert.equal(parseSalesSelection(`statPageSize=${size}`).pageSize,size);
  for (const size of [0,1,20,30,101,-1,'nope']) assert.equal(parseSalesSelection(`statPageSize=${size}`).pageSize,25);
  assert.equal(parseSalesSelection('').pageSize,25);
});
test('new client cohorts, cash drill and original top-five complement survive URL and API serialization', () => {
  for(const repeat of ['new-client','returning-client']){
    const state=parseSalesSelection(`?statRepeat=${repeat}&statDrill=payments&country=OTHERS%3AFR%2CUS%2CDE%2CNL%2CUNKNOWN`);
    assert.equal(state.repeat,repeat);assert.equal(state.drill,'payments');assert.equal(state.country,'OTHERS:FR,US,DE,NL,UNKNOWN');
    assert.deepEqual(parseSalesSelection(salesUrl('/',state).split('?')[1]),state);
    assert.equal(salesApiQuery(state).get('country'),'OTHERS:FR,US,DE,NL,UNKNOWN');
  }
});
test('country series has exactly top five plus a real summed Others with pinned complementary keys', () => {
  const groups=['FR','US','DE','NL','ES','BE','UNKNOWN'].map((key,index)=>({key,label:key,orders:10-index,pieces:(10-index)*2,amountMinor:index===6?null:100}));
  const months=[{month:'2026-10',countries:groups.map(g=>({...g,orders:g.key==='BE'?50:1,pieces:g.key==='BE'?100:2}))}];
  const orders=salesCountrySeries(groups,months,'orders');
  assert.equal(orders.length,6);assert.deepEqual(orders.map(s=>s.key),['FR','US','DE','NL','ES','OTHERS:FR,US,DE,NL,ES']);
  assert.equal(orders[5].values[0],51);
  assert.equal(salesCountrySeries(groups,months,'pieces')[5].values[0],102);
  assert.equal(salesCountrySeries(groups,months,'amount')[5].values[0],null);
  assert.equal(salesCountrySeries(groups.slice(0,5),months,'orders').length,5);
});


test('sales rankings omit cash-only zero-order groups without losing receipt rankings or incomplete valuations', () => {
  const rows = [{key:'sale',orders:1,pieces:0,amountMinor:0,receiptCount:0}, {key:'cash',orders:0,pieces:0,amountMinor:0,receiptCount:2}, {key:'missing',orders:1,pieces:2,amountMinor:null,receiptCount:1}];
  assert.equal(typeof sales.salesTableGroups, 'function');
  assert.deepEqual(sales.salesTableGroups(rows, false).map(r=>r.key), ['sale','missing']);
  assert.deepEqual(sales.salesTableGroups(rows, true).map(r=>r.key), ['sale','cash','missing']);
  assert.equal(rows.length,3);
});

test('normal unallocated overhead is informational; missing FX and unknown issues remain warnings', () => {
  assert.equal(typeof sales.salesWarningTone, 'function');
  for(const code of ['UNALLOCATED_EXPENSES_INCLUDED','UNALLOCATED_EXPENSES_EXCLUDED']) assert.equal(sales.salesWarningTone(code),'blue');
  for(const code of ['MISSING_EXCHANGE_RATE','MISSING_APPLIED_PAYMENT','ITEM_INSTANCE_MISMATCH','NEW_UNKNOWN_WARNING']) assert.equal(sales.salesWarningTone(code),'orange');
});
