import { expect, test, type Page } from "@playwright/test";

async function mockInboxWithMessage(page: Page, options: { clipboardReject?: boolean; templateFailure?: boolean } = {}) {
  await page.addInitScript((clipboardReject) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => clipboardReject ? Promise.reject(new Error("clipboard rejected")) : undefined },
    });
  }, Boolean(options.clipboardReject));
  const conversation = {
    id: "conversation-toast",
    channel: "FACEBOOK",
    lastMessageAt: "2026-09-13T08:00:00.000Z",
    unreadCount: 0,
    unreadVersion: 0,
    messages: [{ content: "Текст для копирования", createdAt: "2026-09-13T08:00:00.000Z" }],
  };
  const client = {
    id: "client-toast",
    displayName: "Тестовый клиент",
    status: "ACTIVE",
    source: "FACEBOOK",
    preferredChannel: "FACEBOOK",
    orders: [],
    buyerSummary: { purchaseCount: 0, paymentTotals: [] },
    linkedChannels: ["FACEBOOK"],
    conversations: [conversation],
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST" && path === "/api/communications/templates") {
      if (options.templateFailure) {
        await route.fulfill({ status: 500, json: { message: "Не удалось сохранить шаблон" } });
        return;
      }
      await route.fulfill({ json: { id: "template-toast", name: "Шаблон ответа", content: "Исходящий ответ", channel: "FACEBOOK", language: "ru" } });
      return;
    }
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 405, json: { message: "Unexpected test mutation" } });
      return;
    }
    if (path === "/api/auth/me") {
      await route.fulfill({ json: { user: { email: "qa@yoleotard.local", displayName: "QA Operator", role: "OWNER" } } });
      return;
    }
    if (path === "/api/branding") {
      await route.fulfill({ json: {} });
      return;
    }
    if (path === "/api/communications/templates") {
      await route.fulfill({ json: [] });
      return;
    }
    if (path === "/api/communications") {
      await route.fulfill({ json: { items: [client], total: 1, hasMore: false, channelCounts: { FACEBOOK: 1 } } });
      return;
    }
    if (path === "/api/communications/client-toast") {
      await route.fulfill({ json: { messages: [
        { id: "message-toast", content: "Текст для копирования", channel: "FACEBOOK", direction: "INBOUND", status: "SENT", createdAt: "2026-09-13T08:00:00.000Z" },
        { id: "message-template", content: "Исходящий ответ", channel: "FACEBOOK", direction: "OUTBOUND", status: "SENT", createdAt: "2026-09-13T08:01:00.000Z" },
      ] } });
      return;
    }
    if (path === "/api/clients/client-toast") {
      await route.fulfill({ json: { id: "client-toast", displayName: "Тестовый клиент", athletes: [], workTasks: [] } });
      return;
    }
    await route.fulfill({ status: 501, json: { message: `Unexpected test route: ${path}` } });
  });
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`копирование показывает компактное временное уведомление ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockInboxWithMessage(page);
    await page.goto("/?section=inbox");

    const orderFilter = page.locator("select[aria-label='Фильтр по заказам']");
    await expect(orderFilter).toHaveClass(/mantine-NativeSelect-input/);
    if (viewport.width < 700) {
      await page.locator(".communications-mobile-list-toggle").click();
      await expect(page.locator(".communications-clients.mobile-open")).toBeVisible();
    }
    await page.screenshot({ path: testInfo.outputPath(`inbox-controls-${viewport.width}x${viewport.height}.png`), fullPage: false });

    if (viewport.width >= 1600) {
      const headerMenu = page.locator(".communications-header-menu").first();
      await headerMenu.click();
      await expect(page.getByRole("menuitem", { name: "Сбросить ширину" })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`inbox-controls-menu-${viewport.width}x${viewport.height}.png`), fullPage: false });
      await page.keyboard.press("Escape");
      await expect(headerMenu).toBeFocused();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(headerMenu).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath(`inbox-controls-focus-${viewport.width}x${viewport.height}.png`), fullPage: false });
    } else {
      await page.screenshot({ path: testInfo.outputPath(`inbox-controls-menu-${viewport.width}x${viewport.height}.png`), fullPage: false });
      const createClient = page.getByRole("button", { name: "Новый клиент" });
      await createClient.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(createClient).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath(`inbox-controls-focus-${viewport.width}x${viewport.height}.png`), fullPage: false });
    }
    if (viewport.width < 700) await page.reload();

    const message = page.getByText("Текст для копирования", { exact: true }).last();
    await expect(message).toBeVisible();
    const article = message.locator("xpath=ancestor::article[1]");
    await article.hover();
    await article.getByRole("button", { name: "Копировать сообщение" }).click();

    const toastText = page.getByText("Сообщение скопировано", { exact: true });
    await expect(toastText).toBeVisible();
    const toast = toastText.locator("xpath=ancestor::*[contains(@class,'mantine-Notification-root')][1]");
    const box = await toast.boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(360);
    await expect(toast.getByRole("button", { name: "Закрыть" })).toBeVisible();
    await expect(page.locator(".communications-template-notice")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`inbox-copy-notification-${viewport.width}x${viewport.height}.png`), fullPage: false });
    await page.waitForTimeout(3_250);
    await expect(toastText).toHaveCount(0);
  });
}

test("сохранение ответа как шаблона показывает временное уведомление", async ({ page }) => {
  await mockInboxWithMessage(page);
  await page.goto("/?section=inbox");
  page.once("dialog", (dialog) => dialog.accept("Шаблон ответа"));
  const message = page.getByText("Исходящий ответ", { exact: true });
  await message.locator("xpath=ancestor::article[1]").hover();
  await page.getByRole("button", { name: "Сохранить как шаблон" }).click();
  await expect(page.getByText("Ответ сохранён как шаблон", { exact: true })).toBeVisible();
});

test("ошибка копирования остаётся постоянной и не превращается в toast", async ({ page }) => {
  await mockInboxWithMessage(page, { clipboardReject: true });
  await page.goto("/?section=inbox");
  const message = page.getByText("Текст для копирования", { exact: true }).last();
  const article = message.locator("xpath=ancestor::article[1]");
  await article.hover();
  await article.getByRole("button", { name: "Копировать сообщение" }).click();
  await expect(page.locator(".phase2-error")).toContainText("Не удалось скопировать сообщение");
  await expect(page.getByText("Сообщение скопировано", { exact: true })).toHaveCount(0);
});

test("ошибка сохранения шаблона остаётся постоянной", async ({ page }) => {
  await mockInboxWithMessage(page, { templateFailure: true });
  await page.goto("/?section=inbox");
  page.once("dialog", (dialog) => dialog.accept("Шаблон ответа"));
  const message = page.getByText("Исходящий ответ", { exact: true });
  await message.locator("xpath=ancestor::article[1]").hover();
  await page.getByRole("button", { name: "Сохранить как шаблон" }).click();
  await expect(page.locator(".phase2-error")).toContainText("Не удалось сохранить шаблон");
  await expect(page.getByText("Ответ сохранён как шаблон", { exact: true })).toHaveCount(0);
});
