import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { join } from "node:path";

const screenshotPath = (testInfo: TestInfo, name: string) =>
  process.env.YO_CRM_VISUAL_DIR ? join(process.env.YO_CRM_VISUAL_DIR, name) : testInfo.outputPath(name);

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

async function mockOrdersApi(page: Page) {
  let currentOrder = structuredClone(order);
  const updates: { path: string; body: Record<string, string> }[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (method === "PATCH" && path.startsWith(`/api/orders/${order.id}/`)) {
      const body = route.request().postDataJSON() as Record<string, string>;
      updates.push({ path, body });
      currentOrder = { ...currentOrder, ...body };
      if (body.requiredDeliveryAt) currentOrder.requiredDeliveryAt = `${body.requiredDeliveryAt}T12:00:00.000Z`;
      await route.fulfill({ json: currentOrder });
      return;
    }
    if (method === "GET" && path === "/api/auth/me") return route.fulfill({ json: { user: { email: "qa@yoleotard.local", displayName: "QA", role: "OWNER" } } });
    if (method === "GET" && path === "/api/branding") return route.fulfill({ json: {} });
    if (method === "GET" && path === "/api/orders") return route.fulfill({ json: [currentOrder] });
    if (method === "GET" && path === "/api/finance/exchange-rates") return route.fulfill({ json: { provider: "ECB", officialUrl: "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html", supportedPairs: ["EUR/USD", "EUR/UAH", "USD/UAH"], cache: { effectiveDate: "2026-10-10", fetchedAt: "2026-10-10T12:00:00.000Z", rates: [{ baseCurrency: "EUR", quoteCurrency: "USD", decimal: "1.16" }] } } });
    if (method === "GET" && path === "/api/orders/images/keycrm-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg") return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="#7c3aed"/><path d="M20 30h80v120H20z" fill="#facc15"/><circle cx="60" cy="85" r="28" fill="#ec4899"/></svg>',
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
    await expect.poll(() => updates.length).toBe(2);
    expect(updates).toEqual([
      { path: `/api/orders/${order.id}/discipline`, body: { discipline: "FIGURE_SKATING" } },
      { path: `/api/orders/${order.id}/deadline`, body: { requiredDeliveryAt: "2026-10-25" } },
    ]);

    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    if (viewport.name === "mobile") {
      expect(await page.locator(".orders-table-scroll").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    }
    await page.screenshot({ path: screenshotPath(testInfo, `keycrm-orders-${viewport.width}x${viewport.height}.png`), fullPage: false });
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
