import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { join } from "node:path";

const screenshotPath = (testInfo: TestInfo, name: string) =>
  process.env.YO_CRM_VISUAL_DIR ? join(process.env.YO_CRM_VISUAL_DIR, name) : testInfo.outputPath(name);
const testPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=", "base64");

const order = {
  id: "order-mantine-1",
  number: "YO-26-0101",
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
  paymentStatus: "PARTIALLY_PAID",
  shippingStatus: "NOT_READY",
  notes: "Тестовый заказ",
  createdAt: "2026-09-01T12:00:00.000Z",
  client: {
    id: "client-mantine-1",
    displayName: "Клиент Mantine",
    country: "Ukraine",
    language: "ru",
    source: "MANUAL",
  },
  modelImagePath: "keycrm-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg",
  items: [{ id: "item-1", name: "Купальник", quantity: 1, priceMinor: 45000, productionStatus: "READY", modelImagePath: "keycrm-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg", externalImageUrl: "https://cdn.keycrm.test/design.svg" }],
  payments: [],
  activities: [],
  invoices: [{ id: "invoice-usd", number: "INV-USD", status: "ISSUED", language: "ru", currency: "USD", totalMinor: 12345, issueDate: "2026-10-01T12:00:00.000Z" }],
};

function richOrderDetail(base: typeof order) {
  const measurement = { id: "measurement-1", athleteId: "athlete-1", measuredAt: "2026-09-05T12:00:00.000Z", values: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`m${index + 1}`, 50 + index])) };
  const athlete = { id: "athlete-1", firstName: "Анна", lastName: "Коваленко", measurements: [measurement] };
  const previousOrder = { id: "order-previous-1", number: "YO-26-0094", createdAt: "2026-06-12T12:00:00.000Z", priceMinor: 39000, currency: "EUR", salesStatus: "COMPLETED", productionStatus: "READY", shippingStatus: "DELIVERED", modelImagePath: "keycrm-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg" };
  return {
    ...base,
    buyerComment: "Учесть запас по росту и согласовать декор перед пошивом.",
    managerComment: "Начать после подтверждения предоплаты.",
    client: { ...base.client, phone: "+380501234567", email: "client@example.test", preferences: { "Любимые цвета": "фиолетовый и золото", "Посадка": "плотная" }, files: [], athletes: [athlete], orders: [{ ...base }, previousOrder] },
    items: [{ ...base.items[0], designNumber: "AI-1842", sku: "AURORA-01", properties: { technicalRequirements: ["Серебряные стразы", "Запас по росту"], materials: ["Фиолетовая лайкра", "Подкладка"] }, athlete, measurement, instances: [{ id: "instance-1", ordinal: 1, productionStatus: "READY", plannedStartAt: "2026-10-02T12:00:00.000Z", plannedEndAt: "2026-10-09T12:00:00.000Z", athlete, measurement }] }],
    productionSlot: { id: "slot-1", startsAt: "2026-10-02T12:00:00.000Z", endsAt: "2026-10-09T12:00:00.000Z", capacity: 1, tentative: false, locked: false },
    payments: [{ id: "payment-1", amountMinor: 22500, currency: "EUR", method: "BANK_TRANSFER", receivedAt: "2026-09-10T12:00:00.000Z" }],
    paymentHistory: [{ id: "payment-1", amountMinor: 22500, currency: "EUR", method: "BANK_TRANSFER", receivedAt: "2026-09-10T12:00:00.000Z" }],
    activities: [
      { id: "activity-4", type: "SHIPMENT_CREATED", summary: "Создана посылка Nova Global", createdAt: "2026-10-10T12:00:00.000Z", actor: { id: "manager-1", displayName: "QA Manager" } },
      { id: "activity-3", type: "PRODUCTION_STATUS_CHANGED", summary: "Производство завершено", createdAt: "2026-10-09T12:00:00.000Z", actor: { id: "manager-1", displayName: "QA Manager" } },
      { id: "activity-2", type: "PAYMENT_RECEIVED", summary: "Получена предоплата", createdAt: "2026-09-10T12:00:00.000Z", actor: { id: "manager-1", displayName: "QA Manager" } },
      { id: "activity-1", type: "ORDER_CREATED", summary: "Заказ создан", createdAt: "2026-09-01T12:00:00.000Z", actor: { id: "manager-1", displayName: "QA Manager" } },
    ],
    orderShipments: [{ id: "shipment-1", updatedAt: "2026-10-10T12:00:00.000Z", carrier: "NOVA_GLOBAL", status: "LABEL_CREATED", trackingNumber: "NP000012345", customerChargeMinor: 2500, atelierCostMinor: 1800, currency: "EUR", isPrimary: true, weightGrams: 500, lengthMm: 300, widthMm: 200, heightMm: 100, instances: [{ id: "instance-1", ordinal: 1, orderItemId: "item-1" }] }],
    expenses: [{ id: "expense-1", amountMinor: 1800, currency: "EUR", incurredAt: "2026-10-10T12:00:00.000Z", notes: "Перевозчик", category: { id: "category-shipping", name: "Доставка" } }],
    tags: [{ id: "tag-1", label: "Срочно", color: "violet" }],
    notesStructured: [{ id: "note-1", category: "DESIGNS", visibility: "INTERNAL", title: "Декор", body: "Добавить золотые стразы по линии талии", createdAt: "2026-09-03T12:00:00.000Z", updatedAt: "2026-09-03T12:00:00.000Z", author: { displayName: "QA Manager" } }],
  };
}

async function mockOrdersApi(page: Page, detailsFailure?: { status: number; message: string }, telemetry?: { listGets: number }, behavior?: { statusPatchFails?: boolean; detailFailsAfterStatusPatch?: boolean; detailFailsAfterPayment?: boolean; orderType?: string; additionalOrders?: number; primaryIndex?: number; primaryCreatedAt?: string; richDetail?: boolean }) {
  let currentOrder = structuredClone({ ...order, type: behavior?.orderType ?? order.type, createdAt: behavior?.primaryCreatedAt ?? order.createdAt });
  let statusPatched = false;
  let paymentPosted = false;
  const updates: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (method === "PATCH" && path.endsWith("/statuses") && behavior?.statusPatchFails) return route.fulfill({ status: 409, json: { message: "Статус уже изменён" } });
    if (method === "PATCH" && path.startsWith(`/api/orders/${order.id}/`)) {
      if (path.endsWith("/details") && detailsFailure) return route.fulfill({ status: detailsFailure.status, json: { message: detailsFailure.message } });
      const body = route.request().postDataJSON() as Record<string, unknown>;
      updates.push({ path, body });
      if (path.endsWith("/currency")) {
        currentOrder = { ...currentOrder, currency: body.currency as string, priceMinor: 52200, depositRequiredMinor: 26100 };
        await route.fulfill({ json: { order: currentOrder, conversion: { provider: "ECB" } } });
        return;
      }
      if (path.endsWith("/details")) currentOrder = { ...currentOrder, currency: (body.currency as string | undefined) ?? currentOrder.currency, notes: body.description as string, priceMinor: body.priceMinor as number, modelImagePath: (body.modelImagePath as string | undefined) ?? currentOrder.modelImagePath };
      else currentOrder = { ...currentOrder, ...body } as typeof currentOrder;
      if (path.endsWith("/statuses")) statusPatched = true;
      if (body.requiredDeliveryAt) currentOrder.requiredDeliveryAt = `${body.requiredDeliveryAt as string}T12:00:00.000Z`;
      await route.fulfill({ json: currentOrder });
      return;
    }
    if (method === "POST" && path === "/api/orders/model-image") return route.fulfill({ json: { path: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg" } });
    if (method === "POST" && path === `/api/orders/${order.id}/payments`) {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const payment = { id: "payment-new", amountMinor: body.amountMinor as number, currency: body.currency as string, method: body.method as string, receivedAt: body.receivedAt as string, reference: body.reference as string | undefined, notes: body.notes as string | undefined };
      currentOrder = { ...currentOrder, payments: [payment], paymentHistory: [payment] } as typeof currentOrder;
      paymentPosted = true;
      return route.fulfill({ json: payment });
    }
    if (method === "PATCH" && path === "/api/orders/archive") { const body=route.request().postDataJSON() as Record<string,unknown>; updates.push({path,body}); return route.fulfill({json:{archived:1,orderIds:[order.id]}}); }
    if (method === "GET" && path === "/api/auth/me") return route.fulfill({ json: { user: { email: "qa@yoleotard.local", displayName: "QA", role: "OWNER" } } });
    if (method === "GET" && path === "/api/branding") return route.fulfill({ json: {} });
    if (method === "GET" && path === "/api/orders") {
      if (telemetry) telemetry.listGets += 1;
      const additional = Array.from({ length: behavior?.additionalOrders ?? 0 }, (_, index) => {
        const requiredDeliveryAt = new Date(Date.UTC(2026, 9, 21 + index, 12)).toISOString();
        const createdAt = new Date(Date.UTC(2026, 8, 3 - index, 12)).toISOString();
        return { ...currentOrder, id: `visual-order-${index + 2}`, number: `YO-26-01${String(index + 2).padStart(2, "0")}`, requiredDeliveryAt, createdAt, client: { ...currentOrder.client, id: `visual-client-${index + 2}`, displayName: ["Анна Коваленко", "Maria Rossi", "Sophie Martin", "Emma Wilson"][index] ?? `Клиент ${index + 2}` } };
      });
      const result = [...additional];
      result.splice(Math.min(behavior?.primaryIndex ?? 0, result.length), 0, currentOrder);
      return route.fulfill({ json: result });
    }
    if (method === "GET" && path === `/api/orders/${order.id}`) {
      if (statusPatched && behavior?.detailFailsAfterStatusPatch) return route.fulfill({ status: 503, json: { message: "Детали временно недоступны" } });
      if (paymentPosted && behavior?.detailFailsAfterPayment) return route.fulfill({ status: 503, json: { message: "Детали временно недоступны" } });
      return route.fulfill({ json: { ...(behavior?.richDetail ? richOrderDetail(currentOrder) : currentOrder), responsibleManager: { id: "manager-1", displayName: "QA Manager" } } });
    }
    if (method === "GET" && path === "/api/finance/exchange-rates") return route.fulfill({ json: { provider: "ECB", officialUrl: "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html", supportedPairs: ["EUR/USD", "EUR/UAH", "USD/UAH"], cache: { effectiveDate: "2026-10-10", fetchedAt: "2026-10-10T12:00:00.000Z", rates: [{ baseCurrency: "EUR", quoteCurrency: "USD", decimal: "1.16" }] } } });
    if (method === "GET" && path === "/api/orders/images/keycrm-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg") return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="#7c3aed"/><path d="M20 30h80v120H20z" fill="#facc15"/><circle cx="60" cy="85" r="28" fill="#ec4899"/></svg>',
    });
    if (method === "GET" && path === "/api/orders/images/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg") return route.fulfill({
      contentType: "image/png",
      body: testPng,
    });
    if (method === "GET" && path === `/api/clients/${order.client.id}`) return route.fulfill({ json: { ...order.client, athletes: [] } });
    if (method === "GET" && path === "/api/clients") return route.fulfill({ json: [{ id: order.client.id, displayName: order.client.displayName, country: order.client.country }] });
    return route.fulfill({ status: 501, json: { error: `Unexpected test route: ${method} ${path}` } });
  });
  await page.route("https://cdn.keycrm.test/design.svg", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="#7c3aed"/><path d="M20 30h80v120H20z" fill="#facc15"/><circle cx="60" cy="85" r="28" fill="#ec4899"/></svg>',
  }));
  return updates;
}

test("ошибка параллельного редактирования остаётся в окне заказа", async ({ page }) => {
  await mockOrdersApi(page, { status: 409, message: "Описание или цена уже изменены другим пользователем" });
  await page.goto("/?section=orders");
  await page.getByRole("button", { name: order.number, exact: true }).click();
  await page.getByRole("button", { name: "Изменить заказ" }).click();
  const dialog = page.getByRole("dialog", { name: "Изменить заказ" });
  await dialog.getByLabel("Описание изделия").fill("Конфликтующая правка");
  await dialog.getByRole("button", { name: "Сохранить заказ" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Описание или цена уже изменены другим пользователем")).toBeVisible();
});

test("смена валюты без ручной правки цены отправляется атомарно вместе с заказом", async ({ page }) => {
  const updates = await mockOrdersApi(page);
  await page.goto("/?section=orders");
  await page.getByRole("button", { name: order.number, exact: true }).click();
  await page.getByRole("button", { name: "Изменить заказ" }).click();
  const dialog = page.getByRole("dialog", { name: "Изменить заказ" });
  await dialog.getByLabel("Валюта").selectOption("USD");
  await dialog.getByRole("button", { name: "Сохранить заказ" }).click();
  await expect(dialog).toBeHidden();
  expect(updates.some((update) => update.path.endsWith("/currency"))).toBe(false);
  expect(updates.find((update) => update.path.endsWith("/details"))?.body).toMatchObject({ currency: "USD", expectedCurrency: "EUR", priceDirty: false, priceMinor: 45000, expectedPriceMinor: 45000 });
});

test("вид спорта выглядит как текст и карточка раскрывается сразу под выбранной строкой", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1703, height: 895 });
  const updates = await mockOrdersApi(page);
  await page.goto("/?section=orders");

  const sport = page.getByRole("button", { name: `Вид спорта: Художественная гимнастика, ${order.number}` });
  await expect(sport).toHaveText("Художественная гимнастика");
  await expect(sport).not.toHaveAttribute("aria-haspopup", "listbox");
  await sport.click();
  const currentSport = page.getByRole("menuitem", { name: "Художественная гимнастика, Выбрано" });
  await expect(currentSport).toBeDisabled();
  await currentSport.evaluate((element) => (element as HTMLElement).click());
  await expect.poll(() => updates.filter((update) => update.path.endsWith("/discipline")).length).toBe(0);
  await page.getByRole("menuitem", { name: "Фигурное катание" }).click();
  await expect.poll(() => updates.some((update) => update.path.endsWith("/discipline") && update.body.discipline === "FIGURE_SKATING")).toBe(true);

  await page.getByRole("button", { name: order.number, exact: true }).click();
  const summaryRow = page.locator("tr.orders-summary-row", { has: page.getByRole("button", { name: order.number, exact: true }) });
  const detailRow = summaryRow.locator("xpath=following-sibling::tr[1]");
  await expect(detailRow).toHaveClass(/orders-expanded-row/);
  await expect(detailRow.getByRole("region", { name: `Данные заказа ${order.number}` })).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, "orders-inline-details-1703x895.png"), fullPage: false });
});

test("девять вкладок раскрытого заказа соответствуют единому визуальному контракту", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1536, height: 1024 });
  await mockOrdersApi(page, undefined, undefined, { richDetail: true });
  await page.goto("/?section=orders");
  await page.getByRole("button", { name: order.number, exact: true }).click();
  const tabs = [
    ["Детали", "01-details.png"], ["Дизайны (1)", "02-designs.png"], ["Измерения", "03-measurements.png"],
    ["Клиент", "04-client.png"], ["Финансы", "05-finance.png"], ["Производство", "06-production.png"],
    ["Доставка", "07-shipping.png"], ["Заметки", "08-notes.png"], ["История", "09-history.png"],
  ] as const;
  for (const [label, fileName] of tabs) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    await expect(page.getByRole("tabpanel")).toBeVisible();
    await page.evaluate(() => {
      const overview = document.querySelector<HTMLElement>(".orders-order-overview");
      if (overview) window.scrollTo({ top: Math.max(0, window.scrollY + overview.getBoundingClientRect().top - 64), behavior: "instant" });
    });
    await page.screenshot({ path: screenshotPath(testInfo, fileName), fullPage: false });
  }
});

test("выбранная сортировка сохраняется после обновления страницы", async ({ page }) => {
  await mockOrdersApi(page);
  await page.goto("/?section=orders");

  const sort = page.getByLabel("Сортировка");
  await sort.selectOption("deadline");
  await page.getByRole("button", { name: "Сортировать по столбцу: Срок" }).click();
  await expect(page.getByRole("columnheader", { name: /Срок/ })).toHaveAttribute("aria-sort", "descending");

  await page.reload();
  await expect(sort).toHaveValue("deadline");
  await expect(page.getByRole("columnheader", { name: /Срок/ })).toHaveAttribute("aria-sort", "descending");
});

test("ссылка на заказ восстанавливает его страницу и раскрывает точную карточку", async ({ page }) => {
  await mockOrdersApi(page, undefined, undefined, { additionalOrders: 25, primaryIndex: 24, primaryCreatedAt: "2026-07-01T12:00:00.000Z" });
  await page.goto(`/?section=orders&orderId=${order.id}`);

  await expect(page.getByRole("region", { name: `Данные заказа ${order.number}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "2", exact: true })).toHaveAttribute("aria-current", "page");
});

test("страница и размер списка восстанавливаются после перехода Заказы → Производство → Заказы", async ({ page }) => {
  await mockOrdersApi(page, undefined, undefined, { additionalOrders: 55 });
  await page.goto("/?section=orders");

  await page.getByLabel("Заказов на странице").selectOption("50");
  await page.getByRole("navigation", { name: "Пагинация заказов" }).getByRole("button", { name: "2", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Пагинация заказов" }).getByRole("button", { name: "2", exact: true })).toHaveAttribute("aria-current", "page");

  await page.locator(".crm-topbar-nav").getByRole("button", { name: "Производство", exact: true }).click();
  await expect(page).toHaveURL(/section=production/);
  await page.locator(".crm-topbar-nav").getByRole("button", { name: "Заказы", exact: true }).click();

  await expect(page.getByLabel("Заказов на странице")).toHaveValue("50");
  await expect(page.getByRole("navigation", { name: "Пагинация заказов" }).getByRole("button", { name: "2", exact: true })).toHaveAttribute("aria-current", "page");
});

for (const viewport of [
  { name: "approved", width: 1703, height: 895 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Mantine-контролы заказов сохраняют рабочие сценарии: ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const updates = await mockOrdersApi(page);
    await page.goto("/?section=orders");

    const search = page.getByRole("searchbox", { name: "Номер заказа, клиент, модель…" });
    await search.fill("Mantine");
    await page.getByRole("button", { name: "Очистить поиск" }).click();
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();

    const newOrder = page.getByRole("button", { name: /Новый заказ/ });
    await expect(newOrder).toHaveClass(/mantine-Button-root/);
    await newOrder.click();
    const picker = page.getByRole("dialog", { name: "Выберите клиента" });
    await expect(picker).toBeVisible();
    const clientSearch = picker.getByRole("searchbox", { name: "Найти клиента…" });
    await expect(clientSearch).toBeVisible();
    await expect(clientSearch).toBeFocused();
    await expect(picker.getByRole("button", { name: /Клиент Mantine/ })).toBeVisible();
    await page.screenshot({ path: screenshotPath(testInfo, `mantine-orders-client-picker-${viewport.width}x${viewport.height}.png`), fullPage: false });
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(newOrder).toBeFocused();

    await newOrder.click();
    const reopenedPicker = page.getByRole("dialog", { name: "Выберите клиента" });
    await reopenedPicker.getByRole("button", { name: /Клиент Mantine/ }).click();
    const orderForm = page.getByRole("dialog", { name: "Новый заказ" });
    await expect(orderForm).toBeVisible();
    await expect(orderForm.getByText("КЛИЕНТ MANTINE")).toBeVisible();
    await orderForm.getByRole("button", { name: "Закрыть" }).click();
    await expect(orderForm).toBeHidden();
    await expect(newOrder).toBeFocused();

    await page.getByRole("button", { name: order.number, exact: true }).click();
    await expect(page.getByRole("region", { name: `Данные заказа ${order.number}` })).toBeVisible();
    const importedDesign = page.locator('img[src="/api/orders/images/keycrm-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg"]').first();
    await expect(importedDesign).toBeVisible();
    if (viewport.name !== "mobile") {
      await importedDesign.hover();
      const preview = page.locator(".orders-image-preview");
      await expect(preview).toBeVisible();
      const bounds = await preview.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      await page.screenshot({ path: screenshotPath(testInfo, `keycrm-orders-preview-${viewport.width}x${viewport.height}.png`), fullPage: false });
      await page.mouse.move(0, 0);
      await expect(page.locator(".orders-image-preview")).toBeHidden();
    }

    await page.getByRole("button", { name: "Изменить заказ" }).click();
    const editDialog = page.getByRole("dialog", { name: "Изменить заказ" });
    await expect(editDialog).toBeVisible();
    const description = editDialog.getByLabel("Описание изделия");
    await expect(editDialog.getByLabel("Тип заказа")).toBeFocused();
    await description.fill("Обновлённый тестовый заказ");
    await editDialog.getByLabel("Валюта").selectOption("USD");
    await editDialog.getByLabel("Общая цена").fill("475,50");
    await editDialog.locator('input[type="file"]').setInputFiles({ name: "updated.png", mimeType: "image/png", buffer: testPng });
    await expect(editDialog.getByRole("button", { name: "Отмена" })).toBeInViewport();
    await expect(editDialog.getByRole("button", { name: "Сохранить заказ" })).toBeInViewport();
    await page.screenshot({ path: screenshotPath(testInfo, `order-edit-dialog-${viewport.width}x${viewport.height}.png`), fullPage: false });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await editDialog.getByRole("button", { name: "Сохранить заказ" }).click();
    await expect(editDialog).toBeHidden();
    const detailUpdate = updates.find((update) => update.path.endsWith("/details"));
    expect(updates.some((update) => update.path.endsWith("/currency"))).toBe(false);
    expect(detailUpdate).toEqual({ path: `/api/orders/${order.id}/details`, body: { currency: "USD", expectedCurrency: "EUR", priceDirty: true, type: "CUSTOM_ORDER", expectedType: "CUSTOM_ORDER", description: "Обновлённый тестовый заказ", priceMinor: 47550, expectedDescription: "Тестовый заказ", expectedPriceMinor: 45000, requiredDeliveryAt: "2026-10-20", expectedRequiredDeliveryAt: "2026-10-20T12:00:00.000Z", modelImagePath: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg", expectedModelImagePath: "keycrm-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg" } });
    await page.getByRole("tab", { name: /Дизайны/ }).click();
    await expect(page.getByRole("button", { name: "Изменить изображение позиции: Купальник" })).toBeVisible();
    await page.getByRole("button", { name: "Изменить дизайн" }).click();
    const designDialog = page.getByRole("dialog", { name: "Изменить дизайн" });
    await expect(designDialog.getByLabel("Описание дизайна")).toHaveValue("Купальник");
    await designDialog.getByLabel("Описание дизайна").fill("Купальник с рукавами");
    await designDialog.getByLabel("Количество").fill("2");
    await designDialog.getByLabel("Цена за единицу, USD").fill("250.00");
    await page.screenshot({ path: screenshotPath(testInfo, `order-design-dialog-${viewport.width}x${viewport.height}.png`), fullPage: false });
    expect(await designDialog.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
    await designDialog.getByRole("button", { name: "Сохранить дизайн" }).click();
    await expect(designDialog).toBeHidden();
    expect(updates.find((update) => update.path.endsWith("/items/item-1"))).toEqual({ path: `/api/orders/${order.id}/items/item-1`, body: { name: "Купальник с рукавами", quantity: 2, priceMinor: 25000, designNumber: null, expectedName: "Купальник", expectedQuantity: 1, expectedPriceMinor: 45000, expectedDesignNumber: null, expectedModelImagePath: "keycrm-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg" } });
    await page.getByRole("tab", { name: /Дизайны/ }).click();
    await page.locator(".orders-item-image-editor input[type=file]").setInputFiles({ name: "item-updated.png", mimeType: "image/png", buffer: testPng });
    await expect.poll(() => updates.find((update) => update.path.endsWith("/model-image"))).toEqual({ path: `/api/orders/${order.id}/model-image`, body: { itemId: "item-1", modelImagePath: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg", expectedModelImagePath: "keycrm-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg" } });

    await page.getByRole("tab", { name: "Финансы" }).click();
    await page.getByRole("button", { name: "Изменить валюту", exact: true }).click();
    const currencyDialog = page.getByRole("dialog", { name: new RegExp(order.number) });
    await expect(currencyDialog).toBeVisible();
    await expect(page.getByRole("link", { name: "Открыть источник" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Закрыть" })).toBeVisible();
    await page.screenshot({ path: screenshotPath(testInfo, `order-currency-dialog-${viewport.width}x${viewport.height}.png`), fullPage: false });
    await currencyDialog.getByRole("button", { name: "Отмена" }).click();

    const deadline = page.getByRole("textbox", { name: "Изменить срок" });
    await deadline.evaluate((input) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "2026-10-25");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const inlineUpdates = () => updates.filter((update) => update.path.endsWith("/deadline"));
    await expect.poll(() => inlineUpdates().length).toBe(1);
    expect(inlineUpdates()).toEqual([
      { path: `/api/orders/${order.id}/deadline`, body: { requiredDeliveryAt: "2026-10-25" } },
    ]);

    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    if (viewport.name === "mobile") {
      expect(await page.locator(".orders-table-scroll").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    }
    if (viewport.name === "approved") {
      for (const tabName of ["Дизайны", "Измерения", "Финансы", "Производство", "Доставка"]) {
        await page.getByRole("tab", { name: tabName }).click();
        await page.screenshot({ path: screenshotPath(testInfo, `keycrm-orders-tab-${tabName}-${viewport.width}x${viewport.height}.png`), fullPage: false });
      }
      await page.getByRole("tab", { name: "Детали" }).click();
    }
    await page.screenshot({ path: screenshotPath(testInfo, `keycrm-orders-${viewport.width}x${viewport.height}.png`), fullPage: false });
    await page.getByRole("checkbox", { name: "Выбрать заказ" }).check();
    await page.getByRole("button", { name: "Удалить выбранные" }).click();
    const archiveDialog=page.getByRole("dialog", { name: "Удаление заказов" });
    await expect(archiveDialog).toContainText("Оплаты, сообщения и история сохранятся");
    await page.screenshot({ path: screenshotPath(testInfo, `order-archive-dialog-${viewport.width}x${viewport.height}.png`), fullPage: false });
    await archiveDialog.getByRole("button", { name: "Отмена" }).click();
  });
}

test("фильтры и сортировка заказов сохраняют рабочую семантику", async ({ page }) => {
  const secondOrder = {
    ...structuredClone(order),
    id: "order-mantine-2",
    number: "YO-26-0102",
    discipline: "FIGURE_SKATING",
    salesStatus: "NEW_LEAD",
    createdAt: "2026-09-10T12:00:00.000Z",
    client: { ...order.client, id: "client-mantine-2", displayName: "Альфа Клиент" },
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET" && url.pathname === "/api/auth/me") return route.fulfill({ json: { user: { email: "qa@yoleotard.local", displayName: "QA", role: "OWNER" } } });
    if (route.request().method() === "GET" && url.pathname === "/api/branding") return route.fulfill({ json: {} });
    if (route.request().method() === "GET" && url.pathname === "/api/orders") return route.fulfill({ json: [order, secondOrder] });
    return route.fulfill({ status: 501, json: { error: `Unexpected test route: ${route.request().method()} ${url.pathname}` } });
  });
  await page.goto("/?section=orders");
  const orderNumbers = page.locator(".orders-order-number");
  await expect(orderNumbers).toHaveCount(2);

  const clientHeader = page.getByRole("columnheader", { name: /№ \/ Клиент/ });
  const clientSort = page.getByRole("button", { name: "Сортировать по столбцу: № / Клиент" });
  await clientSort.click();
  await expect(clientHeader).toHaveAttribute("aria-sort", "ascending");
  await expect(orderNumbers).toHaveText([secondOrder.number, order.number]);
  await clientSort.click();
  await expect(clientHeader).toHaveAttribute("aria-sort", "descending");
  await expect(orderNumbers).toHaveText([order.number, secondOrder.number]);

  await page.getByRole("button", { name: "Фильтры" }).click();
  const filters = page.getByRole("dialog", { name: "Фильтры" });
  await filters.getByLabel("Статус").selectOption("NEW_LEAD");
  await expect(page.getByRole("button", { name: secondOrder.number, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: order.number, exact: true })).toBeHidden();

  await filters.getByLabel("Вид спорта").selectOption("RHYTHMIC_GYMNASTICS");
  await expect(page.getByText("Заказы не найдены")).toBeVisible();
  await page.getByRole("button", { name: "Очистить все" }).last().click();
  await expect(orderNumbers).toHaveCount(2);

  await page.getByLabel("Сортировка").selectOption("client");
  await expect(orderNumbers).toHaveText([secondOrder.number, order.number]);
});

test("смена статуса сохраняется без перезагрузки списка и не закрывает выбранный заказ", async ({ page }) => {
  const telemetry = { listGets: 0 };
  const updates = await mockOrdersApi(page, undefined, telemetry);
  await page.goto("/?section=orders");
  await expect.poll(() => telemetry.listGets).toBe(1);
  await page.getByRole("button", { name: order.number, exact: true }).click();
  const details = page.getByRole("region", { name: `Данные заказа ${order.number}` });
  await expect(details).toBeVisible();
  await page.getByRole("combobox", { name: "Изменить статус" }).selectOption("PAID");
  await expect.poll(() => updates.some((update) => update.path.endsWith("/statuses") && update.body.salesStatus === "PAID")).toBe(true);
  await expect(details).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Изменить статус" })).toHaveValue("PAID");
  expect(telemetry.listGets).toBe(1);
});

test("ошибка PATCH статуса полностью откатывает оптимистическое изменение без перезагрузки списка", async ({ page }) => {
  const telemetry = { listGets: 0 };
  await mockOrdersApi(page, undefined, telemetry, { statusPatchFails: true });
  await page.goto("/?section=orders");
  await page.getByRole("button", { name: order.number, exact: true }).click();
  const status = page.getByRole("combobox", { name: "Изменить статус" });
  await status.selectOption("PAID");
  await expect(status).toHaveValue("ORDER_CONFIRMED");
  await expect(page.getByText("Статус уже изменён")).toBeVisible();
  expect(telemetry.listGets).toBe(1);
});

test("успешный PATCH статуса не откатывается при сбое точечного обновления деталей", async ({ page }) => {
  const telemetry = { listGets: 0 };
  await mockOrdersApi(page, undefined, telemetry, { detailFailsAfterStatusPatch: true });
  await page.goto("/?section=orders");
  await page.getByRole("button", { name: order.number, exact: true }).click();
  const status = page.getByRole("combobox", { name: "Изменить статус" });
  await status.selectOption("PAID");
  await expect(status).toHaveValue("PAID");
  await expect(page.getByText("Детали временно недоступны")).toBeVisible();
  expect(telemetry.listGets).toBe(1);
});

test("после добавления оплаты раскрытая карточка обновляет сумму и историю без перезагрузки списка", async ({ page }) => {
  const telemetry = { listGets: 0 };
  await mockOrdersApi(page, undefined, telemetry);
  await page.goto("/?section=orders");
  await page.getByRole("button", { name: order.number, exact: true }).click();
  await page.getByRole("button", { name: "+ Добавить оплату" }).first().click();
  const payment = page.getByRole("dialog", { name: "Оплата по заказу" });
  await payment.getByLabel("Сумма").fill("225");
  await payment.getByLabel("Номер / ссылка").fill("PAY-225");
  await payment.getByLabel("Примечание").fill("Подтверждено банком");
  await payment.getByRole("button", { name: "Добавить оплату" }).click();
  await expect(payment).toBeHidden();
  await page.getByRole("tab", { name: "Финансы" }).click();
  await expect(page.getByText("PAY-225")).toBeVisible();
  await expect(page.getByText("Подтверждено банком")).toBeVisible();
  await expect(page.getByText(/123,45.*\$/)).toBeVisible();
  expect(telemetry.listGets).toBe(1);
});

test("сбой точечного обновления после оплаты безопасно перечитывает список и не оставляет старую сумму", async ({ page }) => {
  const telemetry = { listGets: 0 };
  await mockOrdersApi(page, undefined, telemetry, { detailFailsAfterPayment: true });
  await page.goto("/?section=orders");
  await page.getByRole("button", { name: order.number, exact: true }).click();
  await page.getByRole("button", { name: "+ Добавить оплату" }).first().click();
  const payment = page.getByRole("dialog", { name: "Оплата по заказу" });
  await payment.getByLabel("Сумма").fill("225");
  await payment.getByRole("button", { name: "Добавить оплату" }).click();
  await expect(payment).toBeHidden();
  await expect.poll(() => telemetry.listGets).toBe(2);
  await expect(page.getByRole("region", { name: `Данные заказа ${order.number}` })).toContainText("225,00");
});

for (const orderType of ["READY_MODEL", "ACCESSORY", "WEBSITE_SALE", "STOCK_SALE"]) {
  test(`тип ${orderType} не предлагает производство`, async ({ page }) => {
    await mockOrdersApi(page, undefined, undefined, { orderType });
    await page.goto("/?section=orders");
    await page.getByRole("button", { name: order.number, exact: true }).click();
    await expect(page.getByRole("button", { name: "Назначить производство" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Открыть в производств/ })).toHaveCount(0);
    await page.getByRole("tab", { name: "Производство" }).click();
    await expect(page.getByText("Производство не требуется для этого типа заказа")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Статус производства" })).toHaveCount(0);
  });
}

test("утверждённая геометрия сохраняет плотность пяти строк и нижнюю панель", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1703, height: 895 });
  await mockOrdersApi(page, undefined, undefined, { additionalOrders: 4, primaryIndex: 2 });
  await page.goto("/?section=orders");
  await expect(page.locator(".orders-summary-row")).toHaveCount(5);
  const clientColumnWidth = await page.locator("tbody .orders-col-client").first().evaluate((cell) => cell.getBoundingClientRect().width);
  expect(clientColumnWidth).toBeLessThanOrEqual(221);
  await page.getByRole("button", { name: order.number, exact: true }).click();
  const selectedRow = page.locator("tr.orders-summary-row", { has: page.getByRole("button", { name: order.number, exact: true }) });
  await expect(selectedRow.locator("xpath=following-sibling::tr[1]")).toHaveClass(/orders-expanded-row/);
  await expect(page.locator(".orders-order-overview")).toBeVisible();
  const rowHeight = await page.locator(".orders-summary-row").nth(1).evaluate((row) => row.getBoundingClientRect().height);
  expect(rowHeight).toBeLessThanOrEqual(66);
  await page.screenshot({ path: screenshotPath(testInfo, "keycrm-orders-density-1703x895.png"), fullPage: false });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: screenshotPath(testInfo, "keycrm-orders-density-1920x1080.png"), fullPage: false });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole("button", { name: new RegExp(`^Вид спорта: .*, ${order.number}$`) }).click();
  await page.screenshot({ path: screenshotPath(testInfo, "keycrm-orders-density-menu-1366x768.png"), fullPage: false });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: new RegExp(`^Вид спорта: .*, ${order.number}$`) }).click();
  await page.screenshot({ path: screenshotPath(testInfo, "keycrm-orders-density-menu-390x844.png"), fullPage: false });
});

for (const viewport of [
  { name: "approved", width: 1703, height: 895 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`настройка столбцов сохраняется и доступна с клавиатуры: ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockOrdersApi(page);
    await page.goto("/?section=orders");

    const trigger = page.getByRole("button", { name: "Столбцы" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Столбцы" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: "№ / Клиент" })).toBeFocused();

    const model = dialog.getByRole("checkbox", { name: "Модель / Спорт" });
    await model.uncheck();
    await expect(page.getByRole("columnheader", { name: "Модель / Спорт" })).toBeHidden();

    await dialog.getByRole("button", { name: "Ниже" }).first().click();
    await expect(page.locator("thead th.orders-col").nth(0).locator(".orders-sort-heading span")).toHaveText("№ / Клиент");
    await expect(page.locator("thead th.orders-col").nth(1).locator(".orders-sort-heading span")).toHaveText("Кол-во");

    const deadlineRow = dialog.locator('[data-column-id="deadline"]');
    const paymentRow = dialog.locator('[data-column-id="payment"]');
    await deadlineRow.dragTo(paymentRow);
    const visibleColumnClasses = async (selector: string) => page.locator(selector).evaluateAll((elements) => elements.map((element) => [...element.classList].find((name) => name.startsWith("orders-col-") && name !== "orders-col") || ""));
    await expect.poll(() => visibleColumnClasses("thead th.orders-col")).toEqual([
      "orders-col-client", "orders-col-quantity", "orders-col-payment", "orders-col-deadline", "orders-col-production", "orders-col-delivery", "orders-col-status", "orders-col-created", "orders-col-menu",
    ]);
    expect(await visibleColumnClasses("tbody tr.orders-summary-row td.orders-col")).toEqual(await visibleColumnClasses("thead th.orders-col"));
    await expect(dialog.getByRole("button", { name: "Готово" })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`mantine-orders-columns-${viewport.width}x${viewport.height}.png`), fullPage: false });

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await expect(page.getByRole("dialog", { name: "Столбцы" }).getByRole("checkbox", { name: "Модель / Спорт" })).not.toBeChecked();
    await page.getByRole("dialog", { name: "Столбцы" }).getByRole("button", { name: "Готово" }).click();
    await page.reload();
    await page.getByRole("button", { name: "Столбцы" }).click();
    const persistedDialog = page.getByRole("dialog", { name: "Столбцы" });
    await expect(persistedDialog.getByRole("checkbox", { name: "Модель / Спорт" })).not.toBeChecked();
    await expect(page.locator("thead th.orders-col").nth(0).locator(".orders-sort-heading span")).toHaveText("№ / Клиент");
    await expect.poll(() => visibleColumnClasses("thead th.orders-col")).toEqual([
      "orders-col-client", "orders-col-quantity", "orders-col-payment", "orders-col-deadline", "orders-col-production", "orders-col-delivery", "orders-col-status", "orders-col-created", "orders-col-menu",
    ]);

    await persistedDialog.getByRole("button", { name: "Сбросить" }).click();
    await expect(persistedDialog.getByRole("checkbox", { name: "Модель / Спорт" })).toBeChecked();
    await expect.poll(() => visibleColumnClasses("thead th.orders-col")).toEqual([
      "orders-col-client", "orders-col-model", "orders-col-quantity", "orders-col-deadline", "orders-col-payment", "orders-col-production", "orders-col-delivery", "orders-col-status", "orders-col-created", "orders-col-menu",
    ]);
    await persistedDialog.getByRole("button", { name: "Готово" }).click();
    await page.reload();
    await expect.poll(() => visibleColumnClasses("thead th.orders-col")).toEqual([
      "orders-col-client", "orders-col-model", "orders-col-quantity", "orders-col-deadline", "orders-col-payment", "orders-col-production", "orders-col-delivery", "orders-col-status", "orders-col-created", "orders-col-menu",
    ]);

    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });
}
