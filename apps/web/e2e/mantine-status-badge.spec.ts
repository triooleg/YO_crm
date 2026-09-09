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
    },
    {
      id: "item-2",
      name: "Юбка",
      quantity: 1,
      priceMinor: 0,
      productionStatus: "ON_HOLD",
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
  let currentOrder = structuredClone(order);
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
    const responses = new Map<string, unknown>([
      ["/api/auth/me", { user: { email: "qa@yoleotard.local", displayName: "QA Operator", role: "OWNER" } }],
      ["/api/branding", {}],
      ["/api/orders", [currentOrder]],
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

    await page.getByRole("button", { name: order.number }).click();

    const paid = page.locator('[data-domain="payment"][data-status="PAID"]');
    const shipping = page.locator('[data-domain="shipping"][data-status="LOST"]');
    const production = page.locator('[data-domain="production"][data-status="READY"]');
    const warning = page.locator('[data-domain="production"][data-status="ON_HOLD"]');
    const fallback = page.locator('[data-domain="production"][data-status="QUALITY_CONTROL"]');
    const unknown = page.locator('[data-domain="production"][data-status="PROVIDER_NEW_STATUS"]');
    await expect(paid).toHaveText("Оплачено");
    await expect(shipping).toHaveText("Утерян");
    await expect(production).toHaveText("Готов");
    await expect(warning).toHaveText("Приостановлен");
    await expect(fallback).toHaveText("Контроль качества");
    await expect(unknown).toHaveText("Неизвестный статус");
    await expect(paid).toHaveCSS("text-transform", "none");
    await expect(paid).toHaveCSS("background-color", "rgb(223, 245, 232)");
    await expect(shipping).toHaveCSS("background-color", "rgb(255, 226, 226)");
    await expect(warning).toHaveCSS("background-color", "rgb(255, 240, 210)");
    await expect(fallback).toHaveCSS("background-color", "rgb(236, 229, 255)");
    await expect(unknown).toHaveCSS("background-color", "rgb(236, 229, 255)");
    await expect(fallback).toHaveCSS("white-space", "nowrap");
    const itemPaymentGeometry = await production.evaluate((badge) => {
      const paymentText = badge.parentElement?.querySelector("strong");
      const badgeRect = badge.getBoundingClientRect();
      const textRect = paymentText?.getBoundingClientRect();
      return {
        display: getComputedStyle(badge).display,
        gap: textRect ? badgeRect.top - textRect.bottom : -1,
      };
    });
    expect(itemPaymentGeometry.display).toBe("block");
    expect(itemPaymentGeometry.gap).toBeGreaterThanOrEqual(3);

    const statusControls = page.locator(".orders-expanded-statuses select");
    await expect(statusControls).toHaveCount(2);
    await expect(statusControls.nth(0)).toBeEnabled();
    await expect(statusControls.nth(1)).toBeEnabled();
    await statusControls.nth(0).selectOption("PAID");
    await expect(statusControls.nth(0)).toHaveValue("PAID");
    await statusControls.nth(1).selectOption("SEWING");
    await expect(statusControls.nth(1)).toHaveValue("SEWING");
    expect(statusUpdates).toEqual([{ salesStatus: "PAID" }, { productionStatus: "SEWING" }]);

    const pageOverflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(pageOverflows).toBe(false);
    await paid.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`mantine-statuses-${viewport.width}x${viewport.height}.png`),
      fullPage: false,
    });
  });
}
