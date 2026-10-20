import { expect, test, type Page } from "@playwright/test";

async function mockInbox(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method !== "GET") {
      await route.fulfill({ status: 405, json: { message: "Unexpected test mutation" } });
      return;
    }
    if (url.pathname === "/api/auth/me") {
      await route.fulfill({ json: { user: { email: "qa@yoleotard.local", displayName: "QA Operator", role: "OWNER" } } });
      return;
    }
    if (url.pathname === "/api/branding") {
      await route.fulfill({ json: {} });
      return;
    }
    if (url.pathname === "/api/communications/templates") {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname === "/api/communications") {
      await route.fulfill({ json: { items: [], total: 0, hasMore: false, channelCounts: {} } });
      return;
    }
    await route.fulfill({ status: 501, json: { message: `Unexpected test route: ${url.pathname}` } });
  });
}

test("оператор очищает общий и Inbox-поиск отдельным крестиком", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await mockInbox(page);
  await page.goto("/?section=inbox");

  const globalSearch = page.locator(".crm-topbar-search");
  const inboxSearch = page.locator(".communications-search-field");
  const globalInput = globalSearch.getByRole("searchbox");
  const inboxInput = inboxSearch.getByRole("searchbox");

  await globalSearch.locator(".crm-search-leading-icon").click();
  await expect(globalInput).toBeFocused();
  await inboxInput.fill("Eve Emeterio");
  await expect(globalInput).toHaveValue("Eve Emeterio");
  const globalClearBox = await globalSearch.getByRole("button", { name: "Очистить поиск" }).boundingBox();
  expect(globalClearBox?.width ?? 0).toBeGreaterThanOrEqual(30);
  expect(globalClearBox?.height ?? 0).toBeGreaterThanOrEqual(30);
  await page.screenshot({ path: testInfo.outputPath("search-clear-desktop.png"), fullPage: true });
  await inboxSearch.getByRole("button", { name: "Очистить поиск" }).click();
  await expect(inboxInput).toHaveValue("");
  await expect(globalInput).toHaveValue("");
  await expect(inboxInput).toBeFocused();
  await expect(inboxSearch.getByRole("button", { name: "Очистить поиск" })).toBeHidden();

  await globalInput.fill("Yolanda Yao");
  await expect(inboxInput).toHaveValue("Yolanda Yao");
  await globalSearch.getByRole("button", { name: "Очистить поиск" }).click();
  await expect(globalInput).toHaveValue("");
  await expect(inboxInput).toHaveValue("");
  await expect(globalInput).toBeFocused();
  await expect(globalSearch.getByRole("button", { name: "Очистить поиск" })).toBeHidden();
});

test("крестики поиска сохраняют геометрию на экране 1366×768", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockInbox(page);
  await page.goto("/?section=inbox");

  const inboxInput = page.locator(".communications-search-field").getByRole("searchbox");
  await inboxInput.fill("Eve Emeterio");
  await expect(page.locator(".crm-topbar-search").getByRole("button", { name: "Очистить поиск" })).toBeVisible();
  await expect(page.locator(".communications-search-field").getByRole("button", { name: "Очистить поиск" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("search-clear-1366x768.png"), fullPage: true });
});

test("крестик Inbox-поиска остаётся доступным на мобильном экране", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockInbox(page);
  await page.goto("/?section=inbox");
  await page.getByRole("button", { name: "Чаты" }).click();

  const inboxSearch = page.locator(".communications-search-field");
  const input = inboxSearch.getByRole("searchbox");
  await input.fill("Eve");
  const clear = inboxSearch.getByRole("button", { name: "Очистить поиск" });
  await expect(clear).toBeVisible();
  const box = await clear.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(40);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
  await page.screenshot({ path: testInfo.outputPath("search-clear-mobile.png"), fullPage: true });
  await clear.click();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});
