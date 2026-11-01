import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTargetModule } from './overview-target-loader.mjs';
const { isHistoryMigrationHttps } = loadTargetModule('history-migration/history-migration-security.ts');

test('HTTPS requires a TLS socket or an explicitly trusted direct proxy, never global trust-proxy', () => {
  const before = process.env.HISTORY_MIGRATION_TRUSTED_PROXIES;
  const req = (remoteAddress, proto, encrypted = false) => ({ socket: { remoteAddress, encrypted }, headers: { 'x-forwarded-proto': proto }, secure: true });
  try {
    delete process.env.HISTORY_MIGRATION_TRUSTED_PROXIES;
    assert.equal(isHistoryMigrationHttps(req('127.0.0.1', 'https')), false);
    assert.equal(isHistoryMigrationHttps(req('10.1.2.3', undefined, true)), true);
    process.env.HISTORY_MIGRATION_TRUSTED_PROXIES = '10.1.2.3, ::1';
    assert.equal(isHistoryMigrationHttps(req('10.1.2.3', 'https')), true);
    assert.equal(isHistoryMigrationHttps(req('::ffff:10.1.2.3', 'https')), true);
    assert.equal(isHistoryMigrationHttps(req('::1', 'https')), true);
    for (const proto of ['http', 'https,http', ['https'], undefined]) assert.equal(isHistoryMigrationHttps(req('10.1.2.3', proto)), false);
    assert.equal(isHistoryMigrationHttps(req('10.1.2.4', 'https')), false);
    process.env.HISTORY_MIGRATION_TRUSTED_PROXIES = '*';
    assert.equal(isHistoryMigrationHttps(req('10.1.2.3', 'https')), false);
  } finally { if (before === undefined) delete process.env.HISTORY_MIGRATION_TRUSTED_PROXIES; else process.env.HISTORY_MIGRATION_TRUSTED_PROXIES = before; }
});
