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
  shippingStatus: "READY",
  paymentStatus: "DEPOSIT_PAID",
  hasTrackingNumber: false,
  priceMinor: 32000,
  depositRequiredMinor: 16000,
  paidMinor: 16000,
  latestPaymentAt: `${productionDate(1)}T09:00:00.000Z`,
  shippedAt: null,
  deliveredAt: null,
  currency: "EUR",
  client: { displayName: "Анна", country: "Ukraine" },
  items: [{ name: "Купальник Aurora", quantity: 1, modelImagePath: "design-1.svg" }],
  productionSlot: {
    startsAt: `${productionDate(1)}T12:00:00.000Z`,
    endsAt: `${productionDate(3)}T12:00:00.000Z`,
    capacity: 1,
    tentative: true,
    locked: false,
    updatedAt: "2026-10-10T12:00:00.000Z",
  },
};

async function mockWorkspaceApi(page: Page, options: { role?: string; trackedProductionOrder?: boolean; lockedProductionSlot?: boolean; productionLoadError?: boolean; slotSaveError?: boolean; deadlineSaveError?: boolean; holdFirstDeadlineSave?: boolean; shippedProductionOrder?: boolean; legacyShippedProductionOrder?: boolean; shippedWithoutTracking?: boolean; denseProduction?: boolean } = {}) {
  const shippingUpdates: unknown[] = [];
  const slotUpdates: unknown[] = [];
  const deadlineUpdates: unknown[] = [];
  const slotDeletes: unknown[] = [];
  let productionLoads = 0;
  let releaseFirstDeadlineSave = () => {};
  const firstDeadlineBarrier = new Promise<void>((resolve) => { releaseFirstDeadlineSave = resolve; });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" && pathname.startsWith("/api/orders/images/")) {
      const hue = Number(pathname.match(/(\d+)/)?.[1] ?? 1) * 31 % 360;
      await route.fulfill({ status: 200, contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 110"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${hue} 75% 38%)"/><stop offset="1" stop-color="hsl(${(hue + 75) % 360} 85% 68%)"/></linearGradient></defs><rect width="80" height="110" rx="8" fill="#f4efff"/><path d="M22 8h36l8 21-12 8v62H26V37l-12-8z" fill="url(#g)"/><path d="M24 28q16 18 32 0M28 60q12 14 24 0" fill="none" stroke="#fff" stroke-width="4"/></svg>` });
      return;
    }
    if (request.method() === "PUT" && pathname === "/api/shipping/orders/shipping-ready") {
      shippingUpdates.push(request.postDataJSON());
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (request.method() === "PATCH" && pathname === "/api/orders/production-hold/production-slot") {
      slotUpdates.push(request.postDataJSON());
      if (options.slotSaveError) {
        await route.fulfill({ status: 400, json: { message: "Проверочная ошибка даты" } });
        return;
      }
      await route.fulfill({ json: request.postDataJSON() });
      return;
    }
    if (request.method() === "PATCH" && pathname === "/api/orders/production-hold/deadline") {
      deadlineUpdates.push(request.postDataJSON());
      if (options.holdFirstDeadlineSave && deadlineUpdates.length === 1) await firstDeadlineBarrier;
      if (options.deadlineSaveError) {
        await route.fulfill({ status: 400, json: { message: "Проверочная ошибка плановой отправки" } });
        return;
      }
      await route.fulfill({ json: { ...productionOrder, ...request.postDataJSON() } });
      return;
    }
    if (request.method() === "DELETE" && pathname === "/api/orders/production-hold/production-slot") {
      slotDeletes.push(request.postDataJSON());
      await route.fulfill({ json: { deleted: true, orderId: "production-hold", productionStatus: "NOT_SCHEDULED" } });
      return;
    }
    if (request.method() === "GET" && pathname === "/api/orders/defaults" && options.productionLoadError) {
      await route.fulfill({ json: {} });
      return;
    }
    if (request.method() === "GET" && pathname === "/api/orders/production") productionLoads++;
    const responses = new Map<string, unknown>([
      ["/api/auth/me", options.role ? { user: { ...auth.user, role: options.role } } : auth],
      ["/api/branding", {}],
      ["/api/communications/unread-count", { unreadCount: 0 }],
      ["/api/orders/website-notifications", []],
      ["/api/shipping", { orders: shippingOrders, carriers: [{ carrier: "NOVA_GLOBAL", label: "Nova Global", enabled: true }, { carrier: "DHL", label: "DHL", enabled: true }] }],
      ["/api/orders/production", [{
        ...productionOrder,
        ...(options.trackedProductionOrder?{hasTrackingNumber:true}:{}),
        ...(options.shippedProductionOrder ? {
          shippingStatus: "SHIPPED",
          shippedAt: `${productionDate(24)}T12:00:00.000Z`,
          hasTrackingNumber: true,
          items: [{ name: "Купальник Aurora", quantity: 3 }],
          client: { ...productionOrder.client, country: "Czech Republic" },
        } : {}),
        ...(options.legacyShippedProductionOrder ? {
          shippingStatus: "SHIPPED",
          hasTrackingNumber: true,
        } : {}),
        ...(options.shippedWithoutTracking ? {
          shippingStatus: "SHIPPED",
          hasTrackingNumber: false,
          client: { ...productionOrder.client, country: undefined },
        } : {}),
        productionSlot: {
          ...productionOrder.productionSlot,
          locked: options.lockedProductionSlot ?? productionOrder.productionSlot.locked,
        },
      }, ...(options.denseProduction ? Array.from({ length: 11 }, (_, index) => {
        const start = 4 + index * 2;
        const quantity = index % 4 === 0 ? 2 : 1;
        const countries = ["Singapore", "Lithuania", "Norway", "Germany", "France", "Netherlands", "Italy", "Malaysia", "Poland", "United States", "Czech Republic"];
        return {
          ...productionOrder,
          id: `production-${index + 2}`,
          number: `KC-${640 + index}`,
          notes: index % 2 ? `Модель ${index + 2}` : `Из KeyCRM #${640 + index}`,
          requiredDeliveryAt: `${productionDate(Math.min(28, start + 9))}T12:00:00.000Z`,
          hasTrackingNumber: index === 4,
          paidMinor: index % 3 === 0 ? 0 : 16000,
          paymentStatus: index % 3 === 0 ? "UNPAID" : "DEPOSIT_PAID",
          client: { displayName: ["Christabel Lim", "Leana", "Ingrid", "Paulina", "Bazine Nicolas", "Siti Balkis", "Pati BJ", "Gaelle", "Janna", "Igor", "Susie"][index], country: countries[index] },
          items: [{ name: index % 2 ? "custom leotard" : "Купальник Aurora", quantity, modelImagePath: `design-${index + 2}.svg` }],
          productionSlot: { ...productionOrder.productionSlot, startsAt: `${productionDate(start)}T12:00:00.000Z`, endsAt: `${productionDate(Math.min(28, start + 5))}T12:00:00.000Z`, tentative: index % 4 === 0, locked: index % 5 === 0 },
        };
      }) : [])]],
      ["/api/orders/defaults", { defaultDurationDays: 7, shippingLeadDays: 2 }],
    ]);
    if (request.method() !== "GET" || !responses.has(pathname)) {
      await route.fulfill({ status: 501, json: { error: `Unexpected test route: ${pathname}` } });
      return;
    }
    await route.fulfill({ json: responses.get(pathname) });
  });
  return { shippingUpdates, slotUpdates, deadlineUpdates, slotDeletes, consoleErrors, productionLoads: () => productionLoads, releaseFirstDeadlineSave };
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

    await expect(page.locator(".crm-version")).toContainText(/CRM v\d+\.\d+\.\d+/);
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

test("производственный план соответствует утверждённой геометрии 1703×895", async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date(`${currentYearMonth}-10T12:00:00Z`));
  await page.setViewportSize({ width: 1703, height: 895 });
  const { consoleErrors } = await mockWorkspaceApi(page, { denseProduction: true });
  await page.goto("/?section=production");
  await expect(page.locator(".production-kpi")).toHaveCount(5);
  await expect(page.locator(".production-order-row")).toHaveCount(12);
  await expect(page.locator(".timeline-payment-segment").first()).toBeVisible();
  await expect(page.locator(".timeline-production-segment").first()).toBeVisible();
  await expect(page.locator(".timeline-shipping-segment").first()).toBeVisible();
  await expect(page.locator(".shipping-date-marker").first()).toBeVisible();
  const boardWithoutSelection = await page.locator(".production-board").evaluate((board) => {
    const box = board.getBoundingClientRect();
    return { height: box.height, bottom: box.bottom, viewportHeight: innerHeight };
  });
  expect(boardWithoutSelection.height).toBeGreaterThan(450);
  expect(boardWithoutSelection.viewportHeight - boardWithoutSelection.bottom).toBeLessThanOrEqual(20);
  await page.screenshot({ path: testInfo.outputPath("production-full-board-1703x895.png"), fullPage: false });

  await page.getByRole("combobox", { name: "Порядок заказов" }).click();
  await page.getByRole("option", { name: "Ближайшая дата отправки" }).click();
  await expect(page.locator(".production-order-main strong").first()).toHaveText("KC-640");

  await page.locator(".timeline-bar").first().hover();
  const slotPreview = page.locator(".production-slot-preview");
  await expect(slotPreview).toBeVisible();
  await expect(slotPreview).toContainText("Дата начала");
  await expect(slotPreview).toContainText("Дата завершения");
  await expect(slotPreview).toContainText("Общий срок");
  await expect(slotPreview).toContainText(/До завершения|Просрочено/);
  await page.screenshot({ path: testInfo.outputPath("production-slot-hover-1703x895.png"), fullPage: false });

  await page.locator(".production-order-summary").first().click();
  await expect(page.locator(".production-order-details")).toBeVisible();
  await expect(page.locator(".production-lifecycle")).toBeVisible();
  await expect(page.locator(".production-lifecycle")).toContainText("Приостановлено");
  const geometry = await page.locator(".production-board").evaluate((board) => {
    const box = board.getBoundingClientRect();
    const left = board.querySelector(".production-order-summary")?.getBoundingClientRect();
    const rowHeight = board.querySelector(".production-order-row")?.getBoundingClientRect().height ?? 0;
    const details = document.querySelector(".production-order-details")?.getBoundingClientRect();
    const rowLabel = board.querySelector(".production-order-main small");
    const rowFont = rowLabel ? Number.parseFloat(getComputedStyle(rowLabel).fontSize) : 0;
    return { width: box.width, height: box.height, leftWidth: left?.width ?? 0, rowHeight, rowFont, detailsTop: details?.top ?? 0, detailsBottom: details?.bottom ?? 0, boardBottom: box.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  expect(geometry.width).toBeGreaterThan(1600);
  expect(geometry.height).toBeGreaterThanOrEqual(320);
  expect(geometry.leftWidth).toBeGreaterThanOrEqual(390);
  expect(geometry.leftWidth).toBeLessThanOrEqual(470);
  expect(geometry.rowHeight).toBeLessThanOrEqual(42);
  expect(geometry.rowFont).toBeGreaterThanOrEqual(10);
  expect(geometry.detailsBottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.detailsBottom).toBeLessThanOrEqual(geometry.boardBottom);
  expect(geometry.detailsTop).toBeGreaterThan(0);
  expect(geometry.height).toBeCloseTo(boardWithoutSelection.height, 0);
  expect(geometry.overflow).toBe(0);
  expect(consoleErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("production-redesign-1703x895.png"), fullPage: false });
});

for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`производственный план сохраняет читаемость без горизонтального переполнения: ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const { consoleErrors } = await mockWorkspaceApi(page, { denseProduction: true });
    await page.goto("/?section=production");
    await expect(page.locator(".production-kpi")).toHaveCount(5);
    await page.locator(".production-order-summary").first().click();
    await expect(page.locator(".production-order-details")).toBeVisible();
    const visual = await page.locator(".production-page").evaluate((root) => {
      const label = root.querySelector(".production-order-main small");
      const period = root.querySelector(".production-period-controls")?.getBoundingClientRect();
      const actions = root.querySelector(".production-heading-actions")?.getBoundingClientRect();
      const heading = root.querySelector(".production-heading");
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        rowFont: label ? Number.parseFloat(getComputedStyle(label).fontSize) : 0,
        periodLeft: period?.left ?? 0,
        periodRight: period?.right ?? 0,
        actionsLeft: actions?.left ?? 0,
        actionsRight: actions?.right ?? 0,
        headingDisplay: heading ? getComputedStyle(heading).display : "",
        headingWidth: heading?.getBoundingClientRect().width ?? 0,
        periodMarginLeft: period ? getComputedStyle(root.querySelector(".production-period-controls")!).marginLeft : "",
        periodFlex: period ? getComputedStyle(root.querySelector(".production-period-controls")!).flex : "",
      };
    });
    expect(visual.overflow).toBe(0);
    expect(visual.rowFont).toBeGreaterThanOrEqual(10);
    if (viewport.width === 390) {
      expect(visual.headingDisplay).toBe("grid");
      expect(visual.headingWidth).toBeLessThanOrEqual(370);
      expect(visual.periodMarginLeft).toBe("0px");
      expect(visual.periodLeft).toBeLessThanOrEqual(12);
      expect(visual.periodRight).toBeLessThanOrEqual(380);
      expect(visual.actionsLeft).toBeLessThanOrEqual(12);
      expect(visual.actionsRight).toBeLessThanOrEqual(380);
    }
    expect(consoleErrors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`production-redesign-${viewport.width}x${viewport.height}.png`), fullPage: false });
  });
}

test("ширина предпросмотра настраивается и сохраняется", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const { consoleErrors } = await mockWorkspaceApi(page);
  await page.goto("/?section=production");
  await page.getByRole("button", { name: "☷ Фильтры", exact:true }).click();
  const width = page.getByLabel("Ширина предпросмотра");
  await width.fill("750");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("orders-image-preview-width-v1"))).toBe("750");
  expect(consoleErrors).toEqual([]);
});

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

  await expect(page.locator(".production-order-details")).toBeVisible();
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
  expect(slotUpdates[0]).toMatchObject({ startsAt: productionDate(4), endsAt: productionDate(6) });
  const afterDrag = await page.locator(".timeline-bar").boundingBox();
  expect(afterDrag?.x).toBeGreaterThan(beforeDrag.x);
  await expect(page.locator(".phase2-error")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("левая граница производственного слота меняет начало без сдвига окончания", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const { slotUpdates, consoleErrors } = await mockWorkspaceApi(page);
  await page.goto("/?section=production");
  const handle = page.locator(".timeline-bar .resize.left");
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 34, box!.y + box!.height / 2);
  await page.mouse.up();
  await expect.poll(() => slotUpdates.length).toBe(1);
  expect(slotUpdates[0]).toMatchObject({ startsAt: productionDate(2), endsAt: productionDate(3) });
  expect(consoleErrors).toEqual([]);
});

test("правая граница слота не выходит за резерв до отправки", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const { slotUpdates, consoleErrors } = await mockWorkspaceApi(page);
  await page.goto("/?section=production");
  const handle = page.locator(".timeline-bar .resize.right");
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width - 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 1000, box!.y + box!.height / 2);
  await page.mouse.up();
  await expect.poll(() => slotUpdates.length).toBe(1);
  expect(slotUpdates[0]).toMatchObject({ startsAt: productionDate(1), endsAt: productionDate(23) });
  expect(consoleErrors).toEqual([]);
});

test("панель производственного слота показывает заказ, открывает его и безопасно удаляет только слот", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const { slotDeletes, consoleErrors } = await mockWorkspaceApi(page);
  await page.goto("/?section=production");
  await expect(page.locator(".production-calendar-header")).toHaveCSS("position", "sticky");
  await page.locator(".timeline-bar").click();
  const sidebar = page.locator(".production-order-details");
  await expect(sidebar).toContainText("YO-26-0103");
  await expect(sidebar).toContainText("Анна");
  await expect(sidebar).toContainText("160,00");
  await expect(sidebar.getByRole("button", { name: "Открыть заказ" })).toBeVisible();
  await sidebar.getByRole("button", { name: "Удалить слот" }).click();
  const confirm = page.getByRole("dialog", { name: "Удаление производственного слота" });
  await expect(confirm).toContainText("заказ останется в CRM со всей историей");
  await confirm.getByRole("button", { name: "Удалить слот" }).click();
  await expect.poll(() => slotDeletes.length).toBe(1);
  expect(slotDeletes[0]).toEqual({ expectedUpdatedAt: "2026-10-10T12:00:00.000Z" });
  await expect(page.locator(".timeline-bar")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("на планшете последний заказ можно прокрутить выше наложенной панели", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await mockWorkspaceApi(page, { denseProduction: true });
  await page.goto("/?section=production");
  await page.locator(".timeline-bar").first().click();

  const scroll = page.locator(".production-board-scroll");
  await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const lastRow = page.locator(".production-order-row").last();
  await expect(lastRow).toBeVisible();
  const geometry = await page.evaluate(() => {
    const row = document.querySelector(".production-order-row:last-child")?.getBoundingClientRect();
    const details = document.querySelector(".production-order-details")?.getBoundingClientRect();
    const scroll = document.querySelector(".production-board-scroll");
    return row && details && scroll ? { rowBottom: row.bottom, detailsTop: details.top, scrollTop: scroll.scrollTop, scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight, paddingBottom: getComputedStyle(scroll).paddingBottom } : null;
  });
  expect(geometry).not.toBeNull();
  expect(geometry!.rowBottom, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry!.detailsTop);
});

test("отправленный заказ получает цветной слот со статусом на всю линию, а количество больше одного видно слева", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockWorkspaceApi(page, { shippedProductionOrder: true });
  await page.goto("/?section=production");

  const row = page.locator(".production-order-row").filter({ hasText: "YO-26-0103" });
  await expect(row.locator(".production-order-description")).toContainText("3 шт.");
  await expect(row.locator(".production-order-main")).toContainText("🇨🇿 Czech Republic");
  await expect(row.locator(".timeline-bar")).toHaveClass(/is-sent/);
  await expect(row.locator(".timeline-shipped-segment")).toHaveText("Отправлено");
  await expect(row.locator(".timeline-payment-segment")).toHaveCount(0);
  await expect(row.locator(".timeline-production-segment")).toHaveCount(0);
  await expect(row.locator(".timeline-tracking-indicator")).toHaveCount(0);
});

for (const viewport of [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`трек-номер означает отправку в производстве: ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockWorkspaceApi(page,{trackedProductionOrder:true});
    await page.goto("/?section=production");

    const row = page.locator(".production-order-row").filter({ hasText: "YO-26-0103" });
    await expect(row.locator(".production-order-description em")).toHaveCount(0);
    await expect(row.locator(".timeline-bar")).toHaveClass(/is-sent/);
    await expect(row.locator(".timeline-shipped-segment")).toHaveText("Отправлено");
    await expect(row.locator(".timeline-tracking-indicator")).toHaveCount(0);
    await expect(row.locator(".timeline-bar")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`tracked-production-${viewport.width}x${viewport.height}.png`) });
  });
}

for(const viewport of [{name:"desktop",width:1920,height:1080},{name:"laptop",width:1366,height:768},{name:"mobile",width:390,height:844}])test(`статусы производства учитывают статус заказа и трек без окраски ячеек: ${viewport.name}`,async({page},testInfo)=>{
  await page.setViewportSize(viewport);
  const {consoleErrors}=await mockWorkspaceApi(page);
  const cases=[
    {id:"active",number:"ACTIVE",hasTrackingNumber:false,salesStatus:"IN_PRODUCTION",productionStatus:"ON_HOLD",paidMinor:1000},
    {id:"sales-shipped",number:"SALES-SHIPPED",hasTrackingNumber:false,salesStatus:"SHIPPED",shippingStatus:"NOT_READY"},
    {id:"tracking",number:"TRACKING",hasTrackingNumber:true,salesStatus:"ORDER_CONFIRMED",shippingStatus:"LABEL_CREATED"},
    {id:"transport",number:"TRANSPORT",hasTrackingNumber:false,shippingStatus:"SHIPPED"},
    {id:"returned",number:"RETURNED",hasTrackingNumber:true,salesStatus:"SHIPPED",shippingStatus:"RETURNED"},
    {id:"lost",number:"LOST",hasTrackingNumber:true,salesStatus:"DELIVERED",shippingStatus:"LOST"},
    {id:"delivered",number:"DELIVERED",hasTrackingNumber:false,salesStatus:"DELIVERED",shippingStatus:"NOT_READY"},
  ].map(candidate=>({...productionOrder,...candidate}));
  await page.route("**/api/orders/production?*",route=>route.fulfill({json:cases}));
  await page.goto("/?section=production");
  await expect(page.locator(".production-order-row")).toHaveCount(cases.length);
  const active=page.locator(".production-order-row").filter({hasText:"ACTIVE"});
  await expect(active.locator(".timeline-production-segment")).toContainText("Приостановлено");
  for(const number of ["SALES-SHIPPED","TRACKING","TRANSPORT"]){
    const row=page.locator(".production-order-row").filter({hasText:number});
    await expect(row.locator(".timeline-shipped-segment")).toHaveText("Отправлено");
    await expect(row.locator(".shipping-date-marker")).toHaveCount(0);
  }
  await expect(page.locator(".production-order-row").filter({hasText:"RETURNED"}).locator(".timeline-shipped-segment")).toHaveText("Возвращено");
  await expect(page.locator(".production-order-row").filter({hasText:"LOST"}).locator(".timeline-shipped-segment")).toHaveText("Утеряно");
  await expect(page.locator(".production-order-row").filter({hasText:"DELIVERED"}).locator(".timeline-shipped-segment")).toHaveText("Доставлено");
  for (const number of ["RETURNED", "LOST", "DELIVERED"]) await expect(page.locator(".production-order-row").filter({hasText:number}).locator(".shipping-date-marker")).toHaveCount(0);
  const geometry=await page.locator(".production-order-row").evaluateAll(rows=>rows.map(row=>({height:row.getBoundingClientRect().height,background:getComputedStyle(row).backgroundColor,grid:getComputedStyle(row).backgroundImage,summary:getComputedStyle(row.querySelector(".production-order-summary")).backgroundColor,barWidth:row.querySelector(".timeline-bar").getBoundingClientRect().width,statusColor:getComputedStyle(row.querySelector(".timeline-bar")).backgroundColor})));
  expect(new Set(geometry.map(value=>value.height)).size).toBe(1);
  expect(new Set(geometry.map(value=>value.background)).size).toBe(1);
  expect(new Set(geometry.map(value=>value.grid)).size).toBe(1);
  expect(new Set(geometry.map(value=>value.summary)).size).toBe(1);
  expect(new Set(geometry.map(value=>value.barWidth)).size).toBe(1);
  expect(geometry[0].statusColor).not.toBe(geometry[1].statusColor);
  await page.screenshot({path:testInfo.outputPath(`production-statuses-${viewport.name}.png`)});
  if (viewport.name === "mobile") {
    await page.locator(".production-board-scroll").evaluate(scroll => {
      const label = scroll.querySelector(".timeline-shipped-segment b")!.getBoundingClientRect();
      const summary = scroll.querySelector(".production-order-summary")!.getBoundingClientRect();
      scroll.scrollLeft += (label.left + label.right) / 2 - (summary.right + scroll.getBoundingClientRect().right) / 2;
    });
    await page.screenshot({path:testInfo.outputPath("production-statuses-mobile-timeline.png")});
  }
  await page.locator(".production-order-row").filter({hasText:"SALES-SHIPPED"}).locator(".production-order-summary").click();
  await expect(page.locator(".production-lifecycle .is-shipped small")).toHaveText("Отправлено");
  await expect(page.locator(".production-details-dates dl div").filter({hasText:"Фактическая отправка"}).locator("dd")).toHaveText("Не указан");
  expect(consoleErrors).toEqual([]);
});

test("отправка видна в производстве даже когда слот вне видимого календаря", async ({ page }) => {
  await mockWorkspaceApi(page);
  await page.route("**/api/orders/production?*", route => route.fulfill({ json: [{ ...productionOrder, salesStatus: "SHIPPED", productionSlot: { ...productionOrder.productionSlot, startsAt: "2020-01-01", endsAt: "2020-01-07" } }] }));
  await page.goto("/?section=production");
  const row = page.locator(".production-order-row");
  await expect(row.locator(".timeline-bar")).toHaveCount(0);
  await expect(row.locator(".production-order-shipping .mantine-Badge-root")).toHaveText("Отправлено");
});

test("legacy статус отправки KeyCRM также показывает цветной отправленный слот", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockWorkspaceApi(page, { legacyShippedProductionOrder: true });
  await page.goto("/?section=production");

  await expect(page.locator(".timeline-bar")).toHaveClass(/is-sent/);
  await expect(page.locator(".timeline-shipped-segment")).toHaveText("Отправлено");
});

test("отправленный статус без накладной всё равно показывает цветной слот и не показывает отсутствующую страну", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockWorkspaceApi(page, { shippedWithoutTracking: true });
  await page.goto("/?section=production");

  const row = page.locator(".production-order-row").filter({ hasText: "YO-26-0103" });
  await expect(row.locator(".timeline-bar")).toHaveClass(/is-sent/);
  await expect(row.locator(".timeline-shipped-segment")).toHaveText("Отправлено");
  await expect(row.locator(".timeline-tracking-indicator")).toHaveCount(0);
  await expect(row.locator(".production-order-main")).toContainText("Страна не указана");
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
    const { slotUpdates, deadlineUpdates, consoleErrors } = await mockWorkspaceApi(page);
    await page.goto("/?section=production");

    await page.locator(".production-order-summary").first().click();
    const status = page.locator(".production-lifecycle").getByText("Производство", { exact: true });
    await expect(status).toBeVisible();
    const start = page.locator('.production-order-details input[type="date"]').first();
    await start.fill(productionDate(2));
    await expect.poll(() => slotUpdates.length).toBe(1);
    expect(slotUpdates[0]).toMatchObject({ startsAt: productionDate(2) });

    const plannedShipping = page.getByLabel("Плановая отправка", { exact: true });
    await expect(plannedShipping).toBeVisible();
    await plannedShipping.fill(productionDate(26));
    await expect.poll(() => deadlineUpdates.length).toBe(1);
    expect(deadlineUpdates[0]).toEqual({ requiredDeliveryAt: productionDate(26) });

    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    expect(consoleErrors).toEqual([]);
    await status.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`mantine-production-${viewport.width}x${viewport.height}.png`), fullPage: false });
  });
}

test("даты производства и отправки пересчитываются без перезагрузки очереди", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const api = await mockWorkspaceApi(page);
  await page.goto("/?section=production");
  await page.locator(".production-order-summary").first().click();
  await expect(page.locator(".production-order-details")).toBeVisible();
  const initialLoads = api.productionLoads();
  const pageToken = await page.evaluate(() => {
    const token = crypto.randomUUID();
    (window as typeof window & { __productionPageToken?: string }).__productionPageToken = token;
    return token;
  });

  await page.getByLabel("Дата начала", { exact: true }).fill(productionDate(2));
  await expect.poll(() => api.slotUpdates.length).toBe(1);
  await expect(page.getByLabel("Дата начала", { exact: true })).toHaveValue(productionDate(2));

  await page.getByLabel("Плановая отправка", { exact: true }).fill(productionDate(26));
  await expect.poll(() => api.deadlineUpdates.length).toBe(1);
  expect(api.deadlineUpdates[0]).toEqual({ requiredDeliveryAt: productionDate(26) });
  await expect(page.getByLabel("Плановая отправка", { exact: true })).toHaveValue(productionDate(26));
  await expect(page.locator(".production-order-summary").first()).toContainText(new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${productionDate(26)}T00:00:00`)));
  expect(api.productionLoads()).toBe(initialLoads);
  expect(await page.evaluate(() => (window as typeof window & { __productionPageToken?: string }).__productionPageToken)).toBe(pageToken);
  await expect(page.locator(".production-order-details")).toBeVisible();
  expect(api.consoleErrors).toEqual([]);
});

test("ошибка сохранения даты откатывает поле без перезагрузки очереди", async ({ page }) => {
  const api = await mockWorkspaceApi(page, { deadlineSaveError: true });
  await page.goto("/?section=production");
  await page.locator(".production-order-summary").first().click();
  const initialLoads = api.productionLoads();
  const plannedShipping = page.getByLabel("Плановая отправка", { exact: true });
  await expect(plannedShipping).toHaveValue(productionDate(25));
  await plannedShipping.fill(productionDate(26));
  await expect(page.locator(".crm-alert")).toContainText("Проверочная ошибка плановой отправки");
  await expect(plannedShipping).toHaveValue(productionDate(25));
  expect(api.productionLoads()).toBe(initialLoads);
  await expect(page.locator(".production-order-details")).toBeVisible();
});

test("производственная роль видит плановую отправку без недоступного редактирования", async ({ page }) => {
  const api = await mockWorkspaceApi(page, { role: "PRODUCTION" });
  await page.goto("/?section=production");
  await page.locator(".production-order-summary").first().click();
  await expect(page.getByLabel("Плановая отправка", { exact: true })).toHaveCount(0);
  await expect(page.locator(".production-details-dates")).toContainText("Плановая отправка");
  await expect(page.locator(".production-details-dates")).toContainText("25");
  expect(api.deadlineUpdates).toEqual([]);
});

test("быстрые изменения плановой отправки сохраняются последовательно и последнее значение побеждает", async ({ page }) => {
  const api = await mockWorkspaceApi(page, { holdFirstDeadlineSave: true });
  await page.goto("/?section=production");
  await page.locator(".production-order-summary").first().click();
  const initialLoads = api.productionLoads();
  const plannedShipping = page.getByLabel("Плановая отправка", { exact: true });
  await plannedShipping.fill(productionDate(26));
  await expect.poll(() => api.deadlineUpdates.length).toBe(1);
  await plannedShipping.fill(productionDate(27));
  await page.waitForTimeout(50);
  expect(api.deadlineUpdates).toHaveLength(1);
  api.releaseFirstDeadlineSave();
  await expect.poll(() => api.deadlineUpdates.length).toBe(2);
  expect(api.deadlineUpdates).toEqual([{ requiredDeliveryAt: productionDate(26) }, { requiredDeliveryAt: productionDate(27) }]);
  await expect(plannedShipping).toHaveValue(productionDate(27));
  expect(api.productionLoads()).toBe(initialLoads);
});

test("две ошибки плановой отправки возвращают последнее подтверждённое сервером значение", async ({ page }) => {
  const api = await mockWorkspaceApi(page, { deadlineSaveError: true, holdFirstDeadlineSave: true });
  await page.goto("/?section=production");
  await page.locator(".production-order-summary").first().click();
  const plannedShipping = page.getByLabel("Плановая отправка", { exact: true });
  await plannedShipping.fill(productionDate(26));
  await expect.poll(() => api.deadlineUpdates.length).toBe(1);
  await plannedShipping.fill(productionDate(27));
  api.releaseFirstDeadlineSave();
  await expect.poll(() => api.deadlineUpdates.length).toBe(2);
  await expect(plannedShipping).toHaveValue(productionDate(25));
});

test("ошибка даты производства откатывает слот без перезагрузки очереди", async ({ page }) => {
  const api = await mockWorkspaceApi(page, { slotSaveError: true });
  await page.goto("/?section=production");
  await page.locator(".production-order-summary").first().click();
  const initialLoads = api.productionLoads();
  const start = page.getByLabel("Дата начала", { exact: true });
  await start.fill(productionDate(2));
  await expect(page.locator(".crm-alert")).toContainText("Проверочная ошибка даты");
  await expect(start).toHaveValue(productionDate(1));
  expect(api.productionLoads()).toBe(initialLoads);
});
