import { expect, test, type Locator, type Page } from "@playwright/test";

const order = {
  id: "order-visual",
  number: "YO-26-0222",
  priceMinor: 32000,
  depositRequiredMinor: 16000,
  currency: "EUR",
  requiredDeliveryAt: "2026-10-15T12:00:00.000Z",
  client: { displayName: "Visual Client", country: "Spain", language: "en" },
  payments: [],
  invoices: [],
};

const finance = {
  month: "2026-09",
  currency: "EUR",
  orders: [order],
  categories: [{ id: "category-materials", name: "Материалы" }],
  expenses: [],
  categoryBreakdown: [],
  monthlyTrend: [],
  invoices: [],
  current: { receivedMinor: 0, expensesMinor: 0, profitMinor: 0 },
  previous: { receivedMinor: 0, expensesMinor: 0, profitMinor: 0 },
};

async function mockOperationalApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") return route.fulfill({ status: 405, json: { message: "Visual test is read-only" } });
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { email: "qa@yoleotard.local", displayName: "QA", role: "OWNER" } } });
    if (path === "/api/branding") return route.fulfill({ json: {} });
    if (path === "/api/finance") return route.fulfill({ json: finance });
    if (path === "/api/finance/settings") return route.fulfill({ json: [] });
    if (path === "/api/tasks/board") return route.fulfill({ json: {
      columns: [{ id: "column-new", name: "Новые", color: "#7047eb", isDone: false, sortOrder: 0, tasks: [] }],
      users: [{ id: "user-owner", displayName: "QA", role: "OWNER" }],
    } });
    return route.fulfill({ status: 501, json: { message: `Unexpected ${request.method()} ${path}` } });
  });
}

async function assertModal(page: Page, dialog: Locator) {
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.height).toBeLessThanOrEqual(viewport.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
}

for (const viewport of [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`операционные CrmModal: finance, invoice и task — ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockOperationalApi(page);

    await page.goto("/?section=finance");
    await page.getByRole("button", { name: "Расход", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Новый расход" });
    await assertModal(page, dialog);
    await dialog.screenshot({ path: testInfo.outputPath(`finance-expense-modal-${viewport.width}x${viewport.height}.png`) });
    await dialog.getByRole("button", { name: "Закрыть" }).click();

    await page.getByRole("button", { name: "Создать", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Редактор инвойса" });
    await assertModal(page, dialog);
    await dialog.screenshot({ path: testInfo.outputPath(`invoice-editor-modal-${viewport.width}x${viewport.height}.png`) });
    await dialog.getByRole("button", { name: "Закрыть" }).click();

    await page.goto("/?section=tasks");
    await page.getByRole("button", { name: "+ Новая задача" }).click();
    dialog = page.getByRole("dialog", { name: "+ Новая задача" });
    await assertModal(page, dialog);
    await dialog.screenshot({ path: testInfo.outputPath(`task-modal-${viewport.width}x${viewport.height}.png`) });
  });
}
