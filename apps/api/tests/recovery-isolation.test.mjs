import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(env) {
  const file = new URL('../src/recovery-safety.ts', import.meta.url);
  const module = { exports: {} };
  const process = { env };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, process, Error, Promise });
  return module.exports;
}

test('isolated recovery blocks provider fetches before a transport is called', async () => {
  let calls = 0;
  const api = load({ APP_ENV: 'backup-drill' });
  const fetch = api.recoveryFetch(async () => { calls++; return 'sent'; });
  await assert.rejects(fetch('https://provider.invalid/messages', { method: 'POST' }), /RECOVERY_OUTBOUND_DISABLED/);
  await assert.rejects(fetch('https://provider.invalid/attachments'), /RECOVERY_OUTBOUND_DISABLED/);
  assert.equal(calls, 0);
  assert.throws(() => api.assertExternalSideEffectsAllowed(), /RECOVERY_OUTBOUND_DISABLED/);
});

test('normal production transport is unchanged; recovery is explicit and fail-closed', async () => {
  const api = load({ APP_ENV: 'production' });
  const input = { method: 'POST' };
  const url = 'https://provider.invalid/messages';
  const calls = [];
  const fetch = api.recoveryFetch(async (...args) => { calls.push(args); return 'ok'; });
  assert.equal(await fetch(url, input), 'ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], url);
  assert.equal(calls[0][1], input);
  assert.equal(api.recoveryIsolationEnabled(), false);
});

test('recovery HTTP surface only permits reads and staff session login/logout', () => {
  const api = load({ APP_ENV: 'backup-drill' });
  assert.equal(api.recoveryRequestAllowed('GET', '/api/orders'), true);
  assert.equal(api.recoveryRequestAllowed('POST', '/api/auth/login'), true);
  assert.equal(api.recoveryRequestAllowed('POST', '/api/auth/logout'), true);
  for (const path of ['/api/communications/reply', '/api/integrations/website/orders', '/api/auth/login/extra', '/api/admin/backups']) {
    assert.equal(api.recoveryRequestAllowed('POST', path), false);
  }
  assert.equal(api.recoveryRequestAllowed('DELETE', '/api/orders/one'), false);
  for (const path of ['/api/communications/meta/oauth/start', '/api/communications/meta/instagram/oauth/callback']) {
    assert.equal(api.recoveryRequestAllowed('GET', path), false);
    assert.equal(api.recoveryRequestAllowed('HEAD', path), false);
  }
  assert.equal(load({}).recoveryRequestAllowed('POST', '/api/orders'), true);
});
