import { test, expect, type Page } from '@playwright/test';
import type { WebsiteApiKey } from '../lib/website-api-keys';

test.skip(process.env.YO_WEBSITE_KEYS_BROWSER !== '1', 'Owned synthetic mounted SettingsWorkspace harness only');
const secret = 'yo_crm_v1_0123456789abcdef_' + 'a'.repeat(43);
const account = 'calendar.yoleotard.com';
const key: WebsiteApiKey = { id: 'key-1', name: 'WordPress', selector: '0123456789abcdef', sourceAccount: account, createdAt: '2026-10-21T00:00:00Z', lastUsedAt: null, revokedAt: null, createdById: 'owner', revokedById: null, rotatedFromId: null };

async function fixture(page: Page, rejectFirst = false) {
  let keys: typeof key[] = []; let loads = 0; let role = 'OWNER';
  const writes: { path: string; body: Record<string, unknown>; csrf: string | undefined }[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'synthetic-owner', displayName: 'Тестовый владелец', email: 'owner@example.invalid', role } } });
    if (path === '/api/communications/unread-count') return route.fulfill({ json: { unreadCount: 0 } });
    if (path === '/api/auth/website-api-keys' && request.method() === 'GET') return route.fulfill({ json: { keys, csrfToken: 'csrf-' + (++loads), legacyConfigured: true } });
    if (path.startsWith('/api/auth/website-api-keys') && request.method() === 'POST') {
      const body = request.postDataJSON(); writes.push({ path, body, csrf: request.headers()['x-website-key-csrf'] });
      if (rejectFirst && writes.length === 1) return route.fulfill({ status: 401, json: { message: secret } });
      if (path.endsWith('/revoke')) { keys = keys.map(k => ({ ...k, revokedAt: '2026-10-22T00:00:00Z', revokedById: 'owner' } as typeof key)); return route.fulfill({ json: { key: keys[0] } }); }
      const next = { ...key, id: keys.length ? 'key-2' : key.id, name: body.name, sourceAccount: body.sourceAccount, rotatedFromId: keys.length ? key.id : null };
      keys = [...keys, next]; return route.fulfill({ json: { key: next, secret } });
    }
    if (request.method() !== 'GET') throw new Error('Unexpected synthetic mutation');
    return route.fulfill({ json: [] });
  });
  return { writes, loads: () => loads, setRole: (next: string) => { role = next; } };
}
async function create(page: Page) {
  await page.getByRole('button', { name: 'Создать ключ', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Название ключа')).toBeFocused();
  await dialog.getByLabel('Название ключа').fill('WordPress');
  await dialog.getByLabel('Текущий пароль').fill('synthetic-owner-password');
  await dialog.getByLabel('Подтверждаю действие с ключом доступа сайта').check();
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByLabel('Секретный ключ (один раз)')).toHaveValue(secret);
}

for (const { width, height } of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) test(`one-time secret, keyboard/focus, copy, close, auth refresh and metadata at ${width}`, async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width, height });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const api = await fixture(page); await page.goto('/?section=settings&tab=account');
  await expect(page.getByRole('heading', { name: 'Ключи API сайта' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать ключ', exact: true })).toBeEnabled(); const initialLoads = api.loads();
  await page.getByRole('button', { name: 'Создать ключ', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Название ключа').fill('Must not send');
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click();
  expect(api.writes).toHaveLength(0);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await create(page);
  expect(api.writes[0]?.csrf).toBe('csrf-' + initialLoads);
  expect(api.writes[0]?.body).toEqual({ name: 'WordPress', sourceAccount: account, currentPassword: 'synthetic-owner-password', confirmed: true });
  expect(await page.locator('input[type=password]').evaluateAll(inputs => inputs.every(input => (input as HTMLInputElement).value === ''))).toBe(true);
  await page.getByRole('button', { name: 'Скопировать ключ', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(secret);
  await expect(page.getByRole('status').filter({ hasText: 'Ключ скопирован.' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('one-time-' + width + '.png'), fullPage: true });
  await page.getByRole('button', { name: 'Закрыть и скрыть навсегда' }).click();
  await expect(page.getByLabel('Секретный ключ (один раз)')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Создать ключ', exact: true })).toBeFocused();
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, href: location.href }))).not.toContain(secret);
  await page.reload(); await expect(page.getByText('WordPress', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Секретный ключ (один раз)')).toHaveCount(0);
  const beforeAuthLoads = api.loads(); await page.evaluate(() => dispatchEvent(new Event('yoleotard-auth-changed')));
  await expect.poll(api.loads).toBeGreaterThan(beforeAuthLoads);
  await expect(page.getByRole('button', { name: 'Создать ключ', exact: true })).toBeEnabled(); const freshCsrf = 'csrf-' + api.loads();
  await page.getByRole('button', { name: 'Выпустить замену', exact: true }).click();
  await expect(page.getByText('Старый ключ продолжает работать.', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Аккаунт сайта')).toHaveValue(account);
  await page.getByRole('dialog').getByLabel('Аккаунт сайта').fill('shop.yoleotard.com');
  await page.screenshot({ path: testInfo.outputPath('replacement-account-' + width + '.png'), fullPage: true });
  await page.getByRole('dialog').getByLabel('Текущий пароль').fill('synthetic-owner-password');
  await page.getByRole('dialog').getByLabel('Подтверждаю действие с ключом доступа сайта').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByLabel('Секретный ключ (один раз)')).toHaveValue(secret); expect(api.writes[1]?.csrf).toBe(freshCsrf);
  expect(api.writes[1]?.body.sourceAccount).toBe('shop.yoleotard.com');
  await page.evaluate(() => dispatchEvent(new Event('yoleotard-auth-changed')));
  await expect(page.getByLabel('Секретный ключ (один раз)')).toHaveCount(0);
  await expect(page.getByText('Активен', { exact: true })).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('metadata-' + width + '.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('wrong password401 recovers with explicit inline reload, fresh password and no automatic POST', async ({ page }) => {
  const api = await fixture(page, true); await page.goto('/?section=settings&tab=account');
  await page.getByRole('button', { name: 'Создать ключ', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Название ключа').fill('WordPress');
  await dialog.getByLabel('Текущий пароль').fill('wrong-synthetic-password');
  await dialog.getByLabel('Подтверждаю действие с ключом доступа сайта').check();
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(dialog.getByLabel('Текущий пароль')).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Обновить доступ', exact: true })).toBeVisible();
  expect(await page.locator('body').textContent()).not.toContain(secret);
  await dialog.getByRole('button', { name: 'Обновить доступ', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(api.writes).toHaveLength(1);
  await create(page); expect(api.writes).toHaveLength(2); expect(api.writes[1]?.csrf).not.toBe(api.writes[0]?.csrf);
});

test('unmount hides a revealed secret, remount never reveals it; OWNER account mounting only', async ({ page }) => {
  const api = await fixture(page); await page.goto('/?section=settings&tab=account'); await create(page);
  await page.goto('/?section=settings&tab=interface');
  await expect(page.getByLabel('Секретный ключ (один раз)')).toHaveCount(0);
  await page.goto('/?section=settings&tab=account'); await expect(page.getByRole('heading', { name: 'Ключи API сайта' })).toBeVisible();
  await expect(page.getByLabel('Секретный ключ (один раз)')).toHaveCount(0);
  api.setRole('ADMIN'); await page.reload();
  await expect(page.getByRole('heading', { name: 'Ключи API сайта' })).toHaveCount(0);
});

test('real Next dev StrictMode setup-cleanup-setup rearms CSRF and account management', async ({ page }, testInfo) => {
  test.skip(process.env.YO_WEBSITE_KEYS_NEXT !== '1', 'Separate owned loopback Next dev check');
  await page.addInitScript(() => {
    const original = window.fetch;
    (window as unknown as { websiteKeyGets: number }).websiteKeyGets = 0;
    window.fetch = (...args) => {
      if (String(args[0]) === '/api/auth/website-api-keys' && args[1]?.method === 'GET') (window as unknown as { websiteKeyGets: number }).websiteKeyGets++;
      return original(...args);
    };
  });
  const api = await fixture(page); const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/?section=settings&tab=account');
  await expect(page.getByRole('button', { name: 'Создать ключ', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { websiteKeyGets: number }).websiteKeyGets)).toBeGreaterThanOrEqual(2);
  await create(page); expect(api.writes).toHaveLength(1);
  await page.keyboard.press('Escape'); await expect(page.getByLabel('Секретный ключ (один раз)')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Создать ключ', exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('next-strict-mode-390.png'), fullPage: true });
  expect(errors).toEqual([]);
});
