import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';

// Match the existing aggregate tests: execute the real TypeScript projection
// and its dependencies, without a database, compiled dist, or live FX requests.
const require = createRequire(import.meta.url);
const modules = new Map();
function load(url) {
  if (modules.has(url.href)) return modules.get(url.href).exports;
  const module = { exports: {} };
  modules.set(url.href, module);
  const source = ts.transpileModule(fs.readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require: name => name.startsWith('.') ? load(new URL(name + '.ts', url)) : require(name),
    Date, Intl, Buffer, URL, AbortController, TextDecoder, setTimeout, clearTimeout,
    fetch: () => { throw new Error('Live FX requests are forbidden in aggregate regressions'); },
  });
  return module.exports;
}
const { buildSalesStatistics, salesStatisticsValuationEvents } = load(new URL('../src/overview/sales-statistics.model.ts', import.meta.url));
const { SalesStatisticsFx } = load(new URL('../src/overview/sales-statistics-fx.ts', import.meta.url));
const now = new Date('2026-10-26T12:00:00Z');
const sameCurrency = { provider: 'NBU', convert: (amount, currency) => currency === 'EUR' ? amount : null };
const item = (id, quantity, extra = {}) => ({ id, quantity, priceMinor: 100, discipline: 'RG', archivedAt: null,
  instances: Array.from({ length: quantity }, (_, index) => ({ id: `${id}-${index}`, archivedAt: null })), ...extra });
const order = (id, createdAt, extra = {}) => ({ id, number: id, clientId: 'c', clientName: 'Клиент', createdAt,
  country: 'FR', orderSource: 'WEBSITE', type: 'CUSTOM', discipline: 'RG', priceMinor: 100, currency: 'EUR',
  depositRequiredMinor: 50, salesStatus: 'NEW_LEAD', paymentStatus: 'UNPAID', shippingStatus: 'NOT_READY',
  archivedAt: null, items: [item(id, 1)], ...extra });
function sources(orders, extra = {}) {
  return { orders, payments: [], expenses: [], redirects: [],
    clients: [...new Set(orders.map(row => row.clientId))].map(id => ({ id, displayName: id })),
    countryLabels: { FR: 'Франция', UA: 'Украина', US: 'США' }, ...extra };
}
const query = (extra = {}) => ({ from: '2026-10-03', to: '2026-10-04', currency: 'EUR', source: '', status: '',
  clientId: '', country: '', orderType: '', discipline: '', tab: 'countries', months: 3, metric: 'orders',
  customerMetric: 'clients', revenueMetric: 'orders', ranking: 'amount', scope: 'sales', repeat: '',
  drill: 'orders', page: 1, pageSize: 10, sort: 'orders', direction: 'desc', ...extra });
const build = (data, selection = {}, valuation = sameCurrency, financial = true) =>
  buildSalesStatistics(data, query(selection), financial, valuation, now);

// These are the six overview cards. Expected tuples below are hand-worked
// examples; no production period or aggregation helper computes expectations.
const kpis = totals => [totals.orders, totals.pieces, totals.countries, totals.clients, totals.repeatOrders, totals.amountMinor];
function expectKpis(report, current, previous) {
  assert.deepEqual(kpis(report.current), current, 'current six KPIs');
  assert.deepEqual(kpis(report.previous), previous, 'previous six KPIs');
}

const calendarCases = [
  ['arbitrary partial months', '2026-05-17', '2026-06-02', '2026-04-30', '2026-05-16', '2026-04-29', '2026-06-03'],
  ['year boundary', '2026-01-01', '2026-01-03', '2025-12-29', '2025-12-31', '2025-12-28', '2026-01-04'],
  ['leap day in current period', '2024-02-28', '2024-03-01', '2024-02-25', '2024-02-27', '2024-02-24', '2024-03-02'],
  ['leap day in previous period', '2024-03-01', '2024-03-02', '2024-02-28', '2024-02-29', '2024-02-27', '2024-03-03'],
  ['single inclusive day', '2026-07-15', '2026-07-15', '2026-07-14', '2026-07-14', '2026-07-13', '2026-07-16'],
  ['full leap year has 366 comparison days', '2024-01-01', '2024-12-31', '2022-12-31', '2023-12-31', '2022-12-30', '2025-01-01'],
];
for (const [label, from, to, previousFrom, previousTo, before, after] of calendarCases) {
  test(`six KPIs use equal inclusive calendar periods: ${label}`, () => {
    const data = sources([
      order('before', before, { clientId: 'outside', priceMinor: 10000 }),
      order('previous-first', previousFrom, { priceMinor: 11, items: [item('p1', 2)] }),
      order('previous-last', previousTo, { priceMinor: 13, items: [item('p2', 3)] }),
      order('current-first', from, { priceMinor: 17, items: [item('c1', 4)] }),
      order('current-last', to, { priceMinor: 19, items: [item('c2', 5)] }),
      order('after', after, { clientId: 'outside', priceMinor: 20000 }),
    ]);
    expectKpis(build(data, { from, to }), [2, 9, 1, 1, 2, 36], [2, 5, 1, 1, 1, 24]);
  });
}

for (const boundary of [
  { name: 'spring forward (23-hour day)', from: '2024-03-31', to: '2024-04-01',
    previousStart: '2024-03-28T22:00:00Z', previousEnd: '2024-03-30T21:59:59.999Z',
    currentStart: '2024-03-30T22:00:00Z', currentEnd: '2024-04-01T20:59:59.999Z', after: '2024-04-01T21:00:00Z' },
  { name: 'fall back (25-hour day)', from: '2024-10-27', to: '2024-10-28',
    previousStart: '2024-10-24T21:00:00Z', previousEnd: '2024-10-26T20:59:59.999Z',
    currentStart: '2024-10-26T21:00:00Z', currentEnd: '2024-10-28T21:59:59.999Z', after: '2024-10-28T22:00:00Z' },
]) {
  test(`Kyiv midnight boundaries survive ${boundary.name} in both comparison periods`, () => {
    const data = sources([
      order('before', new Date(Date.parse(boundary.previousStart) - 1), { clientId: 'outside', priceMinor: 10000 }),
      order('p-first', boundary.previousStart, { priceMinor: 11 }),
      order('p-last', new Date(boundary.previousEnd), { priceMinor: 13 }),
      order('c-first', new Date(boundary.currentStart), { priceMinor: 17 }),
      order('c-last', boundary.currentEnd, { priceMinor: 19 }),
      order('after', boundary.after, { clientId: 'outside', priceMinor: 20000 }),
    ]);
    expectKpis(build(data, boundary), [2, 2, 1, 1, 2, 36], [2, 2, 1, 1, 1, 24]);
  });
}

const filterCases = [
  ['website source', { source: 'WEBSITE' }, [1, 2, 1, 1, 1, 100], [1, 2, 1, 1, 0, 100]],
  ['non-website source includes unknown', { source: 'NON_WEBSITE' }, [2, 7, 1, 2, 2, 500], [2, 7, 1, 2, 1, 500]],
  ['sales status', { status: 'COMPLETED' }, [1, 3, 1, 1, 1, 200], [1, 3, 1, 1, 0, 200]],
  ['client', { clientId: 'c' }, [2, 6, 1, 1, 2, 400], [2, 6, 1, 1, 1, 400]],
  ['combined source, status and client', { source: 'MANUAL', status: 'COMPLETED', clientId: 'd' },
    [1, 3, 1, 1, 1, 200], [1, 3, 1, 1, 0, 200]],
  ['contradictory filters', { source: 'WEBSITE', status: 'COMPLETED', clientId: 'c' },
    [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]],
];
for (const [label, selection, current, previous] of filterCases) {
  test(`all six KPIs apply ${label} identically to both periods`, () => {
    const orders = ['2026-10-01', '2026-10-03'].flatMap((date, index) => [
      order(`website-${index}`, `${date}T10:00:00Z`, { items: [item('w', 2)] }),
      order(`manual-${index}`, `${date}T11:00:00Z`, { clientId: 'd', country: 'US', orderSource: 'MANUAL', salesStatus: 'COMPLETED', priceMinor: 200, items: [item('m', 3)] }),
      order(`unknown-${index}`, `${date}T12:00:00Z`, { country: null, orderSource: 'UNKNOWN', priceMinor: 300, items: [item('u', 4)] }),
    ]);
    expectKpis(build(sources(orders), selection), current, previous);
  });
}

test('countries and canonical clients are distinct over the entire range, independent of chart window and pagination', () => {
  const orders = [
    order('p1', '2023-10-02', { clientId: 'legacy' }),
    order('p2', '2023-11-10'),
    order('p3', '2023-12-31', { clientId: 'd', country: 'UA' }),
    order('c1', '2024-01-01', { clientId: 'legacy' }),
    order('c2', '2024-02-29'),
    order('c3', '2024-03-31', { clientId: 'd', country: 'UA' }),
    order('c4', '2024-03-31', { clientId: 'd', country: null }),
  ];
  const data = sources(orders, { redirects: [{ sourceClientId: 'legacy', targetClientId: 'c' }] });
  for (const months of [3, 6, 12]) {
    const report = build(data, { from: '2024-01-01', to: '2024-03-31', months, page: 2 });
    expectKpis(report, [4, 4, 2, 2, 4, 400], [3, 3, 2, 2, 1, 300]);
    assert.equal(report.current.unknownCountryOrders, 1);
    assert.equal(report.drilldown.rows.length, 0);
  }
});

test('repeat means subsequent eligible order in canonical lifetime history, before source and status filters', () => {
  const data = sources([
    order('history', '2026-08-01', { clientId: 'legacy', orderSource: 'MANUAL', salesStatus: 'COMPLETED' }),
    order('archived-history', '2026-08-02', { clientId: 'd', archivedAt: now }),
    order('cancelled-history', '2026-08-03', { clientId: 'd', salesStatus: 'CANCELLED' }),
    order('refunded-history', '2026-08-04', { clientId: 'd', paymentStatus: 'REFUNDED' }),
    order('p-c', '2026-10-01'), order('p-d', '2026-10-01', { clientId: 'd' }),
    order('c-c', '2026-10-03'), order('c-d1', '2026-10-03', { clientId: 'd' }),
    order('c-d2', '2026-10-04', { clientId: 'd' }), order('c-new', '2026-10-04', { clientId: 'n' }),
  ], { redirects: [{ sourceClientId: 'legacy', targetClientId: 'c' }] });
  const report = build(data, { source: 'WEBSITE', status: 'NEW_LEAD' });
  expectKpis(report, [4, 4, 1, 3, 3, 400], [2, 2, 1, 2, 1, 200]);
  assert.equal(report.current.repeatClients, 2);
  assert.equal(report.previous.repeatClients, 1);
  assert.equal(report.current.repeatShare, 2 / 3 * 100);
  assert.equal(report.previous.repeatShare, 50);
  expectKpis(build(data, { source: 'WEBSITE', clientId: 'legacy' }), [1, 1, 1, 1, 1, 100], [1, 1, 1, 1, 1, 100]);
});

test('archived orders/items, duplicates and cancelled/refunded sales never inflate either period', () => {
  const orders = ['2026-10-01', '2026-10-03'].flatMap((date, index) => {
    const active = item('active', 2);
    const sale = order(`sale-${index}`, date, { items: [active, active, item('archived', 90, { archivedAt: now })] });
    return [sale, sale,
      order(`archived-${index}`, date, { archivedAt: now, country: 'US', clientId: 'excluded', priceMinor: 90000 }),
      order(`cancelled-${index}`, date, { salesStatus: 'CANCELLED' }),
      order(`refund-${index}`, date, { paymentStatus: 'REFUNDED' }),
      order(`cancelled-payment-${index}`, date, { paymentStatus: 'CANCELLED' }),
      order(`returned-${index}`, date, { shippingStatus: 'RETURNED' }),
    ];
  });
  expectKpis(build(sources(orders)), [2, 3, 1, 1, 2, 200], [2, 3, 1, 1, 1, 200]);
});

async function historicalFx(data, selection, missingUsdDay = '') {
  // Only the external HTTP boundary is replaced. The real FX parser, historical
  // day lookup, cross-rate construction and minor-unit rounding remain in use.
  return new SalesStatisticsFx(async url => {
    const params = new URL(url).searchParams;
    assert.equal(new URL(url).origin, 'https://bank.gov.ua');
    const cc = params.get('valcode').toUpperCase();
    const rows = [
      { cc, exchangedate: '02.10.2026', units: 1, rate_per_unit: cc === 'EUR' ? '50' : '40' },
      { cc, exchangedate: '03.10.2026', units: 1, rate_per_unit: cc === 'EUR' ? '60' : '30' },
    ].filter(row => !(cc === 'USD' && row.exchangedate === missingUsdDay));
    return new Response(JSON.stringify(rows));
  }, () => now).prepare({ provider: 'NBU', currency: selection.currency,
    events: salesStatisticsValuationEvents(data, selection, now) });
}

for (const [currency, currentAmount, previousAmount] of [['EUR', 317, 380], ['USD', 633, 475], ['UAH', 19000, 19000]]) {
  test(`both periods convert EUR/USD/UAH sales to ${currency} at their own historical rates`, async () => {
    const orders = ['2026-10-02', '2026-10-03'].flatMap((date, index) => [
      order(`eur-${index}`, date, { clientId: 'eur' }),
      order(`usd-${index}`, date, { clientId: 'usd', currency: 'USD' }),
      order(`uah-${index}`, date, { clientId: 'uah', currency: 'UAH', priceMinor: 10000 }),
    ]);
    const data = sources(orders), selection = query({ from: '2026-10-03', to: '2026-10-03', currency });
    const report = build(data, selection, await historicalFx(data, selection));
    expectKpis(report, [3, 3, 1, 3, 3, currentAmount], [3, 3, 1, 3, 0, previousAmount]);
    assert.equal(report.valuation.missingCount, 0);
  });
}

for (const [missingDay, currentAmount, previousAmount] of [['03.10.2026', null, 180], ['02.10.2026', 150, null]]) {
  test(`missing FX on ${missingDay} affects only that period's money, preserving all counts`, async () => {
    const data = sources(['2026-10-02', '2026-10-03'].flatMap((date, index) => [
      order(`eur-${index}`, date), order(`usd-${index}`, date, { clientId: 'd', currency: 'USD' }),
    ]));
    const selection = query({ from: '2026-10-03', to: '2026-10-03' });
    const report = build(data, selection, await historicalFx(data, selection, missingDay));
    expectKpis(report, [2, 2, 1, 2, 2, currentAmount], [2, 2, 1, 2, 0, previousAmount]);
    assert.ok(report.valuation.missingCount > 0);
    assert.equal(report.current.averageMinor, currentAmount === null ? null : 75);
    assert.equal(report.previous.averageMinor, previousAmount === null ? null : 90);
  });
}

test('empty periods, real zero-price sales and hidden financial data stay distinguishable', () => {
  expectKpis(build(sources([])), [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]);
  const data = sources([order('free', '2026-10-03', { priceMinor: 0 })]);
  const report = build(data);
  expectKpis(report, [1, 1, 1, 1, 0, 0], [0, 0, 0, 0, 0, 0]);
  assert.equal(report.current.averageMinor, 0);
  assert.equal(report.previous.averageMinor, null);
  assert.equal(report.current.repeatShare, 0);
  assert.equal(report.previous.repeatShare, null);
  const hidden = build(data, {}, { provider: 'NBU', convert: () => { throw new Error('Hidden money must not be valued'); } }, false);
  expectKpis(hidden, [1, 1, 1, 1, 0, null], [0, 0, 0, 0, 0, null]);
});

test('zero foreign-currency prices remain zero even when that event day has no exchange rate', async () => {
  const data = sources([
    order('p-zero', '2026-10-02', { currency: 'USD', priceMinor: 0, depositRequiredMinor: 0, items: [item('p', 1, { priceMinor: 0 })] }),
    order('c-zero', '2026-10-03', { currency: 'USD', priceMinor: 0, depositRequiredMinor: 0, items: [item('c', 1, { priceMinor: 0 })] }),
  ]);
  const selection = query({ from: '2026-10-03', to: '2026-10-03' });
  const valuation = await new SalesStatisticsFx(async () => { throw new Error('Zero prices require no HTTP'); }, () => now)
    .prepare({ provider: 'NBU', currency: 'EUR', events: salesStatisticsValuationEvents(data, selection, now) });
  const report = build(data, selection, valuation);
  expectKpis(report, [1, 1, 1, 1, 1, 0], [1, 1, 1, 1, 0, 0]);
  assert.equal(report.valuation.missingCount, 0);
});
