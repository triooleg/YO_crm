import { test, expect, type Page } from '@playwright/test';

const { loadTargetModule } = require('./website-sales-model-loader.cjs');
const { buildOrderListPage } = loadTargetModule('orders/order-list-read-model.ts');

async function fixture(page: Page) {
  const stamp = '2026-10-21T09:00:00Z';
  const item = { id: 'website-item', name: 'Купальник u201cЗвездаu201d', quantity: 1, priceMinor: 28000, productionStatus: 'NOT_SCHEDULED', instances: [] };
  const order: any = {
    id: 'website-order', number: 'WEB-source-22727', externalNumber: '706', externalId: '22727',
    sourceSystem: 'YOLEOTARD_WEBSITE', websiteCardFeeMinor: 578, currency: 'EUR', type: 'READY_MODEL',
    priceMinor: 28878, deliveryMinor: 300, discountMinor: 0, depositRequiredMinor: 0,
    paymentStatus: 'PAID', productionStatus: 'NOT_SCHEDULED', shippingStatus: 'NOT_READY', salesStatus: 'NEW_LEAD',
    createdAt: stamp, updatedAt: stamp, client: { id: 'buyer', displayName: 'Контрольный покупатель', source: 'WEBSITE', athletes: [] },
    items: [item], payments: [{ id: 'receipt', amountMinor: 28878, currency: 'EUR', method: 'CARD', receivedAt: stamp }],
    paymentHistory: [{ id: 'receipt', amountMinor: 28878, currency: 'EUR', method: 'CARD', receivedAt: stamp, voidedAt: null, canVoid: false }],
    activities: [], invoices: [], shipments: [], expenses: [],
  };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const result = path === '/api/auth/me' ? { user: { role: 'OWNER', displayName: 'QA' } }
      : path === '/api/branding' ? {}
      : path === '/api/communications/unread-count' ? { unreadCount: 0 }
      : path === '/api/orders' ? buildOrderListPage([order], Object.fromEntries(url.searchParams), new Date(stamp))
      : path === '/api/orders/website-order' ? order : [];
    return route.fulfill({ json: result });
  });
  return errors;
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`website order number and finance at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const errors = await fixture(page);
    await page.goto('/?section=orders&orderId=website-order&tab=finance');
    await expect(page.getByText('706', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Сбор при оплате картой (уже в цене)').first()).toBeVisible();
    await expect(page.getByText('Звезда', { exact: false }).first()).toBeVisible();
    const orderIdentity = page.locator('.orders-order-identity');
    await expect(orderIdentity).toBeVisible();
    await orderIdentity.screenshot({ path: info.outputPath(`website-order-identity-${viewport.width}.png`) });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`website-order-finance-${viewport.width}.png`), fullPage: true });
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
