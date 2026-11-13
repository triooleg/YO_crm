import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url); require('reflect-metadata');
const ts = require('typescript'), cache = new Map();
// Mirrors the Nest compiler's decorator metadata (the pure-model loader omits it).
function load(path) {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), '../src', path);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true,
    emitDecoratorMetadata: true, esModuleInterop: true,
  } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    const local = resolve(dirname(file), `${name}.ts`);
    return name.startsWith('.') && existsSync(local) ? load(local) : require(name);
  }, module, module.exports);
  return module.exports;
}

test('actual Nest HTTP routes keep bearer staging separate from owner sessions and strict DTOs', async () => {
  const { NestFactory, Reflector } = require('@nestjs/core');
  const { Module, UnauthorizedException } = require('@nestjs/common');
  const { HistoryMigrationController, HistoryMigrationAgentController } = load('history-migration/history-migration.controller.ts');
  const { HistoryMigrationService } = load('history-migration/history-migration.service.ts');
  const { HistoryMigrationPlanningController } = load('history-migration/history-planning.controller.ts');
  const { HistoryMigrationPlanningService } = load('history-migration/history-planning.service.ts');
  const { SessionGuard } = load('auth/session.guard.ts');
  const { AuthService } = load('auth/auth.service.ts');
  const { RolesGuard } = load('auth/roles.guard.ts');
  const { ParentMeasurementsValidationPipe } = load('parent-measurements/parent-measurements-validation.pipe.ts');
  const { historyMigrationBodyParser } = load('history-migration/history-migration-security.ts');
  const calls = [];
  const service = {
    create: async (input, password, owner) => { calls.push({ input, password, owner }); return { jobId: 'synthetic-job', importEnabled: false }; },
    pair: async () => ({ token: 'synthetic-once' }),
    status: async (_id, auth) => { if (auth !== 'Bearer scoped-agent') throw new UnauthorizedException(); return { importEnabled: false }; },
    stage: async (_id, auth, body) => { if (auth !== 'Bearer scoped-agent') throw new UnauthorizedException(); calls.push(body); return { status: 'STAGED' }; },
    preview: async () => ({ crmCompared: false, importEnabled: false, addedToCrm: 0 }),
  };
  const auth = { userForToken: async token => {
    if (!['owner', 'manager'].includes(token)) throw new UnauthorizedException();
    return { id: token, role: token === 'owner' ? 'OWNER' : 'MANAGER' };
  } };
  const planningCalls = [];
  const planning = {
    resolve: async (_id, body) => { planningCalls.push(body); return { persisted: false, status: 'REVIEW', importEnabled: false }; },
    bind: async (_id, body, password) => { planningCalls.push({ ...body, password }); return { revision: 1, importEnabled: false }; },
    dryRun: async () => ({ crmCompared: true, importEnabled: false, addedToCrm: 0 }),
  };
  class HttpFixture {}
  Module({ controllers: [HistoryMigrationPlanningController, HistoryMigrationController, HistoryMigrationAgentController], providers: [
    { provide: HistoryMigrationService, useValue: service },
    { provide: AuthService, useValue: auth },
    { provide: HistoryMigrationPlanningService, useValue: planning },
    { provide: SessionGuard, useValue: new SessionGuard(auth) },
    { provide: RolesGuard, useValue: new RolesGuard(new Reflector()) },
  ] })(HttpFixture);
  const app = await NestFactory.create(HttpFixture, { logger: false, abortOnError: false, bodyParser: false });
  app.use('/api/admin/history-migration', ...historyMigrationBodyParser('16kb'));
  app.use('/api/history-migration-agent', ...historyMigrationBodyParser('1mb'));
  app.use(require('express').urlencoded({ extended: true, limit: '8mb' }));
  app.use(require('cookie-parser')()); app.setGlobalPrefix('api'); app.useGlobalPipes(new ParentMeasurementsValidationPipe());
  await app.listen(0, '127.0.0.1');
  const root = await app.getUrl();
  const oldProxies = process.env.HISTORY_MIGRATION_TRUSTED_PROXIES;
  process.env.HISTORY_MIGRATION_TRUSTED_PROXIES = '127.0.0.1';
  const request = (path, method = 'GET', body, role, agent) => fetch(root + '/api/' + path, { method,
    headers: { 'X-Forwarded-Proto': 'https', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(role ? { Cookie: `yoleotard_crm_session=${role}` } : {}), ...(agent ? { Authorization: agent } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error' });
  try {
    delete process.env.HISTORY_MIGRATION_TRUSTED_PROXIES;
    assert.equal((await request('history-migration-agent/jobs/test')).status, 426);
    process.env.HISTORY_MIGRATION_TRUSTED_PROXIES = '127.0.0.1';
    assert.equal((await fetch(root + '/api/history-migration-agent/jobs/test')).status, 426);
    for (const prefix of ['admin/history-migration/jobs', 'history-migration-agent/jobs/test/batches']) {
      const response = await fetch(root + '/api/' + prefix, { method: 'POST', headers: { 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'payload=' + 'a'.repeat(20000) });
      assert.equal(response.status, 415);
    }
    const huge = await request('admin/history-migration/jobs', 'POST', { payload: 'a'.repeat(17000) }, 'owner');
    assert.equal(huge.status, 413);
    const input = { source: 'KEYCRM', account: 'synthetic-business', channel: 'INSTAGRAM', currentPassword: 'synthetic-password' };
    assert.equal((await request('admin/history-migration/jobs', 'POST', input)).status, 401);
    assert.equal((await request('admin/history-migration/jobs', 'POST', input, 'manager')).status, 403);
    assert.equal((await request('admin/history-migration/jobs', 'POST', { ...input, unexpected: true }, 'owner')).status, 400);
    const created = await request('admin/history-migration/jobs', 'POST', input, 'owner');
    assert.equal(created.status, 201); assert.equal(created.headers.get('cache-control'), 'no-store');
    assert.equal(created.headers.get('referrer-policy'), 'no-referrer');
    assert.deepEqual(await created.json(), { jobId: 'synthetic-job', importEnabled: false });
    assert.equal(calls.length, 1); assert.equal(calls[0].password, 'synthetic-password');
    const packet = { batchId: 'test', checksum: 'a'.repeat(64), payloadJson: '{}' };
    const route = 'history-migration-agent/jobs/test/batches';
    assert.equal((await request(route, 'POST', packet, 'owner')).status, 401);
    assert.equal((await request(route + '?token=scoped-agent', 'POST', packet, undefined, 'Bearer scoped-agent')).status, 400);
    assert.equal((await request(route, 'POST', { ...packet, token: 'unexpected' }, undefined, 'Bearer scoped-agent')).status, 400);
    const staged = await request(route, 'POST', packet, undefined, 'Bearer scoped-agent');
    assert.equal(staged.status, 201); assert.equal(staged.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await staged.json(), { status: 'STAGED' }); assert.equal(calls.length, 2);
    assert.equal((await request('admin/history-migration/jobs/test/preview', 'GET', undefined, undefined, 'Bearer scoped-agent')).status, 401);
    const preview = await request('admin/history-migration/jobs/test/preview', 'GET', undefined, 'owner');
    assert.deepEqual(await preview.json(), { crmCompared: false, importEnabled: false, addedToCrm: 0 });
    assert.equal((await request('admin/history-migration/jobs/test/apply', 'POST', {}, 'owner')).status, 404);
    const dryRun = 'admin/history-migration/jobs/test/dry-run';
    assert.equal((await request(dryRun, 'GET', undefined, undefined, 'Bearer scoped-agent')).status, 401);
    assert.equal((await request(dryRun, 'GET', undefined, 'manager')).status, 403);
    assert.deepEqual(await (await request(dryRun, 'GET', undefined, 'owner')).json(), { crmCompared: true, importEnabled: false, addedToCrm: 0 });
    const targetRoute = 'admin/history-migration/jobs/test/targets';
    const target = { mode: 'EXISTING', dialogueId: 'test-dialogue', clientId: 'test-client', currentPassword: 'synthetic-password' };
    assert.equal((await request(targetRoute, 'POST', target, undefined, 'Bearer scoped-agent')).status, 401);
    assert.equal((await request(targetRoute, 'POST', { ...target, trustedProof: true }, 'owner')).status, 400);
    assert.equal((await request(targetRoute, 'POST', { ...target, mode: 'AUTO_CREATE' }, 'owner')).status, 400);
    assert.equal((await request(targetRoute, 'POST', target, 'owner')).status, 201);
    assert.equal(planningCalls.length, 1); assert.equal(planningCalls[0].password, 'synthetic-password');
    assert.equal((await request('admin/history-migration/jobs/test/rollback', 'POST', {}, 'owner')).status, 404);
  } finally {
    await app.close();
    if (oldProxies === undefined) delete process.env.HISTORY_MIGRATION_TRUSTED_PROXIES; else process.env.HISTORY_MIGRATION_TRUSTED_PROXIES = oldProxies;
  }
});
