import { expect, test, type Page } from "@playwright/test";

const order = {
  id: "order-payment-1",
  number: "YO-26-0201",
  type: "CUSTOM_ORDER",
  discipline: "RHYTHMIC_GYMNASTICS",
  requiredDeliveryAt: "2026-10-20T12:00:00.000Z",
  priceMinor: 45000,
  deliveryMinor: 0,
  discountMinor: 0,
  depositRequiredMinor: 22500,
  currency: "EUR",
  salesStatus: "ORDER_CONFIRMED",
  productionStatus: "NOT_SCHEDULED",
  paymentStatus: "UNPAID",
  shippingStatus: "NOT_READY",
  createdAt: "2026-09-01T12:00:00.000Z",
  client: { id: "client-payment-1", displayName: "Клиент Оплата", country: "Ukraine", source: "MANUAL" },
  items: [{ id: "item-payment-1", name: "Купальник", quantity: 1, priceMinor: 45000, productionStatus: "NOT_SCHEDULED" }],
  payments: [],
  activities: [],
  invoices: [],
};

async function mockOrdersApi(page: Page) {
  let currentOrder = structuredClone(order);
  const paymentRequests: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (method === "POST" && path === `/api/orders/${order.id}/payments`) {
      const body = route.request().postDataJSON();
      paymentRequests.push(body);
      const payment = { id: `payment-${paymentRequests.length}`, amountMinor: body.amountMinor, currency: body.currency, method: body.method, receivedAt: body.receivedAt, reference: body.reference, notes: body.notes };
      currentOrder = {
        ...currentOrder,
        paymentStatus: "PARTIALLY_PAID",
        payments: [...currentOrder.payments, payment],
      };
      return route.fulfill({ json: payment });
    }
    if (method === "GET" && path === "/api/auth/me") return route.fulfill({ json: { user: { email: "qa@yoleotard.local", displayName: "QA", role: "OWNER" } } });
    if (method === "GET" && path === "/api/branding") return route.fulfill({ json: {} });
    if (method === "GET" && path === "/api/orders") return route.fulfill({ json: [currentOrder] });
    return route.fulfill({ status: 501, json: { error: `Unexpected test route: ${method} ${path}` } });
  });
  return paymentRequests;
}

for (const viewport of [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Mantine-окно оплаты сохраняет контракт и доступность: ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const paymentRequests = await mockOrdersApi(page);
    await page.goto("/?section=orders");
    await page.getByRole("button", { name: order.number, exact: true }).click();

    const trigger = page.getByRole("button", { name: /Добавить оплату/ });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: `${"ОПЛАТА ПО ЗАКАЗУ"} ${order.number}` });
    await expect(dialog).toBeVisible();
    const amount = dialog.getByLabel("Сумма");
    await expect(amount).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`mantine-orders-payment-${viewport.width}x${viewport.height}.png`), fullPage: false });

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    const reopened = page.getByRole("dialog", { name: `${"ОПЛАТА ПО ЗАКАЗУ"} ${order.number}` });
    const reopenedAmount = reopened.getByLabel("Сумма");

    await reopenedAmount.fill("0");
    await reopened.getByRole("button", { name: "Добавить оплату" }).click();
    await expect(reopened.getByRole("alert")).toHaveText("Укажите сумму больше нуля");
    expect(paymentRequests).toHaveLength(0);

    await reopenedAmount.fill("100");
    await reopened.getByLabel("Дата оплаты").fill("2026-09-12");
    await reopened.getByRole("button", { name: "Добавить оплату" }).click();
    await expect(reopened).toBeHidden();
    await expect.poll(() => paymentRequests.length).toBe(1);
    expect(paymentRequests[0]).toEqual({
      amountMinor: 10000,
      currency: "EUR",
      method: "BANK_TRANSFER",
      receivedAt: new Date("2026-09-12T12:00:00").toISOString(),
    });

    await trigger.click();
    const populated = page.getByRole("dialog", { name: `${"ОПЛАТА ПО ЗАКАЗУ"} ${order.number}` });
    await populated.getByLabel("Сумма").fill("123,45");
    await populated.getByLabel("Способ оплаты").selectOption("CARD");
    await populated.getByLabel("Дата оплаты").fill("2026-09-13");
    await populated.getByLabel("Номер / ссылка").fill("PAY-123");
    await populated.getByLabel("Примечание").fill("Тестовая оплата");
    await populated.getByRole("button", { name: "Добавить оплату" }).click();

    await expect(populated).toBeHidden();
    await expect.poll(() => paymentRequests.length).toBe(2);
    expect(paymentRequests[1]).toEqual({
      amountMinor: 12345,
      currency: "EUR",
      method: "CARD",
      receivedAt: new Date("2026-09-13T12:00:00").toISOString(),
      reference: "PAY-123",
      notes: "Тестовая оплата",
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });
}
