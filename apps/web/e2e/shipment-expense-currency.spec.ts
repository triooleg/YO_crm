import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { financeFixture, openFinance, rememberFinance } from './order-finance-fixture';
import type { ExpenseRow, FinanceReport } from '../lib/finance-report';

// Synthetic HTTP responses only. Unexpected remote resources are blocked.
async function setup(page: Page, deferRefresh = false) {
  const external: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    external.push(url.origin); return route.abort();
  });
  const fixture = await financeFixture(page, { deferRefresh });
  return { ...fixture, external, errors };
}

async function capture(page: Page, info: TestInfo, name: string) {
  const path = process.env.SHIPMENT_CURRENCY_SCREEN_DIR ? join(process.env.SHIPMENT_CURRENCY_SCREEN_DIR, name) : info.outputPath(name);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true });
}

test('shipment expense currency can be selected independently of the customer charge', async ({ page }, info) => {
  const fixture = await setup(page);
  await page.goto('/?section=orders&orderId=discount-order&tab=shipping');
  const region = page.locator('#order-details-discount-order');
  await region.getByRole('tab', { name: 'Доставка', exact: true }).click();
  await region.getByRole('button', { name: /Добавить посылку/ }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: 'Доставка, оплачиваемая клиентом', exact: true })).toBeVisible();
  const legacy = dialog.getByRole('combobox', { name: 'Валюта', exact: true });
  if (await legacy.count()) {
    await expect(legacy).toBeDisabled();
    await expect(legacy).toHaveValue('EUR');
    await expect(legacy.locator('option')).toHaveText(['EUR']);
    await info.attach('legacy-disabled-currency', { body: 'Old shipment form: disabled EUR selector, no USD/UAH choices.', contentType: 'text/plain' });
  }
  await page.screenshot({ path: info.outputPath('shipment-currency-before-selection.png'), fullPage: true });
  const currency = dialog.getByRole('combobox', { name: 'Валюта расхода на доставку', exact: true });
  await expect(currency).toBeEnabled();
  await currency.selectOption('UAH');
  await expect(currency).toHaveValue('UAH');
  const customerCurrency = dialog.getByRole('combobox', { name: 'Валюта доставки для клиента', exact: true });
  await expect(customerCurrency).toBeEnabled();
  for (const selector of [customerCurrency, currency]) await expect(selector.locator('option')).toHaveText(['EUR', 'USD', 'UAH']);
  await customerCurrency.selectOption('USD');
  await expect(customerCurrency).toHaveValue('USD');
  expect(fixture.external).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

for (const width of [1366, 390]) test(`shipment submits original USD charge and UAH cost on EUR order, keeps expanded DOM ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 950 });
  const f = await setup(page, true);
  const writes: { method: string; body: Record<string, any> }[] = [];
  const snapshot = { provider: 'QA_NBU', effectiveDate: '2026-10-18', numerator: '9', denominator: '10' };
  // The conversion is a literal synthetic server result. Browser must send 1234 USD, never 1111 EUR.
  await page.route('**/api/shipping/orders/discount-order/shipments**', async route => {
    const request = route.request();
    if (!['POST', 'PUT'].includes(request.method())) return route.fallback();
    const body = request.postDataJSON(); writes.push({ method: request.method(), body });
    const expense = { id: 'currency-expense', amountMinor: 45678, currency: 'UAH', incurredAt: '2026-10-18T12:00:00Z', category: { id: 'delivery', name: 'Доставка' } };
    const shipment = { id: 'currency-shipment', updatedAt: '2026-10-18T12:00:00Z', ...body,
      customerChargeMinor: 1111, currency: 'EUR', customerChargeOriginalMinor: 1234, customerChargeOriginalCurrency: 'USD', customerChargeRateSnapshot: snapshot,
      atelierCostMinor: 1142, atelierExpense: expense, instances: [], isPrimary: true };
    Object.assign(f.order, { orderShipments: [shipment], expenses: [expense] });
    f.state.mutated = true;
    await route.fulfill({ json: shipment });
  });
  await page.goto('/?section=orders&orderId=discount-order&tab=shipping');
  const region = page.locator('#order-details-discount-order');
  await region.getByRole('tab', { name: 'Доставка', exact: true }).click();
  const originalRoot = await region.elementHandle();
  let navigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  await region.getByRole('button', { name: /Добавить посылку/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Доставка, оплачиваемая клиентом', exact: true }).fill('12,34');
  await dialog.getByRole('textbox', { name: 'Фактические расходы ателье', exact: true }).fill('456,78');
  await dialog.getByRole('combobox', { name: 'Валюта доставки для клиента', exact: true }).selectOption('USD');
  await dialog.getByRole('combobox', { name: 'Валюта расхода на доставку', exact: true }).selectOption('UAH');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture(page, info, `shipment-currencies-${width}.png`);
  await dialog.getByRole('button', { name: 'Сохранить посылку', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ method: 'POST', body: { customerChargeMinor: 1234, customerChargeCurrency: 'USD', atelierCostMinor: 45678, atelierCostCurrency: 'UAH', currency: 'EUR' } });
  await expect.poll(() => f.state.waitingRefresh).toBe(true);
  expect(await originalRoot!.evaluate(node => node.isConnected && document.getElementById('order-details-discount-order') === node)).toBe(true);
  f.releaseRefresh();
  await expect(dialog).toHaveCount(0);
  await expect(region.locator('[data-shipment-id="currency-shipment"]')).toBeVisible();
  await expect(region.locator('[data-shipment-id="currency-shipment"]')).toContainText('В заказе: 11,11');
  await region.getByRole('button', { name: 'Изменить посылку', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Валюта доставки для клиента', exact: true })).toHaveValue('USD');
  await expect(dialog.getByRole('textbox', { name: 'Доставка, оплачиваемая клиентом', exact: true })).toHaveValue(/12[,.]34/);
  await expect(dialog.getByRole('combobox', { name: 'Валюта расхода на доставку', exact: true })).toHaveValue('UAH');
  await expect(dialog.getByRole('textbox', { name: 'Фактические расходы ателье', exact: true })).toHaveValue(/456[,.]78/);
  await capture(page, info, `shipment-edit-original-${width}.png`);
  await dialog.getByRole('combobox', { name: 'Статус отправления', exact: true }).selectOption('READY');
  await dialog.getByRole('button', { name: 'Сохранить посылку', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toMatchObject({ method: 'PUT', body: { status: 'READY', currency: 'EUR', customerChargeMinor: 1234, customerChargeCurrency: 'USD', atelierCostMinor: 45678, atelierCostCurrency: 'UAH', expectedUpdatedAt: '2026-10-18T12:00:00Z' } });
  for (const write of writes) for (const serverField of ['customerChargeOriginalMinor', 'customerChargeOriginalCurrency', 'customerChargeRateSnapshot']) expect(write.body).not.toHaveProperty(serverField);
  await expect(dialog).toHaveCount(0);
  expect(await originalRoot!.evaluate(node => node.isConnected)).toBe(true);
  await expect(region.locator('[data-shipment-id="currency-shipment"]')).toContainText('Готов к отправке');
  await region.getByRole('button', { name: 'Изменить посылку', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Доставка, оплачиваемая клиентом', exact: true })).toHaveValue(/12[,.]34/);
  await expect(dialog.getByRole('combobox', { name: 'Валюта доставки для клиента', exact: true })).toHaveValue('USD');
  expect(f.order.currency).toBe('EUR'); expect(navigations).toBe(0);
  expect(f.external).toEqual([]); expect(f.unexpected).toEqual([]); expect(f.errors).toEqual([]);
});

for (const archived of [false, true]) test(`legacy nullable customer charge uses EUR and linked expense original value, archived=${archived}`, async ({ page }) => {
  const f = await setup(page);
  Object.assign(f.order, { orderShipments: [{ id: 'legacy-shipment', updatedAt: '2026-10-18T12:00:00Z', carrier: 'NOVA_POSHTA', status: 'NOT_READY',
    currency: 'EUR', customerChargeMinor: 987, customerChargeOriginalMinor: null, customerChargeOriginalCurrency: null, customerChargeRateSnapshot: null,
    atelierCostMinor: 9999, isPrimary: true, instances: [], atelierExpense: { id: 'legacy-expense', amountMinor: 3450, currency: 'USD',
      incurredAt: '2026-10-18T12:00:00Z', category: { id: 'delivery', name: 'Доставка' }, archivedAt: archived ? '2026-10-18T13:00:00Z' : null } }] });
  await page.goto('/?section=orders&orderId=discount-order&tab=shipping');
  const region = page.locator('#order-details-discount-order');
  await region.getByRole('tab', { name: 'Доставка', exact: true }).click();
  await region.getByRole('button', { name: 'Изменить посылку', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: 'Доставка, оплачиваемая клиентом', exact: true })).toHaveValue(/9[,.]87/);
  await expect(dialog.getByRole('combobox', { name: 'Валюта доставки для клиента', exact: true })).toHaveValue('EUR');
  await expect(dialog.getByRole('textbox', { name: 'Фактические расходы ателье', exact: true })).toHaveValue(archived ? /0[,.]00/ : /34[,.]50/);
  await expect(dialog.getByRole('combobox', { name: 'Валюта расхода на доставку', exact: true })).toHaveValue('USD');
  expect(f.calls).toEqual([]); expect(f.unexpected).toEqual([]); expect(f.external).toEqual([]); expect(f.errors).toEqual([]);
});

for (const currency of ['UAH', 'USD']) test(`order expense POST keeps original ${currency} amount and expanded Finance during delayed refresh`, async ({ page }) => {
  const f = await setup(page, true);
  const writes: Record<string, unknown>[] = [];
  await page.route('**/api/finance', route => route.fulfill({ json: { categories: [{ id: 'materials', name: 'Материалы', active: true }] } }));
  await page.route('**/api/finance/expenses', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON(); writes.push(body); f.state.mutated = true;
    await route.fulfill({ json: { id: 'added-expense', ...body } });
  });
  await openFinance(page); const retained = await rememberFinance(page);
  await page.getByRole('button', { name: 'Добавить расход', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Сумма', exact: true }).fill('34,50');
  await dialog.getByRole('combobox', { name: 'Валюта', exact: true }).selectOption(currency);
  await dialog.getByRole('button', { name: /Сохранить/ }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ amountMinor: 3450, currency, orderId: 'discount-order', categoryId: 'materials' });
  await expect.poll(() => f.state.waitingRefresh).toBe(true); await retained();
  f.releaseRefresh(); await expect(dialog).toHaveCount(0); await retained();
  expect(f.order.currency).toBe('EUR'); expect(f.external).toEqual([]); expect(f.unexpected).toEqual([]); expect(f.errors).toEqual([]);
});

async function reportFixture(page: Page, originalCurrency: 'UAH' | 'USD') {
  const f = await setup(page);
  const writes: { method: string; body: Record<string, unknown> }[] = [];
  const expense: ExpenseRow = { id: 'original-expense', date: '2026-10-18', categoryId: 'materials', categoryName: 'Материалы',
    orderId: 'discount-order', number: 'QA-DISCOUNT', notes: 'QA original expense', amountMinor: 789,
    originalAmountMinor: 3450, originalCurrency, shipmentId: null };
  let reportReads = 0;
  await page.route('**/api/finance/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if ((url.pathname === '/api/finance/expenses' && request.method() === 'POST') || (url.pathname === '/api/finance/expenses/original-expense' && request.method() === 'PATCH')) {
      const body = request.postDataJSON(); writes.push({ method: request.method(), body });
      return route.fulfill({ json: { id: expense.id, ...body } });
    }
    if (request.method() !== 'GET') return route.fallback();
    if (url.pathname === '/api/finance/report/options') return route.fulfill({ json: { orders: [], clients: [], limit: 100 } });
    if (url.pathname !== '/api/finance/report') return route.fallback();
    reportReads++;
    const month = url.searchParams.get('month') || '2026-10';
    const report: FinanceReport = {
      month, currency: 'EUR', valuationVersion: 'qa-v1', valuation: { provider: 'QA', effectiveDate: '2026-10-18', fetchedAt: '2026-10-18T12:00:00Z', officialUrl: null },
      today: '2026-10-18', forecastUntil: '2026-11-17', current: { receivedMinor: 10000, expensesMinor: 789, resultMinor: 9211 },
      previous: { receivedMinor: 9000, expensesMinor: 700, resultMinor: 8300 }, debtMinor: 0, forecastMinor: 0, forecastCount: 0,
      invoiceCount: 0, invoiceTotalMinor: 0, unpaidInvoiceCount: 0,
      monthlyTrend: [{ month, receivedMinor: 10000, expensesMinor: 789, resultMinor: 9211 }],
      categoryBreakdown: [{ id: 'materials', name: 'Материалы', amountMinor: 789 }], recentExpenses: [expense], upcoming: [],
      table: { tab: 'expenses', rows: [expense], total: 1, page: 1, pageSize: 10 },
      options: { clients: [], categories: [{ id: 'materials', name: 'Материалы', active: true }], orders: [{ id: 'discount-order', number: 'QA-DISCOUNT', clientName: 'QA', currency: 'EUR' }] },
    };
    return route.fulfill({ json: report });
  });
  return { ...f, writes, reportReads: () => reportReads };
}

for (const currency of ['UAH', 'USD'] as const) test(`Finance POST and PATCH preserve original ${currency} minor units instead of EUR report amount`, async ({ page }, info) => {
  const width = currency === 'UAH' ? 1366 : 390;
  await page.setViewportSize({ width, height: 950 });
  const f = await reportFixture(page, currency);
  await page.goto('/?section=finance&tab=expenses&currency=EUR');
  await expect(page.locator('.finance-report-table')).toContainText('QA original expense');
  await page.locator('.finance-report-table').getByRole('button', { name: 'Действия: Материалы', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Изменить', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: 'Сумма', exact: true })).toHaveValue('34.50');
  await expect(dialog.getByRole('combobox', { name: 'Валюта операции', exact: true })).toHaveValue(currency);
  await capture(page, info, `expense-edit-original-${width}-${currency}.png`);
  const reads = f.reportReads();
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => f.writes.length).toBe(1);
  expect(f.writes[0]).toMatchObject({ method: 'PATCH', body: { amountMinor: 3450, currency } });
  expect(f.writes[0].body).not.toHaveProperty('orderId');
  await expect(dialog).toHaveCount(0); await expect.poll(f.reportReads).toBeGreaterThan(reads);
  await page.getByRole('tabpanel', { name: 'Расходы', exact: true }).getByRole('button', { name: 'Добавить расход', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Сумма', exact: true }).fill('56,78');
  await dialog.getByRole('combobox', { name: 'Валюта операции', exact: true }).click();
  await page.getByRole('option', { name: currency, exact: true }).click();
  await capture(page, info, `expense-create-${width}-${currency}.png`);
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => f.writes.length).toBe(2);
  expect(f.writes[1]).toMatchObject({ method: 'POST', body: { amountMinor: 5678, currency, orderId: null, categoryId: 'materials' } });
  await expect(dialog).toHaveCount(0);
  expect(f.external).toEqual([]); expect(f.unexpected).toEqual([]); expect(f.errors).toEqual([]);
});
