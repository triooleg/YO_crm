import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page, options: { role?: string; fail?: boolean; mode?: string } = {}) {
  const writes: { path: string; method: string; body: Record<string, unknown> }[] = [];
  let config = { mode: options.mode ?? 'MANUAL', folder: 'D:\\YO_CRM_Backups', intervalMinutes: 30 };
  let devices = [{ id: 'synthetic-pc', name: 'Тестовый компьютер', createdAt: '2026-10-26T10:00:00Z', expiresAt: '2027-01-24T10:00:00Z', revokedAt: null as string | null, lastSeenAt: null }];
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() !== 'GET') {
      const body = req.postDataJSON(); writes.push({ path, method: req.method(), body });
      if (options.fail) return route.fulfill({ status: 403, json: { message: 'PRIVATE_SERVER_ERROR' } });
      if (path.endsWith('/computer-transfer')) { config = { mode: body.mode, folder: body.folder, intervalMinutes: body.intervalMinutes }; return route.fulfill({ json: config }); }
      if (path.endsWith('/revoke')) { devices = devices.map(d => ({ ...d, revokedAt: '2026-10-26T11:00:00Z' })); return route.fulfill({ json: devices[0] }); }
      return route.fulfill({ json: { id: 'paired-pc', token: 'synthetic-once-token', expiresAt: '2027-01-24T10:00:00Z' } });
    }
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { role: options.role ?? 'OWNER', displayName: 'Synthetic', email: 'ui@example.invalid' } } });
    if (path.endsWith('/computer-transfer')) return options.fail ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: config });
    if (path.endsWith('/computers')) return options.fail ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: devices });
    if (path === '/api/admin/backups') return route.fulfill({ json: [] });
    if (path.endsWith('/backups/overview')) return route.fulfill({ json: { offsite: { mode: 'MANUAL_DOWNLOAD' } } });
    if (path.endsWith('/backups/journal')) return route.fulfill({ json: [] });
    if (path.endsWith('/backups/settings')) return route.fulfill({ json: { enabled: false, frequency: 'DAILY', time: '03:00', timezone: 'Europe/Kyiv', backupType: 'DATA', retentionCount: 10 } });
    if (path.includes('unread-count')) return route.fulfill({ json: { unreadCount: 0 } });
    if (path === '/api/branding') return route.fulfill({ json: { logoUrl: null } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/?section=settings&tab=backups');
  if (!options.role || ['OWNER', 'ADMIN'].includes(options.role)) await page.getByRole('tab', { name: 'Хранилище', exact: true }).click();
  return writes;
}

for (const width of [390, 1366]) {
  test(`computer transfer config and credentials lifecycle ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const writes = await setup(page);
    const block = page.getByRole('region', { name: 'Сохранение копий на компьютер' });
    await expect(block.getByRole('radio', { name: 'Вручную — скачать из CRM', exact: true })).toBeChecked();
    await block.getByRole('heading').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`computer-manual-top-${width}.png`) });
    await block.getByRole('radio', { name: 'Автоматически на компьютер', exact: true }).check();
    await expect(block.getByLabel('Папка на компьютере', { exact: true })).toHaveValue('D:\\YO_CRM_Backups');
    await expect(block.getByLabel('Интервал, минут', { exact: true })).toHaveValue('30');
    await block.getByRole('heading').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`computer-auto-top-${width}.png`) });
    await block.getByLabel('Папка на компьютере', { exact: true }).fill('E:\\Копии CRM');
    await block.getByRole('button', { name: 'Сохранить режим', exact: true }).click();
    let modal = page.getByRole('dialog');
    await modal.getByLabel('Текущий пароль', { exact: true }).fill('discard');
    await modal.getByRole('button', { name: 'Отмена', exact: true }).click();
    await block.getByRole('button', { name: 'Сохранить режим', exact: true }).click();
    await expect(modal.getByLabel('Текущий пароль', { exact: true })).toHaveValue('');
    await modal.getByLabel('Текущий пароль', { exact: true }).fill('synthetic-password');
    await modal.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    await expect(modal).not.toBeVisible();
    expect(writes[0]).toEqual({ path: '/api/admin/backups/computer-transfer', method: 'PUT', body: { mode: 'AUTOMATIC', folder: 'E:\\Копии CRM', intervalMinutes: 30, currentPassword: 'synthetic-password' } });
    await block.getByRole('button', { name: 'Подключить компьютер', exact: true }).click();
    await expect(modal.getByLabel('Текущий пароль', { exact: true })).toHaveValue('');
    await modal.getByLabel('Название компьютера', { exact: true }).fill('Мой ноутбук');
    await modal.getByLabel('Текущий пароль', { exact: true }).fill('synthetic-password');
    await modal.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    await expect(modal.getByLabel('Токен подключения', { exact: true })).toHaveValue('synthetic-once-token');
    await expect(modal.getByLabel('Текущий пароль', { exact: true })).toHaveCount(0);
    await modal.getByRole('button', { name: 'Скопировать токен', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('synthetic-once-token');
    expect(writes[1].body).toEqual({ name: 'Мой ноутбук', currentPassword: 'synthetic-password' });
    await modal.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
    await expect(page.locator('input[value="synthetic-once-token"]')).toHaveCount(0);
    await block.getByRole('button', { name: 'Отозвать доступ', exact: true }).click();
    await expect(modal.getByLabel('Текущий пароль', { exact: true })).toHaveValue('');
    await modal.getByLabel('Текущий пароль', { exact: true }).fill('synthetic-password');
    await modal.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    await expect(modal).not.toBeVisible();
    await expect(block.getByText('Доступ отозван', { exact: true }).last()).toBeVisible();
    expect(writes[2]).toEqual({ path: '/api/admin/backups/computers/synthetic-pc/revoke', method: 'POST', body: { currentPassword: 'synthetic-password' } });
    await expect(block.getByRole('link', { name: 'Скачать помощник Windows', exact: true })).toHaveAttribute('href', '/backup-sync/Install-YoCrmBackupSync.ps1');
    expect(await page.evaluate(() => Object.values(localStorage).some(v => v.includes('synthetic-once-token')))).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`computer-auto-${width}.png`), fullPage: true });
    await block.getByRole('radio', { name: 'Вручную — скачать из CRM', exact: true }).check();
    await block.getByRole('button', { name: 'Сохранить режим', exact: true }).click();
    await modal.getByLabel('Текущий пароль', { exact: true }).fill('synthetic-password');
    await modal.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    await expect(modal).not.toBeVisible();
    expect(writes[3].body.mode).toBe('MANUAL');
    await page.screenshot({ path: info.outputPath(`computer-manual-${width}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}



test('optional API absence leaves parent usable and mode unknown, never saves defaults', async ({ page }) => {
  const writes = await setup(page, { fail: true });
  const block = page.getByRole('region', { name: 'Сохранение копий на компьютер' });
  await expect(block.getByText('Текущий режим не подтверждён сервером.', { exact: false })).toBeVisible();
  await expect(block.getByRole('radio', { name: 'Вручную — скачать из CRM', exact: true })).toBeChecked();
  await expect(block.getByRole('button', { name: 'Сохранить режим', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: 'Архивы', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Создать копию данных', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('fresh password required after failed save, pair and revoke; raw errors stay private', async ({ page }) => {
  const writes = await setup(page);
  await page.route('**/api/admin/backups/**', async route => {
    if (route.request().method() === 'GET') return route.fallback();
    writes.push({ path: new URL(route.request().url()).pathname, method: route.request().method(), body: route.request().postDataJSON() });
    return route.fulfill({ status: 403, json: { message: 'PRIVATE_SERVER_ERROR' } });
  });
  for (const action of ['Сохранить режим', 'Подключить компьютер', 'Отозвать доступ']) {
    await page.getByRole('region', { name: 'Сохранение копий на компьютер' }).getByRole('button', { name: action, exact: true }).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByLabel('Текущий пароль', { exact: true })).toHaveValue('');
    if (action === 'Подключить компьютер') await modal.getByLabel('Название компьютера', { exact: true }).fill('Тест');
    await modal.getByLabel('Текущий пароль', { exact: true }).fill('synthetic-password');
    await modal.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    await expect(modal.getByRole('alert')).toContainText('Доступ не подтверждён');
    await expect(modal.getByLabel('Текущий пароль', { exact: true })).toHaveValue('');
    await expect(modal.getByRole('button', { name: 'Подтвердить', exact: true })).toBeDisabled();
    await expect(page.getByText('PRIVATE_SERVER_ERROR')).toHaveCount(0);
    await modal.getByRole('button', { name: 'Отмена', exact: true }).click();
  }
  expect(writes).toHaveLength(3);
});

test('Windows absolute folder and interval bounds guard save; selection makes no mutation', async ({ page }) => {
  const writes = await setup(page, { role: 'ADMIN', mode: 'AUTOMATIC' });
  const block = page.getByRole('region', { name: 'Сохранение копий на компьютер' });
  const save = block.getByRole('button', { name: 'Сохранить режим', exact: true });
  await expect(block.getByRole('radio', { name: 'Автоматически на компьютер', exact: true })).toBeChecked();
  for (const folder of ['relative\\folder', '\\\\server\\share', 'D:\\', 'D:/copies', 'D:\\folder\\..\\copies', 'D:\\folder\\.\\copies', 'D:\\folder\\\\copies', 'D:\\copies.', 'D:\\copies ', 'D:\\bad\'name', 'D:\\bad`name', 'D:\\' + 'a'.repeat(238)]) {
    await block.getByLabel('Папка на компьютере', { exact: true }).fill(folder);
    await expect(save).toBeDisabled();
    await expect(block.getByText('Укажите абсолютный путь Windows', { exact: false })).toBeVisible();
  }
  await block.getByLabel('Папка на компьютере', { exact: true }).fill('D:\\Копии CRM');
  const interval = block.getByLabel('Интервал, минут', { exact: true });
  for (const value of ['4', '1441', '']) { await interval.fill(value); await expect(save).toBeDisabled(); }
  for (const value of ['5', '1440']) { await interval.fill(value); await expect(save).toBeEnabled(); }
  expect(writes).toEqual([]);
});

for (const role of ['MANAGER', 'PRODUCTION']) {
  test(`parent excludes transfer controls for ${role}`, async ({ page }) => {
    await setup(page, { role });
    await expect(page.getByRole('button', { name: 'Сохранить режим', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Резервное копирование', exact: true })).toHaveCount(0);
  });
}

test('pending mutation blocks repeats and closing, then clears password', async ({ page }) => {
  const writes = await setup(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/admin/backups/computer-transfer', async route => {
    if (route.request().method() === 'GET') return route.fallback();
    writes.push({ path: new URL(route.request().url()).pathname, method: 'PUT', body: route.request().postDataJSON() });
    await pending;
    return route.fulfill({ json: { mode: 'MANUAL', folder: 'D:\\YO_CRM_Backups', intervalMinutes: 30 } });
  });
  const block = page.getByRole('region', { name: 'Сохранение копий на компьютер' });
  await block.getByRole('button', { name: 'Сохранить режим', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Текущий пароль', { exact: true }).fill('synthetic-password');
  await modal.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  await expect(modal.getByLabel('Текущий пароль', { exact: true })).toHaveValue('');
  await expect(modal.getByRole('button', { name: 'Отмена', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(modal).toBeVisible();
  release();
  await expect(modal).not.toBeVisible();
  expect(writes).toHaveLength(1);
});


test('storage hints defer PC mode to its endpoint, independently of legacy offsite overview', async ({ page }) => {
  const writes = await setup(page, { mode: 'AUTOMATIC' });
  const panel = page.locator('#settings-backups-panel');
  await expect(panel.getByRole('radio', { name: 'Автоматически на компьютер', exact: true })).toBeChecked();
  await expect(panel.getByText('Способ сохранения готовых архивов выберите в карточке', { exact: false })).toBeVisible();
  await expect(panel.getByText('S3 — отдельное внешнее хранилище, сейчас не настроено.', { exact: false })).toBeVisible();
  await expect(panel.getByText('Сейчас внешняя копия сохраняется вручную', { exact: false })).toHaveCount(0);
  await expect(panel.getByText('MANUAL_DOWNLOAD', { exact: true })).toHaveCount(0);
  await panel.getByRole('tab', { name: 'Расписание', exact: true }).click();
  await expect(panel.getByText('Этот переключатель сохраняет намерение включить внешнее хранение и не меняет режим компьютера.', { exact: false })).toBeVisible();
  expect(writes).toEqual([]);
});
