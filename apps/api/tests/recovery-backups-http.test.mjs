import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, createReadStream } from 'node:fs';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
require('reflect-metadata');
const ts = require('typescript');
const { NestFactory } = require('@nestjs/core');
const { Module, UnauthorizedException, ValidationPipe } = require('@nestjs/common');
const argon = require('argon2');
const cookieParser = require('cookie-parser');
const cache = new Map();
class AuthToken {}
function load(file) {
  const filename = resolve(dirname(fileURLToPath(import.meta.url)), file);
  if (filename.endsWith('auth.service.ts')) return { AuthService: AuthToken };
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true,
  } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name.endsWith('/prisma.service')) return { PrismaService: class {} };
    const local = resolve(dirname(filename), name + '.ts');
    return name.startsWith('.') && existsSync(local) ? load(local) : require(name);
  }, module, module.exports);
  return module.exports;
}

test('backup HTTP guards, queue, quarantine and download use real controller/interceptor', async t => {
  const root = await mkdtemp(join(tmpdir(), 'yocrm-backup-http-'));
  const prior = process.env.BACKUP_STORAGE_PATH;
  process.env.BACKUP_STORAGE_PATH = root;
  let app;
  try {
    const password = 'synthetic-backup-http-password';
    const users = Object.fromEntries(['OWNER', 'ADMIN', 'MANAGER'].map(role => [role, { id: role, role, active: true, archivedAt: null }]));
    const passwordHash = await argon.hash(password);
    for (const user of Object.values(users)) user.passwordHash = passwordHash;
    const data = gzipSync(Buffer.from('synthetic download bytes; not an actual portable archive'));
    const file = join(root, 'synthetic.tar.gz'); await writeFile(file, data);
    const checksum = createHash('sha256').update(data).digest('hex');
    const id = 'synthetic-http-backup';
    const source = { id, type: 'DATA', status: 'COMPLETED', archivedAt: null, storageProvider: 'LOCAL', sizeBytes: BigInt(data.length), checksum,
      metadata: { archive: { file: 'archive.tar.gz', bytes: String(data.length), checksum }, job: { kind: 'BACKUP' } } };
    const requests = [], audits = [];
    let failVerificationAudit = false;
    // Use the real repository at the persistence boundary. A no-op verification
    // stub would hide lost metadata/audit and would not protect legacy callers.
    const database = {
      user: { findUnique: async ({ where }) => users[where.id] },
      backup: {
        findFirst: async ({ where }) => where.id === id && source.archivedAt === null ? source : null,
        findMany: async () => [source],
        findUniqueOrThrow: async ({ where }) => { assert.equal(where.id, id); return source; },
        update: async ({ where, data }) => { assert.equal(where.id, id); Object.assign(source, structuredClone(data)); return source; },
      },
      auditLog: { create: async ({ data }) => {
        if (failVerificationAudit && ['BACKUP_VERIFIED', 'BACKUP_VERIFICATION_FAILED'].includes(data.action)) throw new Error('synthetic audit persistence failure');
        const event = structuredClone(data); audits.push(event); return event;
      } },
      $queryRaw: async () => [{ id }],
      $transaction: async action => {
        const before = structuredClone(source), eventCount = audits.length;
        try { return await action(database); }
        catch (error) {
          for (const key of Object.keys(source)) delete source[key];
          Object.assign(source, before); audits.splice(eventCount);
          throw error;
        }
      },
    };
    const { BackupRepository } = load('../src/backups/backup.repository.ts');
    const repository = Object.assign(new BackupRepository(database), {
      // Queue admission stays outside this fixture's verification/download seam.
      request: async (key, type, actor, options = {}) => { requests.push({ key, type, actor: actor.id, options }); return { id: key, type, status: 'PENDING', sizeBytes: null, metadata: { job: { kind: options.kind ?? 'BACKUP' } } }; },
      reserveUpload: async () => "synthetic-admission", releaseUpload: async () => {},
    });
    const storage = { provider: 'LOCAL', exists: async () => true,
      verify: async () => ({ checksum, sizeBytes: BigInt(data.length), manifest: { type: 'data', format_version: 2 } }),
      openArchive: async () => createReadStream(file) };
    const { BackupService } = load('../src/backups/backup.service.ts');
    const { RestoreService } = load('../src/backups/restore.service.ts');
    const { BackupsController } = load('../src/backups/backups.controller.ts');
    const { BackupUploadInterceptor } = load('../src/backups/backup.upload.ts');
    const { SessionGuard } = load('../src/auth/session.guard.ts');
    const { RolesGuard } = load('../src/auth/roles.guard.ts');
    const backups = new BackupService(repository, storage);
    class HttpFixture {}
    Module({ controllers: [BackupsController], providers: [SessionGuard, RolesGuard, BackupUploadInterceptor,
      { provide: AuthToken, useValue: { userForToken: async token => { if (!users[token]) throw new UnauthorizedException(); return users[token]; } } },
      { provide: BackupService, useValue: backups },
      { provide: RestoreService, useValue: new RestoreService({}, backups) },
    ] })(HttpFixture);
    app = await NestFactory.create(HttpFixture, { logger: false });
    app.use(cookieParser()); app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const request = (path, role = 'OWNER', body, method = 'POST') => fetch(url + '/api/admin/backups' + path, {
      method, headers: { Cookie: `yoleotard_crm_session=${role}`, ...(body instanceof FormData || body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000),
    });
    await t.test('role guards run before any create or upload side effect', async () => {
      assert.equal((await request('', 'missing', undefined, 'GET')).status, 401);
      assert.equal((await request('', 'MANAGER', { type: 'FULL' })).status, 403);
      assert.equal(requests.length, 0);
      assert.equal((await request('', 'ADMIN', { type: 'DATA', idempotencyKey: 'http-case-0001' })).status, 201);
      assert.equal(requests[0].type, 'DATA');
      assert.equal((await request('', 'OWNER', { type: 'INVALID' })).status, 400);
      assert.equal(requests.length, 1);
    });
    await t.test('download requires fresh password and streams bytes with safe headers', async () => {
      assert.equal((await request(`/${id}/download`, 'OWNER', { currentPassword: 'incorrect' })).status, 401);
      const response = await request(`/${id}/download`, 'OWNER', { currentPassword: password });
      assert.equal(response.status, 201);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(response.headers.get('content-disposition'), /attachment/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), data);
      assert.ok(audits.some(row => row.action === 'BACKUP_DOWNLOAD_AUTHORIZED'));
      assert.ok(!JSON.stringify(audits).includes(password));
    });
    await t.test('verify preserves legacy response fields and persists actor-bound integrity evidence', async () => {
      const response = await request(`/${id}/verify`, 'ADMIN', {});
      assert.equal(response.status, 201);
      const body = await response.json();
      assert.equal(body.checksum, checksum);
      assert.equal(body.sizeBytes, String(data.length));
      assert.deepEqual(body.manifest, { type: 'data', format_version: 2 });
      assert.deepEqual(body.verification, source.metadata.verification);
      assert.equal(body.verification.status, 'PASS');
      assert.equal(body.verification.kind, 'INTEGRITY');
      assert.ok(Number.isFinite(Date.parse(body.verification.verifiedAt)));
      const event = audits.at(-1);
      assert.equal(event.action, 'BACKUP_VERIFIED');
      assert.equal(event.actorId, 'ADMIN');
      assert.deepEqual(event.after, body.verification);
      assert.deepEqual(source.metadata.job, { kind: 'BACKUP' });
      assert.equal(source.status, 'COMPLETED');
    });
    await t.test('metadata mismatch replaces previous PASS with audited FAILED without repairing the source checksum', async () => {
      source.checksum = '0'.repeat(64);
      try {
        assert.equal((await request(`/${id}/verify`, 'OWNER', {})).status, 400);
        assert.equal(source.metadata.verification.status, 'FAILED');
        assert.equal(source.metadata.verification.kind, 'INTEGRITY');
        assert.equal(source.checksum, '0'.repeat(64));
        assert.equal(audits.at(-1).action, 'BACKUP_VERIFICATION_FAILED');
        assert.equal(audits.at(-1).actorId, 'OWNER');
        assert.deepEqual(audits.at(-1).after, source.metadata.verification);
      } finally { source.checksum = checksum; }
    });
    await t.test('audit persistence failure rolls back verification metadata and never returns success', async () => {
      const before = structuredClone(source.metadata), eventCount = audits.length;
      failVerificationAudit = true;
      try {
        const response = await request(`/${id}/verify`, 'OWNER', {});
        assert.equal(response.status, 500);
        assert.ok(!(await response.text()).includes('synthetic audit persistence failure'));
        assert.deepEqual(source.metadata, before);
        assert.equal(audits.length, eventCount);
      } finally { failVerificationAudit = false; }
    });
    await t.test('legacy service verify without an actor still persists evidence and retains its response contract', async () => {
      const result = await backups.verifyBackup(id);
      assert.equal(result.checksum, checksum);
      assert.equal(result.sizeBytes, String(data.length));
      assert.deepEqual(result.manifest, { type: 'data', format_version: 2 });
      assert.equal(source.metadata.verification.status, 'PASS');
      assert.equal(audits.at(-1).actorId, undefined);
      assert.deepEqual(audits.at(-1).after, source.metadata.verification);
    });
    await t.test('upload authenticates fields before file, queues quarantine only', async () => {
      const before = requests.length;
      const rejected = new FormData(); rejected.append('currentPassword', 'incorrect'); rejected.append('type', 'DATA'); rejected.append('archive', new Blob([data]), '../untrusted.tar.gz');
      assert.equal((await request('/upload', 'OWNER', rejected)).status, 401);
      assert.equal(requests.length, before);
      const form = new FormData(); form.append('currentPassword', password); form.append('type', 'DATA'); form.append('archive', new Blob([data]), '../untrusted.tar.gz');
      const response = await request('/upload', 'OWNER', form);
      assert.equal(response.status, 201, await response.text());
      const queued = requests.at(-1);
      assert.equal(queued.options.kind, 'IMPORT_VERIFY');
      assert.match(queued.options.quarantine.file, /^[a-f0-9-]+\.tar\.gz$/);
      assert.equal(queued.options.quarantine.checksum, checksum);
      assert.equal((await readdir(join(root, 'quarantine'))).length, 1);
      assert.ok(!JSON.stringify(requests).includes(password));
    });
  } finally {
    if (app) await app.close();
    if (prior === undefined) delete process.env.BACKUP_STORAGE_PATH; else process.env.BACKUP_STORAGE_PATH = prior;
    await rm(root, { recursive: true, force: true });
  }
});
