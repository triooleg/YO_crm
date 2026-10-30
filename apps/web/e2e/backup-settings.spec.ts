import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function setup(page: Page, role = 'OWNER', options: { optionalFailure?: boolean; denySensitive?: boolean; workerStatus?: string; coverage?: Record<string, unknown>; maxUploadBytes?: number; version?: string; storage?: string } = {}) {
  const writes: { path: string; body: string; method: string }[] = [];
  let list = [{ id: 'synthetic-backup', appVersion: options.version, storageProvider: options.storage, type: 'DATA', status: 'COMPLETED', createdAt: '2026-10-26T10:00:00Z', metadata: { archive: { file: 'archive.tar.gz', bytes: 32, checksum: 'sha256-synthetic' } } }];
  let reads = 0;
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() !== 'GET') {
      writes.push({ path, body: req.postData() || '', method: req.method() });
      if (options.denySensitive) return route.fulfill({ status: 403, json: { message: 'DO_NOT_EXPOSE_PASSWORD_OR_SERVER_PATH' } });
      if (path.endsWith('/download')) return route.fulfill({ body: 'synthetic-archive-bytes', contentType: 'application/gzip' });
      if (path === '/api/admin/backups') list = [{ ...list[0], id: 'pending-job', status: 'PENDING', metadata: { job: { kind: 'BACKUP', phase: 'QUEUED', progress: 0 } } } as typeof list[number], ...list];
      if (path.endsWith('/recovery-plan')) return route.fulfill({ json: { backupId: 'synthetic-backup', execution: 'CLI_REQUIRED', steps: ['synthetic-safe-plan'] } });
      return route.fulfill({ json: list[0] });
    }
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { role, displayName: 'Synthetic', email: 'test@example.invalid' } } });
    if (path === '/api/branding') return route.fulfill({ json: { logoUrl: null, useInHeader: true } });
    if (path === '/api/admin/backups') { reads++; return route.fulfill({ json: list }); }
    if (path.endsWith('/backups/overview')) return options.optionalFailure ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ json: { latestBackup: list[0], executor: options.workerStatus ? { status: options.workerStatus } : { configured: false }, coverage: options.coverage, maxUploadBytes: options.maxUploadBytes, offsite: { mode: 'MANUAL_DOWNLOAD', configured: false, evidence: null } } });
    if (path.endsWith('/backups/settings')) return route.fulfill({ json: { enabled: false, frequency: 'DAILY', time: '03:00', timezone: 'Europe/Kyiv', backupType: 'DATA', retentionCount: 10, recovery: { weeklyFull: { enabled: false, dayOfWeek: 0, time: '03:00' }, monthlyDrill: { enabled: false, dayOfMonth: 1, time: '04:00' }, retention: { enabled: false, daily: 7, weekly: 4, monthly: 3, minimumVerified: 2 }, offsite: { enabled: false }, maintenance: { allowWriterPause: false } } } });
    if (path.endsWith('/backups/journal')) return options.optionalFailure ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: [] });
    if (path === '/api/finance/settings') return route.fulfill({ json: [] });
    if (path === '/api/communications/unread-count') return route.fulfill({ json: { unreadCount: 0 } });
    if (path.includes('website')) return route.fulfill({ json: [] });
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/?section=settings&tab=backups');
  return { writes, reads: () => reads };
}

for (const width of [390, 1366]) {
  test(`backup workspace preserves unknown coverage, polls and fits ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    let documentLoads = 0; page.on('domcontentloaded', () => documentLoads++);
    const api = await setup(page);
    const panel = page.locator('#settings-backups-panel');
    await expect(panel.getByRole('heading', { name: 'Резервное копирование' })).toBeVisible();
    await expect(panel.getByText('Исполнитель не настроен', { exact: false })).toBeVisible();
    await expect(panel.getByText('Chatwoot: покрытие не подтверждено', { exact: false })).toBeVisible();
    await panel.getByRole('button', { name: 'Создать копию данных', exact: true }).click();
    await expect(panel.getByText('pending-job', { exact: true })).toBeVisible();
    const before = api.reads(); await expect.poll(api.reads, { timeout: 10000 }).toBeGreaterThan(before);
    expect(JSON.parse(api.writes[0].body).type).toBe('DATA');
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`backup-archives-${width}.png`), fullPage: true });
    await panel.getByRole('tab', { name: 'Хранилище', exact: true }).click();
    await expect(panel.getByText('Скачивание не подтверждает проверенную внешнюю копию.', { exact: false })).toBeVisible();
    for (const name of ['Расписание', 'Проверка и восстановление', 'Перенос', 'Журнал', 'Хранилище']) {
      await panel.getByRole('tab', { name, exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      if (name === 'Расписание') {
        await panel.getByLabel('Минимум проверенных копий', { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`backup-schedule-${width}.png`), fullPage: true });
      }
    }
    await page.screenshot({ path: info.outputPath(`backup-${width}.png`), fullPage: true });
    await panel.getByRole('tab', { name: 'Архивы', exact: true }).click();
    await panel.getByRole('button', { name: 'Скачать архив', exact: true }).last().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Текущий пароль', { exact: true })).toBeVisible();
    const box = await dialog.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`backup-reauth-${width}.png`) });
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    expect(errors).toEqual([]);
    expect(documentLoads).toBe(1);
  });
}

test('reauth clears password, download streams bytes, drill/plan and upload use POST bodies', async ({ page }) => {
  const api = await setup(page);
  const panel = page.locator('#settings-backups-panel');
  await panel.getByRole('button', { name: 'Скачать архив', exact: true }).click();
  let modal = page.getByRole('dialog');
  await modal.getByLabel('Текущий пароль', { exact: true }).fill('discard-this');
  await modal.getByRole('button', { name: 'Отмена', exact: true }).click();
  await panel.getByRole('button', { name: 'Скачать архив', exact: true }).click();
  modal = page.getByRole('dialog');
  await expect(modal.getByLabel('Текущий пароль', { exact: true })).toHaveValue('');
  await modal.getByLabel('Текущий пароль', { exact: true }).fill('synthetic-password');
  const download = page.waitForEvent('download');
  await modal.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  const downloaded = await download;
  expect(downloaded.suggestedFilename()).toBe('synthetic-backup.tar.gz');
  expect(await readFile((await downloaded.path())!, 'utf8')).toBe('synthetic-archive-bytes');
  for (const action of ['Проверить восстановление', 'План восстановления']) {
    await panel.getByRole('button', { name: action, exact: true }).click();
    modal = page.getByRole('dialog');
    await expect(modal.getByLabel('Текущий пароль', { exact: true })).toHaveValue('');
    await modal.getByLabel('Текущий пароль', { exact: true }).fill('synthetic-password');
    if (action === 'План восстановления') await modal.getByLabel('Идентификатор копии для подтверждения').fill('synthetic-backup');
    await modal.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    await expect(modal).not.toBeVisible();
  }
  await panel.getByRole('button', { name: 'Загрузить архив', exact: true }).click();
  modal = page.getByRole('dialog');
  await expect(modal.getByText('2 ГиБ', { exact: false })).toBeVisible();
  await modal.locator('input[type=file]').setInputFiles({ name: 'archive.tar.gz', mimeType: 'application/gzip', buffer: Buffer.from('synthetic-tar') });
  await modal.getByLabel('Текущий пароль', { exact: true }).fill('synthetic-password');
  await modal.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(modal).not.toBeVisible();
  expect(api.writes.map(w => w.path)).toEqual(['/api/admin/backups/synthetic-backup/download', '/api/admin/backups/synthetic-backup/drill', '/api/admin/backups/synthetic-backup/recovery-plan', '/api/admin/backups/upload']);
  expect(api.writes[3].body).toContain('name="archive"');
  expect(api.writes[3].body).toContain('name="currentPassword"');
  expect(api.writes[3].body.indexOf('name="currentPassword"')).toBeLessThan(api.writes[3].body.indexOf('name="type"'));
  expect(api.writes[3].body.indexOf('name="type"')).toBeLessThan(api.writes[3].body.indexOf('name="archive"'));
  expect(api.writes.every(w => w.method === 'POST' && !w.path.includes('password'))).toBe(true);
  expect(api.writes.some(w => w.path.endsWith('/restore'))).toBe(false);
  expect(JSON.parse(api.writes[1].body)).toEqual({ currentPassword: 'synthetic-password' });
  expect(JSON.parse(api.writes[2].body)).toEqual({ currentPassword: 'synthetic-password', confirmBackupId: 'synthetic-backup' });
});

test('advertised upload limit is displayed and enforced; wrong file is never submitted', async ({ page }) => {
  const api = await setup(page, 'OWNER', { maxUploadBytes: 1024 });
  await page.locator('#settings-backups-panel').getByRole('button', { name: 'Загрузить архив', exact: true }).click();
  const modal = page.getByRole('dialog');
  await expect(modal.getByText(/Максимальный размер:.*1.?024 байт/)).toBeVisible();
  await modal.getByLabel('Текущий пароль', { exact: true }).fill('synthetic');
  const input = modal.locator('input[type=file]');
  await input.setInputFiles({ name: 'large.tar.gz', mimeType: 'application/gzip', buffer: Buffer.alloc(1025) });
  await expect(modal.getByRole('button', { name: 'Подтвердить', exact: true })).toBeDisabled();
  await input.setInputFiles({ name: 'wrong.zip', mimeType: 'application/zip', buffer: Buffer.from('zip') });
  await expect(modal.getByText('Допустим только архив .tar.gz.')).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Подтвердить', exact: true })).toBeDisabled();
  expect(api.writes).toHaveLength(0);
});

test('FULL, verify and legacy schedule use existing contracts; polling preserves unsaved fields', async ({ page }) => {
  const api = await setup(page);
  const panel = page.locator('#settings-backups-panel');
  await panel.getByRole('button', { name: 'Создать полную копию', exact: true }).click();
  expect(JSON.parse(api.writes[0].body).type).toBe('FULL');
  await panel.getByRole('button', { name: 'Проверить архив', exact: true }).last().click();
  await expect(panel.getByText('Сервер обработал запрос.', { exact: false })).toBeVisible();
  expect(api.writes[1].path).toBe('/api/admin/backups/synthetic-backup/verify');
  await panel.getByRole('tab', { name: 'Расписание', exact: true }).click();
  const zone = panel.getByLabel('Часовой пояс');
  await zone.fill('Europe/London');
  const before = api.reads(); await expect.poll(api.reads, { timeout: 10000 }).toBeGreaterThan(before);
  await expect(zone).toHaveValue('Europe/London');
  await panel.getByRole('button', { name: 'Сохранить расписание' }).click();
  await expect(panel.getByText('Расписание сохранено сервером.')).toBeVisible();
  expect(api.writes[2].method).toBe('PUT');
  expect(JSON.parse(api.writes[2].body)).toEqual({ enabled: false, frequency: 'DAILY', time: '03:00', timezone: 'Europe/London', backupType: 'DATA', retentionCount: 10 });
});

test('verify displays integrity PASS for checked legacy and current responses, never unknown objects', async ({ page }) => {
  await setup(page);
  const panel = page.locator('#settings-backups-panel');
  const verified = { checksum: 'a'.repeat(64), sizeBytes: '32', manifest: { format_version: 2, backup_id: 'synthetic-backup', type: 'data', storage_provider: 'local', files: ['postgres.dump', 'uploads.tar.gz'] } };
  let response: unknown = verified;
  await page.route('**/api/admin/backups/synthetic-backup/verify', route => route.fulfill({ json: response }));
  for (const [body, label] of [[verified, 'Проверка пройдена'], [{ ...verified, verification: { kind: 'INTEGRITY', status: 'PASS' } }, 'Проверка пройдена'], [{}, 'Нет подтверждённых данных'], [{ status: 'PASS' }, 'Нет подтверждённых данных'], [{ checksum: 'a'.repeat(64), sizeBytes: '32' }, 'Нет подтверждённых данных'], [{ ...verified, verification: { kind: 'INTEGRITY', status: 'FAILED' } }, 'Ошибка']] as const) {
    response = body;
    await panel.getByRole('button', { name: 'Проверить архив', exact: true }).click();
    const result = panel.getByRole('heading', { name: 'Результат проверки целостности', exact: true }).locator('..');
    await expect(result.getByText(label, { exact: true })).toBeVisible();
    if (label !== 'Проверка пройдена') await expect(result.getByText('Проверка пройдена', { exact: true })).toHaveCount(0);
  }
});

test('missing optional endpoints preserve archive list and never imply verification or offsite success', async ({ page }) => {
  await setup(page, 'OWNER', { optionalFailure: true });
  const panel = page.locator('#settings-backups-panel');
  await expect(panel.getByText('synthetic-backup', { exact: true })).toBeVisible();
  await expect(panel.getByText('Часть сведений недоступна.', { exact: false })).toBeVisible();
  await expect(panel.getByText('Состояние исполнителя не подтверждено.', { exact: false })).toBeVisible();
  await expect(panel.getByText('Проверка пройдена', { exact: true })).toHaveCount(0);
});

test('weekly FULL and monthly drill save exact RecoveryConfig fields without enabling offsite or writer pause', async ({ page }) => {
  const api = await setup(page);
  const panel = page.locator('#settings-backups-panel');
  await panel.getByRole('tab', { name: 'Расписание', exact: true }).click();
  await panel.getByRole('switch', { name: 'Еженедельная полная копия', exact: true }).check();
  await panel.getByLabel('День недели полной копии', { exact: true }).click();
  await page.getByRole('option', { name: 'Понедельник', exact: true }).click();
  await panel.getByLabel('Время полной копии').fill('02:15');
  await panel.getByRole('switch', { name: 'Ежемесячная проверка восстановления', exact: true }).check();
  await panel.getByLabel('День месяца проверки', { exact: true }).fill('7');
  await panel.getByLabel('Время проверки восстановления').fill('04:30');
  await panel.getByRole('button', { name: 'Сохранить расписание' }).click();
  await expect(panel.getByText('Расписание сохранено сервером.')).toBeVisible();
  expect(JSON.parse(api.writes[0].body).recovery).toEqual({ weeklyFull: { enabled: true, dayOfWeek: 1, time: '02:15' }, monthlyDrill: { enabled: true, dayOfMonth: 7, time: '04:30' }, retention: { enabled: false, daily: 7, weekly: 4, monthly: 3, minimumVerified: 2 }, offsite: { enabled: false }, maintenance: { allowWriterPause: false } });
});

test('retention, offsite intent and writer-pause permission persist only as explicit warned configuration', async ({ page }) => {
  const api = await setup(page);
  const panel = page.locator('#settings-backups-panel');
  await panel.getByRole('tab', { name: 'Расписание', exact: true }).click();
  for (const name of ['Автоматическое удаление', 'Внешнее хранение', 'Разрешение на обслуживание']) {
    const toggle = panel.getByRole('switch', { name, exact: true });
    await expect(toggle).not.toBeChecked();
    await toggle.check();
  }
  await panel.getByLabel('Ежедневных копий хранить', { exact: true }).fill('9');
  await panel.getByLabel('Еженедельных копий хранить', { exact: true }).fill('5');
  await panel.getByLabel('Ежемесячных копий хранить', { exact: true }).fill('4');
  await panel.getByLabel('Минимум проверенных копий', { exact: true }).fill('3');
  const dailyCount = panel.getByLabel('Ежедневных копий хранить', { exact: true });
  await dailyCount.fill('0'); await dailyCount.blur(); await expect(dailyCount).toHaveValue('1');
  await dailyCount.fill('366'); await dailyCount.blur(); await expect(dailyCount).toHaveValue('365');
  const minimumCount = panel.getByLabel('Минимум проверенных копий', { exact: true });
  await minimumCount.fill('11'); await minimumCount.blur(); await expect(minimumCount).toHaveValue('10');
  await dailyCount.fill('9'); await minimumCount.fill('3');
  await expect(panel.getByText('Остановка записи требует отдельного согласования', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: 'Сохранить расписание' }).click();
  await expect(panel.getByText('Расписание сохранено сервером.')).toBeVisible();
  expect(api.writes).toHaveLength(1);
  expect(JSON.parse(api.writes[0].body).recovery).toEqual({ weeklyFull: { enabled: false, dayOfWeek: 0, time: '03:00' }, monthlyDrill: { enabled: false, dayOfMonth: 1, time: '04:00' }, retention: { enabled: true, daily: 9, weekly: 5, monthly: 4, minimumVerified: 3 }, offsite: { enabled: true }, maintenance: { allowWriterPause: true } });
});

test('reauth failure clears password, hides raw server errors and does not download', async ({ page }) => {
  const api = await setup(page, 'OWNER', { denySensitive: true });
  await page.locator('#settings-backups-panel').getByRole('button', { name: 'Скачать архив', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Текущий пароль', { exact: true }).fill('synthetic');
  await modal.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(modal.getByText('Доступ не подтверждён.', { exact: false })).toBeVisible();
  await expect(modal.getByLabel('Текущий пароль', { exact: true })).toHaveValue('');
  await expect(page.getByText('DO_NOT_EXPOSE_PASSWORD_OR_SERVER_PATH')).toHaveCount(0);
  expect(api.writes).toHaveLength(1);
});

for (const status of ['UNAVAILABLE', 'STALE', 'AVAILABLE']) test(`actual executor ${status} and boolean coverage remain honest`, async ({ page }) => {
  await setup(page, 'OWNER', { workerStatus: status, coverage: { postgresql: true, uploads: true, chatwoot: false } });
  const panel = page.locator('#settings-backups-panel');
  await expect(panel.getByText(status === 'UNAVAILABLE' ? 'Исполнитель недоступен.' : status === 'STALE' ? 'Данные исполнителя устарели.' : 'Внешний исполнитель настроен.', { exact: false })).toBeVisible();
  await panel.getByRole('tab', { name: 'Хранилище', exact: true }).click();
  await expect(panel.getByText('Не включено — частичное покрытие', { exact: true })).toBeVisible();
  await expect(panel.getByText('Включено в состав; восстановление проверяется отдельно', { exact: true })).toHaveCount(2);
  await expect(panel.getByText('Проверка пройдена', { exact: true })).toHaveCount(0);
});

for (const role of ['ADMIN', 'MANAGER']) test(`backup section access ${role}`, async ({ page }) => {
  const api = await setup(page, role);
  await expect(page.getByRole('tab', { name: 'Резервное копирование', exact: true })).toHaveCount(role === 'ADMIN' ? 1 : 0);
  if (role === 'MANAGER') { await expect(page.locator('#settings-finance-panel')).toBeVisible(); expect(api.reads()).toBe(0); }
});


test('archive cards show confirmed version and storage, with honest missing metadata', async ({ page }) => {
  await setup(page, 'OWNER', { version: '0.10.0', storage: 'LOCAL' });
  const panel = page.locator('#settings-backups-panel');
  await expect(panel.getByText('Версия CRM: 0.10.0', { exact: true })).toBeVisible();
  await expect(panel.getByText('Место хранения: Локальное хранилище сервера', { exact: true })).toBeVisible();
});

for (const width of [390, 1366]) test(`local drill outcome notification is translated, bounded and read-only at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  const api = await setup(page);
  let notification: unknown = null;
  await page.route('**/api/admin/backups/overview', route => route.fulfill({ json: { drillNotification: notification } }));
  const panel = page.locator('#settings-backups-panel');
  const alert = panel.getByRole('alert').filter({ hasText: 'Результат проверки восстановления' });
  const base = { version: 1, type: 'BACKUP_DRILL_RESULT', eventId: 'a'.repeat(64), backupId: 'drill-notice-job', sourceBackupId: 'synthetic-backup', finishedAt: '2026-10-26T12:00:00.000Z', delivery: 'LOCAL_PENDING', externalDeliveryEnabled: false, stderr: 'PRIVATE_DO_NOT_RENDER' };
  for (const [trigger, status, message] of [
    ['SCHEDULED', 'PASS', 'Ежемесячная проверка восстановления пройдена.'],
    ['SCHEDULED', 'FAILED', 'Ежемесячная проверка восстановления завершилась ошибкой.'],
    ['MANUAL', 'PASS', 'Ручная проверка восстановления пройдена.'],
    ['MANUAL', 'FAILED', 'Ручная проверка восстановления завершилась ошибкой.'],
  ]) {
    notification = { ...base, trigger, status, scheduleSlot: trigger === 'SCHEDULED' ? '2026-10' : null };
    await panel.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(alert.getByText(message, { exact: true })).toBeVisible();
    await expect(alert.getByText('Исходная копия: synthetic-backup', { exact: true })).toBeVisible();
    await expect(alert.getByText('Уведомление показано только в CRM. Внешняя отправка не выполняется.', { exact: true })).toBeVisible();
    await expect(panel.getByText('PRIVATE_DO_NOT_RENDER')).toHaveCount(0);
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  for (const value of [null, {}, { ...base, trigger: 'SCHEDULED', status: 'UNKNOWN' }]) {
    notification = value;
    await panel.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(alert).toHaveCount(0);
  }
  expect(api.writes).toEqual([]);
});
