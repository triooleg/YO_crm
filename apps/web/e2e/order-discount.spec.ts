import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { discountText as ui, financeFixture, fixedPreview, percentPreview, openFinance, rememberFinance } from './order-finance-fixture';

async function openDiscount(page: Page, card = '.orders-finance-calculation') {
  const trigger = page.locator(card).getByRole('button', { name: ui.title, exact: true });
  await expect(trigger).toBeVisible(); await trigger.click();
  const dialog = page.getByRole('dialog', { name: ui.title, exact: true });
  await expect(dialog).toBeVisible(); return dialog;
}
async function noApplyWithoutPreview(dialog: Locator) {
  const save = dialog.getByRole('button', { name: ui.save, exact: true });
  if (await save.count()) await expect(save).toBeDisabled();
  else await expect(save).toHaveCount(0);
}
async function mode(dialog: Locator, label: string) {
  await dialog.getByText(label, { exact: true }).click();
  await expect(dialog.getByRole('radio', { name: label, exact: true })).toBeChecked();
}
async function capture(target: Locator, info: TestInfo, name: string) {
  const filename = process.env.ORDER_DISCOUNT_SCREEN_DIR ? join(process.env.ORDER_DISCOUNT_SCREEN_DIR, name) : info.outputPath(name);
  mkdirSync(dirname(filename), { recursive: true }); await target.screenshot({ path: filename });
}

for (const [card, width] of [['.orders-finance-calculation', 1366], ['.orders-finance-summary', 390]] as const) {
  test(`both Finance discount amounts open the compact editor: ${card} at ${width}px`, async ({ page }, info) => {
    const f = await financeFixture(page); await page.setViewportSize({ width, height: 900 });
    await openFinance(page);
    await expect(page.getByRole('button', { name: ui.title, exact: true })).toHaveCount(2);
    await expect(page.locator(card).getByRole('button', { name: ui.title, exact: true })).toContainText('5,00');
    const dialog = await openDiscount(page, card);
    await expect(dialog.getByLabel(ui.value, { exact: true })).toHaveValue(/5[,.]00/);
    await noApplyWithoutPreview(dialog);
    const title = await dialog.locator('.mantine-Modal-title').boundingBox();
    const control = await dialog.locator('.mantine-SegmentedControl-root').boundingBox();
    expect(title && control).toBeTruthy();
    expect(control!.y - (title!.y + title!.height), 'compact heading-to-first-control spacing').toBeLessThanOrEqual(26);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(dialog, info, `discount-editor-${width}.png`);
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(dialog).toHaveCount(0); expect(f.calls).toEqual([]); expect(f.unexpected).toEqual([]);
  });
}

for (const scenario of [
  { label: ui.fixed, input: '12,34', command: { mode: 'FIXED', value: 1234 }, preview: fixedPreview, total: '99,66', deposit: '49,83', balance: '39,66', width: 1366 },
  { label: ui.percent, input: '12.5', command: { mode: 'PERCENT', value: 1250 }, preview: percentPreview, total: '98,00', deposit: '49,00', balance: '38,00', width: 390 },
]) {
  test(`${scenario.command.mode} discount uses authoritative preview and applies once while retaining order/tab DOM`, async ({ page }, info) => {
    const f = await financeFixture(page, { deferPreview: true, deferRefresh: true });
    try {
      await page.setViewportSize({ width: scenario.width, height: 900 });
      await openFinance(page); const sameDOM = await rememberFinance(page);
      const dialog = await openDiscount(page);
      await mode(dialog, scenario.label); await dialog.getByLabel(ui.value, { exact: true }).fill(scenario.input);
      await noApplyWithoutPreview(dialog);
      await dialog.getByRole('button', { name: ui.preview, exact: true }).click();
      await expect.poll(() => f.state.waitingPreview).toBe(true);
      expect(f.calls).toEqual([{ method: 'POST', path: '/api/orders/discount-order/composition/discount/preview', body: scenario.command }]);
      await noApplyWithoutPreview(dialog); await sameDOM();
      f.releasePreview();
      await expect(dialog).toContainText(scenario.total);
      await expect(dialog).toContainText(scenario.deposit); await expect(dialog).toContainText(scenario.balance);
      await expect(dialog).toContainText('QA: серверный расчёт с доставкой и налогом');
      await capture(dialog, info, `discount-preview-${scenario.command.mode.toLowerCase()}-${scenario.width}.png`);
      // Preview is not persistence: both discount links still show the original amount.
      for (const button of await page.getByRole('button', { name: ui.title, exact: true }).all()) await expect(button).toContainText('5,00');
      await dialog.getByRole('button', { name: ui.save, exact: true }).click();
      await expect.poll(() => f.state.waitingRefresh).toBe(true);
      await sameDOM(); await expect(dialog.getByLabel(ui.value, { exact: true })).toBeDisabled();
      const apply = f.calls.filter(c => c.path.endsWith('/apply'));
      expect(apply).toHaveLength(1);
      expect(apply[0]!.body).toEqual({ command: scenario.command, expectedToken: scenario.preview.token, operationKey: expect.any(String) });
      expect(apply[0]!.body.operationKey.length).toBeGreaterThan(0);
      f.releaseRefresh(); await expect(dialog).toHaveCount(0); await sameDOM();
      await expect(page.locator('.orders-finance-summary .orders-approved-money.is-strong')).toContainText(scenario.total);
      await capture(page.locator('.orders-tab-finance-approved'), info, `discount-finance-saved-${scenario.width}.png`);
      expect(f.calls.filter(c => c.path.endsWith('/apply'))).toHaveLength(1); expect(f.unexpected).toEqual([]);
    } finally { f.releasePreview(); f.releaseRefresh(); }
  });
}

test('editing a previewed value or mode invalidates its token until a new preview is returned', async ({ page }) => {
  const f = await financeFixture(page); await openFinance(page); const dialog = await openDiscount(page);
  await dialog.getByLabel(ui.value, { exact: true }).fill('12.34');
  await dialog.getByRole('button', { name: ui.preview, exact: true }).click();
  await expect(dialog.getByRole('button', { name: ui.save, exact: true })).toBeEnabled();
  await dialog.getByLabel(ui.value, { exact: true }).fill('13');
  await noApplyWithoutPreview(dialog); await expect(dialog.getByRole('button', { name: ui.preview, exact: true })).toBeEnabled();
  await mode(dialog, ui.percent); await dialog.getByLabel(ui.value, { exact: true }).fill('12.5');
  await noApplyWithoutPreview(dialog);
  await dialog.getByRole('button', { name: ui.preview, exact: true }).click();
  await expect(dialog).toContainText('98,00');
  await dialog.getByRole('button', { name: ui.save, exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(f.calls.filter(c => c.path.endsWith('/preview')).map(c => c.body)).toEqual([{ mode: 'FIXED', value: 1234 }, { mode: 'PERCENT', value: 1250 }]);
  expect(f.calls.filter(c => c.path.endsWith('/apply')).map(c => c.body)).toEqual([{ command: { mode: 'PERCENT', value: 1250 }, expectedToken: 'percent-server-token', operationKey: expect.any(String) }]);
  expect(f.unexpected).toEqual([]);
});

test('discount validation blocks empty, negative, fractional-cent and over-100-percent drafts without writes', async ({ page }) => {
  const f = await financeFixture(page); await openFinance(page); const dialog = await openDiscount(page);
  for (const label of [ui.fixed, ui.percent]) {
    await mode(dialog, label);
    for (const value of ['', '-1', '1.001', ...(label === ui.percent ? ['100.01'] : [])]) {
      await dialog.getByLabel(ui.value, { exact: true }).fill(value);
      await expect(dialog.getByRole('button', { name: ui.preview, exact: true })).toBeDisabled();
      await noApplyWithoutPreview(dialog);
    }
  }
  expect(f.calls).toEqual([]); expect(f.unexpected).toEqual([]);
});

test('server preview validation failure preserves the draft and never enables apply', async ({ page }) => {
  const f = await financeFixture(page, { rejectPreview: true }); await openFinance(page); const dialog = await openDiscount(page);
  await dialog.getByLabel(ui.value, { exact: true }).fill('120');
  await dialog.getByRole('button', { name: ui.preview, exact: true }).click();
  await expect(dialog).toContainText('QA: недопустимый размер скидки');
  await expect(dialog.getByLabel(ui.value, { exact: true })).toHaveValue('120');
  await noApplyWithoutPreview(dialog);
  expect(f.calls.map(c => c.body)).toEqual([{ mode: 'FIXED', value: 12000 }]); expect(f.unexpected).toEqual([]);
});

test('authoritative blockers keep a preview visible but prevent discount apply', async ({ page }) => {
  const f = await financeFixture(page, { blockers: ['QA: заказ заблокирован для изменения скидки'] });
  await openFinance(page); const dialog = await openDiscount(page);
  await dialog.getByLabel(ui.value, { exact: true }).fill('12.34');
  await dialog.getByRole('button', { name: ui.preview, exact: true }).click();
  await expect(dialog).toContainText('QA: заказ заблокирован для изменения скидки');
  await expect(dialog).toContainText('99,66');
  await expect(dialog.getByRole('button', { name: ui.save, exact: true })).toBeDisabled();
  expect(f.calls.filter(c => c.path.endsWith('/apply'))).toHaveLength(0); expect(f.unexpected).toEqual([]);
});

for (const failedRead of ['detail', 'list'] as const) {
  test(`committed discount with ${failedRead} refresh failure freezes editing and retries reads without another apply`, async ({ page }) => {
    const f = await financeFixture(page, { failRead: failedRead });
    await openFinance(page); const sameDOM = await rememberFinance(page); const dialog = await openDiscount(page);
    await dialog.getByLabel(ui.value, { exact: true }).fill('12.34');
    await dialog.getByRole('button', { name: ui.preview, exact: true }).click();
    await dialog.getByRole('button', { name: ui.save, exact: true }).click();
    await expect(dialog).toContainText(`QA ${failedRead} refresh failed`); await sameDOM();
    await expect(dialog.getByLabel(ui.value, { exact: true })).toBeDisabled();
    for (const label of [ui.fixed, ui.percent]) await expect(dialog.getByRole('radio', { name: label, exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: ui.preview, exact: true })).toHaveCount(0);
    const applyBeforeRetry = structuredClone(f.calls.filter(c => c.path.endsWith('/apply')));
    expect(applyBeforeRetry).toHaveLength(1);
    expect(applyBeforeRetry[0]!.body).toEqual({ command: { mode: 'FIXED', value: 1234 }, expectedToken: 'fixed-server-token', operationKey: expect.any(String) });
    await dialog.getByRole('button', { name: ui.save, exact: true }).click();
    await expect(dialog).toHaveCount(0); await sameDOM();
    expect(f.state.failed).toBe(true);
    expect(failedRead === 'detail' ? f.state.detailReadsAfterMutation : f.state.listReadsAfterMutation).toBe(2);
    expect(f.calls.filter(c => c.path.endsWith('/apply'))).toEqual(applyBeforeRetry);
    expect(f.calls.filter(c => c.path.endsWith('/preview'))).toHaveLength(1);
    await expect(page.locator('.orders-finance-summary .orders-approved-money.is-strong')).toContainText('99,66');
    expect(f.unexpected).toEqual([]);
  });
}
