import { expect, type Page } from '@playwright/test';
const { loadTargetModule } = require('./website-sales-model-loader.cjs');
const { buildOrderListPage } = loadTargetModule('orders/order-list-read-model.ts');

export const discountText = {
  title: 'Изменить скидку', fixed: 'Фиксированная сумма', percent: 'Процент',
  value: 'Размер скидки', preview: 'Предварительный расчёт', save: 'Сохранить',
} as const;
export type DiscountCommand = { mode: 'FIXED' | 'PERCENT'; value: number };
export const fixedPreview = {
  token: 'fixed-server-token', currency: 'EUR', baseMinor: 11200, discountMinor: 1234,
  before: { totalMinor: 10700, depositRequiredMinor: 5350, paidMinor: 6000, balanceMinor: 4700, overpaymentMinor: 0 },
  after: { totalMinor: 9966, depositRequiredMinor: 4983, paidMinor: 6000, balanceMinor: 3966, overpaymentMinor: 0 },
  blockers: [] as string[], warnings: ['QA: серверный расчёт с доставкой и налогом'],
};
export const percentPreview = {
  ...fixedPreview, token: 'percent-server-token', discountMinor: 1400,
  after: { totalMinor: 9800, depositRequiredMinor: 4900, paidMinor: 6000, balanceMinor: 3800, overpaymentMinor: 0 },
};

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, release: resolve };
}

// Synthetic records at the HTTP boundary; the real Orders list projection is reused.
// Unexpected mutations fail closed. No database, provider or production request.
export async function financeFixture(page: Page, options: {
  deferRefresh?: boolean; deferPreview?: boolean; failRead?: 'detail' | 'list';
  blockers?: string[]; rejectPreview?: boolean;
} = {}) {
  const athlete = { id: 'discount-athlete', firstName: 'QA athlete', measurements: [] };
  const client = { id: 'discount-client', displayName: 'QA discount client', source: 'MANUAL', athletes: [athlete] };
  const order = {
    id: 'discount-order', number: 'QA-DISCOUNT', currency: 'EUR', type: 'CUSTOM_ORDER',
    discipline: 'RHYTHMIC_GYMNASTICS', compositionManaged: true,
    priceMinor: 10700, discountMinor: 500, deliveryMinor: 1000, taxMinor: 200,
    depositRequiredMinor: 5350, paymentStatus: 'PARTIALLY_PAID',
    productionStatus: 'NOT_SCHEDULED', shippingStatus: 'NOT_READY', salesStatus: 'NEW_LEAD',
    createdAt: '2026-10-15T12:00:00Z', updatedAt: '2026-10-15T12:00:00Z', client,
    payments: [{ id: 'discount-payment', amountMinor: 6000, currency: 'EUR', method: 'BANK_TRANSFER', receivedAt: '2026-10-15T12:00:00Z' }],
    activities: [], invoices: [], notesStructured: [], orderShipments: [], expenses: [],
    items: [{ id: 'discount-design', name: 'QA discount design', quantity: 2, priceMinor: 5000,
      instances: [1, 2].map(ordinal => ({ id: `discount-piece-${ordinal}`, ordinal, updatedAt: '2026-10-15T12:00:00Z', productionStatus: 'NOT_SCHEDULED' })) }],
  };
  let rows = [order, { ...structuredClone(order), id: 'archive-other', number: 'QA-ARCHIVE-OTHER' }];
  const calls: { method: string; path: string; body: any }[] = [];
  const unexpected: string[] = [];
  const refreshGate = gate(), previewGate = gate();
  const state = { mutated: false, waitingRefresh: false, waitingPreview: false, failed: false,
    detailReadsAfterMutation: 0, listReadsAfterMutation: 0 };
  let holdRefresh = Boolean(options.deferRefresh), holdPreview = Boolean(options.deferPreview);
  const releaseRefresh = () => { holdRefresh = false; refreshGate.release(); };
  const releasePreview = () => { holdPreview = false; previewGate.release(); };
  async function refresh(kind: 'detail' | 'list') {
    if (!state.mutated) return false;
    if (kind === 'detail') state.detailReadsAfterMutation++;
    else state.listReadsAfterMutation++;
    if (options.failRead === kind && !state.failed) { state.failed = true; return true; }
    if (holdRefresh && kind === 'list') { state.waitingRefresh = true; await refreshGate.promise; }
    return false;
  }
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), p = url.pathname, method = request.method();
    if (method !== 'GET') {
      const body = request.postDataJSON(); calls.push({ method, path: p, body });
      if (method === 'POST' && p === '/api/orders/discount-order/composition/discount/preview') {
        state.waitingPreview = true; if (holdPreview) await previewGate.promise;
        if (options.rejectPreview) return route.fulfill({ status: 422, json: { message: 'QA: недопустимый размер скидки' } });
        return route.fulfill({ json: { ...(body.mode === 'PERCENT' ? percentPreview : fixedPreview), blockers: options.blockers ?? [] } });
      }
      if (method === 'POST' && p === '/api/orders/discount-order/composition/discount/apply') {
        const preview = body.command?.mode === 'PERCENT' ? percentPreview : fixedPreview;
        order.priceMinor = preview.after.totalMinor; order.discountMinor = preview.discountMinor;
        order.depositRequiredMinor = preview.after.depositRequiredMinor; state.mutated = true;
        return route.fulfill({ json: { operationId: 'discount-operation', orderId: order.id } });
      }
      if (method === 'PATCH' && p === '/api/orders/discount-order/discipline') {
        order.discipline = body.discipline; state.mutated = true; return route.fulfill({ json: order });
      }
      if (method === 'PATCH' && p === '/api/orders/archive') {
        rows = rows.filter(row => !body.orderIds.includes(row.id)); state.mutated = true;
        return route.fulfill({ json: { archived: body.orderIds.length, orderIds: body.orderIds } });
      }
      if (method === 'POST' && p === '/api/orders/model-image') return route.fulfill({ json: { path: 'created-discount.png' } });
      if (method === 'POST' && p === '/api/orders') {
        rows.push({ ...structuredClone(order), ...body, id: 'created-order', number: 'QA-CREATED' }); state.mutated = true;
        return route.fulfill({ json: { id: 'created-order', number: 'QA-CREATED' } });
      }
      unexpected.push(`${method} ${p}`); return route.fulfill({ status: 501, json: { message: 'Unexpected test mutation' } });
    }
    if (p === '/api/orders') {
      if (await refresh('list')) return route.fulfill({ status: 503, json: { message: 'QA list refresh failed' } });
      return route.fulfill({ json: buildOrderListPage(rows, Object.fromEntries(url.searchParams), new Date('2026-10-15T12:00:00Z')) });
    }
    if (p === '/api/orders/discount-order') {
      if (await refresh('detail')) return route.fulfill({ status: 503, json: { message: 'QA detail refresh failed' } });
      return route.fulfill({ json: order });
    }
    if (p === '/api/auth/me') return route.fulfill({ json: { user: { role: 'OWNER', displayName: 'QA' } } });
    if (p === '/api/branding') return route.fulfill({ json: {} });
    if (p === '/api/communications/unread-count') return route.fulfill({ json: { unreadCount: 0 } });
    if (p === '/api/orders/defaults') return route.fulfill({ json: { depositPercent: 50 } });
    if (p === '/api/clients') return route.fulfill({ json: [client] });
    if (p === '/api/clients/discount-client') return route.fulfill({ json: client });
    return route.fulfill({ json: [] });
  });
  return { order, calls, unexpected, state, releaseRefresh, releasePreview };
}

export async function openFinance(page: Page) {
  await page.goto('/?section=orders&orderId=discount-order&tab=finance');
  const region = page.locator('#order-details-discount-order');
  await expect(region.locator('.orders-tab-finance-approved')).toBeVisible({ timeout: 30000 });
  return region;
}

export async function rememberFinance(page: Page) {
  const root = await page.locator('#order-details-discount-order').elementHandle();
  const tab = await page.locator('.orders-tab-finance-approved').elementHandle();
  if (!root || !tab) throw new Error('Expanded Finance DOM must exist before mutation');
  return async () => {
    expect(await root.evaluate(node => node.isConnected && document.getElementById('order-details-discount-order') === node), 'the same expanded order DOM survives the save').toBe(true);
    expect(await tab.evaluate(node => node.isConnected && document.querySelector('.orders-tab-finance-approved') === node), 'the same Finance tab DOM survives the save').toBe(true);
    await expect(page.getByRole('tab', { name: 'Финансы', exact: true })).toHaveAttribute('aria-selected', 'true');
  };
}
