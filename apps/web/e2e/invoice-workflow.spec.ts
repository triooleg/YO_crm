import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const { loadTargetModule } = require('./website-sales-model-loader.cjs');
const { buildOrderListPage } = loadTargetModule('orders/order-list-read-model.ts');
test.beforeAll(() => { execFileSync(process.execPath, ['scripts/invoice-simplification-evidence.mjs'], { cwd: resolve(process.cwd(), '../..'), timeout: 30000 }); });

async function fixture(page: Page, role = 'OWNER') {
  const writes: { path: string; body: any }[] = [];
  const config = { title: 'INVOICE', fieldKeys: ['client.name', 'table.items', 'finance.total'], showLogo: true, seller: { name: 'QA Atelier', address: 'QA address' }, payment: { receiver: '', iban: '', bic: '', instructions: '' }, isDefault: true, currency: 'EUR', purpose: 'SEPA', revision: 2 };
  const order: any = { id: 'invoice-order', number: 'YO-671', currency: 'EUR', type: 'CUSTOM_ORDER', priceMinor: 40000, depositRequiredMinor: 20000, paymentStatus: 'PAID', productionStatus: 'NOT_SCHEDULED', shippingStatus: 'NOT_READY', salesStatus: 'NEW_LEAD', createdAt: '2026-10-01T12:00:00Z', client: { id: 'qa-client', displayName: 'QA Клиент', source: 'FACEBOOK', country: 'Canada' }, payments: [], activities: [], documents: [], invoices: [], items: [{ id: 'qa-design', name: 'custom leotard', quantity: 2, priceMinor: 20000, instances: [] }] };
  await page.route('**/api/**', async route => {
    const r = route.request(), u = new URL(r.url()), p = u.pathname;
    if (p.endsWith('/website-notification/read')) return route.fulfill({ json: { acknowledged: true } });
    if (r.method() !== 'GET') {
      writes.push({ path: p, body: r.postDataJSON() });
      if (p === '/api/finance/invoice-previews') return route.fulfill({ json: { previewToken: 'qa-preview', number: 'YO-671', currency: 'EUR', totalMinor: 40000, language: 'en', templateName: 'Invoice SEPA · English', templateRevision: 2, issueDate: '2026-10-26T12:00:00Z', html: readFileSync(resolve(process.cwd(), '../../output/pdf/invoice-simplification-en.html'), 'utf8') } });
      if (p === '/api/finance/invoices/from-template') { const ordinal = order.invoices.length; const saved = { id: ordinal ? `saved-invoice-${ordinal + 1}` : 'saved-invoice', number: order.number, status: 'ISSUED', language: 'en', currency: 'EUR', totalMinor: 40000, issueDate: '2026-10-26T12:00:00Z', templateKey: 'qa-template', documentOptions: { templateName: 'Invoice SEPA · English', templateRevision: 2, immutable: true } }; order.invoices.push(saved); return route.fulfill({ json: saved }); }
      if (p.endsWith('/archive')) { order.invoices = []; return route.fulfill({ json: { id: 'saved-invoice' } }); }
      if (p === '/api/finance/invoices/saved-invoice' && r.method() === 'PATCH') { const status = r.postDataJSON().status; if (status === 'PAID') return route.fulfill({ status: 400, json: { message: 'Недостаточно распределённой оплаты' } }); const saved = order.invoices.find((item: any) => item.id === 'saved-invoice'); saved.status = status; return route.fulfill({ json: saved }); }
      return route.fulfill({ status: 400, json: { message: 'Unexpected mutation' } });
    }
    if (p.endsWith('/document')) return route.fulfill({ contentType: 'application/pdf', body: readFileSync(resolve(process.cwd(), '../../output/pdf/invoice-simplification-en.pdf')) });
    if (p.endsWith('/preview')) return route.fulfill({ json: { html: readFileSync(resolve(process.cwd(), '../../output/pdf/invoice-simplification-en.html'), 'utf8') } });
    if (p === '/api/finance/document-fields/invoice-order') return route.fulfill({ json: { definitions: [], snapshot: { items: [{ description: 'custom leotard', quantity: 2, amountMinor: 20000 }] } } });
    return route.fulfill({ json: p === '/api/auth/me' ? { user: { role, displayName: 'QA Owner' } } : p === '/api/branding' ? {} : p === '/api/communications/unread-count' ? { unreadCount: 0 } : p === '/api/orders' ? buildOrderListPage([order], Object.fromEntries(u.searchParams), new Date('2026-10-26T12:00:00Z')) : p === '/api/orders/invoice-order' ? order : p === '/api/finance/document-templates' ? [{ id: 'qa-template', name: 'Invoice SEPA · English', kind: 'INVOICE', language: 'en', active: true, builtIn: false, config }, { id: 'inactive', name: 'Archived invoice', kind: 'INVOICE', active: false, config }, { id: 'customer-card', name: 'Customer card', kind: 'CUSTOMER_CARD', language: 'ru', active: true, config }] : [] });
  });
  await page.goto('/?section=orders&orderId=invoice-order&tab=finance');
  await page.getByRole('tab', { name: 'Финансы', exact: true }).click();
  return { writes, order };
}

for (const width of [1920, 1366, 390]) test(`invoice requires only template selection before preview at ${width}`, async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: width === 390 ? 844 : width === 1366 ? 768 : 1080 });
  const { writes } = await fixture(page);
  await page.getByRole('button', { name: 'Создать инвойс', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Создать инвойс', exact: true });
  await expect(picker.getByRole('button', { name: /Invoice SEPA/ })).toBeVisible();
  await expect(picker.getByRole('textbox')).toHaveCount(0);
  await expect(picker).not.toContainText('Archived invoice');
  await expect(picker).not.toContainText('Customer card');
  await picker.screenshot({ path: info.outputPath(`template-picker-${width}.png`) });
  await picker.getByRole('button', { name: /Invoice SEPA/ }).click();
  const preview = page.getByRole('dialog', { name: 'Предпросмотр инвойса', exact: true });
  await expect(preview.getByRole('button', { name: 'Сохранить в заказ', exact: true })).toBeEnabled();
  await expect(preview.getByTitle('Документ инвойса')).toBeVisible();
  const rendered = page.frameLocator('iframe[title="Документ инвойса"]');
  await expect(rendered.locator('.number')).toHaveText('YO-671');
  await expect(rendered.getByRole('img', { name: 'Yoleotard', exact: true })).toBeVisible();
  await expect(rendered.getByRole('img', { name: 'Yoleotard', exact: true })).toHaveAttribute('src', /^data:image\/png;base64,/);
  expect(writes.map(w => w.path)).toEqual(['/api/finance/invoice-previews']);
  await expect(preview.getByRole('link', { name: 'Скачать PDF', exact: true })).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Распечатать', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await preview.getByRole('link', { name: 'Скачать PDF', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('YO-671.pdf');
  expect(writes.filter(w => w.path.endsWith('/from-template'))).toHaveLength(0);
  await page.evaluate(() => { const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Документ инвойса"]'); frame?.contentWindow?.addEventListener('beforeprint', () => { document.body.dataset.invoicePrinted = 'true'; }); });
  await preview.getByRole('button', { name: 'Распечатать', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.body.dataset.invoicePrinted)).toBe('true');
  expect(writes.filter(w => w.path.endsWith('/from-template'))).toHaveLength(0);
  await page.waitForTimeout(800); // Allow the browser PDF viewer to paint before the visual artifact.
  await preview.screenshot({ path: info.outputPath(`invoice-preview-${width}.png`) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await preview.getByRole('button', { name: 'Сохранить в заказ', exact: true }).dblclick();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes.filter(w => w.path.endsWith('/from-template'))).toHaveLength(1);
  await expect(page.locator('.order-invoice-documents').getByText('YO-671', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`saved-invoice-${width}.png`), fullPage: true });
  await page.locator('.order-invoice-documents').scrollIntoViewIfNeeded();
  await page.locator('.order-invoice-documents').screenshot({ path: info.outputPath(`saved-card-${width}.png`) });
  await page.getByRole('button', { name: 'Просмотреть: YO-671', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Инвойс YO-671', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить в заказ', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('failed generation can be retried and empty templates link only administrators to settings', async ({ page }) => {
  await fixture(page);
  let attempts = 0;
  await page.route('**/api/finance/invoice-previews', route => ++attempts === 1 ? route.fulfill({ status: 400, json: { message: 'Заполните реквизиты продавца в шаблоне' } }) : route.fulfill({ json: { previewToken: 'qa-preview', number: 'YO-671', currency: 'EUR', totalMinor: 40000, language: 'en', templateName: 'Invoice SEPA', issueDate: '2026-10-26' } }));
  await page.getByRole('button', { name: 'Создать инвойс', exact: true }).click();
  await page.getByRole('button', { name: /Invoice SEPA/ }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Заполните реквизиты');
  await page.getByRole('button', { name: /Invoice SEPA/ }).click();
  await expect(page.getByRole('dialog', { name: 'Предпросмотр инвойса', exact: true })).toBeVisible();
});

test('save retry keeps its idempotency key and never re-generates the preview', async ({ page }) => {
  const { writes } = await fixture(page); const attempts: any[] = [];
  await page.route('**/api/finance/invoices/from-template', async route => { attempts.push(route.request().postDataJSON()); if (attempts.length === 1) return route.fulfill({ status: 503, json: { message: 'Повторите сохранение' } }); return route.fallback(); });
  await page.getByRole('button', { name: 'Создать инвойс', exact: true }).click();
  await page.getByRole('button', { name: /Invoice SEPA/ }).click();
  const preview = page.getByRole('dialog', { name: 'Предпросмотр инвойса', exact: true });
  await preview.getByRole('button', { name: 'Сохранить в заказ', exact: true }).click();
  await expect(preview.getByRole('alert')).toContainText('Повторите сохранение');
  await preview.getByRole('button', { name: 'Сохранить в заказ', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(attempts).toHaveLength(2); expect(attempts[0]).toEqual(attempts[1]);
  expect(writes.filter(w => w.path.endsWith('/invoice-previews'))).toHaveLength(1);
});

for (const role of ['OWNER', 'MANAGER']) test(`empty templates show settings only for an administrator: ${role}`, async ({ page }) => {
  await fixture(page, role);
  await page.route('**/api/finance/document-templates', route => route.fulfill({ json: [] }));
  await page.getByRole('button', { name: 'Создать инвойс', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Создать инвойс', exact: true });
  await expect(picker).toContainText('Активные шаблоны инвойсов не найдены.');
  await expect(picker.getByRole('link', { name: 'Шаблоны инвойсов', exact: true })).toHaveCount(role === 'OWNER' ? 1 : 0);
});

test('saved invoice can be copied with lineage and archived through explicit confirmation', async ({ page }) => {
  const { writes } = await fixture(page);
  await page.getByRole('button', { name: 'Создать инвойс', exact: true }).click();
  await page.getByRole('button', { name: /Invoice SEPA/ }).click();
  await page.getByRole('button', { name: 'Сохранить в заказ', exact: true }).click();
  await page.getByRole('button', { name: 'Другие действия: YO-671', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Создать копию', exact: true }).click();
  await page.getByRole('button', { name: /Invoice SEPA/ }).click();
  await expect(page.getByRole('dialog', { name: 'Предпросмотр инвойса', exact: true })).toBeVisible();
  expect(writes.filter(w => w.path.endsWith('/invoice-previews')).at(-1)!.body.sourceInvoiceId).toBe('saved-invoice');
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Другие действия: YO-671', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Архивировать', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Архивировать', exact: true });
  expect(writes.filter(w => w.path.endsWith('/archive'))).toHaveLength(0);
  await confirmation.getByRole('button', { name: 'Архивировать', exact: true }).click();
  await expect(page.locator('.order-invoice-documents').getByText('YO-671', { exact: true })).toHaveCount(0);
  expect(writes.filter(w => w.path.endsWith('/archive'))).toHaveLength(1);
});

test('immutable invoice retains guarded lifecycle actions without exposing content editing', async ({ page }) => {
  const { writes } = await fixture(page);
  await page.getByRole('button', { name: 'Создать инвойс', exact: true }).click();
  await page.getByRole('button', { name: /Invoice SEPA/ }).click();
  await page.getByRole('button', { name: 'Сохранить в заказ', exact: true }).click();
  await page.getByRole('button', { name: 'Просмотреть: YO-671', exact: true }).click();
  const viewer = page.getByRole('dialog', { name: 'Инвойс YO-671', exact: true });
  await expect(viewer.getByLabel('Продавец', { exact: true })).toHaveCount(0);
  await expect(viewer.getByLabel('Цена за единицу', { exact: true })).toHaveCount(0);
  await viewer.getByLabel('Статус инвойса', { exact: true }).click();
  await page.getByRole('option', { name: 'Оплачен', exact: true }).click();
  await viewer.getByRole('button', { name: 'Сохранить статус', exact: true }).click();
  await expect(viewer.getByRole('alert')).toContainText('Недостаточно распределённой оплаты');
  await viewer.getByLabel('Статус инвойса', { exact: true }).click();
  await page.getByRole('option', { name: 'Отменён', exact: true }).click();
  await viewer.getByRole('button', { name: 'Сохранить статус', exact: true }).click();
  await expect(viewer.getByRole('alert')).toHaveCount(0);
  const mutations = writes.filter(w => w.path === '/api/finance/invoices/saved-invoice');
  expect(mutations.map(w => w.body)).toEqual([{ status: 'PAID' }, { status: 'CANCELLED' }]);
});

test('creating again adds a separate document and the generic document action stays available', async ({ page }) => {
  const { writes } = await fixture(page);
  for (let index = 0; index < 2; index++) {
    await page.getByRole('button', { name: 'Создать инвойс', exact: true }).click();
    await page.getByRole('button', { name: /Invoice SEPA/ }).click();
    await page.getByRole('button', { name: 'Сохранить в заказ', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await expect(page.locator('.order-invoice-documents').getByText('YO-671', { exact: true })).toHaveCount(2);
  const saves = writes.filter(w => w.path.endsWith('/from-template')); expect(saves).toHaveLength(2);
  expect(saves[0]!.body.idempotencyKey).not.toBe(saves[1]!.body.idempotencyKey);
  await page.locator('.order-invoice-documents-head').getByRole('button', { name: 'Другие действия', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Создать другой документ', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('combobox', { name: /^Шаблон документа/ })).toHaveValue('Customer card · Карточка заказчика');
});

for (const externallyArchived of [false, true]) test(`saved optimistic rows yield to authoritative refresh, archived=${externallyArchived}`, async ({ page }) => {
  const { order } = await fixture(page);
  await page.route('**/api/finance/invoices/from-template', route => {
    const saved = { id: 'saved-invoice', number: 'YO-671', status: 'ISSUED', language: 'en', currency: 'EUR', totalMinor: 40000, issueDate: '2026-10-26T12:00:00Z', documentOptions: { immutable: true } };
    order.invoices = externallyArchived ? [] : [{ ...saved, status: 'CANCELLED' }];
    return route.fulfill({ json: saved });
  });
  await page.getByRole('button', { name: 'Создать инвойс', exact: true }).click();
  await page.getByRole('button', { name: /Invoice SEPA/ }).click();
  await page.getByRole('button', { name: 'Сохранить в заказ', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  if (externallyArchived) await expect(page.locator('.order-invoice-list-row')).toHaveCount(0);
  else await expect(page.locator('.order-invoice-list-row')).toContainText('Отменён');
});

test('successful save remains visible when the following detail refresh fails', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Создать инвойс', exact: true }).click();
  await page.getByRole('button', { name: /Invoice SEPA/ }).click();
  await page.route('**/api/orders/invoice-order', route => route.fulfill({ status: 503, json: { message: 'Временно недоступно' } }));
  await page.getByRole('button', { name: 'Сохранить в заказ', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.order-invoice-documents').getByRole('alert')).toContainText('Инвойс сохранён. Обновите список');
  await expect(page.locator('.order-invoice-documents').getByText('YO-671', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Финансы', exact: true })).toBeVisible();
});

test('explicit save and download retries idempotently and downloads the saved artifact', async ({ page }) => {
  const { writes } = await fixture(page); const attempts: any[] = [];
  await page.route('**/api/finance/invoices/from-template', route => { attempts.push(route.request().postDataJSON()); return attempts.length === 1 ? route.fulfill({ status: 503, json: { message: 'Повторите сохранение' } }) : route.fallback(); });
  await page.getByRole('button', { name: 'Создать инвойс', exact: true }).click();
  await page.getByRole('button', { name: /Invoice SEPA/ }).click();
  await page.getByRole('button', { name: 'Сохранить и скачать', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Повторите сохранение');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить и скачать', exact: true }).click();
  expect((await download).url()).toContain('/api/finance/invoices/saved-invoice/document?download=1');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.order-invoice-documents').getByText('YO-671', { exact: true })).toBeVisible();
  expect(attempts[0]).toEqual(attempts[1]);
  expect(writes.filter(w => w.path.endsWith('/from-template'))).toHaveLength(1);
});

test('unavailable CRM logo displays a localized actionable error without saving an invoice', async ({ page }) => {
  const { writes } = await fixture(page);
  await page.route('**/api/finance/invoice-previews', route => route.fulfill({ status:400,json:{code:'INVOICE_LOGO_UNAVAILABLE',message:'INVOICE_LOGO_UNAVAILABLE'} }));
  await page.getByRole('button',{name:'Создать инвойс',exact:true}).click();
  await page.getByRole('button',{name:/Invoice SEPA/}).click();
  const alert=page.getByRole('dialog').getByRole('alert');
  await expect(alert).toContainText('Повторно загрузите логотип в настройках оформления');
  await expect(alert).not.toContainText('INVOICE_LOGO_UNAVAILABLE');
  expect(writes.filter(w=>w.path.endsWith('/from-template'))).toHaveLength(0);
});
