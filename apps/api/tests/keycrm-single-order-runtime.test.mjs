// Single-order public DTO, service, provider, preview and authorization regressions.
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
  return { service, runs, issues, audits, calls, step, readySources, assertNoBusinessWrites };
}

test('DTO accepts optional positive safe integer; rejects nonnumeric/unsafe card input', async () => {
  for (const orderId of [1, 675, Number.MAX_SAFE_INTEGER]) {
    const errors = await validate(plainToInstance(CreateKeycrmSyncRunDto, dto({ orderId })), { whitelist: true, forbidNonWhitelisted: true });
    assert.equal(errors.length, 0, `valid numeric orderId=${orderId}`);
  }
  for (const orderId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '675', null, NaN, Infinity]) {
    const errors = await validate(plainToInstance(CreateKeycrmSyncRunDto, dto({ orderId })), { whitelist: true, forbidNonWhitelisted: true });
    assert.ok(errors.some(error => error.property === 'orderId'), `invalid orderId=${String(orderId)}`);
  }
  assert.equal((await validate(plainToInstance(CreateKeycrmSyncRunDto, dto()), { whitelist: true, forbidNonWhitelisted: true })).length, 0);
});

test('createRun returns and persists canonical target scope without losing existing fields', async t => {
  const h = harness(t);
  const run = await h.service.createRun(dto({ orderId: 675 }), actor);
  assert.equal(run.context?.targetOrderId, '675');
  assert.equal((await h.service.run(run.id)).context?.targetOrderId, '675');
  assert.equal(run.mode, 'DRY_RUN'); assert.equal(run.configRevision, 1);
  assert.equal(run.status, 'PENDING'); h.assertNoBusinessWrites();
});

test('single preview normalizes exactly one card, completes one page, cannot import bulk decoy', async t => {
  const h = harness(t);
  const run = await h.service.createRun(dto({ orderId: 675 }), actor);
  h.readySources(run.id);
  const result = await h.step(run.id);
  assert.deepEqual(h.calls.map(url => url.pathname), ['/v1/order/675']);
  assert.equal(result.context.targetOrderId, '675');
  assert.equal(result.status, 'COMPLETED'); assert.equal(result.scannedCount, 1);
  assert.equal(result.totalRemote, 1); assert.equal(result.totalPages, 1);
  assert.equal(result.createdCount, 1); assert.equal(result.failedCount, 0);
  assert.equal((await h.service.issues(run.id)).length, 0);
  h.assertNoBusinessWrites();
  // Reprocessing a completed public run cannot issue another provider request.
  await h.service.processStep(run.id, 'synthetic-worker');
  assert.deepEqual(h.calls.map(url => url.pathname), ['/v1/order/675']);
});

test('source pagination keeps the target and only then fetches the exact card', async t => {
  const h = harness(t, { sourcePages: 2 });
  const run = await h.service.createRun(dto({ orderId: 675 }), actor);
  const first = await h.step(run.id);
  assert.equal(first.context.targetOrderId, '675');
  assert.equal(first.context.sourcesComplete, false); assert.equal(first.leaseOwner, null);
  const second = await h.step(run.id);
  assert.equal(second.context.targetOrderId, '675'); assert.equal(second.context.sourcesComplete, true);
  assert.equal(second.context.sourceCurrencies['12'], 'EUR'); assert.equal(second.context.sourceCurrencies['13'], 'EUR');
  const result = await h.step(run.id);
  assert.equal(result.scannedCount, 1); assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(h.calls.map(url => url.pathname), ['/v1/order/source', '/v1/order/source', '/v1/order/675']);
  assert.deepEqual(h.calls.slice(0, 2).map(url => url.searchParams.get('page')), ['1', '2']);
  assert.equal(result.context.targetOrderId, '675'); h.assertNoBusinessWrites();
});

for (const [label, detail, status] of [
  ['404', { message: 'missing' }, 404], ['wrong numeric ID', rawOrder(676), 200],
  ['missing ID', { grand_total: '100.00' }, 200], ['array envelope', [rawOrder()], 200],
  ['list envelope', { data: [rawOrder(), rawOrder(676)], total: 2 }, 200],
]) test(`single-card ${label} fails closed before scanning any other order`, async t => {
  const h = harness(t, { detail, detailStatus: status });
  const run = await h.service.createRun(dto({ orderId: 675 }), actor); h.readySources(run.id);
  await h.step(run.id).catch(error => {
    // Retryable provider errors may throw; persistent public run state is the oracle.
    assert.ok(error instanceof Error);
  });
  const result = await h.service.run(run.id);
  assert.deepEqual(h.calls.map(url => url.pathname), ['/v1/order/675']);
  assert.equal(result.scannedCount, 0); assert.equal(result.createdCount, 0);
  assert.equal(result.updatedCount, 0); assert.notEqual(result.status, 'COMPLETED');
  h.assertNoBusinessWrites();
});

test('one correctly identified but invalid business payload stays in the existing normalizer failure pipeline', async t => {
  const h = harness(t, { detail: rawOrder(675, { grand_total: null }) });
  const run = await h.service.createRun(dto({ orderId: 675 }), actor); h.readySources(run.id);
  const result = await h.step(run.id);
  assert.deepEqual(h.calls.map(url => url.pathname), ['/v1/order/675']);
  assert.equal(result.scannedCount, 1); assert.equal(result.failedCount, 1);
  assert.equal(result.createdCount, 0); assert.equal(result.status, 'PARTIAL');
  const issues = await h.service.issues(run.id);
  assert.equal(issues.length, 1); assert.equal(issues[0].externalOrderId, '675');
  h.assertNoBusinessWrites();
});

test('apply with the exact preview target uses the existing dedupe pipeline', async t => {
  const h = harness(t, { linked: true });
  const preview = await h.service.createRun(dto({ orderId: 675 }), actor); h.readySources(preview.id);
  assert.equal((await h.step(preview.id)).status, 'COMPLETED');
  const apply = await h.service.createRun(dto({ dryRun: false, previewRunId: preview.id, orderId: 675 }), actor);
  assert.equal(apply.context?.targetOrderId, '675'); h.readySources(apply.id);
  const result = await h.step(apply.id);
  assert.equal(result.mode, 'APPLY'); assert.equal(result.status, 'COMPLETED');
  assert.equal(result.scannedCount, 1); assert.equal(result.skippedCount, 1);
  assert.equal(result.createdCount, 0); assert.equal(result.updatedCount, 0);
  assert.deepEqual(h.calls.map(url => url.pathname), ['/v1/order/675', '/v1/order/675']);
  h.assertNoBusinessWrites();
});

test('apply cannot replace target 675 with 676 or narrow a bulk preview into a different scope', async t => {
  const h = harness(t);
  for (const target of [675, undefined]) {
    const preview = await h.service.createRun(dto(target === undefined ? {} : { orderId: target }), actor);
    h.readySources(preview.id); await h.step(preview.id);
    await assert.rejects(() => h.service.createRun(dto({ dryRun: false, previewRunId: preview.id, orderId: 676 }), actor),
      error => error.getStatus?.() === 409 || error.getStatus?.() === 400);
  }
  assert.equal((await h.service.runs()).filter(row => row.mode === 'APPLY').length, 0);
  h.assertNoBusinessWrites();
});

test('bulk without target retains page/date filters and preview-owned apply range', async t => {
  const h = harness(t);
  const from = '2026-10-01T00:00:00.000Z', to = '2026-10-10T23:59:59.000Z';
  const preview = await h.service.createRun(dto({ from, to }), actor); h.readySources(preview.id);
  const result = await h.step(preview.id);
  assert.equal(result.status, 'COMPLETED'); assert.equal(result.scannedCount, 2);
  assert.equal(result.createdCount, 2); assert.equal(result.context?.targetOrderId, undefined);
  assert.equal(h.calls[0].pathname, '/v1/order'); assert.equal(h.calls[0].searchParams.get('page'), '1');
  assert.equal(h.calls[0].searchParams.get('filter[updated_between]'), '2026-10-01 00:00:00,2026-10-10 23:59:59');
  const apply = await h.service.createRun(dto({ dryRun: false, previewRunId: preview.id, from: '2025-01-01T00:00:00Z' }), actor);
  assert.equal(apply.requestedFrom.toISOString(), from); assert.equal(apply.requestedTo.toISOString(), to);
  assert.equal(apply.context?.targetOrderId, undefined); h.assertNoBusinessWrites();
});

test('same clientRequestId returns the original run without duplicating work', async t => {
  const h = harness(t), request = dto({ orderId: 675 });
  const first = await h.service.createRun(request, actor), second = await h.service.createRun(request, actor);
  assert.equal(first.id, second.id); assert.equal(second.context?.targetOrderId, '675');
  assert.deepEqual(h.calls, []); h.assertNoBusinessWrites();
});

test('idempotency key cannot be reused to change a single-card target', async t => {
  const h = harness(t), request = dto({ orderId: 675 });
  const first = await h.service.createRun(request, actor);
  await assert.rejects(() => h.service.createRun({ ...request, orderId: 676 }, actor),
    error => error.getStatus?.() === 409 || error.getStatus?.() === 400);
  assert.equal((await h.service.run(first.id)).context.targetOrderId, '675');
  assert.equal((await h.service.runs()).length, 1); assert.deepEqual(h.calls, []);
});

test('omitting target on apply cannot widen a single-card preview to bulk', async t => {
  const h = harness(t), preview = await h.service.createRun(dto({ orderId: 675 }), actor);
  h.readySources(preview.id); await h.step(preview.id);
  await assert.rejects(() => h.service.createRun(dto({ dryRun: false, previewRunId: preview.id }), actor),
    error => error.getStatus?.() === 409 || error.getStatus?.() === 400);
  assert.equal((await h.service.runs()).filter(row => row.mode === 'APPLY').length, 0);
});

test('failed target normalization cannot authorize single-card APPLY via PARTIAL preview', async t => {
  const h = harness(t, { detail: rawOrder(675, { grand_total: null }) });
  const preview = await h.service.createRun(dto({ orderId: 675 }), actor); h.readySources(preview.id);
  const partial = await h.step(preview.id);
  assert.equal(partial.status, 'PARTIAL'); assert.equal(partial.failedCount, 1);
  await assert.rejects(() => h.service.createRun(dto({ dryRun: false, previewRunId: preview.id, orderId: 675 }), actor),
    error => error.getStatus?.() === 409 || error.getStatus?.() === 400);
});

test('callable service rejects mixed single/date and malformed IDs before creating a run', async t => {
  const h = harness(t);
  for (const extras of [
    { orderId: 0 }, { orderId: -1 }, { orderId: 1.5 }, { orderId: null },
    { orderId: '675' }, { orderId: Number.MAX_SAFE_INTEGER + 1 },
    { orderId: 675, from: '2026-10-01T00:00:00Z' },
    { orderId: 675, to: '2026-10-20T00:00:00Z' },
  ]) await assert.rejects(() => h.service.createRun(dto(extras), actor), error => error.getStatus?.() === 400);
  assert.deepEqual(await h.service.runs(), []); assert.deepEqual(h.calls, []);
});

test('persisted malformed target cannot be reinterpreted as a legacy bulk run', async t => {
  const h = harness(t);
  for (const targetOrderId of ['', '0675', '675x', 675, null, '9007199254740992']) {
    const run = await h.service.createRun(dto(), actor); h.readySources(run.id);
    h.runs.get(run.id).context.targetOrderId = targetOrderId;
    await h.step(run.id).catch(error => assert.ok(error instanceof Error));
    const result = await h.service.run(run.id);
    assert.notEqual(result.status, 'COMPLETED'); assert.equal(result.scannedCount, 0);
  }
  assert.deepEqual(h.calls, []); h.assertNoBusinessWrites();
});

test('actual RolesGuard keeps sync-run controller OWNER/ADMIN-only', () => {
  const { KeycrmController } = loadTargetModule('keycrm/keycrm.controller.ts');
  const { RolesGuard } = loadTargetModule('auth/roles.guard.ts');
  const { Reflector } = require('@nestjs/core');
  const guard = new RolesGuard(new Reflector());
  const context = role => ({
    getHandler: () => KeycrmController.prototype.createRun,
    getClass: () => KeycrmController,
    switchToHttp: () => ({ getRequest: () => role ? { user: { id: 'synthetic', role } } : {} }),
  });
  for (const role of ['OWNER', 'ADMIN']) assert.equal(guard.canActivate(context(role)), true);
  for (const role of ['ACCOUNTANT', 'MANAGER', 'SEAMSTRESS', undefined])
    assert.throws(() => guard.canActivate(context(role)), error => error.getStatus?.() === 403);
});

test('expired or foreign worker lease cannot contact provider for a targeted run', async t => {
  const h = harness(t), run = await h.service.createRun(dto({ orderId: 675 }), actor);
  h.readySources(run.id);
  await h.service.processStep(run.id, 'not-the-owner');
  h.runs.get(run.id).leaseOwner = 'synthetic-worker'; h.runs.get(run.id).leaseUntil = new Date(0);
  await h.service.processStep(run.id, 'synthetic-worker');
  assert.deepEqual(h.calls, []); assert.equal((await h.service.run(run.id)).scannedCount, 0);
});
