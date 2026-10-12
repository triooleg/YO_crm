import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const clients = [
  {
    id: "client-read",
    displayName: "Прочитанный клиент",
    status: "ACTIVE",
    source: "FACEBOOK",
    preferredChannel: "FACEBOOK",
    orders: [],
    buyerSummary: { purchaseCount: 0, paymentTotals: [] },
    linkedChannels: ["FACEBOOK"],
    conversations: [{ id: "conversation-read", channel: "FACEBOOK", lastMessageAt: "2026-09-20T10:00:00.000Z", unreadCount: 0, unreadVersion: 1, messages: [{ content: "Прочитано", createdAt: "2026-09-20T10:00:00.000Z" }] }],
  },
  {
    id: "client-unread",
    displayName: "Непрочитанный клиент",
    status: "ACTIVE",
    source: "WHATSAPP",
    preferredChannel: "WHATSAPP",
    orders: [],
    buyerSummary: { purchaseCount: 0, paymentTotals: [] },
    linkedChannels: ["WHATSAPP"],
    conversations: [{ id: "conversation-unread", channel: "WHATSAPP", lastMessageAt: "2026-09-20T09:00:00.000Z", unreadCount: 5, unreadVersion: 3, messages: [{ content: "Новое сообщение", createdAt: "2026-09-20T09:00:00.000Z" }] }],
  },
];

async function mockUnreadInbox(page: Page) {
  let unreadTotal = 7;
  let delayNextUnread = true;
  let releaseDelayedUnread = () => {};
  let delayedUnreadStarted: Promise<void>;
  let signalDelayedUnreadStarted = () => {};
  let delayedUnreadRelease: Promise<void>;
  const prepareUnreadDelay = () => {
    delayNextUnread = true;
    delayedUnreadStarted = new Promise(resolve => { signalDelayedUnreadStarted = resolve; });
    delayedUnreadRelease = new Promise(resolve => { releaseDelayedUnread = resolve; });
  };
  prepareUnreadDelay();
  const consoleErrors: string[] = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", error => consoleErrors.push(error.message));
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const apiPath = url.pathname;
    if (request.method() === "PATCH" && apiPath === "/api/communications/client-unread/read") {
      unreadTotal = 2;
      return route.fulfill({ json: { updated: 1 } });
    }
    if (request.method() !== "GET") return route.fulfill({ status: 405, json: { message: `Unexpected ${request.method()} ${apiPath}` } });
    if (apiPath === "/api/auth/me") return route.fulfill({ json: { user: { email: "qa@yoleotard.local", displayName: "QA Operator", role: "OWNER" } } });
    if (apiPath === "/api/branding") return route.fulfill({ json: {} });
    if (apiPath === "/api/communications/unread-count") {
      const responseTotal = unreadTotal;
      if (delayNextUnread) {
        delayNextUnread = false;
        signalDelayedUnreadStarted();
        await delayedUnreadRelease;
      }
      return route.fulfill({ json: { unreadCount: responseTotal } });
    }
    if (apiPath === "/api/communications/templates") return route.fulfill({ json: [] });
    if (apiPath === "/api/communications") return route.fulfill({ json: { items: clients, total: clients.length, hasMore: false, channelCounts: { FACEBOOK: 1, WHATSAPP: 1 } } });
    const detail = clients.find(client => apiPath === `/api/communications/${client.id}`);
    if (detail) return route.fulfill({ json: { messages: detail.conversations[0].messages.map((message, index) => ({ id: `${detail.id}-${index}`, ...message, channel: detail.preferredChannel, direction: "INBOUND", status: "SENT" })) } });
    const profile = clients.find(client => apiPath === `/api/clients/${client.id}`);
    if (profile) return route.fulfill({ json: { ...profile, athletes: [], workTasks: [] } });
    if (/^\/api\/ai-assistant\/clients\/[^/]+\/summaries$/.test(apiPath)) return route.fulfill({ json: { firstMessageDate: "2026-09-20", items: [] } });
    return route.fulfill({ status: 501, json: { message: `Unexpected test route: ${apiPath}` } });
  });
  return {
    consoleErrors,
    delayNextUnread: prepareUnreadDelay,
    waitForDelayedUnread: () => delayedUnreadStarted,
    releaseDelayedUnread: () => releaseDelayedUnread(),
    clearUnread() { unreadTotal = 0; },
  };
}

for (const viewport of [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "390x844", width: 390, height: 844 },
]) {
  test(`уведомления браузера и Inbox работают ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const state = await mockUnreadInbox(page);
    await page.goto("/?section=inbox");

    await state.waitForDelayedUnread();
    const originalFaviconHref = await page.locator('link[rel~="icon"]:not([data-yoleotard-unread-icon="true"])').first().getAttribute("href");
    expect(originalFaviconHref).toBeTruthy();
    state.releaseDelayedUnread();

    await expect(page.locator(".crm-version")).toContainText("0.1.41");
    await expect(page).toHaveTitle("(7) CRM Yoleotard");
    await expect(page.locator('link[data-yoleotard-unread-icon="true"]')).toHaveAttribute("href", /^data:image\/svg\+xml/);
    const bell = page.locator(".crm-topbar-notifications");
    await expect(bell).toHaveAccessibleName("Новых сообщений: 7");
    if (viewport.width <= 720) {
      const box = await bell.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(40);
      expect(box?.height).toBeGreaterThanOrEqual(40);
    }

    await bell.click();
    if (viewport.width <= 720) await page.locator(".communications-mobile-list-toggle").click();
    await expect(page.getByRole("button", { name: "Непрочитанные" })).toHaveAttribute("aria-pressed", "true");
    state.delayNextUnread();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await state.waitForDelayedUnread();
    await page.getByRole("button", { name: /Непрочитанный клиент/ }).click();
    await expect(page).toHaveTitle("(2) CRM Yoleotard");
    state.releaseDelayedUnread();
    await page.waitForTimeout(100);
    await expect(page).toHaveTitle("(2) CRM Yoleotard");

    await page.screenshot({
      path: path.resolve(process.cwd(), "../../output/playwright", `unread-notifications-${viewport.name}.png`),
      fullPage: false,
    });

    state.clearUnread();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page).toHaveTitle("CRM Yoleotard");
    await expect(page.locator('link[data-yoleotard-unread-icon="true"]')).toHaveCount(0);
    await expect(page.locator('link[rel~="icon"]:not([data-yoleotard-unread-icon="true"])').first()).toHaveAttribute("href", originalFaviconHref!);
    expect(state.consoleErrors).toEqual([]);

  });
}
