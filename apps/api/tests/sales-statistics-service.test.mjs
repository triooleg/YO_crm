import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
const native = createRequire(import.meta.url); native('reflect-metadata');
const modules = new Map();
function load(path) {
  const file = resolve(fileURLToPath(new URL('../src/', import.meta.url)), path);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true } }).outputText;
  const local = createRequire(file);
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: file })((name) => name.startsWith('.') && existsSync(resolve(dirname(file), name + '.ts')) ? load(resolve(dirname(file), name + '.ts')) : local(name), module, module.exports);
  return module.exports;
}
const NOW = new Date('2026-10-18T10:00:00Z');
const date = value => new Date(value);
const actor = { id: 'owner', role: 'OWNER' };
const query = { from: '2026-10-01', to: '2026-10-31', currency: 'EUR' };
function matches(row, where = {}) { return Object.entries(where).every(([key, value]) => value === null ? row[key] == null : value && typeof value === 'object' && 'in' in value ? value.in.includes(row[key]) : row[key] === value); }
function project(row, select) {
  if (!select) return structuredClone(row);
  return Object.fromEntries(Object.entries(select).filter(([, value]) => value).map(([key, value]) => {
    const raw = row[key];
    if (value === true) return [key, raw];
    if (Array.isArray(raw)) return [key, raw.filter(item => matches(item, value.where)).slice(0, value.take || Infinity).map(item => project(item, value.select))];
    return [key, raw == null ? raw : project(raw, value.select)];
  }));
}
function database(count = 1) {
  const dataset = { order: [], payment: [], expense: [], clientMergeRedirect: [], client: [{ id: 'c', displayName: '=Private Client', country: 'Canada' }], appSetting: [{ key: 'exchangeRateProvider', value: 'NBU' }] };
  for (let i = 0; i < count; i++) {
    const id = `o${String(i).padStart(4, '0')}`;
    dataset.order.push({ id, number: 'KC-' + i, clientId: 'c', client: dataset.client[0], createdAt: date('2026-10-02T12:00:00Z'), updatedAt: NOW, archivedAt: null, country: 'France', type: 'GROUP_ORDER', discipline: 'RHYTHMIC_GYMNASTICS', priceMinor: 12000, currency: 'EUR', depositRequiredMinor: 6000, salesStatus: 'ORDER_CONFIRMED', paymentStatus: 'PARTIALLY_PAID', shippingStatus: 'NOT_READY', sourceSystem: null, sourceAccount: null, sourceLinkMode: null, externalId: null, externalData: null, activities: [{ id: 'a' + i, type: 'ORDER_CREATED', metadata: {}, createdAt: NOW }], items: [{ id: 'item-' + i, quantity: 6, priceMinor: 2000, discipline: 'RHYTHMIC_GYMNASTICS', archivedAt: null, instances: Array.from({ length: 6 }, (_, j) => ({ id: 'piece-' + i + '-' + j, archivedAt: null })) }] });
    dataset.payment.push({ id: 'p' + i, orderId: id, amountMinor: 6000, currency: 'EUR', receivedAt: date('2026-10-03T12:00:00Z'), voidedAt: null, appliedAmountMinor: null, appliedCurrency: null, exchangeRateSnapshot: null });
  }
  const readCounts = {}, tx = {};
  for (const [table, rows] of Object.entries(dataset)) tx[table] = new Proxy({}, { get(_target, method) {
    if (method !== 'findMany') throw new Error('Unexpected write or unsupported database method: ' + table + '.' + String(method));
    return async (args = {}) => {
      readCounts[table] = (readCounts[table] || 0) + 1;
      let selected = rows.filter(row => matches(row, args.where)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
      if (args.cursor) selected = selected.slice(selected.findIndex(row => row.id === args.cursor.id) + (args.skip || 0));
      return selected.slice(0, args.take || Infinity).map(row => project(row, args.select));
    };
  } });
  return { dataset, readCounts, db: { $transaction: async (callback, options) => { assert.equal(options.isolationLevel, 'RepeatableRead'); return callback(tx); } } };
}
test('real statistics service reads the complete multi-batch cohort and exports the same pinned values', async () => {
  const { SalesStatisticsService } = load('overview/sales-statistics.service.ts');
  const { db, dataset, readCounts } = database(501), before = JSON.stringify(dataset);
  const service = new SalesStatisticsService(db), report = await service.report(query, actor, NOW);
  assert.equal(report.current.orders, 501); assert.equal(report.current.pieces, 3006);
  assert.equal(report.current.amountMinor, 6012000); assert.equal(report.current.receivedMinor, 3006000);
  assert.equal(report.countries[0].key, 'FR'); assert.equal(report.sources.find(row => row.key === 'MANUAL').orders, 501);
  assert.equal(report.current.clients, 1); assert.ok(readCounts.order >= 2);
  const csv = service.export({ ...query, valuationVersion: report.valuationVersion }, actor, NOW);
  assert.ok(csv.startsWith('\uFEFF')); assert.match(csv, /6012000/); assert.match(csv, /3006/);
  assert.equal(JSON.stringify(dataset), before);
});
test('server-side financial projection and actor-bound export prevent role or snapshot leakage', async () => {
  const { SalesStatisticsService } = load('overview/sales-statistics.service.ts');
  const { db } = database(), service = new SalesStatisticsService(db), manager = { id: 'manager', role: 'MANAGER' };
  const report = await service.report(query, manager, NOW);
  assert.equal(report.financial, false); assert.equal(report.current.amountMinor, null); assert.equal(report.current.receivedMinor, null);
  assert.ok(!JSON.stringify(report).includes('12000')); assert.ok(report.clients.every(row => row.lifetimeAmountMinor == null));
  const csv = service.export({ ...query, valuationVersion: report.valuationVersion }, manager, NOW);
  assert.doesNotMatch(csv, /Стоимость заказов, мин|Средний чек, мин|12000|6000/);
  assert.match(csv, /Физические изделия/);
  assert.throws(() => service.export({ ...query, valuationVersion: report.valuationVersion }, actor, NOW), /Обновите статистику/);
  assert.throws(() => service.export({ ...query, country: 'CA', valuationVersion: report.valuationVersion }, manager, NOW), /Обновите статистику/);
  assert.throws(() => service.export({ ...query, valuationVersion: report.valuationVersion }, manager, new Date(NOW.getTime() + 120001)), /Обновите статистику/);
  await assert.rejects(service.report(query, { id: 'p', role: 'PRODUCTION' }, NOW), /Недостаточно прав/);
});
test('real controller preserves session/roles guards, validated query and CSV response headers', async () => {
  const { SalesStatisticsController } = load('overview/sales-statistics.controller.ts');
  const { SalesStatisticsQueryDto } = load('overview/sales-statistics.dto.ts');
  const { SalesStatisticsService } = load('overview/sales-statistics.service.ts');
  const { RolesGuard } = load('auth/roles.guard.ts');
  const { Reflector } = native('@nestjs/core'), { ValidationPipe } = native('@nestjs/common'), { GUARDS_METADATA } = native('@nestjs/common/constants');
  assert.equal(Reflect.getMetadata(GUARDS_METADATA, SalesStatisticsController).length, 2);
  const guard = new RolesGuard(new Reflector());
  const context = role => ({ getHandler: () => SalesStatisticsController.prototype.report, getClass: () => SalesStatisticsController, switchToHttp: () => ({ getRequest: () => ({ user: { id: role, role } }) }) });
  for (const role of ['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT']) assert.equal(guard.canActivate(context(role)), true);
  assert.throws(() => guard.canActivate(context('PRODUCTION')), /Недостаточно прав/);
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  await assert.rejects(pipe.transform({ from: ['2026-10-01'] }, { type: 'query', metatype: SalesStatisticsQueryDto }));
  const { db } = database(), service = new SalesStatisticsService(db), controller = new SalesStatisticsController(service);
  const exportQuery = { ...query, tab: 'clients' };
  const report = await service.report(exportQuery, actor, NOW), headers = {};
  let sent;
  // Pin test clock only at the public service export call; all financial logic stays real.
  const originalExport = service.export.bind(service); service.export = (q, a) => originalExport(q, a, NOW);
  controller.export({ ...exportQuery, valuationVersion: report.valuationVersion }, { user: actor }, { setHeader: (k, v) => { headers[k] = v; }, send: value => { sent = value; } });
  assert.equal(headers['Content-Type'], 'text/csv; charset=utf-8'); assert.match(headers['Content-Disposition'], /sales-statistics.csv/);
  assert.match(sent, /'=/); // formula-like client labels remain inert CSV text when client tab is exported.
});
