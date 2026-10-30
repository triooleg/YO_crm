// Single-order configuration, idempotency race recovery and real import-pipeline regressions.
// Run with node --test in its own worker process (synthetic encryption key only).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let root = dirname(fileURLToPath(import.meta.url));
while (!existsSync(resolve(root, 'apps/api/tests/overview-target-loader.mjs'))) {
  const parent = dirname(root);
  if (parent === root) throw new Error('CANONICAL_TEST_ROOT_NOT_FOUND');
  root = parent;
}
const require = createRequire(resolve(root, 'apps/api/package.json'));
const { loadTargetModule } = await import(pathToFileURL(resolve(root, 'apps/api/tests/overview-target-loader.mjs')));
// Actual TS service/client/normalizer, no private overrides or collaborators mocked.
const { KeycrmService } = loadTargetModule('keycrm/keycrm.service.ts');
const { encryptSecret } = loadTargetModule('secret-box.ts');
const { CreateKeycrmSyncRunDto } = loadTargetModule('keycrm/keycrm.dto.ts');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');

// Isolated node:test file process; never reads an existing secret or .env file.
process.env.SETTINGS_ENCRYPTION_KEY = 'synthetic-keycrm-single-order-test-key-ONLY';
const actor = { id: 'owner-synthetic', role: 'OWNER' };
let requestSequence = 0;
const dto = extras => ({ dryRun: true, clientRequestId: `00000000-0000-4000-8000-${String(++requestSequence).padStart(12, '0')}`, ...extras });
const clone = value => structuredClone(value);
const rawOrder = (id = 675, overrides = {}) => ({
  id, source_id: 12, source_uuid: `public-card-${id}`, grand_total: '100.00',
  created_at: '2026-10-01 10:00:00', updated_at: '2026-10-02 10:00:00',
  buyer: { id: 77, full_name: 'Synthetic Buyer' }, products: [], payments: [], ...overrides,
});

function harness(t, { detail = rawOrder(), detailStatus = 200, sourcePages = 1, linked = false } = {}) {
  const runs = new Map(), issues = [], audits = [], calls = [];
  const values = new Map(Object.entries({
    enabled: true, apiTokenEncrypted: encryptSecret('synthetic-provider-token'),
    connectionStatus: 'VERIFIED', connectionKey: 'synthetic-connection', configRevision: 1,
    pageSize: 50, defaultCurrency: 'EUR', defaultOrderType: 'CUSTOM_ORDER',
  }));
  const businessWrites = [];
  const forbidWrite = async input => { businessWrites.push(clone(input)); throw new Error('UNEXPECTED_BUSINESS_WRITE'); };
  const prisma = {
    appSetting: {
      findMany: async () => [...values].map(([key, value]) => ({ key, value })),
      findUnique: async ({ where }) => values.has(where.section_key.key) ? { value: values.get(where.section_key.key) } : null,
    },
    keycrmSyncRun: {
      findMany: async () => clone([...runs.values()]),
      findUnique: async ({ where }) => clone([...runs.values()].find(row =>
        (where.id !== undefined && row.id === where.id) ||
        (where.clientRequestId !== undefined && row.clientRequestId === where.clientRequestId)) ?? null),
      create: async ({ data }) => {
        const row = { id: `run-${runs.size + 1}`, currentPage: 1, context: null,
          scannedCount: 0, createdCount: 0, updatedCount: 0, skippedCount: 0,
          failedCount: 0, attemptCount: 0, leaseOwner: null, leaseUntil: null, ...clone(data) };
        runs.set(row.id, row); return clone(row);
      },
      update: async ({ where, data }) => {
        const row = runs.get(where.id); assert.ok(row, 'existing synthetic run');
        for (const [key, value] of Object.entries(data)) row[key] =
          value && typeof value === 'object' && 'increment' in value ? (row[key] ?? 0) + value.increment : clone(value);
        return clone(row);
      },
    },
    keycrmSyncIssue: {
      create: async ({ data }) => { const row = { id: `issue-${issues.length + 1}`, ...clone(data) }; issues.push(row); return clone(row); },
      findFirst: async () => null,
      findMany: async ({ where }) => clone(issues.filter(row => row.runId === where.runId)),
    },
    auditLog: { create: async ({ data }) => { audits.push(clone(data)); return { id: `audit-${audits.length}`, ...clone(data) }; } },
    order: {
      findUnique: async ({ where }) => linked && where.sourceSystem_sourceAccount_externalId?.externalId === '675'
        ? { id: 'already-imported-675', externalUpdatedAt: new Date('2026-10-03T00:00:00Z'),
            archivedAt: null, modelImagePath: null, currency: 'EUR', number: 'KC-675', sourceLinkMode: 'IMPORTED' }
        : null,
      findMany: async () => [], create: forbidWrite, update: forbidWrite, upsert: forbidWrite,
    },
    $executeRaw: async () => 0,
    $executeRawUnsafe: async () => 0,
    $queryRaw: async () => [],
  };
  // The fake is an external persistence boundary; it models atomic rollback and
  // increment operations, not normalization/matching/import decisions.
  prisma.$transaction = async callback => {
    const before = clone([...runs]), issueCount = issues.length, auditCount = audits.length;
    try { return await callback(prisma); }
    catch (error) {
      runs.clear(); for (const [id, row] of before) runs.set(id, row);
      issues.length = issueCount; audits.length = auditCount; throw error;
    }
  };
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://openapi.keycrm.app');
    assert.equal(init.method, 'GET');
    calls.push(url);
    if (url.pathname === '/v1/order/source') {
      const page = Number(url.searchParams.get('page'));
      return Response.json({ data: [{ id: page === 1 ? 12 : 13, name: 'Synthetic Site', currency_code: 'EUR' }],
        total: sourcePages * 50, per_page: 50, current_page: page });
    }
    if (url.pathname === '/v1/order/675') return Response.json(detail, { status: detailStatus });
    if (url.pathname === '/v1/order') return Response.json({
      // Decoy makes accidental bulk fallback observably broader than one card.
      data: [rawOrder(), rawOrder(676)], total: 2, per_page: 50, current_page: 1,
    });
    throw new Error('UNEXPECTED_PROVIDER_ENDPOINT');
  });
  const service = new KeycrmService(prisma);
  const step = async runId => {
    // Worker lease acquisition is outside these agreed seams; seed only persisted lease.
    const row = runs.get(runId);
    row.leaseOwner = 'synthetic-worker'; row.leaseUntil = new Date(Date.now() + 60_000);
    return service.processStep(runId, 'synthetic-worker');
  };
  const readySources = runId => {
    const row = runs.get(runId);
    row.context = { ...(row.context ?? {}), sourcesComplete: true,
      sourceNames: { '12': 'Synthetic Site' }, sourceCurrencies: { '12': 'EUR' } };
  };
  const assertNoBusinessWrites = () => assert.deepEqual(businessWrites, [], 'no writes at the business persistence boundary');
  return { service, prisma, values, runs, issues, audits, calls, step, readySources, assertNoBusinessWrites };
}

const conflict = error => [400, 409].includes(error.getStatus?.());
async function preview(h) {
  const row = await h.service.createRun(dto({ orderId: 675 }), actor);
  h.readySources(row.id);
  assert.equal((await h.step(row.id)).status, 'COMPLETED');
  return row;
}

test('new APPLY rejects completed target preview from an older configuration revision', async t => {
  const h = harness(t), before = await preview(h);
  h.values.set('configRevision', 2);
  await assert.rejects(() => h.service.createRun(dto({ dryRun: false, previewRunId: before.id, orderId: 675 }), actor), conflict);
  assert.equal((await h.service.runs()).filter(row => row.mode === 'APPLY').length, 0);
  h.assertNoBusinessWrites();
});

test('worker with changed configuration fails before any target or bulk provider fetch', async t => {
  const h = harness(t), run = await h.service.createRun(dto({ orderId: 675 }), actor);
  h.readySources(run.id); h.values.set('configRevision', 2);
  const result = await h.step(run.id);
  assert.equal(result.status, 'FAILED'); assert.equal(result.scannedCount, 0);
  assert.deepEqual(h.calls, []);
  assert.equal((await h.service.issues(run.id))[0].code, 'CONFIG_CHANGED');
});

test('same key cannot replay targeted DRY_RUN as APPLY, or APPLY against another preview', async t => {
  const h = harness(t), request = dto({ orderId: 675 });
  const a = await h.service.createRun(request, actor); h.readySources(a.id); await h.step(a.id);
  await assert.rejects(() => h.service.createRun({ ...request, dryRun: false, previewRunId: a.id }, actor), conflict);
  const b = await preview(h);
  const applyRequest = dto({ dryRun: false, previewRunId: a.id, orderId: 675 });
  const apply = await h.service.createRun(applyRequest, actor);
  assert.equal((await h.service.createRun(applyRequest, actor)).id, apply.id);
  await assert.rejects(() => h.service.createRun({ ...applyRequest, previewRunId: b.id }, actor), conflict);
  assert.equal((await h.service.runs()).filter(row => row.mode === 'APPLY').length, 1);
});

for (const mutation of ['same', 'other target', 'other mode', 'other preview', 'bulk winner', 'single winner for bulk']) {
  test(`P2002 transaction boundary returns only an identical scoped winner: ${mutation}`, async t => {
    const h = harness(t), request = dto({ orderId: 675 });
    const winner = await h.service.createRun(request, actor);
    // Synthetic concurrent committed winner: the transaction itself loses a unique
    // conflict, exactly the external DB error recovered by createRun's public seam.
    if (mutation === 'other target') h.runs.get(winner.id).context = { targetOrderId: '676' };
    if (mutation === 'other mode') h.runs.get(winner.id).mode = 'APPLY';
    if (mutation === 'bulk winner') h.runs.get(winner.id).context = null;
    let retry = request;
    if (mutation === 'single winner for bulk') { const { orderId, ...bulk } = request; retry = bulk; }
    if (mutation === 'other preview') {
      Object.assign(h.runs.get(winner.id), { mode: 'APPLY', previewRunId: 'preview-a' });
      retry = { ...request, dryRun: false, previewRunId: 'preview-b' };
    }
    const { Prisma } = require('@prisma/client');
    h.prisma.$transaction = async () => { throw new Prisma.PrismaClientKnownRequestError('synthetic unique conflict', { code: 'P2002', clientVersion: 'synthetic' }); };
    if (mutation === 'same') assert.equal((await h.service.createRun(retry, actor)).id, winner.id);
    else await assert.rejects(() => h.service.createRun(retry, actor), conflict);
    assert.equal((await h.service.runs()).length, 1); assert.deepEqual(h.calls, []);
  });
}

// A narrowly implemented external DB emulator. Business decisions remain in the
// real service/normalizer/reconciliation functions. Unknown query shapes fail.
function installBusinessDb(h) {
  const state = {
    order: [{ id: 'website-708', number: 'YO-708', priceMinor: 7700, currency: 'EUR', salesStatus: 'CONFIRMED', clientId: 'unrelated-client', sourceSystem: 'YOLEOTARD_WEBSITE' }],
    client: [{ id: 'unrelated-client', displayName: 'Untouched', archivedAt: null }],
    payment: [{ id: 'unrelated-receipt', orderId: 'unrelated-999', amountMinor: 7700, currency: 'EUR', voidedAt: null }],
    orderItem: [], orderItemInstance: [], keycrmClientLink: [], keycrmSyncMutation: [],
    activity: [], productionSlot: [], shipment: [], orderShipment: [],
  };
  const untouched = clone([state.order[0], state.client[0], state.payment[0]]);
  function matches(row, where = {}) {
    return Object.entries(where).every(([key, value]) => {
      if (key === 'AND') return value.every(part => matches(row, part));
      if (key === 'OR') return value.some(part => matches(row, part));
      if (key === 'orderItem') return matches(state.orderItem.find(item => item.id === row.orderItemId) ?? {}, value);
      if (key.includes('_') && value && typeof value === 'object') return matches(row, value);
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if ('in' in value) return value.in.includes(row[key]);
        if ('not' in value) return row[key] !== value.not;
        throw new Error('UNSUPPORTED_SYNTHETIC_QUERY:' + key);
      }
      return value === null ? row[key] == null : row[key] === value;
    });
  }
  const hydrate = (name, row, include) => {
    if (!row) return null;
    if (name === 'order' && include) return clone({ ...row,
      items: state.orderItem.filter(item => item.orderId === row.id),
      payments: state.payment.filter(item => item.orderId === row.id),
      productionSlot: null, shipment: null, invoices: [], expenses: [], agreements: [],
    });
    if (name === 'keycrmClientLink' && include?.client) return clone({ ...row, client: state.client.find(c => c.id === row.clientId) });
    return clone(row);
  };
  for (const [name, rows] of Object.entries(state)) {
    let seq = 0;
    const create = async ({ data }) => {
      const row = { id: `${name}-new-${++seq}`, archivedAt: null, voidedAt: null,
        rolledBackAt: null, productionStatus: 'NOT_SCHEDULED', ...clone(data) };
      rows.push(row); return clone(row);
    };
    const update = async ({ where, data }) => {
      const row = rows.find(row => matches(row, where)); assert.ok(row, `existing ${name} row`);
      Object.assign(row, clone(data)); return clone(row);
    };
    h.prisma[name] = {
      create, update,
      findUnique: async ({ where, include }) => hydrate(name, rows.find(row => matches(row, where)), include),
      findUniqueOrThrow: async ({ where }) => { const row = rows.find(row => matches(row, where)); assert.ok(row); return clone(row); },
      findFirst: async ({ where = {} } = {}) => clone(rows.find(row => matches(row, where)) ?? null),
      findMany: async ({ where = {} } = {}) => clone(rows.filter(row => matches(row, where))),
      count: async ({ where = {} } = {}) => rows.filter(row => matches(row, where)).length,
      upsert: async ({ where, create: data, update: changes }) => rows.some(row => matches(row, where))
        ? update({ where, data: changes }) : create({ data }),
    };
  }
  h.prisma.clientMergeRedirect = { findUnique: async () => null };
  const transact = h.prisma.$transaction;
  h.prisma.$transaction = async callback => {
    const before = clone(state);
    try { return await transact(callback); }
    catch (error) {
      for (const key of Object.keys(state)) state[key].splice(0, state[key].length, ...before[key]);
      throw error;
    }
  };
  return { state, assertUntouched: () => assert.deepEqual([state.order[0], state.client[0], state.payment[0]], untouched) };
}

test('public APPLY creates only selected order, item/instance/payment/audit/rollback evidence and replay adds no duplicates', async t => {
  const h = harness(t, { detail: rawOrder(675, {
    products: [{ id: 91, name: 'Synthetic item A', price: '50.00', quantity: 1 }, { id: 92, name: 'Synthetic item B', price: '50.00', quantity: 1 }],
    custom_fields: [{ id: 1003, uuid: 'OR_1003', name: 'Номер макету', type: 'number', value: 493 }],
    payments: [{ id: 5, amount: '50.00', actual_currency: 'EUR', payment_method_id: 8,
      status: 'paid', payment_date: '2026-10-02 10:00:00' }],
    payment_status: 'part_paid',
  }) });
  const db = installBusinessDb(h);
  const first = await preview(h);
  assert.equal(db.state.order.length, 1); assert.equal(db.state.payment.length, 1);
  const apply = await h.service.createRun(dto({ dryRun: false, previewRunId: first.id, orderId: 675 }), actor);
  h.readySources(apply.id);
  const result = await h.step(apply.id);
  assert.equal(result.status, 'COMPLETED', JSON.stringify(await h.service.issues(apply.id)));
  assert.equal(result.createdCount, 1); assert.equal(result.failedCount, 0); assert.equal(result.scannedCount, 1);
  const imported = db.state.order.find(row => row.externalId === '675');
  assert.ok(imported); assert.equal(imported.priceMinor, 10000); assert.equal(imported.currency, 'EUR');
  assert.equal(imported.number, '26-709', 'KeyCRM continues the shared sequence instead of reusing provider id 675');
  assert.equal(imported.depositRequiredMinor, 5000); assert.equal(imported.paymentStatus, 'DEPOSIT_PAID');
  assert.equal(imported.sourceSystem, 'KEYCRM'); assert.equal(imported.sourceAccount, 'synthetic-connection');
  assert.equal(db.state.order.length, 2); assert.equal(db.state.client.length, 2);
  assert.equal(db.state.orderItem.length, 2); assert.equal(db.state.orderItem[0].externalId, '675:91');
  assert.deepEqual(db.state.orderItem.map(item => item.designNumber), [493, 493]);
  assert.equal(db.state.orderItemInstance.length, 2);
  const receipt = db.state.payment.find(row => row.orderId === imported.id);
  assert.equal(receipt.amountMinor, 5000); assert.equal(receipt.currency, 'EUR'); assert.equal(receipt.externalId, '5');
  assert.equal(db.state.payment.length, 2); db.assertUntouched();
  assert.ok(h.audits.some(row => row.entityType === 'Payment' && row.action === 'CREATE' && row.entityId === receipt.id));
  assert.equal(db.state.keycrmSyncMutation.length, 1);
  const mutation = db.state.keycrmSyncMutation[0];
  assert.equal(mutation.externalOrderId, '675'); assert.equal(mutation.beforeSnapshot.order, null);
  assert.equal(mutation.afterSnapshot.order.id, imported.id); assert.equal(mutation.afterSnapshot.order.payments[0].id, receipt.id);
  assert.equal(mutation.rollbackEligible, true);
  assert.ok(db.state.activity.some(row => row.type === 'PAYMENT_RECEIVED' && row.orderId === imported.id));
  const beforeReplay = clone(db.state);
  const again = await preview(h);
  const secondApply = await h.service.createRun(dto({ dryRun: false, previewRunId: again.id, orderId: 675 }), actor);
  h.readySources(secondApply.id);
  const replay = await h.step(secondApply.id);
  assert.equal(replay.status, 'COMPLETED'); assert.equal(replay.skippedCount, 1); assert.equal(replay.createdCount, 0);
  assert.deepEqual(db.state, beforeReplay); db.assertUntouched();

  for (const item of db.state.orderItem) item.designNumber = null;
  db.state.orderItem.push({ id: 'archived-design', orderId: imported.id, name: 'Historical design', quantity: 1, priceMinor: 1, designNumber: null, archivedAt: new Date('2026-10-03T00:00:00Z') });
  const repairPreview = await preview(h), repairPreviewResult = await h.service.run(repairPreview.id);
  assert.equal(repairPreviewResult.updatedCount, 1, 'preview exposes an unchanged linked order that still needs design-number repair');
  const repairApply = await h.service.createRun(dto({ dryRun: false, previewRunId: repairPreview.id, orderId: 675 }), actor);
  h.readySources(repairApply.id);
  const auditsBeforeRepair = h.audits.length;
  const repairResult = await h.step(repairApply.id);
  assert.equal(repairResult.updatedCount, 1);
  assert.deepEqual(db.state.orderItem.filter(item => !item.archivedAt).map(item => item.designNumber), [493, 493]);
  assert.equal(db.state.orderItem.find(item => item.id === 'archived-design').designNumber, null);
  assert.equal(h.audits.slice(auditsBeforeRepair).filter(row => row.entityType === 'OrderItem' && row.after?.designNumber === 493).length, 2);
  assert.ok(db.state.activity.some(row => row.type === 'KEYCRM_DESIGN_NUMBER_IMPORTED' && row.orderId === imported.id));
  const repairMutation = db.state.keycrmSyncMutation.at(-1);
  assert.deepEqual(repairMutation.beforeSnapshot.order.items.filter(item => !item.archivedAt).map(item => item.designNumber), [null, null]);
  assert.deepEqual(repairMutation.afterSnapshot.order.items.filter(item => !item.archivedAt).map(item => item.designNumber), [493, 493]);

  db.state.orderItem.find(item => item.externalId === '675:91').designNumber = 777;
  const conflictPreview = await preview(h), conflictPreviewResult = await h.service.run(conflictPreview.id);
  assert.equal(conflictPreviewResult.skippedCount, 1);
  assert.equal((await h.service.issues(conflictPreview.id)).filter(issue => issue.code === 'DESIGN_NUMBER_CONFLICT').length, 1);
  const beforeConflictApply = clone(db.state), issueCountBeforeConflictApply = h.issues.length;
  const conflictApply = await h.service.createRun(dto({ dryRun: false, previewRunId: conflictPreview.id, orderId: 675 }), actor);
  h.readySources(conflictApply.id);
  const conflictResult = await h.step(conflictApply.id);
  assert.equal(conflictResult.skippedCount, 1);
  assert.deepEqual(db.state, beforeConflictApply, 'unchanged provider replay must not rewrite an order with a preserved manual conflict');
  assert.equal(h.issues.length, issueCountBeforeConflictApply, 'APPLY does not duplicate the conflict already exposed by preview');
  assert.ok(h.calls.every(url => url.pathname === '/v1/order/675'));
});
