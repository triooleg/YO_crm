import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';

const {OrdersService} = loadTargetModule('orders/orders.service.ts');

// Evaluate the actual Prisma predicate emitted by OrdersService, including
// optional to-one and active to-many relations, rather than matching source text.
function matches(row, where = {}) {
  return Object.entries(where).every(([key, rule]) => {
    if (key === 'OR') return rule.some(term => matches(row, term));
    if (key === 'AND') return (Array.isArray(rule) ? rule : [rule]).every(term => matches(row, term));
    const value = row?.[key];
    if (rule === null || typeof rule !== 'object') return value === rule;
    if ('in' in rule) return rule.in.includes(value);
    if ('contains' in rule) return typeof value === 'string' && (rule.mode === 'insensitive'
      ? value.toLowerCase().includes(rule.contains.toLowerCase())
      : value.includes(rule.contains));
    if ('is' in rule) return value != null && matches(value, rule.is);
    if ('some' in rule) return (value ?? []).some(item => matches(item, rule.some));
    return value != null && matches(value, rule);
  });
}

function fixture() {
  const make = (id, extra = {}) => ({
    id, number: '26-' + id, externalNumber: null, archivedAt: null,
    clientId: 'client', client: {id: 'client', displayName: 'Synthetic buyer', country: null, source: 'MANUAL', _count: {orders: 6}},
    athlete: null, createdAt: new Date('2026-01-01'), requiredDeliveryAt: null,
    country: null, deliveryTrackingCode: null, shipment: null, orderShipments: [],
    currency: 'EUR', priceMinor: 10000, depositRequiredMinor: 5000,
    salesStatus: 'NEW_LEAD', productionStatus: 'NOT_SCHEDULED', shippingStatus: 'NOT_READY',
    items: [], payments: [], invoices: [], compositionOperations: [], activities: [], _count: {items: 0},
    ...extra,
  });
  const rows = [
    make('direct', {deliveryTrackingCode: 'PC-DIRECT-123'}),
    make('legacy', {shipment: {trackingNumber: 'PC-LEGACY-456'}}),
    make('parcels', {orderShipments: [{trackingNumber: 'PC-FIRST-111', archivedAt: null}, {trackingNumber: 'PC-SECOND-789', archivedAt: null}, {trackingNumber: 'PC-DELETED-000', archivedAt: new Date()}]}),
    make('country', {country: 'Croatia'}),
    make('client-country', {client: {id: 'client', displayName: 'Other buyer', country: 'Україна', source: 'MANUAL', _count: {orders: 6}}}),
    make('archived', {archivedAt: new Date(), deliveryTrackingCode: 'PC-ARCHIVE-999', country: 'Croatia'}),
  ];
  const calls = [];
  const db = {order: {findMany: async query => {
    calls.push(query);
    let result = rows.filter(row => matches(row, query.where));
    if (query.take) result = result.slice(0, query.take);
    return structuredClone(result);
  }}};
  db.$transaction = async fn => fn(db);
  return {service: new OrdersService(db, {}), calls, rows};
}

for (const paged of [false, true]) {
  const label = paged ? 'paged' : 'legacy';
  const options = paged ? {page: '1', pageSize: '20'} : undefined;
  const ids = result => (paged ? result.items : result).map(row => row.id);
  test(`${label}: searches full/partial tracking codes in all active shipment representations`, async () => {
    const f = fixture();
    for (const [query, expected] of [['  pc-direct-123  ', ['direct']], ['legacy-4', ['legacy']], ['second-7', ['parcels']], ['pc-', ['direct', 'legacy', 'parcels']]]) {
      const result = await f.service.list(query, options);
      assert.deepEqual(ids(result).sort(), expected.sort());
      if (paged) assert.equal(result.total, expected.length);
    }
    assert.deepEqual(ids(await f.service.list('PC-DELETED', options)), []);
    assert.deepEqual(ids(await f.service.list('PC-ARCHIVE', options)), []);
  });
  test(`${label}: country names on order and client support partial case-insensitive Unicode search`, async () => {
    const f = fixture();
    assert.deepEqual(ids(await f.service.list('  CROAT  ', options)), ['country']);
    assert.deepEqual(ids(await f.service.list('уКрА', options)), ['client-country']);
    assert.deepEqual(ids(await f.service.list('No-such-country', options)), []);
  });
  test(`${label}: existing number/client/athlete searches and empty query remain intact`, async () => {
    const f = fixture();
    f.rows[0].athlete = {firstName: 'TestAthlete', lastName: 'Example'};
    assert.deepEqual(ids(await f.service.list('26-direct', options)), ['direct']);
    assert.deepEqual(ids(await f.service.list('Other buyer', options)), ['client-country']);
    assert.deepEqual(ids(await f.service.list('TestAthlete', options)), ['direct']);
    assert.equal(ids(await f.service.list('   ', options)).length, 5);
    await assert.rejects(() => f.service.list('x'.repeat(201), options), /Слишком длинный/);
  });
}

test('tracking/country searches intersect page/status/source filters before KPI and pagination', async () => {
  const f = fixture();
  const result = await f.service.list('pc-', {page: '1', pageSize: '20', status: 'COMPLETED'});
  assert.equal(result.total, 0);
  assert.equal(result.metrics.total, 3); // status facet retains existing semantics
  assert.deepEqual(result.items, []);
  const unknown = await f.service.list('pc-', {page: '1', pageSize: '20', source: 'WEBSITE'});
  assert.equal(unknown.total, 0);
  for (let i = 0; i < 25; i++) f.rows.push({
    ...structuredClone(f.rows[0]), id: 'page-' + i, number: '26-page-' + i,
    deliveryTrackingCode: 'PC-PAGE-' + i, salesStatus: 'COMPLETED',
  });
  const second = await f.service.list('pc-page', {page: '2', pageSize: '20', status: 'COMPLETED'});
  assert.equal(second.total, 25);
  assert.equal(second.metrics.total, 25);
  assert.equal(second.page, 2);
  assert.equal(second.items.length, 5);
});
