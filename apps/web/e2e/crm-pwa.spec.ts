import { devices, expect, test, type Page } from "@playwright/test";

async function mockSession(page: Page) {
  let authenticated = false;
  await page.route("**/api/**", async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/auth/me") {
      return authenticated
        ? route.fulfill({ json: { user: { id: "test-owner", role: "OWNER", displayName: "Test Owner" } } })
        : route.fulfill({ status: 401, json: {} });
    }
    return route.fulfill({ status: 503, json: {} });
  });
  return () => { authenticated = true; };
}

async function dispatchInstallOffer(page: Page) {
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: async () => { document.body.dataset.pwaPrompt = "opened"; },
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });
    window.dispatchEvent(event);
  });
}

test("manifest refers to a standalone CRM and the packaged icons", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest).toMatchObject({ id: "/", name: "YOleotard CRM", display: "standalone", start_url: "/?section=overview" });
  for (const icon of manifest.icons) {
    const file = await request.get(icon.src);
    expect(file.headers()["content-type"]).toContain("image/png");
    const body = await file.body();
    const [size] = icon.sizes.split("x");
    expect(body.readUInt32BE(16)).toBe(Number(size));
    expect(body.readUInt32BE(20)).toBe(Number(size));
  }
});

test("Chromium install offer respects authentication, dismissal and installed state", async ({ page }) => {
  const signIn = await mockSession(page);
  await page.goto("/");
  await expect(page.locator(".phase2-login")).toBeVisible();
  await dispatchInstallOffer(page);
  await expect(page.getByRole("button", { name: "Установить", exact: true })).toHaveCount(0);
  signIn();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const install = page.getByRole("button", { name: "Установить", exact: true });
  await install.click();
  await expect(page.locator("body")).toHaveAttribute("data-pwa-prompt", "opened");
  await expect(install).toHaveCount(0);
  await page.goto("/?section=settings");
  await expect(install).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(page.getByText("В этом браузере ранее устанавливали CRM.")).toBeVisible();
  await page.reload();
  await expect(install).toHaveCount(0);
  await page.getByRole("button", { name: "Инструкция по установке" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test.describe("iPhone layout and instructions", () => {
  const { defaultBrowserType: _, ...iphone } = devices["iPhone 13"];
  test.use(iphone);

  test("shows the share instructions and retains access after declining", async ({ page }) => {
    (await mockSession(page))();
    await page.goto("/");
    await page.getByRole("button", { name: "Установить", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/В Safari нажмите/)).toBeVisible();
    await dialog.getByRole("button", { name: "Закрыть" }).click();
    await page.getByRole("button", { name: "Позже", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "Установить", exact: true })).toHaveCount(0);
    await page.goto("/?section=settings");
    await expect(page.locator(".crm-topbar")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Установить", exact: true })).toBeVisible();
  });
});

test.describe("Android Chrome layout", () => {
  const { defaultBrowserType: _, ...pixel } = devices["Pixel 7"];
  test.use(pixel);

  test("forwards a tap to the native installation event", async ({ page }) => {
    (await mockSession(page))();
    await page.goto("/");
    await expect(page.locator(".crm-topbar")).toBeVisible();
    await dispatchInstallOffer(page);
    await page.getByRole("button", { name: "Установить", exact: true }).tap();
    await expect(page.locator("body")).toHaveAttribute("data-pwa-prompt", "opened");
  });
});
