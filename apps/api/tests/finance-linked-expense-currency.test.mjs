import {loadTargetModule} from './overview-target-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const nativeRequire = createRequire(import.meta.url);
function harness({ failMirror = false, linked = true } = {}) {
  let expense = { id: 'expense', orderId: 'order', categoryId: 'delivery', amountMinor: 1200,
    currency: 'EUR', incurredAt: new Date('2026-10-01'), archivedAt: null };
  let parcel = { id: 'parcel', orderId: 'order', atelierExpenseId: linked ? 'expense' : null,
    atelierCostMinor: 1200, currency: 'EUR', customerChargeMinor: 1500,
    updatedAt: new Date('2099-01-01') };
  let audits = []; const calls = [];
  const tx = {
    $executeRawUnsafe: async (...args) => { calls.push(['lock', ...args]); return 1; },
    expense: {
      findFirst: async () => { calls.push(['read']); return structuredClone({ ...expense, orderShipment: parcel.atelierExpenseId === expense.id ? parcel : null }); },
      update: async ({ data }) => { expense = { ...expense, ...Object.fromEntries(Object.entries(data).filter(([,v]) => v !== undefined)) }; return structuredClone(expense); },
    },
    orderShipment: { update: async ({ data }) => { if (failMirror) throw new Error('synthetic mirror failure'); parcel = { ...parcel, ...data }; return structuredClone(parcel); } },
    order: { findFirst: async () => ({ id: 'other-order' }) },
    auditLog: { create: async ({ data }) => { audits.push(structuredClone(data)); return {}; } },
  };
  const prisma = { $transaction: async run => {
    const before = structuredClone({ expense, parcel, audits });
    try { return await run(tx); } catch (error) { ({ expense, parcel, audits } = before); throw error; }
  } };
  const source = readFileSync(new URL('../src/finance/finance.service.ts', import.meta.url), 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const module = { exports: {} };
  const require = specifier => {
    if (specifier === '../prisma.service' || specifier === './finance.dto' || specifier === './production-settings' || specifier === './invoice-pdf') return {};
    if (specifier === './exchange-rates') return { appliedPaymentMinor: () => 0 };
    if (specifier === './invoice-number') return loadTargetModule('finance/invoice-number.ts');
    return nativeRequire(specifier);
  };
  vm.runInNewContext(javascript, { module, exports: module.exports, require, Date });
  return { service: new module.exports.FinanceService(prisma), calls, state: () => ({ expense, parcel, audits }) };
}
const actor = { id: 'accountant' };

test('linked expense amount and currency edit updates the parcel mirror and invalidates an open editor', async () => {
  const h = harness();
  await h.service.updateExpense('expense', { amountMinor: 82550, currency: 'UAH' }, actor);
  const { expense, parcel, audits } = h.state();
  assert.equal(expense.currency, 'UAH'); assert.equal(expense.amountMinor, 82550);
  assert.equal(parcel.atelierCostMinor, 82550); assert.equal(parcel.currency, 'EUR');
  assert.equal(parcel.customerChargeMinor, 1500);
  assert.ok(parcel.updatedAt > new Date('2099-01-01'));
  assert.ok(h.calls.findIndex(call => call[0] === 'lock') < h.calls.findLastIndex(call => call[0] === 'read'));
  assert.ok(audits.some(row => row.entityType === 'OrderShipment' && row.actorId === actor.id));
});
test('archiving a linked expense retains history, clears its mirror and invalidates the parcel editor', async () => {
  const h = harness(); await h.service.archiveExpense('expense', actor);
  const { expense, parcel, audits } = h.state();
  assert.ok(expense.archivedAt); assert.equal(expense.amountMinor, 1200);
  assert.equal(parcel.atelierCostMinor, 0); assert.equal(parcel.atelierExpenseId, null);
  assert.ok(parcel.updatedAt > new Date('2099-01-01'));
  assert.ok(audits.some(row => row.entityType === 'Expense' && row.action === 'ARCHIVE'));
});
test('a linked carrier expense cannot be detached or moved to another order', async () => {
  for (const orderId of [null, 'other-order']) {
    const h = harness(); await assert.rejects(() => h.service.updateExpense('expense', { orderId }, actor), /посыл|заказ/i);
    assert.equal(h.state().expense.orderId, 'order'); assert.equal(h.state().audits.length, 0);
  }
});
test('failed mirror write rolls expense and audits back as one transaction', async () => {
  const h = harness({ failMirror: true });
  await assert.rejects(() => h.service.updateExpense('expense', { amountMinor: 82550, currency: 'UAH' }, actor), /mirror failure/);
  assert.equal(h.state().expense.amountMinor, 1200); assert.equal(h.state().expense.currency, 'EUR');
  assert.equal(h.state().audits.length, 0);
});
test('standalone expense currency edits retain their original independent behavior', async () => {
  const h = harness({ linked: false }); await h.service.updateExpense('expense', { amountMinor: 2500, currency: 'USD' }, actor);
  assert.equal(h.state().expense.currency, 'USD'); assert.equal(h.state().expense.amountMinor, 2500);
  assert.equal(h.calls.filter(call => call[0] === 'lock').length, 0);
});
