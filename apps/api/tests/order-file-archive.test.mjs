import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTargetModule } from './website-test-loader.mjs';

const require = createRequire(import.meta.url);
const { Module, UnauthorizedException } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { OrdersController } = loadTargetModule('orders/orders.controller.ts');
const { OrdersService } = loadTargetModule('orders/orders.service.ts');
const { OrderTabsService } = loadTargetModule('orders/order-tabs.service.ts');
const { SessionGuard } = loadTargetModule('auth/session.guard.ts');
const { RolesGuard } = loadTargetModule('auth/roles.guard.ts');
const { AuthService } = loadTargetModule('auth/auth.service.ts');

test('only owner/admin can archive one general order file, with one history event and no partial writes', async () => {
  const archived = new Date('2026-11-05T00:00:00Z');
  const chosenPath = '11111111-1111-1111-1111-111111111111.jpg';
  const designPath = '22222222-2222-2222-2222-222222222222.jpg';
  const image = Buffer.from([255, 216, 255, 217]);
  const orders = new Map([['a', { clientId: 'client-a', archivedAt: null }], ['b', { clientId: 'client-b', archivedAt: archived }]]);
  const file = (id, fields = {}) => ({ id, orderId: 'a', name: `${id}.jpg`, path: `${id}.jpg`, role: 'GENERAL', orderItemId: null, noteId: null, archivedAt: null, ...fields });
  let state = { files: [
    file('chosen', { path: chosenPath }), file('other'),
    file('design', { path: designPath, role: 'DESIGN_FRONT', orderItemId: 'item' }),
    file('note', { noteId: 'note' }), file('linked', { orderItemId: 'item' }), file('inactive', { orderId: 'b' }),
  ], activity: [], audit: [] };
  let failAudit = false;
  const db = { orderFile: { findFirst: async ({ where }) => state.files.find(row => row.path === where.path && row.archivedAt === where.archivedAt) ?? null }, $transaction: async run => {
    const draft = structuredClone(state);
    const match = (row, where) => Object.entries(where).every(([key, value]) => key === 'order'
      ? orders.get(row.orderId)?.archivedAt === value.archivedAt : row[key] === value);
    const result = await run({
      $executeRawUnsafe: async () => 1,
      order: { findFirst: async ({ where }) => orders.get(where.id)?.archivedAt === where.archivedAt ? orders.get(where.id) : null },
      orderFile: {
        findFirst: async ({ where }) => draft.files.find(row => match(row, where)) ?? null,
        updateMany: async ({ where, data }) => {
          const rows = draft.files.filter(row => match(row, where));
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
        },
      },
      activity: { create: async ({ data }) => draft.activity.push(data) },
      auditLog: { create: async ({ data }) => {
        if (failAudit) throw new Error('audit unavailable');
        draft.audit.push(data);
      } },
    });
    state = draft;
    return result;
  } };
  class TestModule {}
  Module({ controllers: [OrdersController], providers: [RolesGuard, SessionGuard,
    { provide: AuthService, useValue: { userForToken: async token => {
      if (!token) throw new UnauthorizedException();
      return { id: token.toLowerCase(), role: token };
    } } }, { provide: OrdersService, useValue: new OrdersService(db) },
  ] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  app.use((req, _res, next) => { req.cookies = { yoleotard_crm_session: req.get('x-test-role') }; next(); });
  await app.listen(0, '127.0.0.1');
  const previousUploadsDir = process.env.UPLOADS_DIR;
  const uploadRoot = await mkdtemp(join(tmpdir(), 'yo-order-file-archive-'));
  const fileDir = join(uploadRoot, 'order-files');
  process.env.UPLOADS_DIR = uploadRoot;
  try {
    await mkdir(fileDir);
    await Promise.all([chosenPath, designPath].map(path => writeFile(join(fileDir, path), image)));
    const base = await app.getUrl();
    const archive = (role, orderId = 'a', fileId = 'chosen') => fetch(`${base}/orders/${orderId}/files/${fileId}/archive`, {
      method: 'PATCH', headers: role ? { 'x-test-role': role } : {},
    });
    const download = path => fetch(`${base}/orders/files/${path}`, { headers: { 'x-test-role': 'MANAGER' } });
    assert.equal((await download(chosenPath)).status, 200);
    assert.equal((await archive('OWNER', 'a', 'missing')).status, 404);
    assert.equal((await archive()).status, 401);
    assert.equal((await archive('MANAGER')).status, 403);
    for (const id of ['design', 'note', 'linked', 'inactive']) assert.equal((await archive('OWNER', 'a', id)).status, 404);
    assert.equal((await archive('OWNER', 'b', 'inactive')).status, 404);
    failAudit = true;
    assert.equal((await archive('OWNER')).status, 500);
    assert.equal(state.files[0].archivedAt, null);
    assert.equal(state.activity.length, 0);
    failAudit = false;
    const response = await archive('OWNER');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result, { id: 'chosen', archivedAt: state.files[0].archivedAt.toISOString() });
    assert.deepEqual(await (await archive('ADMIN')).json(), result);
    assert.deepEqual(state.files[0], file('chosen', { path: chosenPath, archivedAt: new Date(result.archivedAt) }));
    assert.ok(state.files.slice(1).every(row => row.archivedAt === null));
    assert.equal((await download(chosenPath)).status, 404);
    assert.equal((await download(designPath)).status, 200);
    assert.deepEqual(await readFile(join(fileDir, chosenPath)), image);
    assert.equal(state.activity.length, 1);
    assert.equal(state.activity[0].actorId, 'owner');
    assert.equal(state.activity[0].type, 'ORDER_FILE_ARCHIVED');
    assert.equal(state.audit.length, 1);
    assert.equal(state.audit[0].entityId, 'chosen');
    assert.equal(state.audit[0].action, 'ARCHIVE');
  } finally {
    await app.close();
    if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousUploadsDir;
    await Promise.allSettled([chosenPath, designPath].map(path => unlink(join(fileDir, path))));
    await rmdir(fileDir).catch(() => undefined);
    await rmdir(uploadRoot);
  }
});

test('order list, detail and tabs filter archived order files without filtering client files', async () => {
  let list, detail, tabs;
  const db = { order: {
    findMany: async query => { list = query.select; return []; },
    findFirst: async query => { detail = query.select; return null; },
    findFirstOrThrow: async query => { tabs = query.select; return {}; },
  } };
  const orders = new OrdersService(db);
  await orders.list();
  await assert.rejects(orders.detail('a'), error => error.getStatus() === 404);
  await new OrderTabsService(db).detail('a');
  for (const selection of [
    list.files, detail.files, detail.items.select.files, detail.notesStructured.include.files,
    tabs.files, tabs.items.include.files, tabs.notesStructured.include.files,
  ]) assert.deepEqual(selection.where, { archivedAt: null });
  assert.equal(detail.client.select.files.where, undefined);
  assert.equal(tabs.client.select.files.where, undefined);
});
