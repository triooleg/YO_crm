import test from 'node:test';
import assert from 'node:assert/strict';
import { backupRequest, backupUploadError, backupUploadLimit, backupRecoverySettings, backupProgress, backupStatus, BACKUP_UPLOAD_LIMIT } from '../lib/backup-api.ts';

test('download is a credentialed POST with password only in body and returns actual binary', async () => {
  const calls = [];
  const result = await backupRequest('download', { id: 'archive/one', currentPassword: 'synthetic' }, async (url, init) => {
    calls.push({ url, init });
    return new Response(new Blob(['archive-bytes']), { headers: { 'Content-Type': 'application/gzip' } });
  });
  assert.equal(calls[0].url, '/api/admin/backups/archive%2Fone/download');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'include');
  assert.deepEqual(JSON.parse(calls[0].init.body), { currentPassword: 'synthetic' });
  assert.equal(await result.text(), 'archive-bytes');
});

test('upload sends currentPassword/default DATA/archive in API-required multipart order without setting its boundary', async () => {
  let request;
  await backupRequest('upload', { file: new File(['tar'], 'archive.tar.gz'), currentPassword: 'synthetic' }, async (url, init) => {
    request = { url, init }; return Response.json({ status: 'PENDING' });
  });
  assert.equal(request.url, '/api/admin/backups/upload');
  assert.equal(request.init.headers, undefined);
  assert.equal(request.init.body.get('archive').name, 'archive.tar.gz');
  assert.equal(request.init.body.get('type'), 'DATA');
  assert.equal(request.init.body.get('currentPassword'), 'synthetic');
  assert.deepEqual([...request.init.body.keys()], ['currentPassword', 'type', 'archive']);
  assert.equal(backupUploadError({ name: 'archive.tar.gz', size: BACKUP_UPLOAD_LIMIT + 1 }), 'size');
  assert.equal(backupUploadError({ name: 'archive.zip', size: 2 }), 'type');
  assert.equal(backupUploadError({ name: 'archive.tar.gz', size: 0 }), 'size');
});

test('reauth and recovery ID confirmation fail closed before network; no raw API errors leak', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json({ message: 'secret/path/password' }, { status: 403 }); };
  await assert.rejects(backupRequest('drill', { id: 'a', currentPassword: '' }, fetcher));
  await assert.rejects(backupRequest('recovery-plan', { id: 'a', currentPassword: 'p', confirmBackupId: 'b' }, fetcher));
  assert.equal(calls, 0);
  await assert.rejects(backupRequest('drill', { id: 'a', currentPassword: 'p' }, fetcher), /reauth/);
});

test('missing or new statuses never turn into a success and progress is bounded', () => {
  assert.equal(backupStatus(undefined), 'unknown');
  assert.equal(backupStatus({ checksum: 'abc' }), 'unknown');
  assert.equal(backupStatus({ status: 'NEW_RESULT' }), 'unknown');
  assert.equal(backupStatus({ status: 'PASS' }), 'passed');
  assert.equal(backupProgress({ metadata: { job: { progress: 999 } } }), 100);
  assert.equal(backupProgress({ metadata: { job: { progress: -9 } } }), 0);
  assert.equal(backupProgress({ metadata: { job: 'CreateBackupJob' } }), null);
});

test('upload accepts actual 405 MiB data and >1 GiB FULL archives up to API 2 GiB default or advertised bound', () => {
  assert.equal(BACKUP_UPLOAD_LIMIT, 2147483648);
  assert.equal(backupUploadError({ name: 'archive.tar.gz', size: 405 * 1024 ** 2 }), null);
  assert.equal(backupUploadError({ name: 'archive.tar.gz', size: 1500 * 1024 ** 2 }), null);
  assert.equal(backupUploadError({ name: 'archive.tar.gz', size: 2147483648 }), null);
  assert.equal(backupUploadLimit('3221225472'), 3221225472);
  for (const value of [undefined, null, 0, -1, 'not-a-number', Infinity]) assert.equal(backupUploadLimit(value), 2147483648);
  assert.equal(backupUploadError({ name: 'archive.tar.gz', size: 1025 }, 1024), 'size');
});

test('recovery config preserves explicit false, serializes real contract fields and rejects invalid schedule/flags', () => {
  const config = { weeklyFull: { enabled: false, dayOfWeek: 0, time: '03:00' }, monthlyDrill: { enabled: true, dayOfMonth: 28, time: '04:00' }, retention: { enabled: false }, offsite: { enabled: true }, maintenance: { allowWriterPause: false } };
  assert.deepEqual(backupRecoverySettings(config), config);
  for (const invalid of [{ weeklyFull: { ...config.weeklyFull, dayOfWeek: 7 } }, { monthlyDrill: { ...config.monthlyDrill, dayOfMonth: 29 } }, { retention: { enabled: 'false' } }, { maintenance: { allowWriterPause: 1 } }]) assert.throws(() => backupRecoverySettings(invalid));
  assert.deepEqual(backupRecoverySettings({ offsite: { enabled: false, password: 'never-send' } }), { offsite: { enabled: false } });
});

test('retention counts survive serialization and enforce API integer bounds 1..365 / minimumVerified 1..10', () => {
  const retention = { enabled: false, daily: 7, weekly: 4, monthly: 3, minimumVerified: 2 };
  assert.deepEqual(backupRecoverySettings({ retention }), { retention });
  for (const count of [-1, 0, 1.5, 366, NaN, Infinity]) assert.throws(() => backupRecoverySettings({ retention: { ...retention, daily: count } }));
  assert.throws(() => backupRecoverySettings({ retention: { ...retention, minimumVerified: 11 } }));
  assert.deepEqual(backupRecoverySettings({ retention: { ...retention, daily: 365, minimumVerified: 10 } }), { retention: { ...retention, daily: 365, minimumVerified: 10 } });
});
