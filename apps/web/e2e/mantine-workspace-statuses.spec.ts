import { expect, test, type Page } from "@playwright/test";

const auth = { user: { email: "qa@yoleotard.local", displayName: "QA Operator", role: "OWNER" } };
const currentYearMonth = new Date().toISOString().slice(0, 7);
const productionDate = (day: number) => `${currentYearMonth}-${String(day).padStart(2, "0")}`;

const shippingOrders = [
  {
    id: "shipping-ready",
    number: "YO-26-0101",
    requiredDeliveryAt: "2026-09-20T12:00:00.000Z",
    shippingStatus: "READY",
    currency: "EUR",
    client: { displayName: "Олена", country: "Ukraine", city: "Київ" },
    items: [{ quantity: 1 }],
    shipment: { carrier: "NOVA_GLOBAL", trackingNumber: "NG-101", costMinor: 1800, currency: "EUR" },
  },
  {
    id: "shipping-lost",
    number: "YO-26-0102",
    requiredDeliveryAt: "2026-09-18T12:00:00.000Z",
    shippingStatus: "LOST",
    currency: "EUR",
    client: { displayName: "Марія", country: "Germany", city: "Берлін" },
    items: [{ quantity: 2 }],
    shipment: { carrier: "DHL", trackingNumber: "DHL-102", costMinor: 2400, currency: "EUR" },
  },
  {
    id: "shipping-returned",
    number: "YO-26-0104",
    requiredDeliveryAt: "2026-09-19T12:00:00.000Z",
    shippingStatus: "RETURNED",
    currency: "EUR",
    client: { displayName: "Софія", country: "Ukraine", city: "Львів" },
    items: [{ quantity: 1 }],
    shipment: { carrier: "NOVA_GLOBAL", trackingNumber: "NG-104", costMinor: 1900, currency: "EUR" },
  },
];

const productionOrder = {
  id: "production-hold",
  number: "YO-26-0103",
  notes: "Купальник",
  requiredDeliveryAt: `${productionDate(25)}T12:00:00.000Z`,
  productionStatus: "ON_HOLD",
  priceMinor: 32000,
  currency: "EUR",
  client: { displayName: "Анна", country: "Ukraine" },
  items: [{ quantity: 1 }],
  productionSlot: {
    startsAt: `${productionDate(1)}T12:00:00.000Z`,
    endsAt: `${productionDate(3)}T12:00:00.000Z`,
    capacity: 1,
    tentative: true,
    locked: false,
  },
};

async function mockWorkspaceApi(page: Page, options: { lockedProductionSlot?: boolean; productionLoadError?: boolean } = {}) {
  const shippingUpdates: unknown[] = [];
  const slotUpdates: unknown[] = [];
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "PUT" && pathname === "/api/shipping/orders/shipping-ready") {
      shippingUpdates.push(request.postDataJSON());
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (request.method() === "PATCH" && pathname === "/api/orders/production-hold/production-slot") {
      slotUpdates.push(request.postDataJSON());
      await route.fulfill({ json: request.postDataJSON() });
      return;
    }
    if (request.method() === "GET" && pathname === "/api/orders/defaults" && options.productionLoadError) {
      await route.fulfill({ json: {} });
      return;
    }
    const responses = new Map<string, unknown>([
      ["/api/auth/me", auth],
      ["/api/branding", {}],
      ["/api/communications/unread-count", { unreadCount: 0 }],
      ["/api/shipping", { orders: shippingOrders, carriers: [{ carrier: "NOVA_GLOBAL", label: "Nova Global", enabled: true }, { carrier: "DHL", label: "DHL", enabled: true }] }],
      ["/api/orders/production", [{
        ...productionOrder,
        productionSlot: {
          ...productionOrder.productionSlot,
          locked: options.lockedProductionSlot ?? productionOrder.productionSlot.locked,
        },
      }]],
      ["/api/orders/defaults", { defaultDurationDays: 7, shippingLeadDays: 2 }],
    ]);
    if (request.method() !== "GET" || !responses.has(pathname)) {
      await route.fulfill({ status: 501, json: { error: `Unexpected test route: ${pathname}` } });
      return;
    }
    await route.fulfill({ json: responses.get(pathname) });
  });
  return { shippingUpdates, slotUpdates, consoleErrors };
}

for (const viewport of [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Ошибка производства показана единым доступным уведомлением и закрывается: ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const { consoleErrors } = await mockWorkspaceApi(page, { productionLoadError: true });
    await page.goto("/?section=production");

    await expect(page.locator(".crm-version")).toContainText("0.1.33");
    const alert = page.locator("main.production-page").getByRole("alert");
    await expect(alert).toHaveText("Не удалось загрузить производственную очередь");
    await expect(alert).toHaveClass(/mantine-Alert-root/);
    await expect(alert.locator(".mantine-Alert-message")).toHaveCSS("font-size", "16px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    expect(consoleErrors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`mantine-alert-${viewport.width}x${viewport.height}.png`), fullPage: false });
    await page.getByRole("button", { name: "Закрыть уведомление" }).click();
    await expect(alert).toHaveCount(0);
  });
}

async function dragTimelineBar(page: Page, deltaX: number) {
  const bar = page.locator(".timeline-bar");
  const box = await bar.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + deltaX, box!.y + box!.height / 2);
  await page.mouse.up();
  return box!;
}

test("Закреплённый производственный слот открывается без ложной ошибки загрузки", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const { slotUpdates, consoleErrors } = await mockWorkspaceApi(page, { lockedProductionSlot: true });
  await page.goto("/?section=production");

  const beforeDrag = await dragTimelineBar(page, 80);
  const afterDrag = await page.locator(".timeline-bar").boundingBox();

  expect(afterDrag?.x).toBe(beforeDrag.x);
  expect(slotUpdates).toEqual([]);
  await expect(page.locator(".phase2-error")).toHaveCount(0);

  await page.locator(".timeline-bar").click();

  await expect(page.locator(".production-slot-card")).toBeVisible();
  await expect(page.locator(".phase2-error")).toHaveCount(0);
  expect(slotUpdates).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("Незакреплённый производственный слот сохраняет перетаскивание одним запросом", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const { slotUpdates, consoleErrors } = await mockWorkspaceApi(page);
  await page.goto("/?section=production");

  const beforeDrag = await dragTimelineBar(page, 80);

  await expect.poll(() => slotUpdates.length).toBe(1);
  expect(slotUpdates[0]).toMatchObject({ startsAt: productionDate(3), endsAt: productionDate(5) });
  const afterDrag = await page.locator(".timeline-bar").boundingBox();
  expect(afterDrag?.x).toBeGreaterThan(beforeDrag.x);
  await expect(page.locator(".phase2-error")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

for (const viewport of [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Доставка использует общий статус и сохраняет редактирование: ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const { shippingUpdates, consoleErrors } = await mockWorkspaceApi(page);
    await page.goto("/?section=shipping");

    const ready = page.locator('[data-domain="shipping"][data-status="READY"]');
    const lost = page.locator('[data-domain="shipping"][data-status="LOST"]');
    const returned = page.locator('[data-domain="shipping"][data-status="RETURNED"]');
    await expect(ready).toHaveText("Готов к отправке");
    await expect(lost).toHaveText("Утерян");
    await expect(returned).toHaveText("Возвращён");
    await expect(ready).toHaveCSS("background-color", "rgb(223, 245, 232)");
    await expect(lost).toHaveCSS("background-color", "rgb(255, 226, 226)");
    await expect(returned).toHaveCSS("background-color", "rgb(255, 226, 226)");
    expect(await ready.evaluate((element) => element.tagName)).toBe("SPAN");

    await page.getByRole("button", { name: /YO-26-0101/ }).click();
    const shippingDialog = page.getByRole("dialog", { name: "YO-26-0101" });
    await expect(shippingDialog).toBeVisible();
    await shippingDialog.screenshot({ path: testInfo.outputPath(`mantine-shipping-modal-${viewport.width}x${viewport.height}.png`) });
    const status = page.locator('select[name="status"]');
    await expect(status).toHaveValue("READY");
    await status.selectOption("SHIPPED");
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect.poll(() => shippingUpdates.length).toBe(1);
    expect(shippingUpdates[0]).toMatchObject({ status: "SHIPPED" });

    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    expect(consoleErrors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`mantine-shipping-${viewport.width}x${viewport.height}.png`), fullPage: false });
  });

  test(`Производство использует общий статус и сохраняет даты слота: ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const { slotUpdates, consoleErrors } = await mockWorkspaceApi(page);
    await page.goto("/?section=production");

    await page.locator(".timeline-bar").click();
    const status = page.locator('[data-domain="production"][data-status="ON_HOLD"]');
    await expect(status).toHaveText("Приостановлен");
    await expect(status).toHaveCSS("background-color", "rgb(255, 240, 210)");
    const start = page.locator('.production-slot-card input[type="date"]').first();
    await start.fill(productionDate(2));
    await expect.poll(() => slotUpdates.length).toBe(1);
    expect(slotUpdates[0]).toMatchObject({ startsAt: productionDate(2) });

    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    expect(consoleErrors).toEqual([]);
    await status.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`mantine-production-${viewport.width}x${viewport.height}.png`), fullPage: false });
  });
}
