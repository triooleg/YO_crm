import { expect, test, type Page } from '@playwright/test';

const { loadTargetModule } = require('./website-sales-model-loader.cjs');
const { buildOrderListPage } = loadTargetModule('orders/order-list-read-model.ts');

async function fixture(page: Page, unreadCount = 123, failFirstAcknowledgement = false) {
  const stamp = '2026-10-23T12:58:53Z';
  const order: any = {
    id: 'website-order-708', number: 'YO-708', externalNumber: '#22734', externalId: '261023',
    sourceSystem: 'YOLEOTARD_WEBSITE', currency: 'EUR', type: 'READY_MODEL', priceMinor: 35000,
    deliveryMinor: 300, discountMinor: 0, depositRequiredMinor: 0, paymentStatus: 'PAID',
    productionStatus: 'NOT_SCHEDULED', shippingStatus: 'NOT_READY', salesStatus: 'NEW_LEAD',
    createdAt: stamp, updatedAt: stamp, client: { id: 'buyer', displayName: 'Очень длинное имя покупателя для проверки переноса', source: 'WEBSITE', athletes: [] },
    items: [{ id: 'item', name: 'Mystic Blossom', quantity: 1, priceMinor: 34000, productionStatus: 'NOT_SCHEDULED', instances: [] }],
    payments: [{ id: 'receipt', amountMinor: 35000, currency: 'EUR', method: 'CARD', receivedAt: stamp }],
    paymentHistory: [], activities: [], invoices: [], shipments: [], expenses: [],
  };
  let acknowledgementAttempts=0,reviewed=false;
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { role: 'OWNER', displayName: 'QA' } } });
    if (url.pathname === '/api/branding') return route.fulfill({ json: {} });
    if (url.pathname === '/api/communications/unread-count') return route.fulfill({ json: { unreadCount: 0 } });
    if (url.pathname === '/api/orders/website-notifications') return route.fulfill({ json: { unreadCount: reviewed ? 0 : unreadCount, items: reviewed ? [] : [{ id: order.id, number: order.number, paymentStatus: order.paymentStatus, priceMinor: order.priceMinor, currency: order.currency, websiteNoticeAt: stamp, client: order.client }] } });
    if (url.pathname === `/api/orders/${order.id}/website-notification/read`) {
      acknowledgementAttempts++;
      if(failFirstAcknowledgement&&acknowledgementAttempts===1)return route.fulfill({status:500,json:{message:'temporary'}});
      reviewed=true;return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname === `/api/orders/${order.id}`) return route.fulfill({ json: order });
    if (url.pathname === '/api/orders') return route.fulfill({ json: buildOrderListPage([order], Object.fromEntries(url.searchParams), new Date(stamp)) });
    return route.fulfill({ json: [] });
  });
  return {acknowledgementAttempts:()=>acknowledgementAttempts};
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`website purchase notification at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await fixture(page);
    await page.goto('/?section=orders');
    await expect(page.getByText('Новая покупка с сайта')).toBeVisible();
    await expect(page.getByRole('button', { name: /YO-708.*Очень длинное имя покупателя/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Заказы: 123' })).toBeVisible();
    await expect(page.getByText('99+', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`website-order-notification-${viewport.width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('failed notification acknowledgement is shown again and succeeds on retry',async({page})=>{
  await page.setViewportSize({width:1366,height:768});
  const state=await fixture(page,1,true);
  await page.goto('/?section=orders');
  await expect(page.getByText('Новая покупка с сайта')).toBeVisible();
  await page.getByRole('button',{name:'Закрыть уведомление'}).click();
  await expect(page.getByText('Новая покупка с сайта')).toBeVisible({timeout:4000});
  await expect(page.getByRole('button',{name:'Заказы: 1'})).toBeVisible();
  await page.getByRole('button',{name:'Закрыть уведомление'}).click();
  await expect(page.getByText('Новая покупка с сайта')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Заказы',exact:true})).toBeVisible();
  expect(state.acknowledgementAttempts()).toBe(2);
});

test('notification action opens and expands the exact order before acknowledgement',async({page})=>{
  await page.setViewportSize({width:1366,height:768});
  const state=await fixture(page,1);
  await page.goto('/?section=inbox');
  await page.getByRole('button',{name:/YO-708.*Очень длинное имя покупателя/}).click();
  await expect(page).toHaveURL(/section=orders.*orderId=website-order-708/);
  await expect(page.getByRole('region',{name:'Данные заказа YO-708'})).toBeVisible();
  await expect(page.getByText('Новая покупка с сайта')).toHaveCount(0);
  expect(state.acknowledgementAttempts()).toBeGreaterThanOrEqual(1);
});
