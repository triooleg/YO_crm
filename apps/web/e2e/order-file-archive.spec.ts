import { expect, test } from '@playwright/test';
import { financeFixture } from './order-finance-fixture';

test('archives only the confirmed order attachment and updates the Files card', async ({ page }, info) => {
  const { order, unexpected } = await financeFixture(page);
  const photo = { id: 'photo', name: 'QA photo.png', path: 'qa-photo.png', mimeType: 'image/png', sizeBytes: 100, createdAt: order.createdAt, role: 'GENERAL' };
  const document = { ...photo, id: 'document', name: 'QA document.pdf', path: 'qa-document.pdf', mimeType: 'application/pdf', noteId: 'qa-note' };
  const detail = Object.assign(order, { files: [photo, document] });
  let attempts = 0;
  await page.route('**/api/orders/discount-order/files/photo/archive', async route => {
    expect(route.request().method()).toBe('PATCH');
    if (++attempts === 1) return route.fulfill({ status: 503, json: { message: 'QA: файл временно недоступен' } });
    detail.files = [document];
    return route.fulfill({ json: { id: photo.id } });
  });
  await page.route('**/api/orders/files/qa-photo.png', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="100"><rect width="80" height="100" fill="purple"/></svg>',
  }));

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?section=orders&orderId=discount-order');
  const card = page.locator('.orders-approved-card').filter({ has: page.getByRole('heading', { name: /^Файлы \(/ }) });
  await expect(card.getByRole('heading', { name: 'Файлы (2)' })).toBeVisible();
  await expect(card.getByRole('button', { name: `Удалить из файлов заказа: ${document.name}` })).toHaveCount(0);
  await card.getByRole('button', { name: /QA photo\.png/ }).filter({ has: page.getByRole('img') }).click();
  await expect(page.getByRole('dialog').getByRole('img', { name: photo.name })).toBeVisible();
  await page.keyboard.press('Escape');

  const archive = card.getByRole('button', { name: `Удалить из файлов заказа: ${photo.name}` });
  const dialog = page.getByRole('dialog', { name: 'Удалить файл из заказа' });
  await card.screenshot({ path: info.outputPath('order-files-1366.png') });
  await archive.focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(archive).toBeFocused();
  expect(attempts).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await archive.click();
  await expect(dialog.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await dialog.screenshot({ path: info.outputPath('order-file-archive-390.png') });
  await dialog.getByRole('button', { name: 'Переместить в архив' }).click();
  await expect(dialog.getByRole('alert')).toContainText('QA: файл временно недоступен');
  await expect(card.getByRole('heading', { name: 'Файлы (2)' })).toBeVisible();
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/orders/discount-order' && response.request().method() === 'GET');
  await dialog.getByRole('button', { name: 'Переместить в архив' }).click();
  await refreshed;
  await expect(dialog).toBeHidden();
  await expect(archive).toHaveCount(0);
  await expect(card.getByRole('heading', { name: 'Файлы (1)' })).toBeVisible();
  await expect(card.getByRole('link', { name: document.name })).toHaveAttribute('href', `/api/orders/files/${document.path}`);
  await expect(card.getByRole('button', { name: /Добавить файл/ })).toBeFocused();
  expect(attempts).toBe(2);
  expect(unexpected).toEqual([]);
});
