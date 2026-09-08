import { expect, test, type Page } from "@playwright/test";

async function mockSettingsApi(page: Page) {
  await page.route("**/api/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    const responses = new Map<string, unknown>([
      ["/api/auth/me", { user: { email: "qa@yoleotard.local", displayName: "QA Operator", role: "OWNER" } }],
      ["/api/branding", {}],
      ["/api/communications/integrations", {
        deliveryAvailable: true,
        meta: { enabled: false, status: "NOT_CONFIGURED", appId: "", pageId: "", pageName: "", instagramAccountId: "", instagramAppId: "", instagramStatus: "NOT_CONFIGURED", instagramSubscriptionVerifiedAt: null, lastInstagramWebhookAt: null, whatsappPhoneNumberId: "", appSecretConfigured: false, instagramAppSecretConfigured: false, verifyTokenConfigured: false, verifyTokenUnsafe: false, pageAccessTokenConfigured: false, whatsappAccessTokenConfigured: false, subscriptionVerifiedAt: null, lastWebhookAt: null, webhookUrl: "" },
        chatwoot: { enabled: true, status: "CONFIGURED", baseUrl: "https://chatwoot.example", accountId: "2", inboxId: "7", accessTokenConfigured: true, webhookSecretConfigured: true, webhookUrl: "https://crm.example/api/communications/chatwoot/webhook" },
        email: { enabled: false, status: "NOT_CONFIGURED", smtpHost: "", smtpPort: 465, imapHost: "", imapPort: 993, username: "", fromAddress: "", signature: "", passwordConfigured: false },
      }],
    ]);
    if (route.request().method() !== "GET" || !responses.has(pathname)) return route.fulfill({ status: 501, json: { error: "Unexpected route: " + pathname } });
    return route.fulfill({ json: responses.get(pathname) });
  });
}

for (const viewport of [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test("действие синхронизации Chatwoot помещается в viewport: " + viewport.name, async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await mockSettingsApi(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/?section=settings");
    await page.getByRole("tab", { name: "Каналы связи" }).click();

    const action = page.getByRole("button", { name: "Синхронизировать клиентов Chatwoot" });
    await expect(action).toBeVisible();
    await expect(action).toBeEnabled();
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    expect(consoleErrors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("chatwoot-settings-" + viewport.width + "x" + viewport.height + ".png"), fullPage: true });
  });
}
