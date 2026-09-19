import { expect, test, type Page } from "@playwright/test";

const auth = { user: { email: "qa@yoleotard.local", displayName: "QA Operator", role: "OWNER" } };

async function mockLoadError(page: Page, endpoint: string, message: string) {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/auth/me") {
      await route.fulfill({ json: auth });
      return;
    }
    if (pathname === "/api/branding") {
      await route.fulfill({ json: {} });
      return;
    }
    if (pathname === endpoint) {
      await route.fulfill({ status: 503, json: { message } });
      return;
    }
    await route.fulfill({ status: 501, json: { message: `Unexpected test route: ${pathname}` } });
  });
  return runtimeErrors;
}

const workspaces = [
  {
    section: "finance",
    root: ".finance-page",
    endpoint: "/api/finance",
    message: "Не удалось загрузить финансы",
  },
  {
    section: "tasks",
    root: ".tasks-page",
    endpoint: "/api/tasks/board",
    message: "Не удалось загрузить задачи",
  },
] as const;

for (const viewport of [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  for (const workspace of workspaces) {
    test(`${workspace.section}: ошибка загрузки использует постоянный Mantine Alert — ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const runtimeErrors = await mockLoadError(page, workspace.endpoint, workspace.message);
      await page.goto(`/?section=${workspace.section}`);

      await expect(page.locator(".crm-version")).toContainText("0.1.26");
      const alert = page.locator(workspace.root).getByRole("alert");
      await expect(alert).toHaveText(workspace.message);
      await expect(alert).toHaveClass(/mantine-Alert-root/);
      await expect(alert.locator(".mantine-Alert-message")).toHaveCSS("font-size", "16px");
      await expect(alert.getByRole("button", { name: "Закрыть уведомление" })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      expect(runtimeErrors).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`mantine-alert-${workspace.section}-${viewport.width}x${viewport.height}.png`), fullPage: false });
    });
  }
}
