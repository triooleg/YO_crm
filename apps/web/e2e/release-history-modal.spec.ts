import { expect, test, type Page } from "@playwright/test";

async function mockReadOnlyApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method !== "GET") {
      await route.fulfill({ status: 405, json: { error: "Unexpected test method" } });
      return;
    }

    const knownResponses = new Map<string, unknown>([
      ["/api/auth/me", { user: { email: "qa@yoleotard.local", displayName: "QA Operator", role: "OWNER" } }],
      ["/api/branding", {}],
      ["/api/clients", []],
    ]);
    if (!knownResponses.has(pathname)) {
      await route.fulfill({ status: 501, json: { error: `Unexpected test route: ${pathname}` } });
      return;
    }

    await route.fulfill({ json: knownResponses.get(pathname) });
  });
}

test.beforeEach(async ({ page }) => {
  await mockReadOnlyApi(page);
  await page.goto("/");
});

test("журнал сборок закрывается всеми штатными способами и возвращает фокус", async ({ page }) => {
  const versionButton = page.getByRole("button", { name: /CRM v/ });
  const dialog = page.getByRole("dialog");

  await versionButton.click();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Закрыть журнал изменений" })).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(versionButton).toBeFocused();

  await versionButton.click();
  await page.locator(".mantine-Modal-overlay").click({ position: { x: 4, y: 4 } });
  await expect(dialog).toBeHidden();

  await versionButton.click();
  await page.getByRole("button", { name: "Закрыть журнал изменений" }).click();
  await expect(dialog).toBeHidden();
});

for (const viewport of [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`журнал сборок помещается в viewport: ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.getByRole("button", { name: /CRM v/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.width).toBeLessThanOrEqual(viewport.width);

    const hasDocumentOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasDocumentOverflow).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath(`release-history-${viewport.width}x${viewport.height}.png`),
      fullPage: true,
    });
  });
}
