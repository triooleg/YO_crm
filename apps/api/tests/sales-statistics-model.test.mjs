import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cache = new Map();
function load(url) {
  if (cache.has(url.href)) return cache.get(url.href).exports;
  const module = { exports: {} }; cache.set(url.href, module);
  const source = ts.transpileModule(fs.readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: name => name.startsWith('.') ? load(new URL(name + '.ts', url)) : require(name), Date, Intl, console, Buffer });
  return module.exports;
}
const model = load(new URL('../src/overview/sales-statistics.model.ts', import.meta.url));
const now = new Date('2026-10-18T12:00:00Z');
const item = (extra = {}) => ({ id: 'i', quantity: 6, priceMinor: 100, discipline: 'RG', archivedAt: null, instances: [], ...extra });
const order = (extra = {}) => ({ id: 'o', number: 'YO-1', clientId: 'c', clientName: 'Клиент', createdAt: '2026-10-10T12:00:00Z', country: 'FR', orderSource: 'WEBSITE', type: 'CUSTOM', discipline: 'RG', priceMinor: 1001, currency: 'EUR', depositRequiredMinor: 500, salesStatus: 'NEW_LEAD', paymentStatus: 'UNPAID', shippingStatus: 'NOT_READY', archivedAt: null, items: [item()], ...extra });
const payment = (extra = {}) => ({ id: 'p', orderId: 'o', amountMinor: 300, currency: 'EUR', receivedAt: '2026-10-12T12:00:00Z', voidedAt: null, ...extra });
const sources = (extra = {}) => ({ orders: [order()], payments: [], expenses: [], redirects: [], clients: [{ id: 'c', displayName: 'Клиент' }], countryLabels: { FR: 'Франция' }, ...extra });
const query = (extra = {}) => ({ from: '2026-10-01', to: '2026-10-31', currency: 'EUR', source: '', status: '', clientId: '', country: '', orderType: '', discipline: '', tab: 'countries', months: 3, metric: 'orders', customerMetric: 'clients', revenueMetric: 'orders', ranking: 'amount', scope: 'sales', repeat: '', drill: 'orders', page: 1, pageSize: 10, sort: 'orders', direction: 'desc', ...extra });
const valuation = { provider: 'NBU', convert: amount => amount };
const build = (data = sources(), q = {}, financial = true, fx = valuation, exportAll = false) => model.buildSalesStatistics(data, query(q), financial, fx, now, exportAll);

test('cash, monthly customer cohorts and complementary geography drills match their chart predicates', () => {
  const data = sources({ clients: [{id:'c',displayName:'Old'}, {id:'n',displayName:'New'}], orders: [
    order({id:'september',createdAt:'2026-09-01T12:00:00Z'}),
    order({id:'o',country:'UA'}), order({id:'n1',clientId:'n',country:'US'}), order({id:'n2',clientId:'n',country:null}),
  ], payments:[payment({orderId:'september',amountMinor:777}), payment({id:'void',voidedAt:now})] });
  const cash = build(data,{drill:'payments'});
  assert.equal(cash.drilldown.total,1); assert.equal(cash.drilldown.rows[0].amountMinor,777);
  assert.equal(cash.drilldown.rows[0].orderId,'september'); assert.equal(cash.drilldown.rows[0].date,'2026-10-12T12:00:00.000Z');
  assert.equal(build(data,{repeat:'returning-client',drill:'clients'}).drilldown.total,1);
  assert.equal(build(data,{repeat:'new-client',drill:'clients'}).drilldown.total,1);
  assert.equal(build(data,{country:'OTHERS:FR,UA',drill:'orders'}).current.orders,2);
  assert.equal(build(data,{country:'OTHERS:FR,UA,UNKNOWN',drill:'orders'}).current.orders,1);
});

test('sport piece drills and lifetime receipts preserve their exact physical and cash cohorts', () => {
  const data = sources({orders:[order({items:[item({id:'rg',quantity:2,discipline:'RG'}),item({id:'acro',quantity:3,discipline:'ACRO'})]}),order({id:'refund',country:'UA',paymentStatus:'REFUNDED',createdAt:'2026-09-01T12:00:00Z'})],payments:[payment({orderId:'refund',amountMinor:700})]});
  const physical=build(data,{discipline:'ACRO',drill:'pieces'});
  assert.equal(physical.drilldown.rows.length,1);assert.equal(physical.drilldown.rows[0].pieces,3);
  const client=build(data).clients[0]; assert.equal(client.lifetimeReceivedMinor,700);
  assert.deepEqual([...client.countries].sort(),['FR','UA']);assert.equal(client.country,null);
  const cashOnly=sources({orders:[order({createdAt:'2026-09-01T12:00:00Z'})],payments:[payment({amountMinor:400})]});
  assert.equal(build(cashOnly,{drill:'clients',ranking:'received'}).drilldown.rows[0].receivedMinor,400);
  assert.equal(build(cashOnly,{drill:'countries',ranking:'received'}).drilldown.rows[0].receivedMinor,400);
  assert.equal(build(cashOnly,{drill:'clients',ranking:'orders'}).drilldown.total,0);
  const noFx=sources({orders:[order({createdAt:'2026-09-01T12:00:00Z'})],payments:[payment({currency:'USD',amountMinor:400})]});
  assert.equal(build(noFx,{drill:'clients',ranking:'received'},true,{provider:'NBU',convert:()=>null}).drilldown.total,1);
  assert.equal(build(noFx,{drill:'countries',ranking:'received'},true,{provider:'NBU',convert:()=>null}).drilldown.total,1);
});

test('FX dependencies exclude irrelevant clients while retaining current buyers lifetime history', () => {
  const data=sources({clients:[{id:'c',displayName:'Current'},{id:'x',displayName:'Unrelated'}],orders:[order(),order({id:'past',createdAt:'1980-01-01T12:00:00Z'}),order({id:'unrelated',clientId:'x',createdAt:'1970-01-01T12:00:00Z'})]});
  const events=model.salesStatisticsValuationEvents(data,query(),now);
  assert.ok(events.some(event=>event.date==='1980-01-01T12:00:00Z'));
  assert.ok(!events.some(event=>event.date==='1970-01-01T12:00:00Z'));
});

test('client ranking honors numeric direction and explicit label/average sorting', () => {
  const data=sources({clients:[{id:'c',displayName:'Zed'},{id:'a',displayName:'Amy'}],orders:[order(),order({id:'second',clientId:'a',priceMinor:2000})]});
  assert.equal(build(data,{ranking:'amount',direction:'asc'}).clients[0].key,'c');
  assert.equal(build(data,{sort:'label',direction:'asc'}).clients[0].key,'a');
  assert.equal(build(data,{sort:'average',direction:'desc'}).clients[0].key,'a');
});

test('delivery geography and already-proven source survive filters without inferred KeyCRM origins', () => {
  const data = sources({ orders: [order(), order({ id: 'unknown', country: null, orderSource: 'UNKNOWN' }), order({ id: 'manual', country: 'UA', orderSource: 'MANUAL', type: 'ACCESSORY' })] });
  assert.equal(build(data, { country: 'FR', source: 'WEBSITE' }).current.orders, 1);
  assert.equal(build(data, { country: 'UNKNOWN' }).current.unknownCountryOrders, 1);
  assert.equal(build(data, { source: 'NON_WEBSITE' }).current.orders, 2);
  assert.equal(build(data, { orderType: 'ACCESSORY', status: 'NEW_LEAD' }).current.pieces, 6);
  assert.equal(build(data, { status: 'COMPLETED' }).current.orders, 0);
  const result = build(data);
  assert.equal(result.current.countries, 2);
  assert.equal(result.sources.find(row => row.key === 'UNKNOWN').orders, 1);
  assert.equal(result.countries.find(row => row.key === 'FR').label, 'Франция');
});

test('one order with six physical products counts once; instances never add products', () => {
  const result = build(sources({ orders: [order(), order()] }));
  assert.equal(result.current.orders, 1);
  assert.equal(result.current.pieces, 6);
  assert.equal(result.current.amountMinor, 1001);
  assert.equal(result.current.averageMinor, 1001);
  assert.equal(result.countries[0].key, 'FR');
  assert.equal(result.drilldown.rows[0].orderId, 'o');
  assert.equal(result.expiresAt, '2026-10-18T12:00:30.000Z');
});

test('mixed disciplines and accessories form exclusive piece sectors and overlapping distinct orders', () => {
  const data = sources({ orders: [order({ items: [item({ quantity: 2, instances: [{ id: 'x', archivedAt: null }] }), item({ id: 'accessory', quantity: 3, discipline: 'ACRO', instances: ['a', 'b', 'c'].map(id => ({ id, archivedAt: null })) }), item({ id: 'old', quantity: 50, archivedAt: now })] })] });
  const result = build(data, { discipline: 'ACRO' });
  assert.equal(result.current.pieces, 5);
  assert.equal(result.sports.find(row => row.key === 'RG').pieces, 2);
  assert.equal(result.sports.find(row => row.key === 'ACRO').pieces, 3);
  assert.equal(result.sports.reduce((n, row) => n + row.orders, 0), 2);
  assert.equal(result.warnings.find(row => row.code === 'ITEM_INSTANCE_MISMATCH').count, 1);
  assert.equal(build(data, { discipline: 'FIGURE' }).current.orders, 0);
});

test('sales eligibility excludes archives and cancellations but preserves returned sale history', () => {
  const data = sources({ orders: [order(), order({ id: 'returned', shippingStatus: 'RETURNED' }), order({ id: 'cancelled', salesStatus: 'CANCELLED' }), order({ id: 'refunded', paymentStatus: 'REFUNDED' }), order({ id: 'old', archivedAt: now }), order({ id: 'cancelled-payment', paymentStatus: 'CANCELLED' })] });
  assert.equal(build(data).current.orders, 2);
  assert.equal(build(data, { scope: 'all' }).current.orders, 5);
  assert.equal(build(data, { status: 'CANCELLED' }).current.orders, 0);
  assert.equal(build(data, { status: 'CANCELLED', scope: 'all' }).current.orders, 1);
});

test('canonical repeat history precedes filters; Kyiv dates, previous range and clipped months agree', () => {
  const data = sources({ clients: [{ id: 'c', displayName: 'Канонический' }, { id: 'new', displayName: 'Новый' }], redirects: [{ sourceClientId: 'old', targetClientId: 'c' }], orders: [
    order({ id: 'history', clientId: 'old', country: 'UA', createdAt: '2026-09-01T12:00:00Z' }),
    order({ id: 'edge', createdAt: '2026-09-30T21:30:00Z' }),
    order({ id: 'a', clientId: 'new', createdAt: '2026-10-10T12:00:00Z' }),
    order({ id: 'b', clientId: 'new', createdAt: '2026-10-10T12:00:00Z' }),
    order({ id: 'next', createdAt: '2026-10-31T22:30:00Z' }),
  ] });
  const result = build(data, { country: 'FR' });
  assert.equal(result.current.orders, 3);
  assert.equal(result.current.clients, 2);
  assert.equal(result.current.repeatOrders, 2);
  assert.equal(result.current.repeatClients, 2);
  assert.equal(result.current.repeatShare, 100);
  assert.equal(result.monthly.length, 1);
  assert.equal(result.monthly[0].newClients, 1);
  assert.equal(result.monthly[0].returningClients, 1);
  assert.equal(result.monthly[0].newOrders, 1);
  assert.equal(result.monthly[0].repeatOrders, 2);
  assert.equal(result.clients.find(row => row.key === 'c').lifetimeOrders, 3);
  assert.equal(build(data, { clientId: 'old', repeat: 'repeat' }).current.orders, 1);
  assert.equal(build(data, { from: '2026-10-02', to: '2026-10-02' }).previous.orders, 1);
});

test('invalid merge graphs fail closed and all-status clients without sale history are not invented new clients', () => {
  assert.throws(() => build(sources({ redirects: [{ sourceClientId: 'c', targetClientId: 'missing' }] })), /канонический/);
  assert.throws(() => build(sources({ redirects: [{ sourceClientId: 'c', targetClientId: 'c' }] })), /Цикл/);
  assert.throws(() => build(sources({ redirects: [{ sourceClientId: 'unused', targetClientId: 'missing' }] })), /канонический/);
  assert.throws(() => build(sources({ redirects: [{ sourceClientId: 'c', targetClientId: 'x' }, { sourceClientId: 'c', targetClientId: 'y' }] })), /объединения/);
  const result = build(sources({ orders: [order({ salesStatus: 'CANCELLED' })] }), { scope: 'all' });
  assert.equal(result.current.orders, 1);
  assert.equal(result.monthly[0].newClients, 0);
  assert.equal(result.monthly[0].returningClients, 0);
});

test('cash uses receipt date including cancelled and archived real payments independently of order creation', () => {
  const data = sources({ orders: [order({ id: 'september', createdAt: '2026-09-10T12:00:00Z' }), order({ id: 'cancelled', salesStatus: 'CANCELLED' }), order({ id: 'archived', archivedAt: now })], payments: [payment({ orderId: 'september' }), payment({ id: 'cancelled-cash', orderId: 'cancelled', amountMinor: 200 }), payment({ id: 'archived-cash', orderId: 'archived', amountMinor: 100 }), payment({ id: 'void', orderId: 'september', amountMinor: 999, voidedAt: now }), payment({ id: 'past', orderId: 'september', amountMinor: 50, receivedAt: '2026-09-12T12:00:00Z' })] });
  const result = build(data);
  assert.equal(result.current.orders, 0);
  assert.equal(result.current.receivedMinor, 600);
  assert.equal(result.previous.amountMinor, 1001);
  assert.equal(result.previous.receivedMinor, 50);
  assert.equal(result.monthly[0].receivedMinor, 600);
  assert.equal(result.monthly[0].sports[0].receivedMinor, 600);
  assert.equal(result.sources[0].receivedMinor, 600);
  assert.equal(result.clients[0].lifetimeReceivedMinor, 650);
  assert.equal(build(data, { status: 'CANCELLED' }).current.receivedMinor, 200);
  assert.equal(build(data, { country: 'UA' }).current.receivedMinor, 0);
  const rows = build(data, { drill: 'payments' }).drilldown.rows;
  const archived = rows.find(row => row.id === 'archived-cash');
  assert.equal(archived.orderId, 'archived');
  assert.equal(archived.orderArchived, true);
  assert.equal(archived.clientId, 'c');
  assert.equal(rows.find(row => row.id === 'cancelled-cash').orderArchived, false);
});

test('debt uses applied settlement without fabricated FX and expenses use incurred date with explicit unallocated policy', () => {
  const expense = (extra = {}) => ({ id: 'e', orderId: 'o', amountMinor: 80, currency: 'EUR', incurredAt: '2026-10-15', archivedAt: null, ...extra });
  const data = sources({ payments: [payment({ currency: 'USD', amountMinor: 400, appliedCurrency: 'EUR', appliedAmountMinor: 300 })], expenses: [expense(), expense({ id: 'unallocated', orderId: null, amountMinor: 20 }), expense({ id: 'archived', amountMinor: 900, archivedAt: now }), expense({ id: 'old', incurredAt: '2026-09-01', amountMinor: 50 })] });
  const result = build(data);
  assert.equal(result.current.debtMinor, 701);
  assert.equal(result.current.receivedMinor, 400);
  assert.equal(result.current.expensesMinor, 100);
  assert.equal(result.current.resultMinor, 300);
  assert.equal(result.warnings.find(row => row.code === 'UNALLOCATED_EXPENSES_INCLUDED').count, 1);
  assert.equal(build(data, { country: 'FR' }).current.expensesMinor, 80);
  assert.equal(build(data, { country: 'FR' }).warnings.find(row => row.code === 'UNALLOCATED_EXPENSES_EXCLUDED').count, 1);
  assert.equal(build(sources({ payments: [payment({ currency: 'USD' })] })).current.debtMinor, null);
  assert.equal(build(sources({ orders: [order({ shippingStatus: 'RETURNED' })] })).current.debtMinor, 0);
  assert.equal(build(sources({ orders: [order({ salesStatus: 'COMPLETED' })] })).current.debtMinor, 0);
  assert.equal(build(sources({ payments: [payment({ amountMinor: 2000 })] })).current.debtMinor, 0);
});

test('missing event FX invalidates complete monetary totals, averages and lifetime without partial-zero rankings', () => {
  const dates = [];
  const fx = { provider: 'ECB', dates: ['2026-10-10'], convert: (amount, currency, date) => { dates.push(String(date)); return currency === 'UAH' ? null : amount; } };
  const result = build(sources({ orders: [order(), order({ id: 'uah', currency: 'UAH', country: 'UA' })], payments: [payment({ currency: 'UAH', appliedCurrency: 'EUR', appliedAmountMinor: 250 })] }), {}, true, fx);
  assert.equal(result.current.amountMinor, null);
  assert.equal(result.current.receivedMinor, null);
  assert.equal(result.current.averageMinor, null);
  assert.equal(result.current.resultMinor, null);
  assert.equal(result.countries.find(row => row.key === 'UA').amountMinor, null);
  assert.equal(result.clients[0].lifetimeAmountMinor, null);
  assert.equal(result.valuation.missingCount, 2);
  assert.equal(result.warnings.find(row => row.code === 'MISSING_EXCHANGE_RATE').count, 2);
  assert.ok(dates.includes('2026-10-12T12:00:00Z'));
  assert.equal(build(sources({ orders: [order({ priceMinor: 1000 }), order({ id: 'two', priceMinor: 1001 })] })).current.averageMinor, 1001);
  assert.throws(() => build(sources({ orders: [order({ priceMinor: Number.MAX_SAFE_INTEGER }), order({ id: 'two', priceMinor: 1 })] })), /диапазона/);
});

test('nonfinancial report never reads money or calls valuation and removes monetary and lifetime projections everywhere', () => {
  const data = sources({ payments: [payment()], expenses: [{ id: 'secret', orderId: null, amountMinor: 777, currency: 'USD', incurredAt: '2026-10-15', archivedAt: null }] });
  for (const row of [...data.orders, ...data.payments, ...data.expenses]) for (const key of ['priceMinor', 'amountMinor', 'depositRequiredMinor', 'appliedAmountMinor']) if (key in row) Object.defineProperty(row, key, { get() { throw new Error('money read'); } });
  const result = build(data, {}, false, { provider: 'NBU', dates: ['secret-rate-date'], convert() { throw new Error('FX called'); } });
  function inspect(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key.endsWith('Minor')) assert.equal(child, null, key);
      if (key === 'lifetimeOrders') assert.fail('lifetime leaked');
      inspect(child);
    }
  }
  inspect(result);
  assert.equal(result.current.pieces, 6);
  assert.equal(result.valuation.dates.length, 0);
  assert.equal(result.warnings.some(row => row.code.startsWith('UNALLOCATED')), false);
});

test('drilldown pages the same full cohort by orders, physical item rows, countries or canonical clients; null money ranks last', () => {
  const data = sources({ orders: [order({ id: 'a', priceMinor: 1000, items: [item({ id: 'a1', quantity: 2 }), item({ id: 'a2', quantity: 3 })] }), order({ id: 'b', country: 'UA', priceMinor: 3000, currency: 'UAH' }), order({ id: 'c', country: 'US', priceMinor: 5000 })] });
  const fx = { provider: 'ECB', convert: (amount, currency) => currency === 'UAH' ? null : amount };
  const result = build(data, { sort: 'amount', direction: 'desc', pageSize: 1, page: 2 }, true, fx);
  assert.equal(result.current.orders, 3);
  assert.equal(result.drilldown.total, 3);
  assert.equal(result.drilldown.rows[0].id, 'a');
  assert.equal(build(data, { sort: 'amount', direction: 'asc' }, true, fx).drilldown.rows.at(-1).id, 'b');
  const productRows = build(data, { drill: 'pieces' });
  assert.equal(productRows.drilldown.total, 4);
  assert.equal(productRows.drilldown.rows.reduce((n, row) => n + row.pieces, 0), 17);
  assert.equal(productRows.drilldown.rows[0].orderId !== null, true);
  assert.equal(build(data, { drill: 'countries' }).drilldown.total, 3);
  assert.equal(build(data, { drill: 'clients' }).drilldown.rows[0].clientId, 'c');
  assert.equal(build(data, { drill: '' }).drilldown.total, 0);
  assert.equal(build(data, { pageSize: 1 }, true, valuation, true).drilldown.rows.length, 3);
});

test('all five tabs expose reconciled monthly groups, item unit averages, lifetime cohorts and stable filter options', () => {
  const data = sources({ orders: [order({ items: [item({ quantity: 2, priceMinor: 100 }), item({ id: 'acro', quantity: 3, priceMinor: 300, discipline: 'ACRO' })] }), order({ id: 'unknown', country: 'UNKNOWN', orderSource: 'UNKNOWN', type: 'ACCESSORY', discipline: null, items: [item({ discipline: null, quantity: 1 })] }), order({ id: 'past', country: 'US', createdAt: '2026-09-01T12:00:00Z' })] });
  const result = build(data);
  for (const key of ['countries', 'sources', 'types']) {
    assert.equal(result[key].reduce((n, row) => n + row.orders, 0), 2, key);
    assert.equal(result.monthly[0][key].reduce((n, row) => n + row.pieces, 0), 6, key);
  }
  assert.equal(result.current.countries, 1);
  assert.equal(result.current.unknownCountryOrders, 1);
  assert.equal(result.monthly[0].sports.reduce((n, row) => n + row.pieces, 0), 6);
  assert.equal(result.sports.find(row => row.key === 'ACRO').pieceAverageMinor, 300);
  assert.equal(result.clients[0].lifetimeAmountMinor, 3003);
  assert.equal(result.options.clients.length, 1);
  assert.ok(result.options.countries.some(row => row.value === 'US'));
  assert.ok(result.options.countries.some(row => row.value === 'UNKNOWN'));
  assert.ok(result.options.disciplines.includes('UNKNOWN'));
  assert.ok(result.options.types.includes('ACCESSORY'));
  assert.equal(build(data, { country: 'FR' }).options.countries.length, 3);
  const ranked = build(sources({ clients: [{ id: 'c', displayName: 'Клиент' }, { id: 'b', displayName: 'Второй' }], orders: [order(), order({ id: 'big', clientId: 'b', priceMinor: 3000 })] }), { ranking: 'amount' });
  assert.equal(ranked.clients[0].key, 'b');
});

test('exports refuse more than 50000 matching rows rather than silently truncate', () => {
  const data = sources({ orders: [order({ items: Array.from({ length: 50001 }, (_, index) => item({ id: String(index), quantity: 1, priceMinor: 0 })) })] });
  assert.throws(() => build(data, { drill: 'pieces' }, false, valuation, true), /50000/);
});

test('every missing applied receipt is counted and invalid product quantities fail closed', () => {
  const result = build(sources({ payments: [payment({ currency: 'USD' }), payment({ id: 'p2', currency: 'UAH' })] }));
  assert.equal(result.current.debtMinor, null);
  assert.equal(result.warnings.find(row => row.code === 'MISSING_APPLIED_PAYMENT').count, 2);
  for (const quantity of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => build(sources({ orders: [order({ items: [item({ quantity })] })] })), /количество/);
});

test('status options and status predicate use only sales status, preserving independent status dimensions', () => {
  const data = sources({ orders: [order(), order({ id: 'completed', salesStatus: 'COMPLETED', paymentStatus: 'PAID', shippingStatus: 'DELIVERED' })] });
  const result = build(data);
  assert.equal(result.options.statuses.join(','), 'COMPLETED,NEW_LEAD');
  assert.equal(result.options.statuses.includes('UNPAID'), false);
  assert.equal(result.options.statuses.includes('NOT_READY'), false);
  assert.equal(build(data, { status: 'COMPLETED' }).current.orders, 1);
  assert.equal(build(data, { status: 'UNPAID' }).current.orders, 0);
});
