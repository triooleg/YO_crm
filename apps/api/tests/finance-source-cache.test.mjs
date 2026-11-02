import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
require('reflect-metadata');
// Compile decorators like the existing runtime tests. Keep Nest, validation and
// all reporting collaborators real; only the injected database is a test double.
const modules = new Map();
function load(path) {
  const filename = resolve(fileURLToPath(new URL('../src/', import.meta.url)), path);
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} }; modules.set(filename, module);
  const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  const localRequire = name => name.startsWith('.') && existsSync(resolve(dirname(filename), name + '.ts'))
    ? load(resolve(dirname(filename), name + '.ts')) : require(name.startsWith('.')&&existsSync(resolve(dirname(filename),name))?resolve(dirname(filename),name):name);
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(localRequire, module, module.exports);
  return module.exports;
}
const { FinanceReportService } = load('finance/finance-report.service.ts');
const { FinanceReportQueryDto } = load('finance/finance-report.dto.ts');
const { ValidationPipe } = require('@nestjs/common');

const NOW = Date.parse('2026-10-15T10:00:00Z');
const date = value => new Date(value);
const cache = () => ({ version: 1, provider: 'NBU', officialUrl: 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangeNew', effectiveDate: '2026-10-15', fetchedAt: new Date(NOW).toISOString(), rates: [
  { baseCurrency: 'EUR', quoteCurrency: 'UAH', numerator: '50', denominator: '1', decimal: '50', sourceSeriesOrValcode: 'EUR' },
  { baseCurrency: 'USD', quoteCurrency: 'UAH', numerator: '40', denominator: '1', decimal: '40', sourceSeriesOrValcode: 'USD' },
] });
const order = (id = 'o', extra = {}) => ({ id, number: `KC-${id}`, clientId: 'client', client: { displayName: 'Client' }, archivedAt: null, priceMinor: 10000, currency: 'EUR', salesStatus: 'NEW_LEAD', paymentStatus: 'UNPAID', shippingStatus: 'NOT_READY', requiredDeliveryAt: date('2026-10-20'), ...extra });
const payment = (id = 'p', extra = {}) => ({ id, orderId: 'o', order: { archivedAt: null }, voidedAt: null, amountMinor: 2000, currency: 'EUR', receivedAt: date('2026-10-01'), method: 'BANK_TRANSFER', ...extra });
const expense = (id = 'e', extra = {}) => ({ id, categoryId: 'cat', category: { name: 'Materials' }, archivedAt: null, amountMinor: 1000, currency: 'EUR', incurredAt: date('2026-10-10'), orderId: 'o', order: { number: 'KC-o' }, ...extra });
const invoice = (id = 'i', extra = {}) => ({ id, number: `INV-${id}`, orderId: 'o', order: { number: 'KC-o', clientId: 'client', client: { displayName: 'Client' } }, archivedAt: null, issueDate: date('2026-10-01'), totalMinor: 3000, currency: 'EUR', status: 'ISSUED', ...extra });
function sources(extra = {}) {
  return { order: [order()], payment: [payment()], expense: [expense()], invoice: [invoice()], expenseCategory: [{ id: 'cat', name: 'Materials', active: true, expenses: [] }], appSetting: [
    { section: 'finance', key: 'exchangeRateProvider', value: 'NBU' },
    { section: 'finance', key: 'exchangeRateCache', value: cache() },
  ], ...extra };
}

// Small relational test double at the Prisma boundary, not report logic. It
// honors predicates, projections and cursors so missing reads affect results.
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(branch => matches(row, branch));
    if (key === 'AND') return value.every(branch => matches(row, branch));
    const actual = row?.[key];
    if (value === null) return actual == null;
    if (typeof value !== 'object' || value instanceof Date) return actual === value;
    if ('in' in value) return value.in.includes(actual);
    if ('some' in value) return (actual || []).some(item => matches(item, value.some));
    if ('gte' in value || 'lt' in value) return actual != null && (!('gte' in value) || actual >= value.gte) && (!('lt' in value) || actual < value.lt);
    if ('contains' in value) return String(actual || '').toLowerCase().includes(value.contains.toLowerCase());
    return matches(actual, value);
  });
}
function selectRows(rows, query = {}) {
  let result = rows.filter(row => matches(row, query.where));
  for (const sort of [...(Array.isArray(query.orderBy) ? query.orderBy : query.orderBy ? [query.orderBy] : [])].reverse()) {
    const [key, direction] = Object.entries(sort)[0];
    result.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (direction === 'desc' ? -1 : 1));
  }
  if (query.cursor) result = result.slice(result.findIndex(row => row.id === query.cursor.id) + (query.skip || 0));
  if (query.take != null) result = result.slice(0, query.take);
  return result.map(row => !query.select ? structuredClone(row) : Object.fromEntries(Object.entries(query.select).map(([key, value]) => [key,
    value === true ? row[key] : Array.isArray(row[key]) ? selectRows(row[key], value) : row[key] == null ? row[key] : selectRows([row[key]], value)[0],
  ])));
}
function database(data = sources(), taxes) {
  const reads = [], transactions = [];
  const delegates = transactional => Object.fromEntries(Object.keys(data).map(model => [model, new Proxy({}, { get: (_, method) => {
    if (!['findMany', 'findFirst'].includes(method)) return () => assert.fail(`Unexpected Prisma operation ${model}.${String(method)}`);
    return async query => { reads.push({ model, query, transactional }); const rows = selectRows(data[model], query); return method === 'findFirst' ? rows[0] || null : rows; };
  } })]));
  let revision = '100:100:';
  const tx = { ...delegates(true), $executeRawUnsafe: async () => 0,
    $queryRaw: async () => [{ snapshot: revision, database: 'fixture', schema: 'public', server: 'synthetic-server' }] };

  const prisma = { ...delegates(false), $transaction: async (run, options) => { transactions.push(options); return run(tx); } };
  return { service: new FinanceReportService(prisma, taxes), reads, transactions, data, tx, prisma, setSnapshot: value => { revision = value; } };
}
function freeze(t) { t.mock.timers.enable({ apis: ['Date'], now: NOW }); }
const query = extra => ({ month: '2026-10', currency: 'EUR', tab: 'payments', ...extra });


test('same snapshot shares raw sources across summary, filters, tabs and export, with fresh response objects', async t => {
  freeze(t); const db = database();
  const first = await db.service.report(query({ range: 3 }));
  const second = await db.service.report(query({ range: 3, tab: 'expenses', search: 'Materials' }));
  assert.equal(first.current.receivedMinor, 2000);
  assert.equal(second.table.rows[0].id, 'e');
  first.options.categories[0].name = 'caller mutation';
  const third = await db.service.report(query({ range: 3 }));
  assert.equal(third.options.categories[0].name, 'Materials');
  assert.equal(db.reads.filter(r => r.model === 'order').length, 1);
  assert.equal(db.transactions.length, 3);
});

test('every changed mutation snapshot reloads sources, including commits of previously in-flight writers', async t => {
  freeze(t); const db = database();
  await db.service.report(query());
  for (const snapshot of ['100:102:101', '100:102:', '103:103:']) {
    db.data.payment[0].amountMinor += 100;
    db.setSnapshot(snapshot);
    const result = await db.service.report(query());
    assert.equal(result.current.receivedMinor, db.data.payment[0].amountMinor);
  }
  assert.equal(db.reads.filter(r => r.model === 'order').length, 4);
});

test('concurrent identical report callers share one source read but keep their own RR snapshot guard', async t => {
  freeze(t); const db = database();
  const results = await Promise.all(Array.from({ length: 8 }, () => db.service.report(query())));
  assert.equal(db.transactions.length, 8);
  assert.ok(results.every(r => r.current.receivedMinor === 2000));
  assert.equal(db.reads.filter(r => r.model === 'order').length, 1);
});

test('failed read and failed transaction completion are evicted; next same-snapshot call retries', async t => {
  freeze(t);
  for (const stage of ['read', 'commit']) {
    const db = database(); let fail = true;
    const read = db.tx.order.findMany;
    if (stage === 'read') db.tx.order = { findMany: async q => { if (fail) throw Error('read failed'); return read(q); } };
    else {
      // Same injected service database; fail after the complete callback to model commit failure.
      const original = db.prisma.$transaction;
      db.prisma.$transaction = async (...args) => { const value = await original(...args); if (fail) throw Error('commit failed'); return value; };
    }
    await assert.rejects(db.service.report(query()), /failed/);
    fail = false;
    db.data.payment[0].amountMinor = 777;
    const result = await db.service.report(query());
    assert.equal(result.current.receivedMinor, 777);
  }
});

test('snapshot probe failure rolls back its savepoint and bypasses caching', async t => {
  freeze(t); const db = database(); const sql = [];
  db.tx.$queryRaw = async () => { throw Error('probe unavailable'); };
  db.tx.$executeRawUnsafe = async statement => { sql.push(statement); };
  await db.service.report(query()); await db.service.report(query());
  assert.equal(db.reads.filter(r => r.model === 'order').length, 2);
  assert.ok(sql.includes('ROLLBACK TO SAVEPOINT finance_snapshot_key'));
});

test('cache is period/time bounded and valuation 409 remains checked even on raw cache hits', async t => {
  freeze(t); const db = database();
  const first = await db.service.report(query({ range: 3 }));
  await db.service.report(query({ range: 12 }));
  assert.equal(db.reads.filter(r => r.model === 'order').length, 2);
  t.mock.timers.tick(10_001);
  await db.service.report(query({ range: 3 }));
  assert.equal(db.reads.filter(r => r.model === 'order').length, 3);
  db.data.appSetting[1].value.rates[0].numerator = '51';
  db.data.appSetting[1].value.rates[0].decimal = '51';
  for (const exportAll of [false, true]) await assert.rejects(db.service.report(query({ range: 3, valuationVersion: first.valuationVersion }), exportAll), e => e.getStatus() === 409);
});

test('summary is additive and keeps full KPIs/charts while hiding detail rows, and exports ignore projection', async t => {
  freeze(t); const db = database();
  const full = await db.service.report(query({ range: 3 }));
  const summary = await db.service.report(query({ range: 3, projection: 'summary' }));
  assert.equal(summary.projection, 'summary');
  for (const field of ['current','previous','debtMinor','forecastMinor','sourceAnalytics','categoryBreakdown','monthlyTrend','valuationVersion']) assert.deepEqual(summary[field], full[field], field);
  assert.deepEqual(summary.table.rows, []); assert.equal(summary.table.total, 0);
  assert.deepEqual(summary.options, { clients: [], categories: [], orders: [] });
  assert.deepEqual(summary.recentExpenses, []); assert.deepEqual(summary.upcoming, []);
  assert.equal(db.reads.filter(r => r.model === 'order').length, 1);
  assert.equal(await db.service.report(query({ projection: 'summary' }), true), await db.service.report(query(), true));
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const parsed = await pipe.transform(query({ projection: 'summary' }), { type: 'query', metatype: FinanceReportQueryDto });
  assert.equal(parsed.projection, 'summary');
  await assert.rejects(pipe.transform({ projection: 'unsafe' }, { type: 'query', metatype: FinanceReportQueryDto }));
});

function taxBoundary() {
  const state = { reads: 0, failed: false, pending: false, amount: 100, rates: 0, fxFailed: false, pendingRowsByMonth: {} };
  return Object.assign(state, {
    async readReportIn(tx, month) {
      state.reads++;
      assert.equal(typeof tx.$queryRaw, 'function');
      if (state.failed) throw Error('tax SQL unavailable');
      return { month, entries: month === '2026-10' ? [{ id:'tax', rootId:'root', periodId:month, component:'UNIFIED', kind:'FINALIZE', amountMinor:state.amount, paymentId:null, orderId:null, snapshot:{ month } }] : [],
        periods:[{id:month,month,state:'OPEN'}], incomplete:state.pending, pendingStatuses:state.pendingRowsByMonth[month] ?? [], settlementOptions:[], totals:{accruedMinor:state.amount,paidMinor:0,allocatedMinor:0,debtMinor:state.amount,creditMinor:0} };
    },
    async historicalRate(currency, date) {
      state.rates++;
      if (state.fxFailed) throw Error('external FX unavailable');
      return { numerator:'50',denominator:'1',provider:'NBU',currency,incomeDate:date,effectiveDate:date,url:'synthetic',raw:'',fetchedAt:new Date().toISOString() };
    }
  });
}

test('raw tax ledger shares summary/full/filter requests, refreshes on tax-job snapshot, and keeps fiscal detail out of summary', async t => {
  freeze(t); const taxes = taxBoundary(), db = database(undefined, taxes);
  const summary = await db.service.report(query({ range:3, currency:'UAH', projection:'summary' }));
  const full = await db.service.report(query({ range:3, currency:'UAH', tab:'taxes' }));
  assert.equal(taxes.reads,3);
  assert.deepEqual(summary.fiscal.current,full.fiscal.current);
  assert.deepEqual(summary.fiscal.trend,full.fiscal.trend);
  assert.deepEqual(summary.fiscal.expenseStructure,full.fiscal.expenseStructure);
  assert.deepEqual(summary.fiscal.missing,full.fiscal.missing);
  assert.deepEqual(summary.fiscal.rows,[]); assert.deepEqual(summary.fiscal.expenseTable.rows,[]);
  assert.equal(full.fiscal.rows.length,1); assert.equal(full.fiscal.taxSummary.accruedMinor,100);
  taxes.amount=200; db.setSnapshot('101:101:');
  const next=await db.service.report(query({ range:3,currency:'UAH',tab:'taxes' }));
  assert.equal(next.fiscal.taxSummary.accruedMinor,200); assert.equal(taxes.reads,6);
  const csv=await db.service.report(query({ range:3,currency:'UAH',tab:'taxes',projection:'summary' }),true);
  assert.match(csv,/tax/); assert.equal(taxes.reads,6);
});

test('unavailable tax SQL reads never persist as reusable source cache entries', async t => {
  freeze(t); const taxes=taxBoundary(),db=database(undefined,taxes); taxes.failed=true;
  await db.service.report(query({range:3,currency:'UAH'}));
  taxes.failed=false;
  const next=await db.service.report(query({range:3,currency:'UAH'}));
  assert.equal(next.fiscal.taxSummary.accruedMinor,100);
  assert.equal(db.reads.filter(r=>r.model==='order').length,2);
});

test('known pending ledger reuses raws but a worker commit invalidates immediately and recomputes fiscal status', async t => {
  freeze(t); const taxes=taxBoundary(),db=database(undefined,taxes); taxes.pending=true;
  const first=await db.service.report(query({range:3,currency:'UAH',projection:'summary'}));
  const pending=await db.service.report(query({range:3,currency:'UAH',tab:'taxes'}));
  assert.equal(first.fiscal.current.incomplete,true); assert.equal(pending.fiscal.current.incomplete,true);
  assert.equal(taxes.reads,3); assert.equal(db.service.sourceCacheStats().loads,1);
  taxes.pending=false; taxes.amount=222; db.setSnapshot('101:101:');
  const resolved=await db.service.report(query({range:3,currency:'UAH',tab:'taxes'}));
  assert.equal(taxes.reads,6); assert.equal(db.service.sourceCacheStats().loads,2);
  assert.equal(resolved.fiscal.current.incomplete,false);
  assert.equal(resolved.fiscal.taxSummary.accruedMinor,222);
});

test('external FX failures follow existing retry interval even when raw reads hit cache', async t => {
  freeze(t); const taxes=taxBoundary(),db=database(undefined,taxes); taxes.fxFailed=true;
  const failed=await db.service.report(query({range:3,currency:'UAH'}));
  assert.ok(failed.fiscal.missing.some(x=>x.code==='HISTORICAL_FX_UNAVAILABLE'));
  taxes.fxFailed=false;
  t.mock.timers.tick(30_001);
  const recovered=await db.service.report(query({range:3,currency:'UAH'}));
  assert.equal(recovered.fiscal.current.receivedMinor,100000);
  assert.equal(recovered.fiscal.missing.some(x=>x.code==='HISTORICAL_FX_UNAVAILABLE'),false);
});

test('entry limit bounds retained source windows', async t => {
  freeze(t); const db=database();
  for(let month=1;month<=9;month++) await db.service.report(query({month:`2026-${String(month).padStart(2,'0')}`}));
  await db.service.report(query({month:'2026-01'}));
  assert.equal(db.reads.filter(r=>r.model==='order').length,10);
});

// Optional isolated PostgreSQL engine; no production connection or new dependency.
test('PostgreSQL RR snapshot guard reuses unchanged reads and invalidates after direct committed writes', { skip: !process.env.FINANCE_TEST_PGLITE_MODULE }, async t => {
  freeze(t);
  const { PGlite } = await import(pathToFileURL(resolve(process.env.FINANCE_TEST_PGLITE_MODULE)).href);
  const pg = new PGlite();
  try {
    await pg.exec('CREATE TABLE receipts (amount integer); INSERT INTO receipts VALUES (2000); CREATE TABLE unrelated (value integer)');
    const db = database(); const originalRead = db.tx.payment.findMany;
    const guards = [];
    db.tx.payment = { findMany: async q => {
      db.data.payment[0].amountMinor = (await pg.query('SELECT amount FROM receipts')).rows[0].amount;
      return originalRead(q);
    } };
    db.tx.$queryRaw = async sql => {
      const result = await pg.query(sql.join(''));
      guards.push(result.rows[0].snapshot);
      return result.rows;
    };
    db.tx.$executeRawUnsafe = async sql => { await pg.exec(sql); return 0; };
    db.prisma.$transaction = async (run, options) => {
      assert.equal(options.isolationLevel,'RepeatableRead');
      await pg.exec('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try { const value = await run(db.tx); await pg.exec('COMMIT'); return value; }
      catch(error) { await pg.exec('ROLLBACK'); throw error; }
    };
    const first = await db.service.report(query());
    const second = await db.service.report(query({tab:'expenses'}));
    assert.equal(first.current.receivedMinor,2000); assert.equal(second.current.receivedMinor,2000);
    assert.equal(guards[0],guards[1]); assert.equal(db.reads.filter(r=>r.model==='order').length,1);
    await pg.query('UPDATE receipts SET amount=$1',[2111]);
    assert.equal((await db.service.report(query())).current.receivedMinor,2111);
    assert.notEqual(guards[1],guards[2]);
    // No write hooks: even an unrelated committed SQL write changes the guard.
    await pg.query('INSERT INTO unrelated VALUES ($1)',[1]);
    await db.service.report(query());
    assert.notEqual(guards[2],guards[3]);
    assert.equal(db.reads.filter(r=>r.model==='order').length,3);
  } finally { await pg.close(); }
});

test('aggregate cache counters distinguish concurrent hits and source loads without exposing financial data', async t => {
  freeze(t); const db=database();
  await Promise.all(Array.from({length:8},()=>db.service.report(query())));
  const stats=db.service.sourceCacheStats();
  assert.equal(stats.loads,1); assert.equal(stats.hits,7); assert.equal(stats.inflightHits,7);
  assert.equal(stats.entries,1); assert.equal(stats.maxEntries,8); assert.equal(stats.ttlMs,10_000);
  assert.equal(stats.failures,0); assert.equal(stats.bypasses,0);
  assert.equal(Object.values(stats).some(value=>typeof value!=='number'),false);
});

test('cached public reports and CSV match uncached service across currencies, table filters, sources and tabs', async t => {
  freeze(t); const cached=database(), uncached=database();
  uncached.tx.$queryRaw=undefined;
  const variants=[{}, {tab:'expenses'}, {tab:'invoices'}, {tab:'taxes'}, {currency:'USD'}, {source:'WEBSITE'}, {status:'PAID'}, {scope:'forecast'}, {search:'not found'}, {categoryId:'cat',tab:'expenses'}, {clientId:'client',orderId:'o'}, {from:'2026-10-05',to:'2026-10-20'}, {page:2,pageSize:25,sort:'amount',direction:'asc'}, {projection:'summary'}];
  for(const variant of variants) {
    const input=query({range:3,...variant});
    assert.deepEqual(await cached.service.report(input),await uncached.service.report(input),JSON.stringify(variant));
    assert.equal(await cached.service.report(input,true),await uncached.service.report(input,true),JSON.stringify(variant));
  }
  assert.equal(cached.reads.filter(r=>r.model==='order').length,1);
  assert.equal(uncached.reads.filter(r=>r.model==='order').length,variants.length*2);
});

const { FinanceSourceCache } = load('finance/finance-source-cache.ts');
const serializedBytes = value => Buffer.byteLength(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item), 'utf8');
const cacheRead = (cache, key, value, cacheable = () => true) => cache.read(key, async () => value, Promise.resolve(), cacheable);

test('byte budget bypasses oversized raw values without failing or mutating Dates/BigInts', async () => {
  const cache = new FinanceSourceCache(10_000, 8, 64);
  const raw = { date: new Date('2026-10-01'), sequence: 42n, text: 'я'.repeat(100) };
  const first = await cacheRead(cache, 'large', raw);
  assert.deepEqual(first, raw); assert.notEqual(first, raw);
  first.date.setUTCFullYear(2000);
  const second = await cacheRead(cache, 'large', raw);
  assert.equal(second.date.getUTCFullYear(), 2026); assert.equal(second.sequence,42n);
  assert.equal(cache.stats().loads,2); assert.equal(cache.stats().entries,0);
  assert.equal(cache.stats().retainedBytes,0); assert.equal(cache.stats().maxBytes,64);
  assert.equal(cache.stats().failures,0);
});

test('serialized UTF8 byte budget evicts oldest retained data and accounts BigInts exactly', async () => {
  const raw = { date: new Date('2026-10-01'), sequence: 12345678901234567890n, text: 'ж' };
  const bytes = serializedBytes(raw), cache = new FinanceSourceCache(10_000, 8, bytes * 2);
  await cacheRead(cache,'a',raw); await cacheRead(cache,'b',raw);
  assert.equal(cache.stats().retainedBytes,bytes*2);
  await cacheRead(cache,'c',raw);
  assert.equal(cache.stats().entries,2); assert.equal(cache.stats().retainedBytes,bytes*2);
  assert.equal(cache.stats().evictions,1);
  const retained = await cache.read('b',async()=>assert.fail('b must remain retained'),Promise.resolve(),()=>true);
  assert.equal(retained.sequence,raw.sequence); assert.ok(retained.date instanceof Date);
  await cacheRead(cache,'a',raw);
  assert.equal(cache.stats().loads,4); assert.equal(cache.stats().evictions,2);
  assert.ok(cache.stats().retainedBytes<=cache.stats().maxBytes);
});

test('byte accounting releases expired/entry-evicted data and ignores late completion of evicted in-flight reads', async t => {
  freeze(t);
  const raw={value:'data'}, bytes=serializedBytes(raw), cache=new FinanceSourceCache(100,1,bytes*2);
  await cacheRead(cache,'a',raw); assert.equal(cache.stats().retainedBytes,bytes);
  await cacheRead(cache,'b',raw); assert.equal(cache.stats().retainedBytes,bytes);
  t.mock.timers.tick(101); assert.equal(cache.stats().retainedBytes,0);
  let complete;
  const committed=new Promise(resolve=>{complete=resolve;});
  await cache.read('pending',async()=>raw,committed,()=>true);
  await cacheRead(cache,'new',raw);
  complete(); await Promise.resolve(); await Promise.resolve();
  assert.equal(cache.stats().retainedBytes,bytes); assert.equal(cache.stats().entries,1);
});

test('degraded in-flight waiters get explicit unavailable data without retaining or charging it', async () => {
  const cache=new FinanceSourceCache(), raw={unavailable:true};
  let complete;
  const committed=new Promise(resolve=>{complete=resolve;});
  const first=await cache.read('same',async()=>raw,committed,()=>false);
  const waiting=cache.read('same',async()=>assert.fail('must deduplicate'),Promise.resolve(),()=>false);
  complete();
  assert.deepEqual(await waiting,first); assert.equal(first.unavailable,true);
  assert.equal(cache.stats().retainedBytes,0); assert.equal(cache.stats().entries,0);
  assert.equal(cache.stats().failures,0);
});

test('unsizable raw data is returned but never retained or counted as a failed read', async () => {
  const cache=new FinanceSourceCache(),raw={date:new Date('2026-10-01'),sequence:1n}; raw.self=raw;
  const result=await cacheRead(cache,'cyclic',raw);
  assert.equal(result.self,result); assert.equal(result.sequence,1n);
  assert.equal(cache.stats().entries,0); assert.equal(cache.stats().retainedBytes,0);
  assert.equal(cache.stats().failures,0); assert.equal(cache.stats().uncacheable,1);
});

test('summary receipt-confirmation notice counts match full fiscal rows before details are removed', async t => {
  freeze(t); const taxes=taxBoundary(),db=database(undefined,taxes); taxes.pending=true;
  db.data.payment.push(payment('p2'),payment('p3'));
  taxes.pendingRowsByMonth={
    '2026-10':[
      {paymentId:'p',component:'UNIFIED',status:'RECEIPT_CONFIRMATION_REQUIRED'},
      {paymentId:'p',component:'MILITARY',status:'RECEIPT_CONFIRMATION_REQUIRED'},
      {paymentId:'p2',status:'RECEIPT_CONFIRMATION_REQUIRED'},
      {paymentId:'p3',status:'MANUAL_RECONCILIATION_REQUIRED'},
      {paymentId:null,status:'RECEIPT_CONFIRMATION_REQUIRED'},
    ],
    '2026-09':[{paymentId:'p3',status:'RECEIPT_CONFIRMATION_REQUIRED'}],
  };
  const input=query({range:3,currency:'UAH'});
  const full=await db.service.report(input);
  const summary=await db.service.report({...input,projection:'summary'});
  const count=fiscal=>fiscal.current.incomplete ? new Set(fiscal.rows.filter(row=>row.period===fiscal.current.month&&row.source==='PENDING'&&row.status==='RECEIPT_CONFIRMATION_REQUIRED'&&row.paymentId).map(row=>row.paymentId)).size : 0;
  assert.equal(count(full.fiscal),2);
  assert.equal(summary.receiptConfirmationCount,2);
  assert.equal(summary.receiptConfirmationCount,count(full.fiscal));
  assert.deepEqual(summary.fiscal.rows,[]); assert.deepEqual(summary.fiscal.current,full.fiscal.current);
  assert.equal(Object.hasOwn(full,'receiptConfirmationCount'),false);
  assert.equal(db.service.sourceCacheStats().loads,1);
  taxes.pending=false; taxes.pendingRowsByMonth={}; db.setSnapshot('101:101:');
  const resolved=await db.service.report({...input,projection:'summary'});
  assert.equal(resolved.fiscal.current.incomplete,false); assert.equal(resolved.receiptConfirmationCount,0);
});
