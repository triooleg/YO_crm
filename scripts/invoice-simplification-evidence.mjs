// Synthetic local evidence only. No CRM server, credentials or production data.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireApi = createRequire(resolve(root, 'apps/api/package.json'));
const ts = requireApi('typescript'), modules = new Map();
function compile(source, filename) {
  const module = { exports: {} };
  const customRequire = name => name === './order-document-model' ? modules.get('model') : requireApi(name);
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText, { module, exports: module.exports, require: customRequire, Intl, Date, Buffer, structuredClone, __dirname: resolve(root, 'apps/api/src/finance') }, { filename });
  return module.exports;
}
modules.set('model', compile(await readFile(resolve(root, 'apps/api/src/finance/order-document-model.ts'), 'utf8'), 'model'));
const pdf = compile(await readFile(resolve(root, 'apps/api/src/finance/order-document-pdf.ts'), 'utf8'), 'pdf');
const brandingSource = await readFile(resolve(root, 'apps/api/src/finance/invoice-branding.ts'), 'utf8');
const brandMark = brandingSource.match(/INVOICE_DEFAULT_BRAND_MARK_SVG = '([^']+)'/)?.[1];
if (!brandMark) throw Error('CRM default brand mark missing');
const logoDataUri = `data:image/png;base64,${(await requireApi('sharp')(Buffer.from(brandMark)).png().toBuffer()).toString('base64')}`;
const fieldKeys = ['order.number', 'client.name', 'client.country', 'finance.itemsTotal', 'finance.discount', 'finance.delivery', 'finance.tax', 'finance.total', 'finance.paid', 'finance.balance', 'table.items'];
const order = { id: 'synthetic-order', number: 'YO-671', currency: 'EUR', priceMinor: 40000, deliveryMinor: 2000, discountMinor: 2000, taxMinor: 2264, createdAt: '2026-10-01T12:00:00Z', client: { displayName: 'QA Клиент / QA Customer', country: 'Canada' }, items: [{ name: 'Custom leotard / Купальник', quantity: 2, priceMinor: 20000 }], payments: [{ amountMinor: 20000, currency: 'EUR', receivedAt: '2026-10-22T12:00:00Z', method: 'BANK_TRANSFER' }] };
const output = resolve(root, 'output/pdf'); await mkdir(output, { recursive: true });
for (const language of ['en', 'ru']) {
  const config = modules.get('model').normalizeTemplateConfig({ title: language === 'ru' ? 'ИНВОЙС' : 'INVOICE', fieldKeys, currency: 'EUR', seller: { name: 'QA Atelier', address: 'Synthetic address, Ukraine' }, payment: { receiver: 'QA Atelier', iban: 'TEST-IBAN-NOT-FOR-PAYMENT', bic: 'TESTBIC', instructions: 'Invoice {{invoice.number}} / {{invoice.date}}' }, notes: language === 'ru' ? 'Спасибо за заказ! Тестовый документ.' : 'Thank you for your order! Synthetic document.', appearance: { accentColor: '#7040e8', fontSize: 10 } }, language);
  const snapshot = modules.get('model').buildOrderDocumentSnapshot(order, fieldKeys);
  snapshot.immutableInvoice = true;
  snapshot.values['finance.balance'] = { minor: 20000, currency: 'EUR' };
  const source = { title: config.title, language, templateSnapshot: config, dataSnapshot: snapshot, number: order.number, logoDataUri, issueDate: new Date('2026-10-26T12:00:00Z'), currency: 'EUR', notes: config.notes };
  const bytes = await pdf.renderOrderDocumentPdf(source);
  await writeFile(resolve(output, `invoice-simplification-${language}.html`), pdf.renderSimplifiedInvoiceHtml(source));
  await writeFile(resolve(output, `invoice-simplification-${language}.pdf`), bytes);
  console.log(`${language}: ${bytes.length} bytes`);
}
