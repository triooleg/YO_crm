import { expect, test, type Page } from "@playwright/test";

const order = {
  id: "order-delivery-1", number: "YO-26-0301", type: "CUSTOM_ORDER", discipline: "RHYTHMIC_GYMNASTICS",
  deliveryAddressSet: false, requiredDeliveryAt: "2026-10-20T12:00:00.000Z", priceMinor: 45000,
  deliveryMinor: 0, discountMinor: 0, depositRequiredMinor: 22500, currency: "EUR", salesStatus: "ORDER_CONFIRMED",
  productionStatus: "READY", paymentStatus: "PARTIALLY_PAID", shippingStatus: "NOT_READY", createdAt: "2026-09-01T12:00:00.000Z",
  client: { id: "client-delivery-1", displayName: "Анна Получатель", country: "Ukraine", city: "Киев", address: "Крещатик, 1", postalCode: "01001", source: "MANUAL" },
  items: [{ id: "item-delivery-1", name: "Купальник", quantity: 1, priceMinor: 45000, productionStatus: "READY" }], payments: [], activities: [], invoices: [],
};

async function mockOrdersApi(page: Page) {
  let currentOrder = structuredClone(order);
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
    if (method === "PATCH" && path === `/api/orders/${order.id}/delivery-address`) {
      const body = route.request().postDataJSON() as Record<string, string | boolean>;
      requests.push(body);
      currentOrder = { ...currentOrder, deliveryAddressSet: true, deliveryRecipient: body.recipientMatchesClient ? currentOrder.client.displayName : body.recipient, deliveryAddressLine1: body.addressLine1, deliveryAddressLine2: body.addressLine2, deliveryCity: body.city, deliveryRegion: body.region, deliveryPostalCode: body.postalCode, country: body.country, deliveryAddressText: body.addressText };
      return route.fulfill({ json: currentOrder });
    }
    if (method === "GET" && path === "/api/auth/me") return route.fulfill({ json: { user: { email: "qa@yoleotard.local", displayName: "QA", role: "OWNER" } } });
    if (method === "GET" && path === "/api/branding") return route.fulfill({ json: {} });
    if (method === "GET" && path === "/api/orders") return route.fulfill({ json: [currentOrder] });
    return route.fulfill({ status: 501, json: { error: `Unexpected test route: ${method} ${path}` } });
  });
  return requests;
}

for (const viewport of [{ name: "desktop", width: 1920, height: 1080 }, { name: "laptop", width: 1366, height: 768 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`адрес доставки редактируется в заказе: ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const requests = await mockOrdersApi(page);
    await page.goto("/?section=orders");
    const addressButton = page.getByRole("button", { name: `Изменить адрес доставки: ${order.number}` });
    await expect(addressButton).toHaveCSS("color", "rgb(17, 122, 192)");
    await addressButton.hover();
    await expect(addressButton).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(addressButton).toHaveCSS("color", "rgb(17, 122, 192)");
    await addressButton.click();
    const dialog = page.getByRole("dialog", { name: `Информация о доставке ${order.number}` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Использовать адрес клиента")).toBeChecked();
    await expect(dialog.locator(".orders-delivery-client-note")).toContainText("Крещатик, 1, Киев, 01001, Ukraine");
    await dialog.getByLabel("Использовать новый адрес").check();
    const recipientCheckbox = dialog.getByLabel("Совпадает с покупателем");
    const recipientAlignment = await recipientCheckbox.evaluate((input) => { const wrapper = input.closest(".crm-checkbox"); const control = input.getBoundingClientRect(); const label = wrapper?.getBoundingClientRect(); return { controlCenter: control.top + control.height / 2, labelCenter: label ? label.top + label.height / 2 : -100 }; });
    expect(Math.abs(recipientAlignment.controlCenter - recipientAlignment.labelCenter)).toBeLessThan(4);
    await recipientCheckbox.uncheck();
    await dialog.getByLabel("Получатель", { exact: true }).fill("Мария Получатель");
    await dialog.getByLabel("Адрес", { exact: true }).fill("Rue de Rivoli 10");
    await dialog.getByLabel("Дополнительный адрес").fill("Appartement 4");
    await dialog.getByLabel("Город").fill("Paris");
    await dialog.getByLabel("Область / штат").fill("Île-de-France");
    await dialog.getByLabel("Почтовый индекс").fill("75001");
    await dialog.getByLabel("Страна").fill("France");
    await expect(dialog.getByLabel("Полный адрес")).toHaveValue("");
    await page.screenshot({ path: testInfo.outputPath(`order-delivery-${viewport.width}x${viewport.height}.png`), fullPage: false });
    await dialog.getByRole("button", { name: "Сохранить адрес" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toMatchObject({ useClientAddress: false, recipientMatchesClient: false, recipient: "Мария Получатель", addressLine1: "Rue de Rivoli 10", city: "Paris", country: "France", addressText: "" });
    await expect(page.getByRole("button", { name: `Изменить адрес доставки: ${order.number}` })).toContainText("Rue de Rivoli 10, Appartement 4, Paris, Île-de-France, 75001, France");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });
}
