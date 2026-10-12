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
  invoices: [],
};

async function mockOrdersApi(page: Page, detailsFailure?: { status: number; message: string }) {
  let currentOrder = structuredClone(order);
  const updates: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
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
      if (body.requiredDeliveryAt) currentOrder.requiredDeliveryAt = `${body.requiredDeliveryAt as string}T12:00:00.000Z`;
      await route.fulfill({ json: currentOrder });
      return;
    }
    if (method === "POST" && path === "/api/orders/model-image") return route.fulfill({ json: { path: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg" } });
    if (method === "PATCH" && path === "/api/orders/archive") { const body=route.request().postDataJSON() as Record<string,unknown>; updates.push({path,body}); return route.fulfill({json:{archived:1,orderIds:[order.id]}}); }
    if (method === "GET" && path === "/api/auth/me") return route.fulfill({ json: { user: { email: "qa@yoleotard.local", displayName: "QA", role: "OWNER" } } });
    if (method === "GET" && path === "/api/branding") return route.fulfill({ json: {} });
    if (method === "GET" && path === "/api/orders") return route.fulfill({ json: [currentOrder] });
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

for (const viewport of [
  { name: "desktop", width: 1920, height: 1080 },
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

    await expect(page.getByRole("button", { name: "Изменить изображение позиции: Купальник" })).toBeVisible();
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
    expect(updates.find((update) => update.path.endsWith("/items/item-1"))).toEqual({ path: `/api/orders/${order.id}/items/item-1`, body: { name: "Купальник с рукавами", quantity: 2, priceMinor: 25000, expectedName: "Купальник", expectedQuantity: 1, expectedPriceMinor: 45000, expectedModelImagePath: "keycrm-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg" } });
    const fileChooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Изменить изображение позиции: Купальник" }).click();
    await (await fileChooser).setFiles({ name: "item-updated.png", mimeType: "image/png", buffer: testPng });
    await expect.poll(() => updates.find((update) => update.path.endsWith("/model-image"))).toEqual({ path: `/api/orders/${order.id}/model-image`, body: { itemId: "item-1", modelImagePath: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg", expectedModelImagePath: "keycrm-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg" } });

    await page.getByRole("button", { name: "Изменить валюту" }).click();
    const currencyDialog = page.getByRole("dialog", { name: new RegExp(order.number) });
    await expect(currencyDialog).toBeVisible();
    await expect(page.getByRole("link", { name: "Открыть источник" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Закрыть" })).toBeVisible();
    await page.screenshot({ path: screenshotPath(testInfo, `order-currency-dialog-${viewport.width}x${viewport.height}.png`), fullPage: false });
    await currencyDialog.getByRole("button", { name: "Отмена" }).click();

    const discipline = page.getByRole("combobox", { name: "Изменить вид спорта" });
    await expect(discipline.locator("xpath=ancestor::*[contains(@class,'crm-native-select')]")).toHaveClass(/mantine-NativeSelect-root/);
    await discipline.selectOption("FIGURE_SKATING");
    await expect(discipline).toHaveValue("FIGURE_SKATING");

    const deadline = page.getByRole("textbox", { name: "Изменить срок" });
    await deadline.evaluate((input) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "2026-10-25");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const inlineUpdates = () => updates.filter((update) => update.path.endsWith("/discipline") || update.path.endsWith("/deadline"));
    await expect.poll(() => inlineUpdates().length).toBe(2);
    expect(inlineUpdates()).toEqual([
      { path: `/api/orders/${order.id}/discipline`, body: { discipline: "FIGURE_SKATING" } },
      { path: `/api/orders/${order.id}/deadline`, body: { requiredDeliveryAt: "2026-10-25" } },
    ]);

    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    if (viewport.name === "mobile") {
      expect(await page.locator(".orders-table-scroll").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
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

for (const viewport of [
  { name: "desktop", width: 1920, height: 1080 },
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

    const designs = dialog.getByRole("checkbox", { name: "Дизайны" });
    await designs.uncheck();
    await expect(page.getByRole("columnheader", { name: "Дизайны" })).toBeHidden();

    await dialog.getByRole("button", { name: "Ниже" }).first().click();
    await expect(page.locator("thead th.orders-col").nth(0).locator(".orders-sort-heading span")).toHaveText("Кол-во");
    await expect(page.locator("thead th.orders-col").nth(1).locator(".orders-sort-heading span")).toHaveText("№ / Клиент");

    const deadlineRow = dialog.locator('[data-column-id="deadline"]');
    const paymentRow = dialog.locator('[data-column-id="payment"]');
    await deadlineRow.dragTo(paymentRow);
    const visibleColumnClasses = async (selector: string) => page.locator(selector).evaluateAll((elements) => elements.map((element) => [...element.classList].find((name) => name.startsWith("orders-col-") && name !== "orders-col") || ""));
    await expect.poll(() => visibleColumnClasses("thead th.orders-col")).toEqual([
      "orders-col-quantity", "orders-col-client", "orders-col-discipline", "orders-col-payment", "orders-col-deadline", "orders-col-status", "orders-col-nextAction", "orders-col-delivery", "orders-col-created", "orders-col-menu",
    ]);
    expect(await visibleColumnClasses("tbody tr.orders-summary-row td.orders-col")).toEqual(await visibleColumnClasses("thead th.orders-col"));
    await expect(dialog.getByRole("button", { name: "Готово" })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`mantine-orders-columns-${viewport.width}x${viewport.height}.png`), fullPage: false });

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await expect(page.getByRole("dialog", { name: "Столбцы" }).getByRole("checkbox", { name: "Дизайны" })).not.toBeChecked();
    await page.getByRole("dialog", { name: "Столбцы" }).getByRole("button", { name: "Готово" }).click();
    await page.reload();
    await page.getByRole("button", { name: "Столбцы" }).click();
    const persistedDialog = page.getByRole("dialog", { name: "Столбцы" });
    await expect(persistedDialog.getByRole("checkbox", { name: "Дизайны" })).not.toBeChecked();
    await expect(page.locator("thead th.orders-col").nth(0).locator(".orders-sort-heading span")).toHaveText("Кол-во");
    await expect.poll(() => visibleColumnClasses("thead th.orders-col")).toEqual([
      "orders-col-quantity", "orders-col-client", "orders-col-discipline", "orders-col-payment", "orders-col-deadline", "orders-col-status", "orders-col-nextAction", "orders-col-delivery", "orders-col-created", "orders-col-menu",
    ]);

    await persistedDialog.getByRole("button", { name: "Сбросить" }).click();
    await expect(persistedDialog.getByRole("checkbox", { name: "Дизайны" })).toBeChecked();
    await expect.poll(() => visibleColumnClasses("thead th.orders-col")).toEqual([
      "orders-col-client", "orders-col-quantity", "orders-col-discipline", "orders-col-designs", "orders-col-deadline", "orders-col-payment", "orders-col-status", "orders-col-nextAction", "orders-col-delivery", "orders-col-created", "orders-col-menu",
    ]);
    await persistedDialog.getByRole("button", { name: "Готово" }).click();
    await page.reload();
    await expect.poll(() => visibleColumnClasses("thead th.orders-col")).toEqual([
      "orders-col-client", "orders-col-quantity", "orders-col-discipline", "orders-col-designs", "orders-col-deadline", "orders-col-payment", "orders-col-status", "orders-col-nextAction", "orders-col-delivery", "orders-col-created", "orders-col-menu",
    ]);

    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });
}
