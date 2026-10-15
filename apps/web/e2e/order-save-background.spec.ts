import { test, expect } from '@playwright/test';
import { financeFixture, openFinance, rememberFinance } from './order-finance-fixture';

test('fallback after a committed save and failed detail read retains order/tab DOM without repeating the write', async ({ page }) => {
  const f = await financeFixture(page, { failRead: 'detail', deferRefresh: true });
  try {
    await openFinance(page); const sameDOM = await rememberFinance(page);
    const sport = page.locator('.orders-summary-row').filter({ hasText: 'QA-DISCOUNT' }).locator('.orders-discipline-trigger');
    await sport.click();
    await page.getByRole('menuitem', { name: 'Фигурное катание', exact: true }).click();
    await expect.poll(() => f.state.waitingRefresh).toBe(true);
    expect(f.state.failed).toBe(true);
    await sameDOM();
    f.releaseRefresh();
    await expect(sport).toHaveText('Фигурное катание');
    await sameDOM();
    expect(f.calls).toEqual([{ method: 'PATCH', path: '/api/orders/discount-order/discipline', body: { discipline: 'FIGURE_SKATING' } }]);
    expect(f.unexpected).toEqual([]);
  } finally { f.releaseRefresh(); }
});

test('archiving another selected order refreshes in background and retains the open order/tab DOM', async ({ page }) => {
  const f = await financeFixture(page, { deferRefresh: true });
  try {
    await openFinance(page); const sameDOM = await rememberFinance(page);
    const archived = page.locator('.orders-summary-row').filter({ hasText: 'QA-ARCHIVE-OTHER' });
    await archived.getByRole('checkbox', { name: 'Выбрать заказ', exact: true }).check();
    await page.getByRole('button', { name: 'Удалить выбранные', exact: true }).click();
    await page.getByRole('dialog', { name: 'Удаление заказов', exact: true }).getByRole('button', { name: 'Переместить в архив', exact: true }).click();
    await expect.poll(() => f.state.waitingRefresh).toBe(true);
    await sameDOM();
    f.releaseRefresh();
    await expect(archived).toHaveCount(0);
    await sameDOM();
    expect(f.calls).toEqual([{ method: 'PATCH', path: '/api/orders/archive', body: { orderIds: ['archive-other'] } }]);
    expect(f.unexpected).toEqual([]);
  } finally { f.releaseRefresh(); }
});

test('creating another order refreshes in background and retains the already open order/tab DOM', async ({ page }) => {
  const f = await financeFixture(page, { deferRefresh: true });
  try {
    await openFinance(page); const sameDOM = await rememberFinance(page);
    await page.getByRole('button', { name: /Новый заказ/ }).click();
    await page.locator('.orders-client-picker').getByRole('button', { name: /QA discount client/ }).click();
    const drawer = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Новый заказ', exact: true }) });
    await drawer.getByLabel(/Описание изделия/).fill('QA created design');
    await drawer.getByLabel(/Общая цена/).fill('100');
    await drawer.locator('input[type=file]').setInputFiles({ name: 'create.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=', 'base64') });
    await drawer.getByRole('button', { name: 'Создать заказ', exact: true }).click();
    await expect.poll(() => f.state.waitingRefresh).toBe(true);
    await sameDOM();
    f.releaseRefresh();
    await expect(page.locator('.orders-summary-row').filter({ hasText: 'QA-CREATED' })).toHaveCount(1);
    await sameDOM();
    expect(f.calls.filter(c => c.path === '/api/orders')).toHaveLength(1);
    expect(f.calls.filter(c => c.path === '/api/orders/model-image')).toHaveLength(1);
    expect(f.unexpected).toEqual([]);
  } finally { f.releaseRefresh(); }
});
