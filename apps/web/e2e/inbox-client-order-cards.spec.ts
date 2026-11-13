import { expect, test } from "@playwright/test";
import { communicationsUi as ui, labels, ordersUi } from "../lib/i18n";

test("client orders show actual payments and distinguish work in progress from shipment", async ({ page }) => {
  const client = {
    id: "qa-client", displayName: "Order Cards QA", status: "ACTIVE", source: "INSTAGRAM",
    conversations: [{ id: "qa-conversation", channel: "INSTAGRAM", unreadCount: 0 }],
  };
  const baseOrder = {
    type: "CUSTOM", priceMinor: 35000, currency: "EUR", compositionManaged: true,
    items: [{ name: "Design QA", quantity: 1, instances: [{}] }],
  };
  const trackNumber = "PC0000020000077161NPG";
  const trackUrl = "https://nova.global/track/?Tracking_ID=" + trackNumber;
  const cards = [
    { ...baseOrder, id: "qa-active", number: "26-713", isActive: true, salesStatus: "NEW_LEAD", productionStatus: "SEWING", notes: "Order note QA",
      dispatchStatus: null, tracking: [], payments: [{ amountMinor: 10000, currency: "EUR" }] },
    { ...baseOrder, id: "qa-empty", number: "26-712", isActive: true, salesStatus: "NEW_LEAD",
      dispatchStatus: null, tracking: [], payments: [], items: [] },
    { ...baseOrder, id: "qa-sent", number: "26-639", isActive: false, salesStatus: "COMPLETED",
      dispatchStatus: "SHIPPED", tracking: [{ number: trackNumber, url: trackUrl }],
      payments: [{ amountMinor: 35000, currency: "EUR" }] },
  ];

  await page.route("**/api/**", route => {
    const { pathname } = new URL(route.request().url());
    switch (pathname) {
      case "/api/auth/me":
        return route.fulfill({ json: { user: { id: "qa", role: "OWNER", displayName: "QA" } } });
      case "/api/communications":
        return route.fulfill({ json: { items: [client], total: 1, hasMore: false } });
      case "/api/communications/qa-client":
        return route.fulfill({ json: { messages: [] } });
      case "/api/clients/qa-client":
        return route.fulfill({ json: { ...client, athletes: [], orders: cards.map(({ id, number }) => ({ id, number })) } });
      case "/api/communications/clients/qa-client/order-cards":
        return route.fulfill({ json: cards });
      default:
        return route.fulfill({ json: [] });
    }
  });

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/?section=inbox");
  await page.locator(".communications-client-list>button").filter({ hasText: client.displayName }).click();
  await page.getByRole("tab", { name: ui.contextOrders }).click();
  const panel = page.getByRole("tabpanel");
  const active = panel.getByRole("article").filter({ hasText: "26-713" });
  const shipped = panel.getByRole("article").filter({ hasText: "26-639" });
  await expect(active).toContainText(/Оплачено: 100,00/);
  await expect(active.getByText(labels.productionStatus.SEWING)).toBeVisible();
  await expect(active.getByText("Order note QA")).toBeVisible();
  const empty = panel.getByRole("article").filter({ hasText: "26-712" });
  await expect(empty.getByText(ui.quantity + ": 0", { exact: true })).toBeVisible();
  await expect(active).toContainText(/Остаток: 250,00/);
  await expect(active.getByText(ordersUi.measurementsMissing)).toBeVisible();
  await expect(shipped).toContainText(/Оплачено: 350,00/);
  await expect(shipped.getByText(labels.shippingStatus.SHIPPED, { exact: true })).toBeVisible();
  await expect(shipped.getByRole("link", { name: trackNumber })).toHaveAttribute("href", trackUrl);
  await expect(shipped.getByText(ordersUi.measurementsMissing)).toHaveCount(0);
});
