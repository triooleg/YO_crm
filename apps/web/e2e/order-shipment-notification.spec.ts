import { test, expect } from '@playwright/test';
import { financeFixture } from './order-finance-fixture';

const trackingNumber = 'SYNTHETIC123';
const trackingUrl = 'https://nova.global/track/?Tracking_ID=' + trackingNumber;
const parcel = { id:'s1', carrier:'NOVA_GLOBAL', trackingNumber, trackingUrl, trackingRevision:1 };
const addParcelLabel = /Добавить посылку/;
const openLabel = 'Отправить трек-номер';
const sendLabel = 'Отправить уведомление';

for (const [width, delivery] of [[1920, 'chat'], [1366, 'both'], [390, 'email']] as const) {
  test(`shipped order offers the shared notification dialog in Delivery (${delivery}, ${width}px)`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : width === 1366 ? 768 : 900 });
    const origin = new URL(info.project.use.baseURL!).origin;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const fixture = await financeFixture(page);
    const order = fixture.order;
    const posts: Record<string, unknown>[] = [];
    await page.route('**/api/orders/discount-order/website-notification/read', route => route.fulfill({json:{}}));
    const chats = [{ id:'chat-1', channel:'INSTAGRAM', subject:'QA Instagram' }, { id:'chat-2', channel:'FACEBOOK' }];
    const parcels = [parcel, { ...parcel, id:'s2', trackingNumber:'SYNTHETIC456', trackingUrl:trackingUrl.replace('123','456') }];
    await page.route('**/api/shipment-notifications/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/tracking-url')) return route.fulfill({ json:{ url:trackingUrl } });
      if (url.pathname.endsWith('/options')) {
        expect(url.searchParams.get('orderId')).toBe(order.id);
        expect(url.searchParams.get('clientId')).toBe(order.client.id);
        return route.fulfill({ json:{ orders:[{id:order.id, number:order.number, shipments:parcels}],
          conversations:chats, languages:[{value:'en',label:'Английский'}] } });
      }
      const body = route.request().postDataJSON();
      expect(body.orderId).toBe(order.id);
      expect(body.fromOrder).toBe(true);
      expect(body.shipmentId).toBe('s2');
      if (url.pathname.endsWith('/preview')) {
        return route.fulfill({ json:{ ...parcels[1], orderId:order.id, orderNumber:order.number, shipmentId:'s2',
          scopeToken:'qa-scope', language:'en', content:'Your order has shipped. ' + parcels[1].trackingUrl,
          subject:'Your order has shipped', emailRecipient:'qa@example.test', emailRequiresConfirmation:false,
          emailAvailable:true, chatAvailable:body.conversationId === 'chat-1' } });
      }
      expect(url.pathname).toBe('/api/shipment-notifications/send');
      posts.push(body);
      const deliveries = [...(body.sendChat ? [{ channel:'CHAT', status:'SENT' }] : []),
        ...(body.sendEmail ? [{ channel:'EMAIL', status:'SENT' }] : [])];
      return route.fulfill({ json:{ id:'n1', deliveries } });
    });

    const url = '/?section=orders&orderId=discount-order&tab=delivery';
    const region = page.locator('#order-details-discount-order');
    const header = region.locator('.orders-shipment-column > header');
    await page.goto(url);
    await expect(header.getByRole('button', { name:addParcelLabel })).toBeVisible();
    await expect(header.getByRole('button', { name:openLabel })).toHaveCount(0);
    Object.assign(order, { shippingStatus:'LABEL_CREATED', deliveryTrackingCode:trackingNumber,
      orderShipments:parcels.map(item => ({ ...item, status:'LABEL_CREATED', instances:[], customerChargeMinor:0,
        atelierCostMinor:0, currency:'EUR', isPrimary:item.id === 's1' })) });
    await page.reload();
    await expect(header.getByRole('button', { name:addParcelLabel })).toBeVisible();
    await expect(header.getByRole('button', { name:openLabel })).toHaveCount(0);
    Object.assign(order, { shippingStatus:'SHIPPED', deliveryTrackingCode:trackingNumber,
      orderShipments:parcels.map(item => ({ ...item, status:'SHIPPED', instances:[], customerChargeMinor:0,
        atelierCostMinor:0, currency:'EUR', isPrimary:item.id === 's1' })) });
    await page.reload();
    await expect(header.getByRole('button', { name:openLabel })).toBeVisible();
    await expect(header.getByRole('button', { name:addParcelLabel })).toBeVisible();
    await page.screenshot({ path:info.outputPath('delivery-header.png') });
    await header.getByRole('button', { name:openLabel }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox', { name:'Заказ', exact:true })).toHaveCount(0);
    await expect(dialog.getByLabel('Текст уведомления')).toHaveCount(0);
    await dialog.getByLabel('Посылка', { exact:true }).selectOption('s2');
    await expect(dialog.getByLabel('Текст уведомления')).toHaveValue(/SYNTHETIC456/);
    await expect(dialog.getByRole('button', { name:sendLabel })).toBeDisabled();
    await expect(dialog.getByRole('switch', { name:'Отправить в чат' })).toBeDisabled();
    if (delivery !== 'email') {
      await expect(dialog.locator('option[value="chat-1"]')).toHaveText('Instagram · QA Instagram');
      await dialog.getByLabel('Переписка для уведомления').selectOption('chat-1');
      await dialog.getByRole('switch', { name:'Отправить в чат' }).check();
    }
    if (delivery !== 'chat') await dialog.getByRole('switch', { name:'Отправить на email' }).check();
    expect(posts).toHaveLength(0);
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path:info.outputPath('delivery-notification.png') });
    await dialog.getByRole('button', { name:sendLabel }).click();
    await expect(dialog.getByText('Отправлено', { exact:true })).toHaveCount(delivery === 'both' ? 2 : 1);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ sendChat:delivery !== 'email', sendEmail:delivery !== 'chat', shipmentId:'s2', orderId:order.id });
    expect(posts[0].conversationId).toBe(delivery === 'email' ? undefined : 'chat-1');
    expect(fixture.unexpected).toEqual([]);
    expect(errors).toEqual([]);
  });
}
