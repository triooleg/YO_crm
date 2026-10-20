import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { financeFixture } from './order-finance-fixture';

// Real React/Mantine events. Only the HTTP boundary is synthetic; no real API writes.
for (const width of [1366, 390]) test(`existing shipment repeatedly checks and unchecks pieces without crashing and saves exact instance IDs ${width}`, async ({ page }, info) => {
  const pageErrors: { name: string; message: string; stack?: string }[] = [];
  const external: string[] = [];
  const actions: string[] = [];
  const writes: { method: string; body: Record<string, any> }[] = [];
  page.on('pageerror', error => pageErrors.push({ name: error.name, message: error.message, stack: error.stack }));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const f = await financeFixture(page);
  const piece1 = 'discount-piece-1', piece2 = 'discount-piece-2';
  let parcel = { id: 'selection-parcel', carrier: 'NOVA_POSHTA', status: 'NOT_READY', currency: 'EUR',
    customerChargeMinor: 0, atelierCostMinor: 0, isPrimary: true, updatedAt: '2026-10-18T12:00:00.000Z',
    instances: [{ id: piece1, ordinal: 1, orderItemId: 'discount-design' }] };
  Object.assign(f.order, { orderShipments: [parcel] });
  Object.assign(f.order.items[0].instances[0], { orderShipment: { id: parcel.id } });
  await page.route('**/api/shipping/orders/discount-order/shipments/selection-parcel', async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const body = route.request().postDataJSON(); writes.push({ method: route.request().method(), body });
    parcel = { ...parcel, ...body, updatedAt: '2026-10-18T12:01:00.000Z', instances: body.instanceIds.map((id: string) =>
      ({ id, ordinal: id === piece1 ? 1 : 2, orderItemId: 'discount-design' })) };
    Object.assign(f.order, { orderShipments: [parcel] });
    for (const instance of f.order.items[0].instances) Object.assign(instance, { orderShipment: body.instanceIds.includes(instance.id) ? { id: parcel.id } : null });
    f.state.mutated = true; await route.fulfill({ json: parcel });
  });
  try {
    await page.setViewportSize({ width, height: 950 });
    await page.goto('/?section=orders&orderId=discount-order&tab=shipping');
    const region = page.locator('#order-details-discount-order');
    await region.getByRole('tab', { name: 'Доставка', exact: true }).click();
    await region.getByRole('button', { name: 'Изменить посылку', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const pieces = dialog.getByRole('group', { name: 'Изделия в посылке', exact: true }).getByRole('checkbox');
    await expect(pieces).toHaveCount(2);
    await expect(pieces.nth(0)).toBeChecked(); await expect(pieces.nth(1)).not.toBeChecked();
    for (const [index, checked] of [[1, true], [0, false], [1, false], [0, true], [0, false], [1, true]] as const) {
      actions.push(`piece${index + 1}:${checked ? 'check' : 'uncheck'}`);
      await pieces.nth(index).setChecked(checked);
      await expect(pieces.nth(index)).toBeChecked({ checked });
      expect(pageErrors, 'no page error after a real checkbox event').toEqual([]);
    }
    await expect(pieces.nth(0)).not.toBeChecked(); await expect(pieces.nth(1)).toBeChecked();
    await page.screenshot({ path: info.outputPath('selected-before-save.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Сохранить посылку', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].method).toBe('PUT');
    expect(writes[0].body.instanceIds).toEqual([piece2]);
    expect(writes[0].body.expectedUpdatedAt).toBe('2026-10-18T12:00:00.000Z');
    await expect(dialog).toHaveCount(0);
    await region.getByRole('button', { name: 'Изменить посылку', exact: true }).click();
    await expect(pieces.nth(0)).not.toBeChecked(); await expect(pieces.nth(1)).toBeChecked();
    expect(pageErrors).toEqual([]); expect(f.unexpected).toEqual([]); expect(external).toEqual([]);
  } finally {
    const evidence = { pageErrors, actions, writes, unexpected: f.unexpected, external };
    writeFileSync(info.outputPath('browser-evidence.json'), JSON.stringify(evidence, null, 2));
    await info.attach('actual-pageerrors-and-actions', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath('final-browser-state.png'), fullPage: true }).catch(() => undefined);
  }
});
