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

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") {
      return route.fulfill({ json: { user: { email: "qa@yoleotard.local", displayName: "QA Operator", role: "OWNER" } } });
    }
    if (path === "/api/branding" && request.method() === "GET") return route.fulfill({ json: branding });
    if (path === "/api/branding" && request.method() === "PUT") {
      const body = request.postDataJSON();
      writes.push({ path, body });
      return route.fulfill({ json: { ...branding, ...body, logoUrl: body.removeLogo ? null : branding.logoUrl } });
    }
    if (path === "/api/finance/settings" && request.method() === "GET") return route.fulfill({ json: production });
    if (path === "/api/finance/settings/production" && request.method() === "PATCH") {
      const body = request.postDataJSON();
      writes.push({ path, body });
      return route.fulfill({ json: production.map(item => ({ ...item, value: body[item.key] })) });
    }
    if (path === "/api/ai-assistant/settings" && request.method() === "GET") return route.fulfill({ json: aiAssistant });
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
  test(`Mantine-контролы настроек сохраняют прежний payload — ${viewport.name}`, async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    const writes = await mockSettings(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/?section=settings");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

    await page.getByRole("tab", { name: "Производство" }).click();
    const productionPanel = page.locator("#settings-production-panel");
    await productionPanel.getByLabel("Срок выполнения заказа, дней").fill("12");
    await productionPanel.getByLabel("Резерв до отправки, дней").fill("4");
    const productionSave = productionPanel.getByRole("button", { name: "Сохранить настройки" });
    await expect(productionSave).toHaveClass(/mantine-Button-root/);
    await productionSave.click();
    await expect(productionPanel.getByRole("status")).toHaveText("Настройки сохранены");
    await page.screenshot({ path: screenshotPath(testInfo, `mantine-production-settings-${viewport.width}x${viewport.height}.png`), fullPage: true });

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
    if (viewport.width <= 440) {
      const buttonBox = await brandingPanel.getByRole("button", { name: "Сохранить настройки" }).boundingBox();
      const panelBox = await brandingPanel.boundingBox();
      expect(buttonBox).not.toBeNull();
      expect(panelBox).not.toBeNull();
      expect(Math.abs(buttonBox!.width - (panelBox!.width - 36))).toBeLessThanOrEqual(2);
    }

    await page.getByRole("tab", { name: "AI-помощник" }).click();
    const summarySelect = page.getByLabel("Формат сводки");
    await expect(summarySelect).toHaveClass(/mantine-NativeSelect-input/);
    await summarySelect.selectOption("COMPACT");
    await expect(page.getByRole("status", { name: "" }).filter({ hasText: "Настройка сохранена" })).toBeVisible();
    await summarySelect.locator("xpath=ancestor::*[self::section][1]").screenshot({ path: screenshotPath(testInfo, `mantine-summary-format-${viewport.width}x${viewport.height}.png`) });

    expect(writes).toEqual([
      { path: "/api/finance/settings/production", body: { defaultDurationDays: 12, shippingLeadDays: 4 } },
      { path: "/api/branding", body: { useInHeader: false, useInMessages: true, removeLogo: true } },
      { path: "/api/branding", body: { useInHeader: false, useInMessages: true, removeLogo: false } },
      { path: "/api/ai-control/settings", body: { key: "summaryDetailLevel", value: "COMPACT", scope: "GLOBAL" } },
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    expect(pageErrors).toEqual([]);
    await page.screenshot({ path: screenshotPath(testInfo, `mantine-settings-controls-${viewport.width}x${viewport.height}.png`), fullPage: true });
  });
}
