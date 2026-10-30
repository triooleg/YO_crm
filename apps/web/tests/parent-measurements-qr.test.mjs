import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url), ts = require('typescript');
function helper(qrcode = require('qrcode')) {
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(new URL('../lib/parent-measurements-qr.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(name => name === 'qrcode' ? qrcode : require(name), mod, mod.exports);
  return mod.exports.measurementLinkQrDataUrl;
}

test('QR helper encodes the full issued URL including secret fragment without changing it', async () => {
  let encoded;
  const generate = helper({ toDataURL: async (url, options) => { encoded = { url, options }; return 'data:image/png;base64,qr'; } });
  const url = 'https://crm.example/parent-measurements#private-token_123';
  assert.equal(await generate(url), 'data:image/png;base64,qr');
  assert.equal(encoded.url, url); assert.equal(encoded.options.margin, 4);
});

test('real QR encoder produces a 320px PNG data URL and propagates encoding failure', async () => {
  const url = await helper()('https://crm.example/parent-measurements#private-token_123');
  assert.ok(url.startsWith('data:image/png;base64,'));
  const png = Buffer.from(url.split(',')[1], 'base64');
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 320); assert.equal(png.readUInt32BE(20), 320);
  await assert.rejects(helper({ toDataURL: async () => { throw Error('encode failed'); } })('https://crm.example/#token'), /encode failed/);
});
