import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
import sharp from 'sharp';
import { inflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
require('reflect-metadata');
const cache = new Map();
function load(path) {
 const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../src', path);
 if (cache.has(filename)) return cache.get(filename).exports;
 const module = { exports: {} }; cache.set(filename, module);
 const js = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, experimentalDecorators: true } }).outputText;
 const local = name => name.startsWith('.') ? load(resolve(dirname(filename), name + '.ts')) : require(name);
 new Function('require', 'module', 'exports', '__dirname', js)(local, module, module.exports, dirname(filename));
 return module.exports;
}
const settings = value => ({ appSetting: { findUnique: async query => {
 assert.deepEqual(query.where.section_key, { section: 'interface', key: 'branding' });
 return value === undefined ? null : { value };
} } });

test('default invoice logo is the CRM BrandMark graphic, with the same paths and proportions', async () => {
 const { resolveInvoiceBranding, INVOICE_DEFAULT_BRAND_MARK_SVG } = load('finance/invoice-branding.ts');
 const shell = readFileSync(new URL('../../web/components/crm-shell.tsx', import.meta.url), 'utf8');
 const graphic = shell.slice(shell.indexOf('function BrandMark'));
 for (const path of graphic.matchAll(/\bd="([^"]+)"/g)) assert.ok(INVOICE_DEFAULT_BRAND_MARK_SVG.includes(`d="${path[1]}"`));
 const { logoDataUri } = await resolveInvoiceBranding(settings());
 assert.match(logoDataUri, /^data:image\/png;base64,/);
 const metadata = await sharp(Buffer.from(logoDataUri.split(',')[1], 'base64')).metadata();
 assert.equal(metadata.format, 'png'); assert.equal(metadata.width / metadata.height, 36 / 42);
 assert.deepEqual(await resolveInvoiceBranding(settings({ useInHeader: false, logoPath: '../bad.webp' })), { logoDataUri });
});

test('configured header logo is read locally and frozen as bounded PNG; unsafe names never become URLs', async () => {
 const { resolveInvoiceBranding } = load('finance/invoice-branding.ts');
 const root = await mkdtemp(join(tmpdir(), 'invoice-branding-')), previous = process.env.UPLOADS_DIR;
 process.env.UPLOADS_DIR = root;
 try {
  await mkdir(join(root, 'branding'));
  const webp = await sharp({ create: { width: 240, height: 80, channels: 4, background: '#e12345' } }).webp().toBuffer();
  await writeFile(join(root, 'branding', 'ab-cd.webp'), webp);
  const snapshot = await resolveInvoiceBranding(settings({ logoPath: 'ab-cd.webp', useInHeader: true }));
  const png = Buffer.from(snapshot.logoDataUri.split(',')[1], 'base64');
  const expected = await sharp(webp).png().toBuffer();
  assert.deepEqual(png, expected);
  await writeFile(join(root, 'branding', 'ab-cd.webp'), 'broken');
  assert.deepEqual(png, expected, 'resolved snapshot is independent of later file changes');
  await assert.rejects(resolveInvoiceBranding(settings({ logoPath: 'ab-cd.webp' })), error => {
   assert.equal(error.getResponse().code, 'INVOICE_LOGO_UNAVAILABLE'); assert.ok(!error.message.includes(root)); return true;
  });
  await assert.rejects(resolveInvoiceBranding(settings({ logoPath: 'ff.webp' })), /INVOICE_LOGO_UNAVAILABLE/);
  await writeFile(join(root, 'branding', 'ab-cd.webp'), Buffer.alloc(3 * 1024 * 1024 + 1));
  await assert.rejects(resolveInvoiceBranding(settings({ logoPath: 'ab-cd.webp' })), /INVOICE_LOGO_UNAVAILABLE/);
  const large = await sharp({ create: { width: 4097, height: 1, channels: 3, background: '#ffffff' } }).webp().toBuffer();
  await writeFile(join(root, 'branding', 'ab-cd.webp'), large);
  await assert.rejects(resolveInvoiceBranding(settings({ logoPath: 'ab-cd.webp' })), /INVOICE_LOGO_UNAVAILABLE/);
  const builtin = await resolveInvoiceBranding(settings());
  for (const logoPath of ['../ab-cd.webp', '..\\ab-cd.webp', 'https://example.com/a.webp', '/etc/passwd', 'ab-cd.webp\n', 'data:image/svg+xml,<svg/>']) {
   assert.deepEqual(await resolveInvoiceBranding(settings({ logoPath })), builtin);
  }
 } finally {
  if (previous === undefined) delete process.env.UPLOADS_DIR; else process.env.UPLOADS_DIR = previous;
  await rm(root, { recursive: true, force: true });
 }
});

const source = extra => ({ title: 'INVOICE', number: 'TEST-1', language: 'en', templateSnapshot: { showLogo: true, seller: { name: 'Synthetic seller' } }, dataSnapshot: { immutableInvoice: true, currency: 'EUR', fieldKeys: [], values: {}, items: [] }, ...extra });
test('simplified HTML and real PDF embed the same image, respect showLogo and ignore template image injection', async () => {
 const { resolveInvoiceBranding } = load('finance/invoice-branding.ts');
 const { renderSimplifiedInvoiceHtml, renderSimplifiedInvoicePdf } = load('finance/order-document-pdf.ts');
 const { normalizeTemplateConfig } = load('finance/order-document-model.ts');
 const branding = await resolveInvoiceBranding(settings());
 const html = renderSimplifiedInvoiceHtml(source(branding));
 assert.ok(html.includes(`<img src="${branding.logoDataUri}"`));
 assert.match(html, /img-src data:/);
 const pdf = await renderSimplifiedInvoicePdf(source(branding));
 assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
 assert.match(pdf.toString('latin1'), /\/Subtype \/Image/);
 assert.match(pdf.toString('latin1'), /\/Width 216\b/);
 assert.match(pdf.toString('latin1'), /\/Height 252\b/);
 const widePng = await sharp({ create: { width: 240, height: 80, channels: 3, background: '#e12345' } }).png().toBuffer();
 const widePdf = await renderSimplifiedInvoicePdf(source({ logoDataUri: 'data:image/png;base64,' + widePng.toString('base64') }));
 const content = [...widePdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].flatMap(match => {
  try { return [inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1')]; } catch { return []; }
 }).find(stream => /\/I\d+ Do/.test(stream));
 assert.match(content, /165 0 0 -55 48 102 cm/, 'wide image is fitted into header without stretching');
 const hidden = source({ ...branding, templateSnapshot: { showLogo: false } });
 assert.doesNotMatch(renderSimplifiedInvoiceHtml(hidden), /<img\b/);
 assert.doesNotMatch((await renderSimplifiedInvoicePdf(hidden)).toString('latin1'), /\/Subtype \/Image/);
 const config = normalizeTemplateConfig({ logoDataUri: branding.logoDataUri, appearance: { logoDataUri: branding.logoDataUri } });
 assert.equal(config.logoDataUri, undefined); assert.equal(config.appearance.logoDataUri, undefined);
 assert.doesNotMatch(renderSimplifiedInvoiceHtml(source({ templateSnapshot: { logoDataUri: branding.logoDataUri } })), /<img\b/);
 const corrupted = Buffer.from(branding.logoDataUri.split(',')[1], 'base64'); corrupted[29] ^= 1;
 const huge = Buffer.from(branding.logoDataUri.split(',')[1], 'base64'); huge.writeUInt32BE(0xffffffff, 16);
 for (const logoDataUri of ['https://example.com/logo.png', 'file:///private.png', 'data:image/svg+xml,<svg onload="alert(1)"/>', branding.logoDataUri + '" onerror="alert(1)', 'data:image/png;base64,' + Buffer.from('<svg/>').toString('base64'), 'data:image/png;base64,' + corrupted.toString('base64'), 'data:image/png;base64,' + huge.toString('base64'), 'data:image/png;base64,' + 'A'.repeat(1500000)]) {
  assert.doesNotMatch(renderSimplifiedInvoiceHtml(source({ logoDataUri })), /<img\b/);
  assert.doesNotMatch((await renderSimplifiedInvoicePdf(source({ logoDataUri }))).toString('latin1'), /\/Subtype \/Image/);
 }
});
