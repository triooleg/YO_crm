import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { join } from "node:path";

const screenshotPath = (testInfo: TestInfo, name: string) =>
  process.env.YO_CRM_VISUAL_DIR ? join(process.env.YO_CRM_VISUAL_DIR, name) : testInfo.outputPath(name);

async function mockSettings(page: Page) {
  const writes: Array<{ path: string; body: unknown }> = [];
  const production = [
    { section: "production", key: "defaultDurationDays", value: 7 },
    { section: "production", key: "shippingLeadDays", value: 2 },
  ];
  const branding = { logoUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", useInHeader: true, useInMessages: false };
  const aiAssistant = { enabled: false, allowClientContext: false, model: "gpt-4.1-mini", defaultLanguage: "ru", tone: "деловой", systemPrompt: "", connected: false, apiKeySource: "none" };
  const aiControl = {
    serverPolicy: { aiEnabled: true, provider: "openai", analysisModel: "gpt-4.1-mini", replyModel: "gpt-4.1-mini", embeddingModel: "text-embedding-3-small" },
    effective: { masterEnabled: false, mode: "OFF", autoReplies: false, serverBlocked: false, summaryDetailLevel: "DETAILED" },
    settings: [], worker: { running: false }, outbox: { status: "healthy", queued: 0 }, lastSuccessfulRun: null,
    statistics24h: { messagesQueued: 0, analysesCompleted: 0, failed: 0, retryCount: 0, averageLatencyMs: 0, inputTokens: 0, outputTokens: 0, estimatedCostMinor: 0, automaticRepliesSent: 0 },
  };
  const integrations = {
    deliveryAvailable: true,
    meta: { enabled: false, status: "DISCONNECTED", appId: "", pageId: "", pageName: "", instagramAccountId: "", instagramAppId: "", instagramStatus: "DISCONNECTED", instagramSubscriptionVerifiedAt: null, lastInstagramWebhookAt: null, whatsappPhoneNumberId: "", appSecretConfigured: false, instagramAppSecretConfigured: false, verifyTokenConfigured: false, verifyTokenUnsafe: false, pageAccessTokenConfigured: false, whatsappAccessTokenConfigured: false, subscriptionVerifiedAt: null, lastWebhookAt: null, webhookUrl: "https://crm.test/meta" },
    chatwoot: { enabled: true, status: "CONNECTED", baseUrl: "https://chatwoot.test", accountId: "1", inboxId: "2", accessTokenConfigured: true, webhookSecretConfigured: true, webhookUrl: "https://crm.test/chatwoot" },
    email: { enabled: true, status: "CONNECTED", smtpHost: "smtp.test", smtpPort: 465, imapHost: "imap.test", imapPort: 993, username: "mail@test.local", fromAddress: "mail@test.local", signature: "YO", passwordConfigured: true },
  };
  const keycrmSettings = { enabled: true, endpoint: "https://openapi.keycrm.app/v1", apiTokenConfigured: true, connectionStatus: "VERIFIED", verifiedAt: "2026-10-11T09:00:00.000Z", lastErrorCode: null, pageSize: 50, defaultCurrency: "EUR", defaultOrderType: "CUSTOM_ORDER", configRevision: 3 };
  const exchangeRates = { provider: "NBU", officialUrl: "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json", supportedPairs: ["EUR/USD", "EUR/UAH", "USD/UAH"], cache: { effectiveDate: "2026-10-10", fetchedAt: "2026-10-10T12:00:00.000Z", rates: [{ baseCurrency: "EUR", quoteCurrency: "UAH", decimal: "48.1234" }, { baseCurrency: "USD", quoteCurrency: "UAH", decimal: "41.2345" }, { baseCurrency: "EUR", quoteCurrency: "USD", decimal: "1.167059" }] } };
  const keycrmRuns = [
    { id: "run-current", mode: "DRY_RUN", status: "COMPLETED", requestedFrom: null, requestedTo: "2026-10-11T09:00:00.000Z", currentPage: 3, totalPages: 3, totalRemote: 124, scannedCount: 124, createdCount: 117, updatedCount: 4, skippedCount: 3, failedCount: 0, errorMessage: null, createdAt: "2026-10-11T09:00:00.000Z", completedAt: "2026-10-11T09:03:00.000Z", rolledBackAt: null, rollbackEligible: false, rollbackBlockedReason: null, startedBy: { displayName: "QA Operator" }, _count: { issues: 0 } },
    { id: "run-older", mode: "APPLY", status: "PARTIAL", requestedFrom: "2026-10-01T00:00:00.000Z", requestedTo: "2026-10-10T23:59:59.000Z", currentPage: 1, totalPages: 1, totalRemote: 12, scannedCount: 12, createdCount: 10, updatedCount: 1, skippedCount: 0, failedCount: 1, errorMessage: null, createdAt: "2026-10-10T10:00:00.000Z", completedAt: "2026-10-10T10:01:00.000Z", rolledBackAt: null, rollbackEligible: true, rollbackBlockedReason: null, startedBy: { displayName: "QA Operator" }, _count: { issues: 2 } },
  ];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") {
      return route.fulfill({ json: { user: { email: "qa@yoleotard.local", displayName: "QA Operator", role: "OWNER" } } });
    }
    if (path === "/api/auth/account" && request.method() === "PATCH") {
      const body = request.postDataJSON();
      writes.push({ path, body });
      return route.fulfill({ json: { user: { email: body.email, displayName: "QA Operator", role: "OWNER" } } });
    }
    if (path === "/api/branding" && request.method() === "GET") return route.fulfill({ json: branding });
    if (path === "/api/branding" && request.method() === "PUT") {
      const body = request.postDataJSON();
      writes.push({ path, body });
      return route.fulfill({ json: { ...branding, ...body, logoUrl: body.removeLogo ? null : branding.logoUrl } });
    }
    if (path === "/api/finance/settings" && request.method() === "GET") return route.fulfill({ json: production });
    if (path === "/api/finance/exchange-rates" && request.method() === "GET") return route.fulfill({ json: exchangeRates });
    if (path === "/api/finance/settings" && request.method() === "PATCH") {
      const body = request.postDataJSON();
      writes.push({ path, body });
      return route.fulfill({ json: { saved: true } });
    }
    if (path === "/api/finance/settings/production" && request.method() === "PATCH") {
      const body = request.postDataJSON();
      writes.push({ path, body });
      return route.fulfill({ json: production.map(item => ({ ...item, value: body[item.key] })) });
    }
    if (path === "/api/orders/maintenance/website-sales" && request.method() === "POST") {
      const body = request.postDataJSON();
      writes.push({ path, body });
      return route.fulfill({ json: body.dryRun ? { dryRun: true, matched: 1, updated: 0, orderNumbers: ["KC-701"], candidates: [{ orderId: "order-701", expectedUpdatedAt: "2026-10-10T12:00:00.000Z", expectedType: "CUSTOM_ORDER", expectedProductionSlotUpdatedAt: "2026-10-10T12:00:00.000Z", expectedSourceId: "2", expectedSourceName: "Сайт" }] } : { dryRun: false, matched: 1, updated: 1, orderNumbers: ["KC-701"], candidates: [] } });
    }
    if (path === "/api/ai-assistant/settings" && request.method() === "GET") return route.fulfill({ json: aiAssistant });
    if (path === "/api/ai-assistant/settings" && request.method() === "PATCH") {
      const body = request.postDataJSON();
      writes.push({ path, body });
      return route.fulfill({ json: { ...aiAssistant, ...body, connected: false, apiKeySource: "none" } });
    }
    if (path === "/api/communications/integrations" && request.method() === "GET") return route.fulfill({ json: integrations });
    if (path === "/api/keycrm/settings" && request.method() === "GET") return route.fulfill({ json: keycrmSettings });
    if (path === "/api/keycrm/sync-runs" && request.method() === "GET") return route.fulfill({ json: keycrmRuns });
    if (path === "/api/keycrm/sync-runs/run-current/issues" && request.method() === "GET") return route.fulfill({ json: [] });
    if (path === "/api/keycrm/sync-runs/run-older/issues" && request.method() === "GET") return route.fulfill({ json: [
      { id: "issue-1", externalOrderId: "675", code: "MISSING_PRODUCTION_ITEMS", message: "UNLOCALIZED_PROVIDER_MESSAGE", createdAt: "2026-10-10T10:01:00.000Z" },
      { id: "issue-2", externalOrderId: "675", code: "CLIENT_MERGE_SUGGESTION", message: "Найдена похожая карточка клиента", createdAt: "2026-10-10T10:01:00.000Z", details: { kind: "CLIENT_MERGE_SUGGESTION", importedClientId: "client-imported", keycrmBuyerId: "415", candidates: [{ clientId: "client-existing", displayName: "Вероника Петрова", reasons: ["EMAIL", "PHONE"] }] } },
    ] });
    if (path === "/api/communications/integrations/chatwoot" && request.method() === "PATCH") {
      const body = request.postDataJSON();
      writes.push({ path, body });
      return route.fulfill({ json: integrations.chatwoot });
    }
    if (path === "/api/ai-control/status" && request.method() === "GET") return route.fulfill({ json: aiControl });
    if (path === "/api/ai-control/settings" && request.method() === "PATCH") {
      const body = request.postDataJSON();
      writes.push({ path, body });
      aiControl.effective.summaryDetailLevel = String(body.value);
      return route.fulfill({ json: { saved: true } });
    }
    return route.fulfill({ status: 501, json: { message: `Unexpected test route: ${path}` } });
  });
  return writes;
}

for (const viewport of [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`KeyCRM sync settings remain usable — ${viewport.name}`, async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await mockSettings(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/?section=settings");
    await page.getByRole("tab", { name: "KeyCRM" }).click();
    const panel = page.locator("#settings-keycrm-panel");
    await expect(panel.getByRole("heading", { name: "Синхронизация с KeyCRM" })).toBeVisible();
    const keycrmToggleBox = await panel.locator('input[name="enabled"]').evaluate((input) => {
      const box = input.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });
    expect(keycrmToggleBox).toEqual({ width: 18, height: 18 });
    await expect(panel.getByRole("button", { name: /Проверка/ }).first()).toHaveAttribute("aria-pressed", "true");
    await panel.evaluate((element) => element.scrollTo({ top: 0 }));
    await page.screenshot({ path: screenshotPath(testInfo, `keycrm-settings-top-${viewport.width}x${viewport.height}.png`), fullPage: false });
    await panel.getByRole("button", { name: /Перенос/ }).last().click();
    await expect(panel.getByRole("button", { name: /Перенос/ }).last()).toHaveAttribute("aria-pressed", "true");
    const productionIssue = panel.getByText("KeyCRM не передал товары заказа. Начало производства не рассчитано: количество костюмов требует проверки оператором.");
    await expect(productionIssue).toBeVisible();
    await expect(panel.getByText("UNLOCALIZED_PROVIDER_MESSAGE")).toHaveCount(0);
    await productionIssue.scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshotPath(testInfo, `keycrm-production-issue-${viewport.width}x${viewport.height}.png`), fullPage: false });
    await panel.getByRole("button", { name: /Объединить карточки/ }).click();
    const mergeDialog = page.getByRole("dialog", { name: "Подтвердите объединение клиентов" });
    await expect(mergeDialog).toBeVisible();
    await page.screenshot({ path: screenshotPath(testInfo, `keycrm-merge-dialog-${viewport.width}x${viewport.height}.png`), fullPage: false });
    await mergeDialog.getByRole("button", { name: "Отмена" }).click();
    await panel.getByRole("button", { name: "Откатить неудачный перенос" }).click();
    const rollbackDialog = page.getByRole("dialog", { name: "Подтвердите откат переноса" });
    await expect(rollbackDialog).toBeVisible();
    await page.screenshot({ path: screenshotPath(testInfo, `keycrm-rollback-dialog-${viewport.width}x${viewport.height}.png`), fullPage: false });
    await rollbackDialog.getByRole("button", { name: "Отмена" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
    await page.screenshot({ path: screenshotPath(testInfo, `keycrm-settings-history-${viewport.width}x${viewport.height}.png`), fullPage: false });
  });
}

test("все разделы настроек используют доступные Mantine-контролы", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await mockSettings(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/?section=settings");

  const tabs = page.getByRole("tablist", { name: "Настройки" });
  const accountTab = tabs.getByRole("tab", { name: "Учётная запись" });
  await accountTab.focus();
  await page.keyboard.press("ArrowRight");
  const financeTab = tabs.getByRole("tab", { name: "Финансы" });
  await expect(financeTab).toHaveAttribute("aria-selected", "true");
  await expect(financeTab).toHaveAttribute("aria-controls", "settings-finance-panel");
  await expect(tabs.getByRole("tab", { name: "Заказы" })).toHaveAttribute("title", "Настройки раздела появятся позже");
  await expect(page.locator('select[name="defaultCurrency"]')).toHaveClass(/mantine-NativeSelect-input/);
  await expect(page.locator('textarea[name="sellerAddress"]')).toHaveClass(/mantine-Textarea-input/);

  await tabs.getByRole("tab", { name: "Каналы связи" }).click();
  await expect(page.locator('input[name="baseUrl"]')).toHaveClass(/mantine-TextInput-input/);
  await expect(page.locator('textarea[name="signature"]')).toHaveClass(/mantine-Textarea-input/);
  await expect(page.locator('input[name="enabled"]').first()).toHaveClass(/mantine-Checkbox-input/);
  await tabs.getByRole("tab", { name: "AI-помощник" }).click();
  await expect(page.locator('select[name="model"]')).toHaveClass(/mantine-NativeSelect-input/);
  await expect(page.locator('textarea[name="systemPrompt"]')).toHaveClass(/mantine-Textarea-input/);

  await tabs.getByRole("tab", { name: "Учётная запись" }).click();
  await expect(page.locator('input[name="currentPassword"]')).toHaveClass(/mantine-TextInput-input/);
  expect(pageErrors).toEqual([]);
});

test("панель каналов сохраняет доступную связь во время загрузки", async ({ page }) => {
  let releaseIntegrations!: () => void;
  const integrationsReady = new Promise<void>(resolve => { releaseIntegrations = resolve; });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { email: "qa@yoleotard.local", displayName: "QA Operator", role: "OWNER" } } });
    if (path === "/api/communications/integrations") {
      await integrationsReady;
      return route.fulfill({ status: 500, json: { message: "test complete" } });
    }
    return route.fulfill({ status: 501, json: { message: "Unexpected test route" } });
  });
  await page.goto("/?section=settings");
  const channelsTab = page.getByRole("tab", { name: "Каналы связи" });
  await channelsTab.click();
  const loadingPanel = page.locator("#settings-communications-panel");
  await expect(channelsTab).toHaveAttribute("aria-controls", "settings-communications-panel");
  await expect(loadingPanel).toHaveAttribute("aria-labelledby", "settings-communications-tab");
  releaseIntegrations();
});

test("мигрированные формы сохраняют прежние бизнес-payload", async ({ page }) => {
  const writes = await mockSettings(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/?section=settings");
  const tabs = page.getByRole("tablist", { name: "Настройки" });

  const account = page.locator("#settings-account-panel form");
  await account.locator('input[name="email"]').fill("owner@yoleotard.local");
  await account.locator('input[name="currentPassword"]').fill("current-password");
  await account.getByRole("button", { name: "Изменить учётные данные" }).click();
  await expect.poll(() => writes.length).toBe(1);

  await tabs.getByRole("tab", { name: "Финансы" }).click();
  const finance = page.locator("#settings-finance-panel form");
  await finance.locator('input[name="invoicePrefix"]').fill("YO-TEST");
  await finance.locator('select[name="defaultCurrency"]').selectOption("USD");
  await finance.locator('input[name="sellerName"]').fill("Yoleotard Test");
  await finance.locator('textarea[name="sellerAddress"]').fill("Kyiv");
  await finance.locator('input[name="depositPercent"]').fill("55");
  await finance.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect.poll(() => writes.length).toBe(6);

  await tabs.getByRole("tab", { name: "Каналы связи" }).click();
  const chatwoot = page.locator('form').filter({ has: page.locator('input[name="baseUrl"]') });
  await chatwoot.locator('input[name="enabled"]').uncheck();
  await chatwoot.locator('input[name="accessToken"]').fill("");
  await chatwoot.locator('input[name="webhookSecret"]').fill("");
  await chatwoot.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect.poll(() => writes.length).toBe(7);

  await tabs.getByRole("tab", { name: "AI-помощник" }).click();
  const ai = page.locator("#settings-ai-panel form");
  await ai.locator('input[name="enabled"]').check();
  await ai.getByRole("button", { name: "Сохранить настройки AI" }).click();
  await expect(ai.getByRole("alert")).toBeVisible();
  expect(writes).toHaveLength(7);
  await ai.locator('input[name="allowClientContext"]').check();
  await ai.locator('select[name="model"]').selectOption("gpt-4.1");
  await ai.locator('input[name="defaultLanguage"]').fill("ru");
  await ai.locator('input[name="tone"]').fill("краткий");
  await ai.locator('textarea[name="systemPrompt"]').fill("Отвечать по делу");
  await ai.getByRole("button", { name: "Сохранить настройки AI" }).click();
  await expect.poll(() => writes.length).toBe(8);

  expect(writes).toEqual([
    { path: "/api/auth/account", body: { currentPassword: "current-password", email: "owner@yoleotard.local" } },
    { path: "/api/finance/settings", body: { section: "finance", key: "invoicePrefix", value: "YO-TEST" } },
    { path: "/api/finance/settings", body: { section: "finance", key: "sellerName", value: "Yoleotard Test" } },
    { path: "/api/finance/settings", body: { section: "finance", key: "sellerAddress", value: "Kyiv" } },
    { path: "/api/finance/settings", body: { section: "finance", key: "defaultCurrency", value: "USD" } },
    { path: "/api/finance/settings", body: { section: "orders", key: "depositPercent", value: 55 } },
    { path: "/api/communications/integrations/chatwoot", body: { enabled: false, baseUrl: "https://chatwoot.test", accountId: "1", inboxId: "2", accessToken: "", webhookSecret: "" } },
    { path: "/api/ai-assistant/settings", body: { enabled: true, allowClientContext: true, model: "gpt-4.1", defaultLanguage: "ru", tone: "краткий", systemPrompt: "Отвечать по делу" } },
  ]);
});

for (const viewport of [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Mantine-контролы настроек сохраняют прежний payload — ${viewport.name}`, async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    const writes = await mockSettings(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/?section=settings");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

    const settingsTabs = page.getByRole("tablist", { name: "Настройки" });
    await page.screenshot({ path: screenshotPath(testInfo, `mantine-account-settings-${viewport.width}x${viewport.height}.png`), fullPage: true });
    await page.locator("#settings-account-panel").screenshot({ path: screenshotPath(testInfo, `mantine-account-panel-${viewport.width}x${viewport.height}.png`) });
    await settingsTabs.getByRole("tab", { name: "Финансы" }).click();
    const financePanel = page.locator("#settings-finance-panel");
    await expect(financePanel.getByRole("link", { name: "Открыть официальный источник" })).toBeVisible();
    await expect(financePanel.getByText("EUR/USD, EUR/UAH, USD/UAH")).toBeVisible();
    await page.screenshot({ path: screenshotPath(testInfo, `mantine-finance-settings-${viewport.width}x${viewport.height}.png`), fullPage: true });
    await financePanel.screenshot({ path: screenshotPath(testInfo, `mantine-finance-panel-${viewport.width}x${viewport.height}.png`) });
    const exchangeCard = financePanel.locator("section.settings-card").filter({ hasText: "Официальные курсы валют" });
    await exchangeCard.scrollIntoViewIfNeeded();
    await exchangeCard.screenshot({ path: screenshotPath(testInfo, `mantine-exchange-rates-${viewport.width}x${viewport.height}.png`) });
    await settingsTabs.getByRole("tab", { name: "Каналы связи" }).click();
    await page.screenshot({ path: screenshotPath(testInfo, `mantine-communications-settings-${viewport.width}x${viewport.height}.png`), fullPage: true });
    await page.locator("#settings-communications-panel").screenshot({ path: screenshotPath(testInfo, `mantine-communications-panel-${viewport.width}x${viewport.height}.png`) });
    const baseUrlBox = await page.locator('input[name="baseUrl"]').boundingBox();
    const signatureBox = await page.locator('textarea[name="signature"]').boundingBox();
    expect(baseUrlBox).not.toBeNull();
    expect(signatureBox).not.toBeNull();
    expect(baseUrlBox!.height).toBeGreaterThanOrEqual(38);
    expect(signatureBox!.height).toBeGreaterThanOrEqual(80);
    if (viewport.width <= 440) {
      const tabsBox = await settingsTabs.boundingBox();
      expect(tabsBox).not.toBeNull();
      expect(tabsBox!.height).toBeLessThanOrEqual(44);
      expect(await settingsTabs.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    }

    await settingsTabs.getByRole("tab", { name: "Производство" }).click();
    const productionPanel = page.locator("#settings-production-panel");
    await productionPanel.getByLabel("Срок выполнения заказа, дней").fill("12");
    await productionPanel.getByLabel("Резерв до отправки, дней").fill("4");
    const productionSave = productionPanel.getByRole("button", { name: "Сохранить настройки" });
    await expect(productionSave).toHaveClass(/mantine-Button-root/);
    await productionSave.click();
    await expect(productionPanel.getByRole("status")).toHaveText("Настройки сохранены");
    await page.screenshot({ path: screenshotPath(testInfo, `mantine-production-settings-${viewport.width}x${viewport.height}.png`), fullPage: true });
    await productionPanel.screenshot({ path: screenshotPath(testInfo, `mantine-production-panel-${viewport.width}x${viewport.height}.png`) });
    await productionPanel.getByRole("button", { name: "Проверить заказы" }).click();
    await expect(productionPanel.getByText("Найдено заказов: 1. KC-701")).toBeVisible();
    await productionPanel.getByRole("button", { name: "Применить коррекцию" }).click();
    const correctionDialog=page.getByRole("dialog", { name: "Подтвердите коррекцию заказов" });
    await expect(correctionDialog).toContainText("KC-701");
    await page.screenshot({ path: screenshotPath(testInfo, `website-sales-correction-${viewport.width}x${viewport.height}.png`), fullPage: false });
    await correctionDialog.getByRole("button", { name: "Применить коррекцию" }).click();
    await expect(productionPanel.getByText("Исправлено заказов: 1.")).toBeVisible();

    await page.getByRole("tab", { name: "Интерфейс" }).click();
    const brandingPanel = page.locator("#settings-interface-panel");
    const header = brandingPanel.getByRole("checkbox", { name: /Использовать в шапке CRM/ });
    const messages = brandingPanel.getByRole("checkbox", { name: /Использовать у исходящих сообщений/ });
    await expect(header).toHaveClass(/mantine-Checkbox-input/);
    const checkboxCards = brandingPanel.locator("label.crm-checkbox");
    await expect(checkboxCards).toHaveCount(2);
    await checkboxCards.nth(0).click({ position: { x: 3, y: 3 } });
    await checkboxCards.nth(1).click({ position: { x: 3, y: 3 } });
    await expect(header).not.toBeChecked();
    await expect(messages).toBeChecked();
    await brandingPanel.getByRole("button", { name: "Вернуть стандартный знак" }).click();
    await expect(brandingPanel.getByRole("status")).toHaveText("Логотип и места использования сохранены");
    await brandingPanel.getByRole("button", { name: "Сохранить настройки" }).click();
    await expect(brandingPanel.getByRole("status")).toHaveText("Логотип и места использования сохранены");
    await page.screenshot({ path: screenshotPath(testInfo, `mantine-interface-settings-${viewport.width}x${viewport.height}.png`), fullPage: true });
    await brandingPanel.screenshot({ path: screenshotPath(testInfo, `mantine-interface-panel-${viewport.width}x${viewport.height}.png`) });
    if (viewport.width <= 440) {
      const buttonBox = await brandingPanel.getByRole("button", { name: "Сохранить настройки" }).boundingBox();
      const panelBox = await brandingPanel.boundingBox();
      expect(buttonBox).not.toBeNull();
      expect(panelBox).not.toBeNull();
      expect(Math.abs(buttonBox!.width - (panelBox!.width - 36))).toBeLessThanOrEqual(2);
    }

    await settingsTabs.getByRole("tab", { name: "AI-помощник" }).click();
    const summarySelect = page.getByLabel("Формат сводки");
    await expect(summarySelect).toHaveClass(/mantine-NativeSelect-input/);
    await summarySelect.selectOption("COMPACT");
    await expect(page.getByRole("status", { name: "" }).filter({ hasText: "Настройка сохранена" })).toBeVisible();
    await summarySelect.locator("xpath=ancestor::*[self::section][1]").screenshot({ path: screenshotPath(testInfo, `mantine-summary-format-${viewport.width}x${viewport.height}.png`) });

    expect(writes).toEqual([
      { path: "/api/finance/settings/production", body: { defaultDurationDays: 12, shippingLeadDays: 4 } },
      { path: "/api/orders/maintenance/website-sales", body: { dryRun: true } },
      { path: "/api/orders/maintenance/website-sales", body: { dryRun: false, candidates: [{ orderId: "order-701", expectedUpdatedAt: "2026-10-10T12:00:00.000Z", expectedType: "CUSTOM_ORDER", expectedProductionSlotUpdatedAt: "2026-10-10T12:00:00.000Z", expectedSourceId: "2", expectedSourceName: "Сайт" }] } },
      { path: "/api/branding", body: { useInHeader: false, useInMessages: true, removeLogo: true } },
      { path: "/api/branding", body: { useInHeader: false, useInMessages: true, removeLogo: false } },
      { path: "/api/ai-control/settings", body: { key: "summaryDetailLevel", value: "COMPACT", scope: "GLOBAL" } },
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    expect(pageErrors).toEqual([]);
    await page.screenshot({ path: screenshotPath(testInfo, `mantine-ai-settings-${viewport.width}x${viewport.height}.png`), fullPage: true });
    await page.locator("#settings-ai-panel").screenshot({ path: screenshotPath(testInfo, `mantine-ai-panel-${viewport.width}x${viewport.height}.png`) });
  });
}


test('Finance settings never expose fallback values as loaded configuration after a failed read',async({page})=>{
 await mockSettings(page);await page.route('**/api/finance/settings',route=>route.fulfill({status:503,json:{message:'Settings offline'}}));
 await page.goto('/?section=settings');await page.getByRole('tablist',{name:'Настройки'}).getByRole('tab',{name:'Финансы',exact:true}).click();
 await expect(page.locator('#settings-finance-panel').getByRole('alert')).toContainText('Не удалось загрузить настройки');
 await expect(page.locator('#settings-finance-panel input')).toHaveCount(0);
});
test('KeyCRM first selected run loads issue details and does not report no issues on failure',async({page})=>{
 const calls:string[]=[];await mockSettings(page);
 await page.route('**/api/keycrm/sync-runs/*/issues',route=>{calls.push(route.request().url());return route.fulfill({status:503,json:{message:'Issue details offline'}})});
 await page.goto('/?section=settings');await page.getByRole('tablist',{name:'Настройки'}).getByRole('tab',{name:'KeyCRM',exact:true}).click();
 await expect.poll(()=>calls.length).toBeGreaterThan(0);await expect(page.locator('#settings-keycrm-panel').getByRole('alert')).toContainText('Issue details offline');
});


test('AI status distinguishes enabled configuration from measured health and queue history',async({page})=>{
 await mockSettings(page);await page.goto('/?section=settings');await page.getByRole('tablist',{name:'Настройки'}).getByRole('tab',{name:/AI/}).click();
 await expect(page.locator('#settings-ai-panel')).toContainText('Обработка по настройкам');
 await expect(page.locator('#settings-ai-panel')).toContainText('Поставлено в очередь');
 await expect(page.locator('#settings-ai-panel')).toContainText('Нет данных');
 await expect(page.locator('#settings-ai-panel')).not.toContainText('Автоматически отправлено: 0');
});
