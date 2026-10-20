import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const apiRequire = createRequire(path.join(root, 'apps/api/package.json'));
const ts = apiRequire('typescript');
apiRequire('reflect-metadata');
const NOW = Date.parse('2026-10-15T10:00:00Z');
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}
const modules = new Map();
function load(relative) {
  const filename = path.resolve(root, 'apps/api/src', relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} }; modules.set(filename, module);
  const javascript = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  const localRequire = name => {
    const target = path.resolve(path.dirname(filename), name + '.ts');
    // No real database/client is instantiated. Only the injected Prisma boundary is doubled.
    if (name === '../prisma.service') return { PrismaService: class {} };
    return name.startsWith('.') && fs.existsSync(target) ? load(target) : apiRequire(name);
  };
  vm.runInNewContext(javascript, { module, exports: module.exports, require: localRequire, Date: FixedDate, Intl, Buffer, console, process }, { filename });
  return module.exports;
}
const model = load('finance/finance-report-model.ts');
const { ShippingService } = load('shipping/shipping.service.ts');
const order = () => ({ id: 'o', number: 'SYNTHETIC-1', clientId: 'c', client: { displayName: 'Synthetic' }, currency: 'EUR', priceMinor: 10000, salesStatus: 'NEW_LEAD', paymentStatus: 'UNPAID', shippingStatus: 'NOT_READY', type: 'ACCESSORY', deliveryMinor: 0, depositRequiredMinor: 5000, payments: [], productionSlot: null });
const category = { id: 'delivery', name: 'Доставка', active: true };
const expense = extra => ({ id: 'e', categoryId: category.id, category, orderId: 'o', order: { number: 'SYNTHETIC-1' }, amountMinor: 800, currency: 'EUR', incurredAt: new Date('2026-09-30T12:00:00Z'), archivedAt: null, orderShipment: { id: 's' }, ...extra });
const sources = extra => ({ orders: [order()], payments: [{ id: 'p', orderId: 'o', amountMinor: 2000, currency: 'EUR', receivedAt: new Date('2026-10-01T12:00:00Z'), method: 'BANK_TRANSFER' }], expenses: [expense({ incurredAt: new Date('2026-10-02T12:00:00Z') })], invoices: [], categories: [category], ...extra });
const query = { month: '2026-10', currency: 'EUR', tab: 'payments', range: 6, pageSize: 10 };
const valuation = { provider: 'NBU', cache: null };
const build = (data, overrides = {}, val = valuation, exportAll = false) => model.buildFinanceReport(data, { ...query, ...overrides }, val, new Date(NOW), exportAll);

function parcelHarness(expenseOverrides = {}) {
  let ledger = expense(expenseOverrides), parcel = { id: 's', orderId: 'o', status: 'READY', carrier: 'DHL', currency: 'EUR', customerChargeMinor: 0, atelierCostMinor: 800, atelierExpenseId: 'e', isPrimary: true, trackingNumber: null, shippedAt: null, deliveredAt: null, updatedAt: new Date('2026-09-30T12:00:00Z') };
  const audits = [], expenseWrites = [];
  const parent = { ...order(), orderShipments: [parcel] };
  const tx = {
    $executeRawUnsafe: async () => 1,
    appSetting: { findUnique: async () => null },
    order: { findFirst: async () => parent, findUniqueOrThrow: async () => parent, update: async ({ data }) => Object.assign(parent, data) },
    orderShipment: { findFirst: async () => parcel, findMany: async () => [parcel], update: async ({ data }) => (parcel = { ...parcel, ...data }) },
    orderItemInstance: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    expenseCategory: { findFirst: async () => category },
    expense: { findUnique: async () => ledger, update: async ({ data }) => { expenseWrites.push(data); return (ledger = { ...ledger, ...data }); } },
    shipment: { upsert: async () => ({}) },
    auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
    activity: { create: async ({ data }) => data },
  };
  const service = new ShippingService({ $transaction: async fn => fn(tx) });
  const save = (overrides = {}) => service.updateShipment('o', 's', { carrier: 'DHL', status: 'READY', currency: 'EUR', customerChargeMinor: 0, atelierCostMinor: 800, instanceIds: [], expectedUpdatedAt: parcel.updatedAt.toISOString(), ...overrides }, { id: 'synthetic-owner' });
  return { save, ledger: () => ledger, audits, expenseWrites };
}

test('saving an unsent parcel preserves its existing expense cash month and audit date', async () => {
  const h = parcelHarness();
  const totals = () => ['2026-09', '2026-10'].map(month => build(sources({ payments: [], expenses: [h.ledger()] }), { month }).current.expensesMinor);
  assert.deepEqual(totals(), [800, 0]);
  const result = await h.save({ weightGrams: 123 });
  assert.equal(result.status, 'READY'); assert.equal(result.shippedAt, null);
  assert.equal(result.atelierExpenseId, 'e');
  assert.equal(h.expenseWrites.length, 1);
  assert.equal(h.ledger().id, 'e'); assert.equal(h.ledger().amountMinor, 800); assert.equal(h.ledger().currency, 'EUR');
  assert.equal(h.ledger().incurredAt.toISOString(), '2026-09-30T12:00:00.000Z');
  assert.deepEqual(totals(), [800, 0]);
  const audit = h.audits.find(x => x.entityType === 'Expense');
  assert.equal(audit.action, 'UPDATE');
  assert.equal(audit.before.incurredAt.toISOString(), '2026-09-30T12:00:00.000Z');
  assert.equal(audit.after.incurredAt.toISOString(), '2026-09-30T12:00:00.000Z');
});

test('parcel expense compatibility: explicit shipment date is used; previously archived positive expense is reactivated; zero cost archives instead', async () => {
  const sent = parcelHarness();
  await sent.save({ status: 'SHIPPED', trackingNumber: 'SYNTHETIC-TRACK', shippedAt: '2026-09-30T15:00:00Z' });
  assert.equal(sent.ledger().incurredAt.toISOString(), '2026-09-30T15:00:00.000Z');
  const archived = parcelHarness({ archivedAt: new Date('2026-10-01T00:00:00Z') });
  await archived.save();
  assert.equal(archived.ledger().archivedAt, null);
  assert.equal(archived.ledger().incurredAt.toISOString(), '2026-09-30T12:00:00.000Z');
  const zero = parcelHarness();
  const result = await zero.save({ atelierCostMinor: 0 });
  assert.equal(result.atelierExpenseId, null);
  assert.equal(zero.ledger().archivedAt.toISOString(), '2026-10-15T10:00:00.000Z');
  assert.equal(zero.ledger().incurredAt.toISOString(), '2026-09-30T12:00:00.000Z');
});
