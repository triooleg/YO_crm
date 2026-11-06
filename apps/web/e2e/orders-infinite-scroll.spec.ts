import { expect, test, type Page } from "@playwright/test";

const orders = Array.from({ length: 78 }, (_, index) => ({
  id: `order-${index + 1}`,
  number: `26-${1001 + index}`,
  type: "CUSTOM_ORDER",
  salesStatus: "NEW_LEAD",
  productionStatus: "NOT_STARTED",
  shippingStatus: "NOT_READY",
  paymentStatus: "UNPAID",
  priceMinor: 20000,
  depositRequiredMinor: 10000,
  currency: "EUR",
  createdAt: "2026-11-01T12:00:00Z",
  client: { id: "client-1", displayName: "Тестовый клиент", source: "MANUAL" },
  items: [],
  payments: [],
}));

async function mockOrders(page: Page, options: { hold?: Promise<void>; drift?: "overlap" | "delete"; fail?: boolean } = {}) {
  const requests: { page: number; size: number; search: string; focus: string | null }[] = [];
  const archivedIds = new Set<string>();
  let fail = options.fail;
  let drift = options.drift;
  await page.route("**/api/**", async route => {
    const { pathname, searchParams } = new URL(route.request().url());
    if (pathname === "/api/auth/me") return route.fulfill({ json: { user: { role: "OWNER", displayName: "QA" } } });
    if (pathname === "/api/orders/archive") {
      for (const id of route.request().postDataJSON().orderIds as string[]) archivedIds.add(id);
      return route.fulfill({ json: {} });
    }
    if (pathname === "/api/orders") {
      const requestedPage = Number(searchParams.get("page"));
      const size = Number(searchParams.get("pageSize"));
      const search = searchParams.get("search") ?? "";
      const focus = searchParams.get("focusId");
      requests.push({ page: requestedPage, size, search, focus });
      if (requestedPage === 2 && !search) {
        await options.hold;
        if (fail) {
          fail = false;
          return route.fulfill({ status: 503, json: {} });
        }
      }
      const driftingPage = requestedPage === 2 && !focus ? drift : undefined;
      if (driftingPage) drift = undefined;
      if (driftingPage === "delete") archivedIds.add(orders[0].id);
      const matching = orders.filter(order => !archivedIds.has(order.id) && order.number.includes(search));
      const focusIndex = matching.findIndex(order => order.id === focus);
      const current = focusIndex >= 0 ? Math.floor(focusIndex / size) + 1 : Math.min(requestedPage, Math.max(1, Math.ceil(matching.length / size)));
      const items = matching.slice((current - 1) * size, current * size);
      if (driftingPage === "overlap") items[0] = matching[size - 1];
      return route.fulfill({ json: {
        items, total: matching.length, page: current, pageSize: size, focusFound: !focus || focusIndex >= 0,
        metrics: { total: matching.length, active: matching.length, unpaid: 0, deposit: 0, urgent: 0, overdue: 0, ready: 0, completed: 0, work: 0 },
        sources: { total: matching.length, websiteCount: 0 },
        disciplines: [],
      } });
    }
    const order = orders.find(item => pathname === `/api/orders/${item.id}`);
    return route.fulfill({ json: order ? { ...order, activities: [] } : {} });
  });
  return requests;
}

const rows = (page: Page) => page.locator(".orders-summary-row");
const scrollToEnd = (page: Page) => page.locator(".orders-pagination").evaluate(element => element.scrollIntoView({ block: "end" }));

for (const width of [1366, 390]) {
  test(`append keeps existing rows and selection at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 768 });
    const requests = await mockOrders(page);
    await page.goto("/?section=orders");
    await expect(rows(page)).toHaveCount(20);
    const first = rows(page).first();
    await first.locator("input[type=checkbox]").check();
    await first.evaluate(element => element.setAttribute("data-retained", "yes"));
    await scrollToEnd(page);
    await expect(rows(page)).toHaveCount(40);
    await expect(first).toHaveAttribute("data-retained", "yes");
    await expect(first.locator("input[type=checkbox]")).toBeChecked();
    await expect(page).toHaveURL(/(?:\?|&)page=1(?:&|$)/);
    await page.screenshot({ path: testInfo.outputPath(`orders-after-append-${width}.png`) });
    await scrollToEnd(page);
    await expect(rows(page)).toHaveCount(60);
    await scrollToEnd(page);
    await expect(rows(page)).toHaveCount(78);
    await scrollToEnd(page);
    expect(requests.map(request => request.page)).toEqual([1, 2, 3, 4]);
  });
}

for (const drift of ["overlap", "delete"] as const) {
  test(`append stops on ${drift} and refresh recovers the page boundary`, async ({ page }, testInfo) => {
    const requests = await mockOrders(page, { drift });
    await page.goto("/?section=orders&search=26-1");
    await expect(rows(page)).toHaveCount(20);
    const selected = rows(page).filter({ hasText: "26-1003" }).locator("input[type=checkbox]");
    await selected.check();
    await scrollToEnd(page);

    const status = page.locator(".orders-append-status");
    await expect(status.getByRole("status")).toContainText("Список заказов изменился");
    const refresh = status.getByRole("button", { name: "Обновить список заказов" });
    await expect(refresh).toBeVisible();
    await expect(rows(page)).toHaveCount(20);
    await expect(rows(page).last()).toContainText("26-1020");
    expect(requests.map(request => request.page)).toEqual([1, 2]);
    await refresh.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`orders-recovery-${drift}.png`) });

    await refresh.click();
    await expect(rows(page)).toHaveCount(40);
    await expect(rows(page).nth(drift === "delete" ? 19 : 20)).toContainText("26-1021");
    await expect(rows(page).first()).toContainText(drift === "delete" ? "26-1002" : "26-1001");
    await expect(selected).toBeChecked();
    await expect(page).toHaveURL(/[?&]page=1(?:&|$)/);
    expect(requests.map(request => request.page)).toEqual([1, 2, 1, 2]);
    expect(requests.every(request => request.search === "26-1")).toBe(true);
  });
}

test("a late append does not change new search results", async ({ page }) => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const requests = await mockOrders(page, { hold });
  await page.goto("/?section=orders");
  await expect(rows(page)).toHaveCount(20);
  try {
    await scrollToEnd(page);
    await expect.poll(() => requests.filter(request => request.page === 2).length).toBe(1);
    await page.locator(".orders-command-bar input").first().fill("26-1078");
    await expect(rows(page)).toHaveCount(1);
  } finally {
    release();
  }
  await expect(rows(page)).toContainText("26-1078");
  await expect(rows(page)).toHaveCount(1);
});

test("manual pagination and changing page size stay available after a failed append", async ({ page }) => {
  const requests = await mockOrders(page, { fail: true });
  await page.goto("/?section=orders");
  await expect(rows(page)).toHaveCount(20);
  await scrollToEnd(page);
  const retry = page.locator(".orders-append-status").getByRole("button", { name: "Повторить" });
  await expect(retry).toBeVisible();
  await expect(rows(page)).toHaveCount(20);
  await retry.click();
  await expect(rows(page)).toHaveCount(40);
  await page.locator(".orders-pagination nav").getByRole("button", { name: "3", exact: true }).evaluate(button => button.click());
  await expect(rows(page).first()).toContainText("26-1041");
  await expect(page).toHaveURL(/(?:\?|&)page=3(?:&|$)/);
  await page.locator(".orders-page-size select").selectOption("30");
  await expect(rows(page).first()).toContainText("26-1001");
  await scrollToEnd(page);
  await expect.poll(() => requests.some(request => request.page === 2 && request.size === 30)).toBe(true);
  await expect(rows(page)).toHaveCount(60);
});

test("a deep-linked order stays expanded when the next page is appended", async ({ page }) => {
  const requests = await mockOrders(page);
  await page.goto("/?section=orders&orderId=order-24&pageSize=20");
  const detail = page.locator("#order-details-order-24");
  await expect(detail).toBeVisible();
  await expect(rows(page).first()).toContainText("26-1021");
  await scrollToEnd(page);
  await expect(rows(page)).toHaveCount(40);
  await expect(detail).toBeVisible();
  await expect(page).toHaveURL(/orderId=order-24/);
  expect(requests.some(request => request.page === 3 && !request.focus)).toBe(true);
});

test("archiving an appended order reconciles the loaded range", async ({ page }) => {
  await mockOrders(page);
  await page.goto("/?section=orders");
  await expect(rows(page)).toHaveCount(20);
  await scrollToEnd(page);
  await expect(rows(page)).toHaveCount(40);
  await rows(page).filter({ hasText: "26-1025" }).locator("input[type=checkbox]").check();
  await page.getByRole("button", { name: "Удалить выбранные" }).click();
  await page.getByRole("dialog", { name: "Удаление заказов" }).getByRole("button", { name: "Переместить в архив" }).click();
  await expect(rows(page).filter({ hasText: "26-1025" })).toHaveCount(0);
  await expect(rows(page)).toHaveCount(40);
  await expect(rows(page).last()).toContainText("26-1041");
});
