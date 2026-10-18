import { test, expect, type Page } from '@playwright/test';

const client = { id: 'client-nav', displayName: 'QA Client', source: 'INSTAGRAM', preferredChannel: 'INSTAGRAM' };
const task = { id: 'task-nav', columnId: 'new', title: 'QA sketch', type: 'CLIENT', client, labels: [], attachments: [] };
async function mock(page: Page, options: { role?: string; orders?: object[]; fail?: boolean; noClient?: boolean; wrongClient?: boolean } = {}) {
  let writes = 0, clientReads = 0;
  await page.context().route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') { writes++; return route.fulfill({ status: 405, json: {} }); }
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'owner', displayName: 'QA', role: options.role || 'OWNER' } } });
    if (path === '/api/branding') return route.fulfill({ json: {} });
    if (path === '/api/communications/unread-count') return route.fulfill({ json: { unreadCount: 0 } });
    if (path === '/api/tasks/board') return route.fulfill({ json: { columns: [{ id: 'new', name: 'Новые', color: '#7047eb', isDone: false, sortOrder: 0, tasks: [{ ...task, client: options.noClient ? undefined : client }] }], users: [] } });
    if (path === '/api/clients/client-nav') { clientReads++; return route.fulfill(options.fail ? { status: 503, json: {} } : { json: { ...client, ...(options.wrongClient ? { id: 'another-client' } : {}), orders: options.orders ?? [{ id: 'order-nav', number: 'QA-101', clientId: client.id, archivedAt: null }] } }); }
    return route.fulfill({ json: [] });
  });
  return { writes: () => writes, clientReads: () => clientReads };
}

test('task offers both client destinations without saving or losing entered text', async ({ page }) => {
  const receipt = await mock(page);
  await page.goto('/?section=tasks');
  await page.getByRole('button', { name: /Открыть задачу: QA sketch/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Редактировать задачу' });
  await dialog.getByLabel('Название', { exact: true }).fill('Unsaved sketch');
  const messages = dialog.getByRole('link', { name: 'Переписка клиента', exact: true });
  await expect(messages).toHaveAttribute('href', '/?section=inbox&clientId=client-nav&clientName=QA+Client');
  await expect(messages).toHaveAttribute('target', '_blank');
  const order = dialog.getByRole('link', { name: 'Открыть заказ QA-101', exact: true });
  await expect(order).toHaveAttribute('href', '/?section=orders&orderId=order-nav');
  await expect(order).toHaveAttribute('target', '_blank');
  await page.context().route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (request.isNavigationRequest() && ['inbox', 'orders'].includes(url.searchParams.get('section') || '')) return route.fulfill({ contentType: 'text/html', body: '<main>Destination</main>' });
    return route.fallback();
  });
  for (const link of [messages, order]) {
    const popupPromise = page.waitForEvent('popup'); await link.click(); const popup = await popupPromise;
    await expect(popup).toHaveURL(new URL((await link.getAttribute('href'))!, page.url()).href);
    await popup.close();
  }
  await expect(dialog.getByLabel('Название', { exact: true })).toHaveValue('Unsaved sketch');
  expect(receipt.writes()).toBe(0);
});

for (const width of [1366, 390]) test(`multiple orders require a choice and exclude foreign/archived records ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 950 });
  const receipt = await mock(page, { orders: [
    { id: 'first', number: 'QA-101', clientId: client.id }, { id: 'second', number: 'QA-102', clientId: client.id },
    { id: 'foreign', number: 'QA-OTHER', clientId: 'other' }, { id: 'archived', number: 'QA-OLD', clientId: client.id, archivedAt: '2026-01-01' },
  ] });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?section=tasks'); await page.getByRole('button', { name: /Открыть задачу: QA sketch/ }).click();
  const dialog = page.getByRole('dialog');
  const orders = dialog.getByRole('combobox', { name: 'Заказ клиента', exact: true });
  await expect(orders.locator('option')).toHaveText(['Выберите заказ', 'QA-101', 'QA-102']);
  await expect(dialog.getByRole('link', { name: /Открыть заказ/ })).toHaveCount(0);
  await orders.selectOption('second');
  const link = dialog.getByRole('link', { name: 'Открыть заказ QA-102', exact: true });
  await expect(link).toHaveAttribute('href', '/?section=orders&orderId=second');
  await link.scrollIntoViewIfNeeded();
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(width);
  await page.screenshot({ path: info.outputPath(`task-client-links-${width}.png`), fullPage: true });
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`task-client-links-bottom-${width}.png`), fullPage: true });
  expect(receipt.writes()).toBe(0); expect(errors).toEqual([]);
});

test('no orders leaves the conversation link available', async ({ page }) => {
  await mock(page, { orders: [] }); await page.goto('/?section=tasks');
  await page.getByRole('button', { name: /Открыть задачу: QA sketch/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('У клиента пока нет заказов')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Переписка клиента', exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: /Открыть заказ/ })).toHaveCount(0);
});

for (const options of [{ fail: true }, { wrongClient: true }]) test(`failed or mismatched lookup does not invent an order ${JSON.stringify(options)}`, async ({ page }) => {
  await mock(page, options); await page.goto('/?section=tasks');
  await page.getByRole('button', { name: /Открыть задачу: QA sketch/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('Не удалось загрузить заказы клиента');
  await expect(dialog.getByRole('link', { name: 'Переписка клиента', exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: /Открыть заказ/ })).toHaveCount(0);
});

for (const options of [{ role: 'PRODUCTION' }, { noClient: true }]) test(`ineligible task makes no full-client lookup ${JSON.stringify(options)}`, async ({ page }) => {
  const receipt = await mock(page, options); await page.goto('/?section=tasks');
  await page.getByRole('button', { name: /Открыть задачу: QA sketch/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('link', { name: 'Переписка клиента', exact: true })).toHaveCount(0);
  expect(receipt.clientReads()).toBe(0); expect(receipt.writes()).toBe(0);
});

test('new client task already offers both destinations and failed lookup can retry', async ({ page }) => {
  const options = { fail: true }; const receipt = await mock(page, options);
  await page.goto('/?section=tasks&action=new&clientId=client-nav&clientName=QA+Client');
  const dialog = page.getByRole('dialog', { name: '+ Новая задача' });
  await expect(dialog.getByRole('alert')).toContainText('Не удалось загрузить заказы клиента');
  await expect(dialog.getByRole('link', { name: 'Переписка клиента', exact: true })).toBeVisible();
  const readsBeforeRetry = receipt.clientReads();
  options.fail = false; await dialog.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(dialog.getByRole('link', { name: 'Открыть заказ QA-101', exact: true })).toBeVisible();
  expect(receipt.clientReads()).toBe(readsBeforeRetry + 1); expect(receipt.writes()).toBe(0);
});
