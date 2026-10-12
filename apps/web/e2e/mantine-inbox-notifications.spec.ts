import { expect, test, type Page } from "@playwright/test";

async function mockInboxWithMessage(page: Page, options: { clipboardReject?: boolean; templateFailure?: boolean; instagramFailure?: boolean } = {}) {
  await page.addInitScript((clipboardReject) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => clipboardReject ? Promise.reject(new Error("clipboard rejected")) : undefined },
    });
  }, Boolean(options.clipboardReject));
  const activeChannel = options.instagramFailure ? "INSTAGRAM" : "FACEBOOK";
  const conversation = {
    id: "conversation-toast",
    channel: activeChannel,
    lastMessageAt: "2026-09-13T08:00:00.000Z",
    unreadCount: 0,
    unreadVersion: 0,
    messages: [{ content: "Текст для копирования", createdAt: "2026-09-13T08:00:00.000Z" }],
  };
  const client = {
    id: "client-toast",
    displayName: "Тестовый клиент",
    status: "ACTIVE",
    source: activeChannel,
    preferredChannel: activeChannel,
    waitingForReply: true,
    orders: [],
    buyerSummary: { purchaseCount: 0, paymentTotals: [] },
    linkedChannels: [activeChannel],
    conversations: [conversation],
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (options.instagramFailure && route.request().method() === "POST" && path === "/api/communications/client-toast/messages") {
      const request = route.request().postDataJSON();
      await route.fulfill({ json: { id: "failed-instagram", content: request.content, channel: "INSTAGRAM", direction: "OUTBOUND", status: "FAILED", createdAt: "2026-09-14T13:31:00.000Z", metadata: { reason: "PERMISSION_REQUIRED" } } });
      return;
    }
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
      await route.fulfill({ json: { items: [client], total: 1, hasMore: false, scopeCounts: { all: 1, unread: 0, waiting: 1 }, channelCounts: { [activeChannel]: 1 } } });
      return;
    }
    if (path === "/api/communications/client-toast") {
      await route.fulfill({ json: { messages: [
        { id: "message-toast", content: "Текст для копирования", channel: activeChannel, direction: "INBOUND", status: "SENT", createdAt: "2026-09-13T08:00:00.000Z", ...(options.instagramFailure ? { metadata: { replyTo: { kind: "story", storyUrl: "/api/communications/files/story.png", storyMediaType: "image" } } } : {}) },
        { id: "message-template", content: "Исходящий ответ", channel: activeChannel, direction: "OUTBOUND", status: "SENT", createdAt: "2026-09-13T08:01:00.000Z" },
        ...(options.instagramFailure ? [{ id: "draft-instagram", content: "Текст для повторной отправки", channel: "INSTAGRAM", direction: "OUTBOUND", status: "DRAFT", createdAt: "2026-09-14T13:30:00.000Z", metadata: { composerDraftKey: "draft-key" } }] : []),
      ] } });
      return;
    }
    if (path === "/api/communications/files/story.png") {
      await route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
      return;
    }
    if (path === "/api/clients/client-toast") {
      await route.fulfill({ json: { id: "client-toast", displayName: "Тестовый клиент", athletes: [], workTasks: [] } });
      return;
    }
    await route.fulfill({ status: 501, json: { message: `Unexpected test route: ${path}` } });
  });
}

test("AI предложение во Входящих по умолчанию свернуто и неактивно", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1536, height: 1024 });
  await mockInboxWithMessage(page);
  await page.goto("/?section=inbox");

  const toggle = page.getByRole("button", { name: /Предложение ответа от AI/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#communications-ai-panel-body")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ответ AI" })).toHaveCount(0);
  const waitingRequest=page.waitForRequest(request=>request.url().includes("/api/communications?")&&request.url().includes("conversationScope=WAITING"));
  await page.getByRole("complementary",{name:"Список клиентов"}).getByRole("button",{name:"Ждут ответа 1",exact:true}).click();
  await waitingRequest;
  await page.screenshot({ path: testInfo.outputPath("inbox-approved-collapsed-1536x1024.png"), fullPage: false });

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#communications-ai-panel-body")).toBeVisible();
  await expect(page.getByLabel("Язык ответа")).toBeVisible();
  await expect(page.getByLabel("Язык ответа")).toHaveValue("auto");
  await expect(page.getByRole("button", { name: "Ответ AI" })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("inbox-approved-expanded-1536x1024.png"), fullPage: false });

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#communications-ai-panel-body")).toHaveCount(0);
});

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`копирование показывает компактное временное уведомление ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockInboxWithMessage(page);
    await page.goto("/?section=inbox");

    const orderFilter = page.locator("select[aria-label='Фильтр по заказам']");
    await expect(orderFilter).toHaveClass(/mantine-NativeSelect-input/);
    if (viewport.width < 700) {
      await expect(page.locator(".communications-message-content").filter({hasText:"Текст для копирования"})).toBeVisible();
      const listToggle=page.locator(".communications-mobile-list-toggle");
      await expect(listToggle).toBeVisible();
      await listToggle.evaluate((button:HTMLButtonElement)=>button.click());
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

test("ошибка копирования показывается компактным временным toast", async ({ page }) => {
  await mockInboxWithMessage(page, { clipboardReject: true });
  await page.goto("/?section=inbox");
  const message = page.getByText("Текст для копирования", { exact: true }).last();
  const article = message.locator("xpath=ancestor::article[1]");
  await article.hover();
  await article.getByRole("button", { name: "Копировать сообщение" }).click();
  const errorText = page.getByText("Не удалось скопировать сообщение", { exact: true });
  await expect(errorText).toBeVisible();
  const toast = errorText.locator("xpath=../..");
  expect((await toast.boundingBox())?.width ?? 0).toBeLessThanOrEqual(360);
  await expect(toast.getByRole("button", { name: "Закрыть" })).toBeVisible();
});

test("ошибка сохранения шаблона показывается стандартным toast", async ({ page }) => {
  await mockInboxWithMessage(page, { templateFailure: true });
  await page.goto("/?section=inbox");
  page.once("dialog", (dialog) => dialog.accept("Шаблон ответа"));
  const message = page.getByText("Исходящий ответ", { exact: true });
  await message.locator("xpath=ancestor::article[1]").hover();
  await page.getByRole("button", { name: "Сохранить как шаблон" }).click();
  const toast = page.getByRole("alert").filter({ hasText: "Не удалось сохранить шаблон" });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole("button", { name: "Закрыть" })).toBeVisible();
  await expect(page.getByText("Ответ сохранён как шаблон", { exact: true })).toHaveCount(0);
});

test("отказ Instagram сохраняет текст для повтора, скрывает черновик и показывает превью истории", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockInboxWithMessage(page, { instagramFailure: true });
  await page.goto("/?section=inbox");
  const composer = page.locator(".communications-compose textarea");
  await expect(page.getByText("Черновик", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Фото или видео истории" })).toBeVisible();
  await composer.fill("Текст для повторной отправки");
  await page.getByRole("button", { name: /^Отправить$/ }).click();
  await expect(page.getByText("Instagram не разрешил отправку. Переподключите страницу и подтвердите доступ к сообщениям", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue("Текст для повторной отправки");
  await expect(page.getByRole("alert").filter({ hasText: "Instagram не разрешил отправку" })).toBeVisible();
});
