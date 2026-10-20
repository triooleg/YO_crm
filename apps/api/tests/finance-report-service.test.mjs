import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const { FinanceController } = load('finance/finance.controller.ts');
const { FinanceReportQueryDto } = load('finance/finance-report.dto.ts');
const { RolesGuard } = load('auth/roles.guard.ts');
const { SessionGuard } = load('auth/session.guard.ts');
const { Reflector } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { GUARDS_METADATA } = require('@nestjs/common/constants');

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
function database(data = sources()) {
  const reads = [], transactions = [];
  const delegates = transactional => Object.fromEntries(Object.keys(data).map(model => [model, new Proxy({}, { get: (_, method) => {
    if (!['findMany', 'findFirst'].includes(method)) return () => assert.fail(`Unexpected Prisma operation ${model}.${String(method)}`);
    return async query => { reads.push({ model, query, transactional }); const rows = selectRows(data[model], query); return method === 'findFirst' ? rows[0] || null : rows; };
  } })]));
  const tx = delegates(true);
  const prisma = { ...delegates(false), $transaction: async (run, options) => { transactions.push(options); return run(tx); } };
  return { service: new FinanceReportService(prisma), reads, transactions, data };
}
function freeze(t) { t.mock.timers.enable({ apis: ['Date'], now: NOW }); }
const query = extra => ({ month: '2026-10', currency: 'EUR', tab: 'payments', ...extra });

test('report and export read one repeatable snapshot, with no economic writes or root-delegate reads', async t => {
  freeze(t); const db = database(); const before = JSON.stringify(db.data);
  const report = await db.service.report(query());
  assert.equal(report.current.receivedMinor, 2000);
  assert.equal(report.current.expensesMinor, 1000);
  await db.service.report(query({ valuationVersion: report.valuationVersion }), true);
  assert.equal(db.transactions.length, 2);
  for (const options of db.transactions) assert.equal(options.isolationLevel, 'RepeatableRead');
  assert.ok(db.reads.every(read => read.transactional));
  assert.equal(JSON.stringify(db.data), before);
});

test('report crosses the 500-row boundary for every ledger without gaps or duplicate totals', async t => {
  freeze(t);
  const ids = Array.from({ length: 501 }, (_, i) => String(i).padStart(4, '0'));
  const db = database(sources({ order: ids.map(id => order(id)), payment: ids.map(id => payment(id, { orderId: id, amountMinor: 100 })), expense: ids.map(id => expense(id, { amountMinor: 2, orderId: id })), invoice: ids.map(id => invoice(id, { orderId: id })), expenseCategory: ids.map(id => ({ id, name: id, active: true, expenses: [] })) }));
  const result = await db.service.report(query({ page: 51, pageSize: 10, sort: 'number', direction: 'asc' }));
  assert.equal(result.table.total, 501);
  assert.equal(result.table.rows.length, 1);
  assert.equal(result.table.rows[0].id, '0500');
  assert.equal(result.current.receivedMinor, 50100);
  assert.equal(result.current.expensesMinor, 1002);
  assert.equal(result.invoiceCount, 501);
  assert.equal(result.options.categories.length, 501);
  for (const model of ['order', 'payment', 'expense', 'invoice', 'expenseCategory']) {
    const calls = db.reads.filter(read => read.model === model);
    assert.equal(calls.length, 2, model);
    assert.ok(calls.every(call => call.query.take > 0 && call.query.take <= 500), model);
    assert.equal(calls[1].query.cursor.id, '0499', model);
    assert.equal(calls[1].query.skip, 1, model);
  }
});

test('cash includes archived-order receipts, settlement includes older receipts, and archived/void ledgers stay excluded', async t => {
  freeze(t);
  const db = database(sources({
    order: [order(), order('archived', { archivedAt: date('2026-09-01') })],
    payment: [payment('old', { amountMinor: 3000, receivedAt: date('2025-01-01') }), payment('archived-cash', { orderId: 'archived', order: { archivedAt: date('2026-09-01') }, amountMinor: 700 }), payment('voided', { amountMinor: 99999, voidedAt: date('2026-10-02') })],
    expense: [expense(), expense('archived', { archivedAt: date('2026-10-11'), amountMinor: 99999 }), expense('next', { incurredAt: date('2026-11-01'), amountMinor: 99999 })],
    invoice: [invoice(), invoice('archived', { archivedAt: date('2026-10-11') }), invoice('next', { issueDate: date('2026-11-01') })],
    expenseCategory: [{ id: 'cat', name: 'Materials', active: false, expenses: [expense()] }, { id: 'unused', name: 'Unused', active: false, expenses: [] }],
  }));
  const result = await db.service.report(query());
  assert.equal(result.current.receivedMinor, 700);
  assert.equal(result.current.expensesMinor, 1000);
  assert.equal(result.table.total, 1);
  assert.equal(result.table.rows[0].paidMinor, 3000);
  assert.equal(result.debtMinor, 7000);
  assert.equal(result.invoiceCount, 1);
  assert.deepEqual(result.options.categories, [{ id: 'cat', name: 'Materials', active: false }]);
  assert.equal(db.reads.find(read => read.model === 'payment').query.where.voidedAt, null);
  for (const model of ['order', 'expense', 'invoice']) assert.equal(db.reads.find(read => read.model === model).query.where.archivedAt, null);
});

test('source query predicates bound the UTC reporting window without losing lifetime settlement or historical categories', async t => {
  freeze(t); const db = database();
  await db.service.report(query({ range: 3 }));
  const where = model => db.reads.find(read => read.model === model).query.where;
  // October with a three-month chart requires Aug 1 through Nov 1 exclusive.
  for (const model of ['expense', 'invoice']) {
    const field = model === 'expense' ? 'incurredAt' : 'issueDate';
    const first = model === 'expense' ? '2026-08-01T00:00:00Z' : '2026-10-01T00:00:00Z';
    assert.equal(matches({ archivedAt: null, [field]: date(first) }, where(model)), true);
    assert.equal(matches({ archivedAt: null, [field]: new Date(Date.parse(first) - 1) }, where(model)), false);
    assert.equal(matches({ archivedAt: null, [field]: date('2026-11-01T00:00:00Z') }, where(model)), false);
    assert.equal(matches({ archivedAt: date('2026-10-10'), [field]: date('2026-10-10') }, where(model)), false);
  }
  const paymentWhere = where('payment');
  assert.equal(matches(payment('old-active', { receivedAt: date('2020-01-01') }), paymentWhere), true);
  assert.equal(matches(payment('archived-old', { order: { archivedAt: date('2026-01-01') }, receivedAt: date('2026-07-31T23:59:59.999Z') }), paymentWhere), false);
  assert.equal(matches(payment('archived-chart', { order: { archivedAt: date('2026-01-01') }, receivedAt: date('2026-08-01') }), paymentWhere), true);
  assert.equal(matches(payment('void', { voidedAt: date('2026-10-10') }), paymentWhere), false);
  assert.equal(matches({ active: false, expenses: [expense()] }, where('expenseCategory')), true);
  assert.equal(matches({ active: false, expenses: [expense('arch', { archivedAt: date('2026-10-10') })] }, where('expenseCategory')), false);
});

test('a later database batch failure rejects report/export rather than presenting partial balances or CSV', async t => {
  freeze(t);
  for (const exportAll of [false, true]) {
    let calls = 0;
    const failure = new Error('synthetic database interruption');
    const db = {
      $transaction: async run => run({
        appSetting: { findMany: async () => [] },
        order: { findMany: async () => {
          if (++calls === 2) throw failure;
          return Array.from({ length: 500 }, (_, i) => order(String(i).padStart(4, '0')));
        } },
      }),
    };
    await assert.rejects(() => new FinanceReportService(db).report(query(), exportAll), error => error === failure);
    assert.equal(calls, 2);
  }
});

test('filtered USD pages and CSV export contain the same sorted rows and rounded values', async t => {
  freeze(t);
  const expenses = Array.from({ length: 13 }, (_, i) => expense(`e${String(i).padStart(2, '0')}`, { amountMinor: 100 + i, notes: i === 0 ? '=SUM(A1)' : 'needle', currency: 'EUR' }));
  const db = database(sources({ expense: [...expenses, expense('excluded', { categoryId: 'other', category: { name: 'Other' }, amountMinor: 90000 })] }));
  const input = query({ tab: 'expenses', currency: 'USD', categoryId: 'cat', orderId: 'o', sort: 'amount', direction: 'asc', pageSize: 10 });
  const first = await db.service.report(input);
  const second = await db.service.report({ ...input, page: 2, valuationVersion: first.valuationVersion });
  assert.equal(first.table.total, 13); assert.equal(second.table.rows.length, 3);
  assert.equal(first.table.rows[0].amountMinor, 125);
  assert.equal(second.table.rows.at(-1).amountMinor, 140);
  const csv = await db.service.report({ ...input, page: 2, valuationVersion: first.valuationVersion }, true);
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
  assert.equal(lines.length, 14);
  const combined = [...first.table.rows, ...second.table.rows];
  for (const [index, row] of combined.entries()) {
    assert.ok(lines[index + 1].includes(`"${(row.amountMinor / 100).toFixed(2).replace('.', ',')}"`));
    assert.ok(lines[index + 1].includes('"USD"'));
  }
  assert.match(lines[1], /"'=SUM\(A1\)"/);
  assert.equal(first.current.expensesMinor, second.current.expensesMinor);
});

test('changed valuation rejects page/export/detail before reading monetary rows', async t => {
  freeze(t); const db = database(); const first = await db.service.report(query());
  db.data.appSetting[1].value.rates[0].numerator = '51';
  db.data.appSetting[1].value.rates[0].decimal = '51';
  const before = db.reads.length;
  for (const operation of [() => db.service.report(query({ valuationVersion: first.valuationVersion })), () => db.service.report(query({ valuationVersion: first.valuationVersion }), true), () => db.service.order('o', query({ valuationVersion: first.valuationVersion }))]) {
    await assert.rejects(operation, error => error.getStatus() === 409);
  }
  assert.ok(db.reads.slice(before).every(read => read.model === 'appSetting'));
});

test('detail preserves archived invoice context and filters voided payment history; missing order is 404', async t => {
  freeze(t);
  const db = database(sources({ order: [order('o', { archivedAt: date('2026-09-01'), payments: [payment('active'), payment('void', { voidedAt: date('2026-10-02') })], invoices: [invoice(), invoice('arch', { archivedAt: date('2026-10-02') })] })] }));
  const result = await db.service.order('o', query());
  assert.equal(result.number, 'KC-o');
  assert.equal(result.payments.length, 1); assert.equal(result.payments[0].id, 'active');
  assert.equal(result.invoices.length, 1);
  assert.ok(db.reads.every(read => read.transactional));
  await assert.rejects(() => db.service.order('absent', query()), error => error.getStatus() === 404);
});

test('options search finds an order beyond the first page, deduplicates clients and excludes archived orders', async () => {
  const many = Array.from({ length: 110 }, (_, i) => order(String(i).padStart(3, '0')));
  const db = database(sources({ order: [...many, order('outside', { number: 'UNIQUE-602', clientId: 'outside' }), order('arch', { number: 'UNIQUE-ARCH', archivedAt: new Date() })] }));
  const result = await db.service.options(' unique ');
  assert.deepEqual(result.orders.map(row => row.number), ['UNIQUE-602']);
  assert.deepEqual(result.clients, [{ id: 'outside', name: 'Client' }]);
  const all = await db.service.options();
  assert.equal(all.orders.length, 100); assert.equal(all.clients.length, 1);
});

test('production ValidationPipe transforms valid paging and rejects unsafe reporting inputs before database reads', async t => {
  freeze(t); const db = database();
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const parse = value => pipe.transform(value, { type: 'query', metatype: FinanceReportQueryDto });
  const valid = await parse({ month: '2026-10', page: '2', pageSize: '25', range: '12', currency: 'USD', economicWrite: 'ignored' });
  assert.equal(valid.page, 2); assert.equal(valid.pageSize, 25); assert.equal(valid.range, 12);
  assert.equal(valid.economicWrite, undefined);
  for (const input of [{ page: '0' }, { page: '1.5' }, { pageSize: '1000' }, { range: '100' }, { currency: 'GBP' }, { sort: 'rawSql' }, { direction: 'random' }, { search: 'x'.repeat(201) }]) {
    await assert.rejects(() => parse(input), error => error.getStatus() === 400);
  }
  for (const input of [{ month: '2026-13' }, { from: '2026-02-30' }, { from: '2026-10-20', to: '2026-10-01' }, { status: 'SHIPPED', tab: 'payments' }]) {
    const parsed = await parse(input);
    await assert.rejects(() => db.service.report(parsed), error => error.getStatus() === 400);
  }
  assert.equal(db.reads.length, 0);
});

test('every page size offered by the actual Finance UI survives query serialization, API validation and report pagination', async t => {
  freeze(t);
  // Load the real web module; transpilation removes its type-only React imports.
  // Do not duplicate its allowlist here: an unsupported new UI option must fail.
  const { FINANCE_PAGE_SIZES, financeReportQuery } = load(fileURLToPath(new URL('../../web/lib/finance-report.ts', import.meta.url)));
  assert.ok(Array.isArray(FINANCE_PAGE_SIZES) && FINANCE_PAGE_SIZES.length > 0, 'Finance UI must export its offered page sizes');
  assert.ok(FINANCE_PAGE_SIZES.every(size => Number.isInteger(size) && size > 0));
  const count = Math.max(...FINANCE_PAGE_SIZES) * 2 + 1;
  const db = database(sources({ order: Array.from({ length: count }, (_, i) => order(String(i).padStart(4, '0'))), payment: [], expense: [], invoice: [] }));
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  for (const pageSize of FINANCE_PAGE_SIZES) {
    const serialized = financeReportQuery(query({ page: 2, pageSize, sort: 'number', direction: 'asc' }));
    const parsed = await pipe.transform(Object.fromEntries(serialized), { type: 'query', metatype: FinanceReportQueryDto });
    assert.equal(parsed.pageSize, pageSize, `DTO must accept the UI option ${pageSize}`);
    const result = await db.service.report(parsed);
    assert.equal(result.table.pageSize, pageSize, `service must preserve the UI option ${pageSize}`);
    assert.equal(result.table.page, 2);
    assert.equal(result.table.rows.length, pageSize);
    assert.equal(result.table.rows[0].id, String(pageSize).padStart(4, '0'));
  }
});

test('all reporting handlers enforce the finance read roles with real Nest guards; export forwards identical query', async () => {
  const guards = Reflect.getMetadata(GUARDS_METADATA, FinanceController);
  assert.ok(guards.includes(SessionGuard)); assert.ok(guards.includes(RolesGuard));
  const roleGuard = new RolesGuard(new Reflector());
  for (const method of ['report', 'exportReport', 'reportOptions', 'reportOrder']) {
    for (const role of ['OWNER', 'ADMIN', 'ACCOUNTANT', 'MANAGER', 'PRODUCTION', 'SEAMSTRESS', undefined]) {
      const context = { getHandler: () => FinanceController.prototype[method], getClass: () => FinanceController, switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }) };
      if (['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(role)) assert.equal(roleGuard.canActivate(context), true);
      else assert.throws(() => roleGuard.canActivate(context), error => error.getStatus() === 403);
    }
  }
  const calls = [], headers = {}, input = query({ tab: 'expenses', page: 2, currency: 'USD', categoryId: 'cat' });
  const controller = new FinanceController({}, {}, { report: async (...args) => { calls.push(args); return 'csv'; } });
  const response = { setHeader: (key, value) => { headers[key] = value; }, send: value => value };
  assert.equal(await controller.exportReport(input, response), 'csv');
  assert.equal(calls[0][0], input); assert.equal(calls[0][1], true);
  assert.equal(headers['Content-Type'], 'text/csv; charset=utf-8');
  assert.equal(headers['Cache-Control'], 'no-store');
});

test('archived cash order resolves real persisted WEBSITE provenance inside the same read-only report snapshot',async t=>{
 freeze(t);const {CONFIRMED_WEBSITE_SOURCE}=load('orders/order-source.ts');
 const archived=order('archived',{archivedAt:date('2026-09-01'),sourceSystem:'KEYCRM',sourceAccount:CONFIRMED_WEBSITE_SOURCE.account,externalId:'42',sourceLinkMode:'IMPORTED',externalData:{source_id:12,secret:'never public'},activities:[{id:'event',createdAt:date('2026-09-01'),type:'KEYCRM_ORDER_IMPORTED',metadata:{keycrmOrderId:'42',sourceName:'Вебсайт'}}]});
 const db=database(sources({order:[order(),archived],payment:[payment(),payment('archived-cash',{orderId:'archived',order:{archivedAt:date('2026-09-01')},amountMinor:700})],expense:[],invoice:[]}));
 const before=JSON.stringify(db.data),result=await db.service.report(query({source:'WEBSITE'}));
 assert.equal(result.sourceAnalytics.websiteReceivedMinor,700);assert.equal(result.current.receivedMinor,2700);assert.equal(result.table.total,0);
 assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!JSON.stringify(result).includes('sourceName'));assert.ok(db.reads.every(read=>read.transactional));assert.equal(JSON.stringify(db.data),before);
 assert.ok(db.reads.some(read=>read.model==='order'&&read.query.where.id?.in.includes('archived')));
});
