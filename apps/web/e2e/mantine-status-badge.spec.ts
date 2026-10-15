import { expect, test, type Page } from "@playwright/test";

const order = {
  id: "order-1",
  number: "YO-26-0099",
  type: "CUSTOM_ORDER",
  discipline: "RHYTHMIC_GYMNASTICS",
  requiredDeliveryAt: "2026-10-20T12:00:00.000Z",
  priceMinor: 45000,
  deliveryMinor: 0,
  discountMinor: 0,
  depositRequiredMinor: 22500,
  currency: "EUR",
  salesStatus: "ORDER_CONFIRMED",
  productionStatus: "READY",
  paymentStatus: "PAID",
  shippingStatus: "LOST",
  notes: "Индивидуальный купальник",
  createdAt: "2026-09-01T12:00:00.000Z",
  client: {
    id: "client-1",
    displayName: "Тестовый клиент",
    country: "Ukraine",
    language: "ru",
    source: "MANUAL",
  },
  items: [
    {
      id: "item-1",
      name: "Купальник",
      quantity: 1,
      priceMinor: 45000,
      productionStatus: "READY",
      athlete: { id: "athlete-1", firstName: "Анна", lastName: "Тестова" },
      measurement: {
        id: "measurement-1",
        athleteId: "athlete-1",
        measuredAt: "2026-08-20T12:00:00.000Z",
        values: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`m${index + 1}`, 50 + index])),
      },
    },
    {
      id: "item-2",
      name: "Юбка",
      quantity: 1,
      priceMinor: 0,
      productionStatus: "ON_HOLD",
      athlete: { id: "athlete-2", firstName: "Мария", lastName: "Тестова" },
      measurement: {
        id: "measurement-2",
        athleteId: "athlete-2",
        measuredAt: "2026-08-22T12:00:00.000Z",
        values: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`m${index + 1}`, 60 + index])),
      },
    },
    {
      id: "item-3",
      name: "Манжеты",
      quantity: 1,
      priceMinor: 0,
      productionStatus: "QUALITY_CONTROL",
    },
    {
      id: "item-4",
      name: "Новый этап",
      quantity: 1,
      priceMinor: 0,
      productionStatus: "PROVIDER_NEW_STATUS",
    },
  ],
  payments: [
    {
      id: "payment-1",
      amountMinor: 45000,
      currency: "EUR",
      method: "CARD",
      receivedAt: "2026-09-02T12:00:00.000Z",
    },
  ],
  activities: [],
  invoices: [],
};

async function mockOrdersApi(page: Page) {
  let currentOrder = {...structuredClone(order),items:order.items.map(item=>({...item,instances:[{id:`instance-${item.id}`,orderItemId:item.id,ordinal:1,productionStatus:item.productionStatus,updatedAt:"2026-10-01T12:00:00Z",athlete:"athlete" in item?item.athlete:null,measurement:"measurement" in item?item.measurement:null}]}))};
  const statusUpdates: Record<string, string>[] = [];
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() === "PATCH" && pathname === "/api/orders/order-1/statuses") {
      const update = route.request().postDataJSON() as Record<string, string>;
      statusUpdates.push(update);
      currentOrder = { ...currentOrder, ...update };
      await route.fulfill({ json: currentOrder });
      return;
    }
    if(route.request().method()==="PATCH"&&pathname==="/api/order-tabs/order-1/instances/instance-item-1"){
      const update=route.request().postDataJSON() as Record<string,string>;statusUpdates.push(update);
      currentOrder={...currentOrder,items:currentOrder.items.map(item=>({...item,instances:item.instances.map(instance=>instance.id==="instance-item-1"?{...instance,productionStatus:update.productionStatus!}:instance)}))};
      await route.fulfill({json:{ok:true}});return;
    }
    const responses = new Map<string, unknown>([
      ["/api/auth/me", { user: { email: "qa@yoleotard.local", displayName: "QA Operator", role: "OWNER" } }],
      ["/api/branding", {}],
      ["/api/orders", [currentOrder]],
      ["/api/orders/order-1",currentOrder],
      ["/api/communications/unread-count",{unreadCount:0}],
    ]);

    if (route.request().method() !== "GET" || !responses.has(pathname)) {
      await route.fulfill({ status: 501, json: { error: `Unexpected test route: ${pathname}` } });
      return;
    }
    await route.fulfill({ json: responses.get(pathname) });
  });
  return statusUpdates;
}

for (const viewport of [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Mantine-статусы сохраняют читаемость и границы страницы: ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const statusUpdates = await mockOrdersApi(page);
    await page.goto("/?section=orders");

    await page.getByRole("button", { name: order.number, exact: true }).click();

    const expandedOrder = page.locator(".orders-approved-expanded");
    await expect(expandedOrder).toHaveCSS("font-size", "12px");
    await expect(expandedOrder.locator(".orders-order-deadlines .orders-detail small").first()).toHaveCSS("font-size", "11px");
    await expect(expandedOrder.locator(".orders-order-deadlines .orders-detail strong").first()).toHaveCSS("font-size", "11px");
    await expect(expandedOrder.locator(".orders-order-deadlines h3").first()).toHaveCSS("font-size", "14px");
    await expect(page.getByRole("button", { name: `Вид спорта: Художественная гимнастика, ${order.number}` })).toHaveCSS("font-size", "11px");
    await expect(page.locator(".orders-deadline-button strong")).toHaveCSS("color", "rgb(17, 122, 192)");

    const paid = page.locator('[data-domain="payment"][data-status="PAID"]');
    const shipping = page.locator('[data-domain="shipping"][data-status="LOST"]').filter({hasText:/^Утерян$/});
    await page.getByRole("tab", { name: "Дизайны" }).click();
    const production = expandedOrder.locator('.orders-instance-row [data-domain="production"][data-status="READY"]');
    const warning = expandedOrder.locator('.orders-instance-row [data-domain="production"][data-status="ON_HOLD"]');
    const fallback = expandedOrder.locator('.orders-instance-row [data-domain="production"][data-status="QUALITY_CONTROL"]');
    const unknown = expandedOrder.locator('.orders-instance-row [data-domain="production"][data-status="PROVIDER_NEW_STATUS"]');
    await expect(paid).toHaveText("Оплачено");
    await expect(shipping).toHaveText("Утерян");
    await expect(production).toHaveText("Готов");
    await expect(warning).toHaveText("Приостановлен");
    await expect(fallback).toHaveText("Контроль качества");
    await expect(unknown).toHaveText("Неизвестный статус");
    await expect(paid).toHaveCSS("text-transform", "none");
    await expect(paid).toHaveCSS("background-color", await expandedOrder.locator(".orders-order-flow > article").nth(0).locator(":scope > i").evaluate(icon=>getComputedStyle(icon).backgroundColor));
    await expect(shipping).toHaveCSS("background-color", await expandedOrder.locator(".orders-order-flow > article").nth(2).locator(":scope > i").evaluate(icon=>getComputedStyle(icon).backgroundColor));
    await expect(warning).toHaveCSS("background-color", "rgb(255, 240, 210)");
    await expect(fallback).toHaveCSS("background-color", "rgb(236, 229, 255)");
    await expect(unknown).toHaveCSS("background-color", "rgb(236, 229, 255)");
    await expect(fallback).toHaveCSS("white-space", "nowrap");
    await expect(production).toBeVisible();
    await expect(production).toHaveCSS("white-space", "nowrap");

    await page.getByRole("tab", { name: "Измерения" }).click();
    const grid=expandedOrder.locator(".orders-approved-measurement-grid");
    await expect(grid).toBeVisible();
    await expect(grid.locator("strong")).toHaveCount(4);
    await expect(grid.locator("strong").first()).toHaveText("50 см");
    await expect(grid).toContainText("№15");
    await page.getByRole("tab",{name:"Дополнительные",exact:true}).click();
    await expect(grid.locator("strong")).toHaveCount(13);
    await expect(grid).toContainText("№17");
    await expect(grid.locator("strong").last()).toHaveText("66 см");
    await page.getByRole("tab",{name:"Основные мерки",exact:true}).click();
    await expandedOrder.getByRole("button",{name:/Мария Тестова/}).click();
    await expect(grid.locator("strong")).toHaveCount(4);
    await expect(grid.locator("strong").first()).toHaveText("60 см");
    await page.getByRole("tab",{name:"Дополнительные",exact:true}).click();
    await expect(grid.locator("strong").last()).toHaveText("76 см");
    await grid.scrollIntoViewIfNeeded();
    await page.screenshot({path:testInfo.outputPath(`mantine-statuses-${viewport.width}x${viewport.height}.png`),fullPage:false});

    const salesStatus = page.getByRole("combobox", { name: "Изменить статус заказа" });
    await page.getByRole("tab", { name: "Производство" }).click();
    const productionStatus = expandedOrder.getByRole("combobox", { name: "Статус производства: 1.1",exact:true });
    const statusControls = [salesStatus, productionStatus];
    await expect(statusControls[0]).toBeEnabled();
    await expect(statusControls[1]).toBeEnabled();
    await statusControls[0].click();
    await page.getByRole("option",{name:"Оплачено",exact:true}).click();
    await expect(statusControls[0]).toHaveValue("Оплачено");
    await statusControls[1].selectOption("SEWING");
    await expect(statusControls[1]).toHaveValue("SEWING");
    expect(statusUpdates).toEqual([{ salesStatus: "PAID" }, { productionStatus: "SEWING", expectedUpdatedAt:"2026-10-01T12:00:00Z" }]);

    const pageOverflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(pageOverflows).toBe(false);
  });
}

test("чужой снимок мерок не показывается у позиции, legacy-позиции и заказа без позиций", async ({ page }) => {
  const foreignMeasurement = {
    id: "measurement-foreign",
    athleteId: "athlete-foreign",
    measuredAt: "2026-08-20T12:00:00.000Z",
    values: { m1: 99 },
  };
  const mismatchedItem = structuredClone(order);
  mismatchedItem.id = "order-mismatched-item";
  mismatchedItem.number = "YO-26-0100";
  mismatchedItem.items = [{
    id: "item-mismatched",
    name: "Чужая позиция",
    quantity: 1,
    priceMinor: 45000,
    productionStatus: "READY",
    athlete: { id: "athlete-1", firstName: "Анна", lastName: "Тестова" },
    measurement: foreignMeasurement,
  }];
  const mismatchedLegacy = structuredClone(mismatchedItem);
  mismatchedLegacy.id = "order-mismatched-legacy";
  mismatchedLegacy.number = "YO-26-0101";
  mismatchedLegacy.athlete = { id: "athlete-1", firstName: "Анна", lastName: "Тестова" };
  mismatchedLegacy.measurement = foreignMeasurement;
  delete mismatchedLegacy.items[0].measurement;
  const mismatchedEmpty = structuredClone(mismatchedLegacy);
  mismatchedEmpty.id = "order-mismatched-empty";
  mismatchedEmpty.number = "YO-26-0102";
  mismatchedEmpty.items = [];

  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const responses = new Map<string, unknown>([
      ["/api/auth/me", { user: { email: "qa@yoleotard.local", displayName: "QA Operator", role: "OWNER" } }],
      ["/api/branding", {}],
      ["/api/orders", [mismatchedItem, mismatchedLegacy, mismatchedEmpty]],
    ]);
    await route.fulfill(responses.has(pathname) ? { json: responses.get(pathname) } : { status: 501, json: { error: pathname } });
  });
  await page.goto("/?section=orders");

  for (const [number, id] of [["YO-26-0100", "order-mismatched-item"], ["YO-26-0101", "order-mismatched-legacy"], ["YO-26-0102", "order-mismatched-empty"]]) {
    await page.getByRole("button", { name: number, exact: true }).click();
    const expanded = page.locator(`#order-details-${id}`);
    await expect(expanded).toBeVisible();
    await expect(expanded.getByRole("button", { name: "Все замеры" })).toHaveCount(0);
    await expect(expanded.locator(".orders-expanded-measurements")).toHaveCount(0);
    await page.getByRole("button", { name: number, exact: true }).click();
  }
});
