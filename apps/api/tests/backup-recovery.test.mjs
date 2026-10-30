import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import test from 'node:test';
const require = createRequire(import.meta.url), ts = require('typescript');
require('reflect-metadata');
const cache = new Map();
function load(relative) {
  const filename = resolve(dirname(fileURLToPath(import.meta.url)), relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const js = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true,
  } }).outputText;
  new Function('require', 'module', 'exports', js)(name => {
    if (name.endsWith('/prisma.service')) return { PrismaService: class {} };
    const path = resolve(dirname(filename), name + '.ts');
    return name.startsWith('.') && existsSync(path) ? load(path) : require(name);
  }, module, module.exports);
  return module.exports;
}
const { LocalBackupStorage } = load('../src/backups/backup.storage.ts');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'backup-api-'));
  const previous = process.env.BACKUP_STORAGE_PATH; process.env.BACKUP_STORAGE_PATH = root;
  try { await fn(new LocalBackupStorage(), root); }
  finally { if (previous === undefined) delete process.env.BACKUP_STORAGE_PATH; else process.env.BACKUP_STORAGE_PATH = previous; await rm(root, { recursive: true, force: true }); }
}
async function archive(root, id = 'backup-source', version = 2) {
  const dir = join(root, id); await mkdir(dir);
  const files = { 'postgres.dump': 'synthetic dump', 'uploads.tar.gz': 'synthetic uploads' };
  if (version === 3) { files['inventory.json'] = '[]'; files['table-counts.json'] = '{}'; }
  files['manifest.json'] = JSON.stringify({ format_version: version, backup_id: 'backup-source', type: 'data', app_version: 'test', git_commit: 'test', schema_version: 'test', database_version: 'test', storage_provider: 'local', files: Object.keys(files), ...(version === 3 ? { consistency: { verified: true } } : {}) });
  for (const [name, bytes] of Object.entries(files)) await writeFile(join(dir, name), bytes);
  await writeFile(join(dir, 'SHA256SUMS'), Object.entries(files).map(([name, bytes]) => `${digest(bytes)}  ${name}`).join('\n') + '\n');
  return dir;
}
test('local verification preserves v2 and accepts imported v3 using source manifest identity', async () => fixture(async (storage, root) => {
  await archive(root); assert.equal((await storage.verify('backup-source')).manifest.format_version, 2);
  await archive(root, 'import-record', 3);
  assert.equal((await storage.verify('import-record', 'backup-source')).manifest.format_version, 3);
  await assert.rejects(storage.verify('import-record'));
}));
test('verification rejects duplicate checksum entries and symlinked backup directories', async () => fixture(async (storage, root) => {
  const dir = await archive(root);
  const sums = readFileSync(join(dir, 'SHA256SUMS'), 'utf8');
  await writeFile(join(dir, 'SHA256SUMS'), sums + sums.split('\n')[0] + '\n');
  await assert.rejects(storage.verify('backup-source'));
  await symlink(dir, join(root, 'backup-linked'), 'junction');
  await assert.rejects(storage.verify('backup-linked', 'backup-source'));
}));

const { BackupRepository } = load('../src/backups/backup.repository.ts');
const { BackupService } = load('../src/backups/backup.service.ts');
const argon2 = require('argon2');
const { Prisma } = require('@prisma/client');
const owner = { id: 'owner', role: 'OWNER', active: true, archivedAt: null };
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(branch => matches(row, branch));
    if (key === 'NOT') return !matches(row, value);
    if (key === 'metadata' && value && typeof value === 'object') {
      const actual = value.path ? value.path.reduce((current, part) => current?.[part], row.metadata) : row.metadata;
      const equals = expected => expected === Prisma.AnyNull || expected === Prisma.DbNull ? actual == null : actual === expected;
      if ('equals' in value) return equals(value.equals);
      if ('not' in value) return value.not === Prisma.AnyNull ? actual != null : actual != null && !equals(value.not);
      if ('in' in value) return value.in.includes(actual);
    }
    if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key]);
    return row[key] === value;
  });
}
function selectRows(rows, { where, orderBy = {}, take = Infinity } = {}) {
  const [key, direction] = Object.entries(orderBy)[0] ?? ['createdAt', 'desc'];
  return [...rows.values()].filter(row => matches(row, where)).sort((a, b) => ((a[key]?.valueOf() ?? 0) - (b[key]?.valueOf() ?? 0)) * (direction === 'desc' ? -1 : 1)).slice(0, take);
}
function database() {
  const rows = new Map(), events = []; let settings = { id: 'default', enabled: false, frequency: 'DAILY', time: '03:00', timezone: 'Europe/Kiev', backupType: 'DATA', retentionCount: 10 };
  const app = new Map();
  let transactionTail = Promise.resolve();
  const db = {
    user: { findUnique: async () => db.actor }, actor: owner,
    backup: {
      findUnique: async ({ where }) => rows.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }) => { const row = rows.get(where.id); assert.ok(row); return row; },
      update: async ({ where, data }) => { const row = { ...rows.get(where.id), ...data, updatedAt: new Date() }; rows.set(where.id, row); return row; },
      findFirst: async options => selectRows(rows, { ...options, take: 1 })[0] ?? null,
      create: async ({ data }) => { const row = { ...data, archivedAt: null, sizeBytes: null, checksum: null, createdAt: new Date(), completedAt: null }; rows.set(row.id, row); return row; },
      findMany: async options => selectRows(rows, options),
      count: async ({ where }) => selectRows(rows, { where }).length,
      aggregate: async ({ where }) => ({ _sum: { sizeBytes: selectRows(rows, { where }).reduce((sum, r) => sum + (r.sizeBytes ?? 0n), 0n) } }),
    },
    auditLog: { create: async ({ data }) => { events.push(data); return data; }, findMany: async ({ select, take }) => events.slice(0, take).map(event => Object.fromEntries(Object.keys(select).map(key => [key, event[key]]))) },
    backupSetting: { upsert: async ({ update }) => (settings = { ...settings, ...update }), findUnique: async () => settings },
    appSetting: { findUnique: async ({ where }) => app.get(where.section_key.key) ?? null, upsert: async ({ create, update }) => { const row = { ...create, ...update }; app.set(create.key, row); return row; } },
    $executeRaw: async () => 1,
    $queryRaw: async () => [],
    $transaction: async fn => {
      const previous = transactionTail; let release;
      transactionTail = new Promise(resolve => { release = resolve; });
      await previous;
      try { return await fn(db); } finally { release(); }
    },
  };
  return { db, rows, events, service: new BackupService(new BackupRepository(db), { provider: 'LOCAL' }) };
}
test('queue is replay safe, rejects changed intent and never stores current password', async () => {
  const { service, rows, events } = database();
  const first = await service.requestBackup('DATA', owner, 'request-001');
  const replay = await service.requestBackup('DATA', owner, 'request-001');
  assert.equal(first.id, replay.id); assert.equal(rows.size, 1); assert.equal(events.length, 1);
  assert.equal(first.metadata.job.kind, 'BACKUP'); assert.equal(first.metadata.job.phase, 'QUEUED');
  await assert.rejects(service.requestBackup('FULL', owner, 'request-001'), /идемпотент/i);
});
test('reauth reads fresh active staff and rejects downgraded roles and wrong passwords', async () => {
  const { db, service } = database(); db.actor = { ...owner, passwordHash: await argon2.hash('valid-password') };
  await service.reauthenticate(owner, 'valid-password');
  await assert.rejects(service.reauthenticate(owner, 'bad-password'));
  db.actor = { ...db.actor, role: 'MANAGER' };
  await assert.rejects(service.reauthenticate(owner, 'valid-password'));
  db.actor = { ...db.actor, role: 'OWNER', active: false };
  await assert.rejects(service.reauthenticate(owner, 'valid-password'));
});
test('legacy settings survive recovery update and overview never invents execution evidence', async () => {
  const { service } = database();
  const before = await service.settings(); assert.equal(before.recovery.offsite.enabled, false);
  const saved = await service.saveSettings({ enabled: true, frequency: 'DAILY', time: '05:10', timezone: 'Europe/Kiev', backupType: 'DATA', retentionCount: 12, recovery: { monthlyDrill: { enabled: true, dayOfMonth: 15, time: '04:00' } } }, owner);
  assert.equal(saved.retentionCount, 12); assert.equal(saved.recovery.monthlyDrill.dayOfMonth, 15);
  const legacySave = await service.saveSettings({ enabled: false, frequency: 'DAILY', time: '05:10', timezone: 'Europe/Kiev', backupType: 'DATA', retentionCount: 12 }, owner);
  assert.equal(legacySave.recovery.monthlyDrill.enabled, true);
  const view = await service.overview();
  assert.equal(view.latestBackup, null); assert.equal(view.lastDrill, null); assert.equal(view.totalSizeBytes, '0');
  assert.equal(view.executor.status, 'UNCONFIGURED');
});

const { BackupsController } = load('../src/backups/backups.controller.ts');
const { AuthService } = load('../src/auth/auth.service.ts');
const { SessionGuard } = load('../src/auth/session.guard.ts');
const { RolesGuard } = load('../src/auth/roles.guard.ts');
const { RestoreService } = load('../src/backups/restore.service.ts');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
async function httpFixture(fn) {
  await fixture(async (storage, root) => {
    const model = database(); model.db.actor = { ...owner, passwordHash: await argon2.hash('valid-password') };
    const service = new BackupService(new BackupRepository(model.db), storage);
    let role = 'OWNER';
    class HttpModule {}
    Module({ controllers: [BackupsController], providers: [
      { provide: BackupService, useValue: service }, { provide: AuthService, useValue: { userForToken: async () => ({ ...owner, role }) } },
      { provide: RestoreService, useValue: new RestoreService(model.db, service) },
      { provide: SessionGuard, useValue: { canActivate(context) { context.switchToHttp().getRequest().user = { ...owner, role }; return true; } } },
      RolesGuard,
    ] })(HttpModule);
    const app = await NestFactory.create(HttpModule, { logger: false, abortOnError: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    try { await fn({ ...model, service, root, storage, url: await app.getUrl(), role: value => { role = value; } }); }
    finally { await app.close(); }
  });
}
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('HTTP verify persists integrity evidence and actor audit, replacing stale PASS even on metadata mismatch', async () => httpFixture(async ({ url, root, rows, events, storage, service }) => {
  const dir = await archive(root);
  const original = await storage.verify('backup-source');
  const previous = { status: 'PASS', kind: 'INTEGRITY', verifiedAt: '2000-01-01T00:00:00.000Z' };
  const base = { id: 'backup-source', type: 'DATA', status: 'COMPLETED', storageProvider: 'LOCAL', checksum: original.checksum, sizeBytes: original.sizeBytes, archivedAt: null };
  const started = Date.now();
  for (const scenario of ['valid', 'checksum', 'size', 'type', 'corrupt']) {
    rows.set(base.id, { ...base, ...(scenario === 'checksum' ? { checksum: '0'.repeat(64) } : {}), ...(scenario === 'size' ? { sizeBytes: original.sizeBytes + 1n } : {}), ...(scenario === 'type' ? { type: 'FULL' } : {}), metadata: { job: { kind: 'BACKUP' }, drill: { status: 'PASS' }, verification: previous } });
    if (scenario === 'corrupt') await writeFile(join(dir, 'postgres.dump'), 'damaged');
    const response = await post(`${url}/admin/backups/${base.id}/verify`, {});
    assert.equal(response.status, scenario === 'valid' ? 201 : 400, scenario);
    if (scenario === 'valid') {
      const body = await response.json();
      assert.equal(body.checksum, original.checksum);
      assert.equal(body.sizeBytes, String(original.sizeBytes));
      assert.deepEqual(body.manifest, original.manifest);
    }
    const saved = rows.get(base.id);
    assert.equal(saved.metadata.verification.status, scenario === 'valid' ? 'PASS' : 'FAILED', scenario);
    assert.equal(saved.metadata.verification.kind, 'INTEGRITY');
    assert.ok(Date.parse(saved.metadata.verification.verifiedAt) >= started, scenario);
    assert.deepEqual(saved.metadata.job, { kind: 'BACKUP' });
    assert.deepEqual(saved.metadata.drill, { status: 'PASS' });
    assert.equal(saved.status, 'COMPLETED');
    const event = events.at(-1);
    assert.equal(event.actorId, owner.id, scenario);
    assert.equal(event.entityId, base.id);
    assert.equal(event.after.status, saved.metadata.verification.status);
    assert.equal(event.after.verifiedAt, saved.metadata.verification.verifiedAt);
    assert.equal(event.action, scenario === 'valid' ? 'BACKUP_VERIFIED' : 'BACKUP_VERIFICATION_FAILED');
    assert.equal((await service.overview()).latestVerification.status, saved.metadata.verification.status);
  }
  await writeFile(join(dir, 'postgres.dump'), 'synthetic dump');
  rows.set(base.id, { ...base, metadata: { verification: previous } });
  await service.verifyBackup(base.id); // Existing service callers need no actor argument.
  assert.equal(rows.get(base.id).metadata.verification.status, 'PASS');
  assert.equal(events.at(-1).actorId, undefined);
}));
test('HTTP static routes, RBAC and bounded redacted journal precede dynamic ID routes', async () => httpFixture(async ({ url, role }) => {
  assert.equal((await fetch(`${url}/admin/backups/overview`)).status, 200);
  assert.equal((await fetch(`${url}/admin/backups/journal?limit=101`)).status, 400);
  role('MANAGER');
  for (const suffix of ['overview', 'journal', 'settings', 'backup-source']) assert.equal((await fetch(`${url}/admin/backups/${suffix}`)).status, 403);
}));
test('HTTP import reauthenticates before writing and queues opaque bounded quarantine without extraction', async () => httpFixture(async ({ url, rows, root }) => {
  const form = password => { const data = new FormData(); data.set('currentPassword', password); data.set('type', 'DATA'); data.set('archive', new Blob(['opaque untrusted bytes']), 'untrusted.tar.gz'); return data; };
  assert.equal((await fetch(`${url}/admin/backups/upload`, { method: 'POST', body: form('wrong') })).status, 401);
  assert.equal(rows.size, 0);
  const response = await fetch(`${url}/admin/backups/upload`, { method: 'POST', body: form('valid-password') });
  assert.equal(response.status, 201); const imported = await response.json();
  assert.equal(imported.status, 'PENDING'); assert.equal(imported.metadata.job.kind, 'IMPORT_VERIFY');
  assert.equal(imported.metadata.verification, undefined); assert.equal(imported.metadata.archive, undefined);
  const filename = imported.metadata.quarantine.file;
  assert.equal(readFileSync(join(root, 'quarantine', filename), 'utf8'), 'opaque untrusted bytes');
  assert.ok(!JSON.stringify(imported).includes('valid-password'));
}));



test('HTTP download streams checked bytes; drill is replay safe and recovery plan never permits production restore', async () => httpFixture(async ({ url, root, rows, events }) => {
  const dir = await archive(root);
  const verified = await new LocalBackupStorage().verify('backup-source');
  const bytes = Buffer.from('portable-archive-bytes'); await writeFile(join(dir, 'archive.tar.gz'), bytes);
  rows.set('backup-source', { id: 'backup-source', type: 'DATA', status: 'COMPLETED', storageProvider: 'LOCAL', checksum: verified.checksum, sizeBytes: verified.sizeBytes, metadata: { job: { kind: 'BACKUP' }, archive: { file: 'archive.tar.gz', checksum: digest(bytes), bytes: String(bytes.length) } }, archivedAt: null });
  const response = await post(`${url}/admin/backups/backup-source/download`, { currentPassword: 'valid-password' });
  assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), 'portable-archive-bytes');
  assert.equal((await post(`${url}/admin/backups/backup-source/download`, { currentPassword: 'wrong' })).status, 401);
  const drill = await (await post(`${url}/admin/backups/backup-source/drill`, { currentPassword: 'valid-password', idempotencyKey: 'drill-0001' })).json();
  const replay = await (await post(`${url}/admin/backups/backup-source/drill`, { currentPassword: 'valid-password', idempotencyKey: 'drill-0001' })).json();
  assert.equal(drill.id, replay.id); assert.notEqual(drill.id, 'backup-source');
  assert.equal(drill.metadata.job.kind, 'DRILL'); assert.equal(drill.metadata.job.sourceBackupId, 'backup-source'); assert.equal(drill.status, 'PENDING');
  assert.equal(drill.metadata.drill, undefined);
  const plan = await (await post(`${url}/admin/backups/backup-source/recovery-plan`, { currentPassword: 'valid-password', confirmBackupId: 'backup-source' })).json();
  assert.equal(plan.productionRestoreAllowed, false); assert.equal(plan.readOnly, true);
  assert.equal(plan.emergencyBackupRequired, true);
  assert.equal(plan.rollbackRequired, true);
  assert.ok(plan.steps.indexOf('CREATE_AND_VERIFY_FRESH_EMERGENCY_BACKUP') < plan.steps.indexOf('RESTORE_DATABASE_AND_FILES_OFFLINE'));
  assert.ok(plan.warnings.includes('CHANGES_AFTER_SNAPSHOT_WILL_BE_LOST'));
  assert.ok(events.some(event => event.action === 'BACKUP_RECOVERY_PLAN_VIEWED'));
  assert.ok(!JSON.stringify(events).includes('valid-password'));
  const prior = process.env.NODE_ENV, allow = process.env.ALLOW_RESTORE;
  process.env.NODE_ENV = 'production'; process.env.ALLOW_RESTORE = 'true';
  try { assert.equal((await post(`${url}/admin/backups/backup-source/restore`, { confirmBackupId: 'backup-source' })).status, 400); }
  finally { if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior; if (allow === undefined) delete process.env.ALLOW_RESTORE; else process.env.ALLOW_RESTORE = allow; }
  await writeFile(join(dir, 'archive.tar.gz'), 'tampered');
  assert.equal((await post(`${url}/admin/backups/backup-source/download`, { currentPassword: 'valid-password' })).status, 400);
}));
test('HTTP upload bounds bytes, rejects files before password and cleans validation failures', async () => httpFixture(async ({ url, root, rows }) => {
  const { readdir } = await import('node:fs/promises');
  const prior = process.env.BACKUP_UPLOAD_MAX_BYTES; process.env.BACKUP_UPLOAD_MAX_BYTES = '16';
  try {
    for (const scenario of ['oversize', 'bad-order', 'empty', 'unknown-field']) {
      const data = new FormData();
      if (scenario !== 'bad-order') { data.set('currentPassword', 'valid-password'); data.set('type', 'DATA'); }
      if (scenario === 'unknown-field') data.set('unexpected', 'reject');
      data.set('archive', new Blob([scenario === 'oversize' ? 'x'.repeat(32) : scenario === 'empty' ? '' : 'bytes']), 'archive.tar.gz');
      if (scenario === 'bad-order') { data.set('currentPassword', 'valid-password'); data.set('type', 'DATA'); }
      const response = await fetch(`${url}/admin/backups/upload`, { method: 'POST', body: data });
      assert.equal(response.status, scenario === 'oversize' ? 413 : 400, scenario);
      assert.equal(rows.size, 0);
      assert.deepEqual(await readdir(join(root, 'quarantine')).catch(() => []), [], scenario);
    }
  } finally { if (prior === undefined) delete process.env.BACKUP_UPLOAD_MAX_BYTES; else process.env.BACKUP_UPLOAD_MAX_BYTES = prior; }
}));
test('overview explicitly disclaims uncaptured Chatwoot and remote provider media', async () => {
  const { service } = database();
  const overview = await service.overview();
  assert.match(overview.coverage.disclaimer, /Chatwoot/);
  assert.equal(overview.coverage.status, 'UNKNOWN');
});

test('HTTP overview exposes only bounded local drill notification fields and rejects malformed outcomes', async () => httpFixture(async ({ url, db }) => {
  const get = async () => { const response = await fetch(`${url}/admin/backups/overview`); assert.equal(response.status, 200); return response.json(); };
  const save = value => db.appSetting.upsert({ create: { section: 'backups', key: 'drillNotification', value }, update: { value } });
  assert.equal((await get()).drillNotification, null);
  const base = { version: 1, type: 'BACKUP_DRILL_RESULT', eventId: 'a'.repeat(64), backupId: 'drill-job-12345', sourceBackupId: 'backup-source', status: 'PASS', severity: 'INFO', finishedAt: '2026-10-26T12:00:00+00:00', trigger: 'SCHEDULED', scheduleSlot: '2026-10', delivery: 'LOCAL_PENDING', externalDeliveryEnabled: false };
  for (const status of ['PASS', 'FAILED']) {
    const expected = { ...base, status, severity: status === 'PASS' ? 'INFO' : 'ERROR', finishedAt: '2026-10-26T12:00:00.000Z' };
    await save({ ...expected, stderr: 'private-never-return', report: { files: ['/private/data'] }, currentPassword: 'private-never-return' });
    const view = await get(); assert.deepEqual(view.drillNotification, expected);
    assert.ok(!JSON.stringify(view).includes('private-never-return'));
    assert.ok(!JSON.stringify(view).includes('/private/data'));
  }
  await save({ ...base, trigger: 'MANUAL', scheduleSlot: 'untrusted-slot' });
  assert.deepEqual((await get()).drillNotification, { ...base, trigger: 'MANUAL', scheduleSlot: null, finishedAt: '2026-10-26T12:00:00.000Z' });
  for (const patch of [{ status: 'UNKNOWN' }, { finishedAt: 'invalid' }, { backupId: '../secret' }, { eventId: 'x'.repeat(10000) }, { scheduleSlot: '2026-13' }, { externalDeliveryEnabled: true }, { type: 'OTHER' }]) {
    await save({ ...base, ...patch });
    assert.equal((await get()).drillNotification, null, JSON.stringify(Object.keys(patch)));
  }
}));

test('v3 requires inventories and consistency evidence; unknown artifacts cannot hide outside checksums', async () => fixture(async (storage, root) => {
  const dir = await archive(root, 'backup-source', 3);
  await writeFile(join(dir, 'rogue.sql'), 'not part of the manifest');
  await assert.rejects(storage.verify('backup-source'));
  await rm(join(dir, 'rogue.sql'));
  // A v2 payload relabelled as v3 has none of the expanded-contract evidence.
  const bytes = JSON.stringify({ format_version: 3, backup_id: 'backup-source', type: 'data', app_version: 'test', git_commit: 'test', schema_version: 'test', database_version: 'test', storage_provider: 'local', files: ['postgres.dump', 'uploads.tar.gz'] });
  await writeFile(join(dir, 'manifest.json'), bytes);
  let sums = readFileSync(join(dir, 'SHA256SUMS'), 'utf8'); sums = sums.replace(/^[a-f0-9]{64}  manifest.json$/m, `${digest(bytes)}  manifest.json`);
  await writeFile(join(dir, 'SHA256SUMS'), sums);
  await assert.rejects(storage.verify('backup-source'));
}));
test('validation rejects linked payloads and honors configurable aggregate byte bounds', async () => fixture(async (storage, root) => {
  const dir = await archive(root); const payload = join(dir, 'postgres.dump');
  await rm(payload); await writeFile(join(root, 'outside'), 'synthetic dump'); await symlink(join(root, 'outside'), payload);
  await assert.rejects(storage.verify('backup-source'));
  await rm(payload); await writeFile(payload, 'synthetic dump');
  const prior = process.env.BACKUP_VERIFY_MAX_BYTES; process.env.BACKUP_VERIFY_MAX_BYTES = '64';
  try { await assert.rejects(storage.verify('backup-source')); }
  finally { if (prior === undefined) delete process.env.BACKUP_VERIFY_MAX_BYTES; else process.env.BACKUP_VERIFY_MAX_BYTES = prior; }
}));

test('overview counts real backup rows once and includes completed imports and legacy backups', async () => {
  const { service, rows } = database();
  const base = { type: 'DATA', status: 'COMPLETED', archivedAt: null, completedAt: new Date('2026-10-01'), sizeBytes: 100n, metadata: null };
  rows.set('legacy-backup', { ...base, id: 'legacy-backup' });
  rows.set('import-backup', { ...base, id: 'import-backup', completedAt: new Date('2026-10-02'), sizeBytes: 200n, metadata: { job: { kind: 'IMPORT_VERIFY' }, verification: { status: 'PASS', kind: 'INTEGRITY' } } });
  rows.set('drill-record', { ...base, id: 'drill-record', completedAt: new Date('2026-10-03'), sizeBytes: 200n, metadata: { job: { kind: 'DRILL' }, drill: { status: 'PASS' } } });
  rows.set('archived-backup', { ...base, id: 'archived-backup', archivedAt: new Date(), sizeBytes: 999n });
  const view = await service.overview();
  assert.equal(view.totalSizeBytes, '300'); assert.equal(view.latestBackup.id, 'import-backup');
  rows.delete('import-backup');
  assert.equal((await service.overview()).latestBackup.id, 'legacy-backup');
});
test('journal excludes arbitrary stored evidence, passwords and private paths', async () => {
  const { service, events } = database();
  events.push({ id: 'event', action: 'BACKUP_TEST', entityType: 'Backup', entityId: 'backup-source', after: { currentPassword: 'never-return', privatePath: '/private/data' } });
  const journal = await service.journal();
  assert.equal(journal[0].action, 'BACKUP_TEST');
  assert.ok(!JSON.stringify(journal).includes('never-return')); assert.equal(journal[0].after, undefined);
});

test('manifest JSON fails closed for duplicate keys and excessive nesting', async () => fixture(async (storage, root) => {
  const dir = await archive(root);
  const original = readFileSync(join(dir, 'manifest.json'), 'utf8');
  for (const text of [original.replace('{', '{"type":"full",'), original.replace('{', '{"nested":' + '['.repeat(40) + '0' + ']'.repeat(40) + ',')]) {
    await writeFile(join(dir, 'manifest.json'), text);
    const sums = readFileSync(join(dir, 'SHA256SUMS'), 'utf8').replace(/^[a-f0-9]{64}  manifest.json$/m, `${digest(text)}  manifest.json`);
    await writeFile(join(dir, 'SHA256SUMS'), sums);
    await assert.rejects(storage.verify('backup-source'));
  }
}));
test('HTTP queue accepts legacy create and idempotency key without widening role access', async () => httpFixture(async ({ url, rows, role }) => {
  const payload = { type: 'DATA', idempotencyKey: 'http-00001' };
  const first = await (await post(`${url}/admin/backups`, payload)).json();
  const again = await (await post(`${url}/admin/backups`, payload)).json();
  assert.equal(first.id, again.id); assert.equal(rows.size, 1);
  assert.equal((await post(`${url}/admin/backups`, { ...payload, type: 'FULL' })).status, 409);
  role('MANAGER');
  assert.equal((await post(`${url}/admin/backups`, payload)).status, 403);
  const form = new FormData(); form.set('currentPassword', 'valid-password'); form.set('type', 'DATA'); form.set('archive', new Blob(['bytes']), 'a.tar.gz');
  assert.equal((await fetch(`${url}/admin/backups/upload`, { method: 'POST', body: form })).status, 403);
}));

test('executor overview accepts actual worker timestamps and matches UI state enum', async () => {
  const { db, service } = database();
  let heartbeat = null;
  const original = db.appSetting.findUnique;
  db.appSetting.findUnique = async query => query.where.section_key.key === 'executor' ? heartbeat : original(query);
  assert.deepEqual((await service.overview()).executor, { status: 'UNCONFIGURED', configured: false, lastSeenAt: null });
  for (const field of ['lastSeenAt', 'heartbeatAt']) {
    heartbeat = { value: { status: 'AVAILABLE', [field]: new Date().toISOString() } };
    const view = (await service.overview()).executor; assert.equal(view.status, 'AVAILABLE'); assert.equal(view.configured, true);
  }
  heartbeat = { value: { status: 'AVAILABLE', lastSeenAt: '2020-01-01T00:00:00Z' } };
  assert.equal((await service.overview()).executor.status, 'STALE');
  heartbeat = { value: { configured: true } };
  assert.equal((await service.overview()).executor.status, 'UNAVAILABLE');
});
test('HTTP accepts UI file field with same bounded quarantine contract', async () => httpFixture(async ({ url, rows }) => {
  const form = new FormData(); form.set('currentPassword', 'valid-password'); form.set('type', 'DATA'); form.set('file', new Blob(['ui archive bytes']), 'ui.tar.gz');
  const response = await fetch(`${url}/admin/backups/upload`, { method: 'POST', body: form });
  assert.equal(response.status, 201); assert.equal(rows.size, 1);
}));

test('v2 accepts optional legacy manifest checksum without changing historical size semantics', async () => fixture(async (storage, root) => {
  const dir = await archive(root); const before = await storage.verify('backup-source');
  const legacy = 'format_version=1\n'; await writeFile(join(dir, 'manifest.txt'), legacy);
  const sums = readFileSync(join(dir, 'SHA256SUMS'), 'utf8'); const extra = `${digest(legacy)}  manifest.txt\n`;
  await writeFile(join(dir, 'SHA256SUMS'), sums + extra);
  const result = await storage.verify('backup-source');
  assert.equal(result.sizeBytes, before.sizeBytes + BigInt(Buffer.byteLength(extra)));
}));

test('overview schedules in configured timezone including non-whole-hour UTC offsets', async () => {
  const { service } = database();
  await service.saveSettings({ enabled: true, frequency: 'DAILY', time: '03:00', timezone: 'Asia/Kolkata', backupType: 'DATA', retentionCount: 10 }, owner);
  const original = Date.now; Date.now = () => Date.parse('2026-10-26T00:00:00Z');
  try { assert.equal((await service.overview()).nextRun, '2026-10-26T21:30:00.000Z'); }
  finally { Date.now = original; }
});

test('retention groups persist with safe defaults, bounded values and legacy count compatibility', async () => {
  const { service } = database();
  assert.deepEqual((await service.settings()).recovery.retention, { enabled: false, daily: 7, weekly: 4, monthly: 3, minimumVerified: 2 });
  const base = { enabled: false, frequency: 'DAILY', time: '03:00', timezone: 'Europe/Kiev', backupType: 'DATA', retentionCount: 12 };
  const updated = await service.saveSettings({ ...base, recovery: { retention: { daily: 14, minimumVerified: 3 } } }, owner);
  assert.deepEqual(updated.recovery.retention, { enabled: false, daily: 14, weekly: 4, monthly: 3, minimumVerified: 3 });
  for (const bad of [{ daily: 0 }, { weekly: 366 }, { monthly: 1.5 }, { minimumVerified: 11 }]) await assert.rejects(service.saveSettings({ ...base, recovery: { retention: bad } }, owner));
  const legacy = await service.saveSettings(base, owner); assert.equal(legacy.retentionCount, 12); assert.equal(legacy.recovery.retention.daily, 14);
});
test('upload preflight refuses insufficient free space before creating a quarantine file', async () => httpFixture(async ({ url, root, rows }) => {
  const { readdir } = await import('node:fs/promises');
  const prior = process.env.BACKUP_UPLOAD_RESERVED_BYTES; process.env.BACKUP_UPLOAD_RESERVED_BYTES = String(Number.MAX_SAFE_INTEGER);
  try {
    const data = new FormData(); data.set('currentPassword', 'valid-password'); data.set('type', 'DATA'); data.set('file', new Blob(['bytes']), 'a.tar.gz');
    const response = await fetch(`${url}/admin/backups/upload`, { method: 'POST', body: data });
    assert.equal(response.status, 507); assert.equal(rows.size, 0);
    assert.deepEqual(await readdir(join(root, 'quarantine')).catch(() => []), []);
  } finally { if (prior === undefined) delete process.env.BACKUP_UPLOAD_RESERVED_BYTES; else process.env.BACKUP_UPLOAD_RESERVED_BYTES = prior; }
}));
test('upload admission bounds pending imports per actor and physical quarantine globally', async () => httpFixture(async ({ url, rows }) => {
  async function upload() { const data = new FormData(); data.set('currentPassword', 'valid-password'); data.set('type', 'DATA'); data.set('archive', new Blob(['bytes']), 'a.tar.gz'); return fetch(`${url}/admin/backups/upload`, { method: 'POST', body: data }); }
  assert.equal((await upload()).status, 201); assert.equal((await upload()).status, 201);
  assert.equal((await upload()).status, 429); assert.equal(rows.size, 2);
}));

test('concurrent upload admission has a global pending cap shared through the repository registry', async () => httpFixture(async ({ url, rows }) => {
  const prior = process.env.BACKUP_UPLOAD_MAX_PENDING_GLOBAL; process.env.BACKUP_UPLOAD_MAX_PENDING_GLOBAL = '1';
  try {
    const upload = () => { const data = new FormData(); data.set('currentPassword', 'valid-password'); data.set('type', 'DATA'); data.set('file', new Blob(['bytes']), 'a.tar.gz'); return fetch(`${url}/admin/backups/upload`, { method: 'POST', body: data }); };
    const results = await Promise.all([upload(), upload()]);
    assert.deepEqual(results.map(response => response.status).sort(), [201, 429]); assert.equal(rows.size, 1);
  } finally { if (prior === undefined) delete process.env.BACKUP_UPLOAD_MAX_PENDING_GLOBAL; else process.env.BACKUP_UPLOAD_MAX_PENDING_GLOBAL = prior; }
}));

async function legacyArchive(root, id, checksumManifest = false) {
  const dir = join(root, id); await mkdir(dir);
  const files = { 'postgres.dump': 'PGDMP legacy synthetic', 'uploads.tar.gz': 'legacy uploads', 'manifest.txt': 'format_version=1\ncompose_project=yoleotard-crm\ndatabase_dump=postgres.dump\nuploads_archive=uploads.tar.gz\n' };
  for (const [name, data] of Object.entries(files)) await writeFile(join(dir, name), data);
  const sums = Object.entries(files).filter(([name]) => checksumManifest || name !== 'manifest.txt').map(([name, data]) => `${digest(data)}  ${name}`).join('\n') + '\n';
  await writeFile(join(dir, 'SHA256SUMS'), sums);
  return { dir, checksum: digest(files['manifest.txt']), sizeBytes: BigInt(Object.values(files).reduce((sum, bytes) => sum + Buffer.byteLength(bytes), Buffer.byteLength(sums))) };
}
test('v1 verify preserves engine checksum/size with optional manifest checksum and normalized DATA presentation', async () => fixture(async (storage, root) => {
  for (const flag of [false, true]) {
    const id = flag ? 'legacy-with-sums' : 'legacy-without-sums'; const expected = await legacyArchive(root, id, flag);
    assert.equal(await storage.exists(id), true);
    const result = await storage.verify(id, 'legacy-source-id');
    assert.equal(result.checksum, expected.checksum); assert.equal(result.sizeBytes, expected.sizeBytes);
    assert.equal(result.manifest.format_version, 1); assert.equal(result.manifest.type, 'data'); assert.equal(result.manifest.backup_id, 'legacy-source-id');
    assert.equal(result.manifest.legacy_identity_verified, false);
  }
}));
test('HTTP completed v1 import supports verify, checked download and drill with missing source ID', async () => httpFixture(async ({ url, root, rows }) => {
  const expected = await legacyArchive(root, 'legacy-import-record');
  const bytes = Buffer.from('legacy portable bytes'); await writeFile(join(expected.dir, 'archive.tar.gz'), bytes);
  rows.set('legacy-import-record', { id: 'legacy-import-record', type: 'DATA', status: 'COMPLETED', storageProvider: 'LOCAL', sizeBytes: expected.sizeBytes, checksum: expected.checksum, metadata: { job: { kind: 'IMPORT_VERIFY' }, sourceBackupId: null, archive: { file: 'archive.tar.gz', checksum: digest(bytes), bytes: String(bytes.length) } }, archivedAt: null });
  const verified = await post(`${url}/admin/backups/legacy-import-record/verify`, {}); assert.equal(verified.status, 201);
  const result = await verified.json(); assert.equal(result.manifest.format_version, 1); assert.equal(result.checksum, expected.checksum);
  const download = await post(`${url}/admin/backups/legacy-import-record/download`, { currentPassword: 'valid-password' }); assert.equal(download.status, 201); assert.equal(await download.text(), 'legacy portable bytes');
  const drill = await post(`${url}/admin/backups/legacy-import-record/drill`, { currentPassword: 'valid-password' }); assert.equal(drill.status, 201);
  assert.equal((await drill.json()).metadata.job.sourceBackupId, 'legacy-import-record');
}));


test('DRILL enqueue rejects retention claims and source changes committed while waiting for its source lock', async () => {
  for (const change of [
    { metadata: { retentionClaim: { state: 'DELETING' } } },
    { archivedAt: new Date() },
    { status: 'FAILED' },
    { storagePath: 'different-storage' },
    null,
  ]) {
    const { db, rows, events } = database();
    rows.set('backup-source', { id: 'backup-source', storagePath: 'shared-storage', status: 'COMPLETED', archivedAt: null, metadata: {} });
    let sourceLock = false;
    db.$executeRaw = async (_sql, key) => {
      if (key === 'backups-source:shared-storage') {
        sourceLock = true;
        if (change) rows.set('backup-source', { ...rows.get('backup-source'), ...change });
        else rows.delete('backup-source');
      }
      return 1;
    };
    await assert.rejects(new BackupRepository(db).request('drill-race', 'DATA', owner, { kind: 'DRILL', sourceBackupId: 'backup-source' }), error => error.getStatus() === 409);
    assert.equal(sourceLock, true);
    assert.equal(rows.has('drill-race'), false);
    assert.equal(events.length, 0);
  }
});

test('DRILL reserves actual source storage through enqueue and audit in the same transaction', async () => {
  for (const storagePath of ['shared-storage', null]) {
    const { db, rows, events } = database();
    rows.set('backup-source', { id: 'backup-source', storagePath, status: 'COMPLETED', archivedAt: null, metadata: {} });
    let held = false, reads = 0, inTransaction = false;
    const find = db.backup.findUnique, create = db.backup.create, audit = db.auditLog.create;
    db.backup.findUnique = async query => { if (query.where.id === 'backup-source') { reads++; if (reads === 2) assert.equal(held, true); } return find(query); };
    db.$executeRaw = async (_sql, key) => { assert.equal(inTransaction, true); if (key === `backups-source:${storagePath || 'backup-source'}`) held = true; return 1; };
    db.backup.create = async query => { assert.equal(held, true); assert.equal(inTransaction, true); assert.equal(reads, 2); return create(query); };
    db.auditLog.create = async query => { assert.equal(held, true); assert.equal(inTransaction, true); return audit(query); };
    db.$transaction = async fn => {
      inTransaction = true;
      try { return await fn(db); }
      finally { held = false; inTransaction = false; }
    };
    const queued = await new BackupRepository(db).request('drill-accepted', 'DATA', owner, { kind: 'DRILL', sourceBackupId: 'backup-source' });
    assert.equal(queued.status, 'PENDING');
    assert.equal(queued.metadata.job.sourceBackupId, 'backup-source');
    assert.equal(events[0].action, 'BACKUP_DRILL_REQUESTED');
    assert.equal(held, false);
    // Retention's subsequent snapshot sees the durable pending reference.
    assert.ok([...rows.values()].some(row => row.status === 'PENDING' && row.metadata?.job?.sourceBackupId === 'backup-source'));
  }
});

test('DRILL rejects unavailable or unsafe sources but existing idempotent jobs still return', async () => {
  for (const patch of [null, { archivedAt: new Date() }, { status: 'RUNNING' }, { metadata: { retentionClaim: { state: 'DELETING' } } }, { storagePath: '../unsafe' }, { storagePath: 'x'.repeat(129) }]) {
    const { db, rows, events } = database();
    if (patch) rows.set('backup-source', { id: 'backup-source', status: 'COMPLETED', archivedAt: null, metadata: {}, ...patch });
    const repository = new BackupRepository(db);
    const options = { kind: 'DRILL', sourceBackupId: 'backup-source' };
    await assert.rejects(repository.request('new-drill', 'DATA', owner, options), error => error.getStatus() === 409);
    assert.equal(rows.has('new-drill'), false); assert.equal(events.length, 0);
    const existing = { id: 'existing-drill', type: 'DATA', createdById: owner.id, archivedAt: null, metadata: { job: options } };
    rows.set(existing.id, existing);
    db.$executeRaw = async (_sql, key) => { assert.equal(key, existing.id); return 1; };
    assert.equal(await repository.request(existing.id, 'DATA', owner, options), existing);
    assert.equal(events.length, 0);
  }
});


test('DRILL rejects a DELETING storage alias after the lock while preserving existing retries', async () => {
  for (const alias of [
    { id: 'import-alias', storagePath: 'shared-storage' },
    { id: 'shared-storage', storagePath: null },
    { id: 'shared-storage', storagePath: '' },
  ]) {
    const { db, rows, events } = database();
    rows.set('backup-source', { id: 'backup-source', storagePath: 'shared-storage', status: 'COMPLETED', archivedAt: null, metadata: {} });
    let held = false;
    const find = db.backup.findFirst;
    db.backup.findFirst = async query => { assert.equal(held, true); return find(query); };
    db.$executeRaw = async (_sql, key) => {
      if (key === 'backups-source:shared-storage') {
        held = true;
        rows.set(alias.id, { ...alias, status: 'COMPLETED', archivedAt: null, metadata: { retentionClaim: { state: 'DELETING' } } });
      }
      return 1;
    };
    const repository = new BackupRepository(db), options = { kind: 'DRILL', sourceBackupId: 'backup-source' };
    await assert.rejects(repository.request('alias-drill', 'DATA', owner, options), error => error.getStatus() === 409);
    assert.equal(rows.has('alias-drill'), false); assert.equal(events.length, 0);
    const existing = { id: 'existing-drill', type: 'DATA', createdById: owner.id, archivedAt: null, metadata: { job: options } };
    rows.set(existing.id, existing);
    held = false;
    db.$executeRaw = async (_sql, key) => { assert.equal(key, existing.id); return 1; };
    assert.equal(await repository.request(existing.id, 'DATA', owner, options), existing);
  }
});

test('DRILL accepts a source when DELETING records refer to other storage', async () => {
  const { db, rows } = database();
  rows.set('backup-source', { id: 'backup-source', storagePath: 'shared-storage', status: 'COMPLETED', archivedAt: null, metadata: {} });
  // Matching an alias ID alone is insufficient when its actual storage differs.
  rows.set('shared-storage', { id: 'shared-storage', storagePath: 'other-storage', metadata: { retentionClaim: { state: 'DELETING' } } });
  const queued = await new BackupRepository(db).request('different-storage-drill', 'DATA', owner, { kind: 'DRILL', sourceBackupId: 'backup-source' });
  assert.equal(queued.status, 'PENDING');
});


test('request explicitly uses READ COMMITTED for fresh source snapshots after lock waits', async () => {
  const { db, rows } = database();
  const transaction = db.$transaction;
  db.$transaction = async (callback, options) => {
    assert.equal(options?.isolationLevel, Prisma.TransactionIsolationLevel.ReadCommitted);
    return transaction(callback);
  };
  const repository = new BackupRepository(db);
  await repository.request('isolation-backup', 'DATA', owner);
  rows.set('backup-source', { id: 'backup-source', status: 'COMPLETED', archivedAt: null, metadata: {} });
  await repository.request('isolation-drill', 'DATA', owner, { kind: 'DRILL', sourceBackupId: 'backup-source' });
});
