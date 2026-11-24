import { expect, test, type Locator, type Page } from "@playwright/test";
import { communicationsUi as ui } from "../lib/i18n";

test.use({ serviceWorkers: "block" });

const viewports = [
  { width: 1920, height: 1080 },
  { width: 1728, height: 960 },
  { width: 1680, height: 1050 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];
const clientId = "redesign-client";
const clientName = "Мария Тестовая";
const inboundText = "Здравствуйте! Когда будет готов заказ?";
const outboundText = "Здравствуйте! Проверю срок и напишу вам.";
const email = "inbox-redesign@example.test";
const createdAt = "2026-11-24T10:00:00Z";
const draftText = "Синтетический черновик для проверки канала ответа.";

const client = {
  id: clientId, displayName: clientName, status: "ACTIVE", source: "FACEBOOK",
  preferredChannel: "FACEBOOK", email, inboxEmail: email, country: "Украина",
  phone: "+12025550101", createdAt, responsibleManager: { displayName: "Менеджер QA" },
  linkedChannels: ["FACEBOOK", "EMAIL"],
  linkedAccounts: [{ channel: "FACEBOOK", accountName: "Messenger QA" }, { channel: "EMAIL", accountName: email }],
  conversations: [
    { id: "redesign-facebook", channel: "FACEBOOK", unreadCount: 2, lastMessageAt: createdAt, lastMessage: inboundText },
    { id: "redesign-email", channel: "EMAIL", unreadCount: 0, lastMessageAt: "2026-11-23T10:00:00Z" },
  ],
  orders: [{ id: "redesign-order", number: "QA-2601" }],
};

const clients = [client, ...Array.from({ length: 24 }, (_, index) => ({
  ...client,
  id: `redesign-list-${index}`,
  displayName: `Тестовый диалог ${index + 1}`,
  conversations: [{ ...client.conversations[0], id: `redesign-list-facebook-${index}`, unreadCount: 0 }],
  linkedChannels: ["FACEBOOK"],
  orders: [],
}))];

const history = [
  ...Array.from({ length: 30 }, (_, index) => ({
    id: `redesign-history-${index}`, channel: "FACEBOOK", direction: "INBOUND",
    status: "RECEIVED", content: `Тестовое сообщение ${index + 1}`,
    createdAt: new Date(Date.parse(createdAt) - (30 - index) * 60_000).toISOString(),
  })),
  { id: "redesign-reply", channel: "FACEBOOK", direction: "OUTBOUND", status: "SENT", content: outboundText, createdAt },
  { id: "redesign-inbound", channel: "FACEBOOK", direction: "INBOUND", status: "RECEIVED", content: inboundText, createdAt: "2026-11-24T10:01:00Z" },
];

const defaultOrderCard = {
  ...client.orders[0], type: "CUSTOM", isActive: true, salesStatus: "NEW_LEAD",
  productionStatus: "SEWING", priceMinor: 35000, currency: "EUR", compositionManaged: true,
  items: [{ name: "Модель QA", quantity: 1, instances: [{}] }],
  payments: [{ amountMinor: 10000, currency: "EUR" }], tracking: [] as { number: string; url: string }[],
};

const facebookSid = "25218880364458409";
const instagramSid = "17841407931852361";
const testLogoUrl = "/api/branding/qa-logo.svg";

async function mockInbox(page: Page, orderCards = [defaultOrderCard], showTechnicalDetails = false) {
  const activeClient = showTechnicalDetails
    ? { ...client, facebook: facebookSid, instagram: instagramSid, instagramUsername: "test.design" }
    : client;
  const errors: string[] = [];
  const deliveryRequests: string[] = [];
  const drafts = new Map<string, (typeof history)[number] & { metadata: { composerDraftKey: string } }>();
  page.on("pageerror", error => errors.push(error.message));

  await page.route("**/api/**", route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() === "POST" && /\/(messages|message-bundles|shipment-notifications)(\/|$)/.test(pathname)) {
      deliveryRequests.push(pathname);
      return route.fulfill({ status: 409, json: { message: "Synthetic test blocks delivery" } });
    }
    const draftKey = pathname.match(new RegExp(`^/api/communications/${clientId}/drafts/([^/]+)$`))?.[1];
    if (draftKey && request.method() === "PUT") {
      const { content, channel } = request.postDataJSON();
      const draft = {
        id: `redesign-draft-${draftKey}`, channel, createdAt, status: "DRAFT", direction: "OUTBOUND",
        content, metadata: { composerDraftKey: draftKey },
      };
      drafts.set(channel, draft);
      return route.fulfill({ json: draft });
    }
    switch (pathname) {
      case "/api/auth/me":
        return route.fulfill({ json: { user: { id: "redesign-owner", role: "OWNER", displayName: "Оператор QA" } } });
      case "/api/branding":
        return route.fulfill({ json: { logoUrl: showTechnicalDetails ? testLogoUrl : null, useInMessages: true } });
      case testLogoUrl:
        return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><circle cx="15" cy="15" r="10"/></svg>' });
      case "/api/communications":
        return route.fulfill({ json: { items: [activeClient, ...clients.slice(1)], total: clients.length, hasMore: false, channelCounts: { FACEBOOK: clients.length, EMAIL: 1 } } });
      case `/api/communications/${clientId}`:
        return route.fulfill({ json: { messages: [...history, ...drafts.values()] } });
      case `/api/clients/${clientId}`:
        return route.fulfill({
          json: {
            ...client, workTasks: [],
            athletes: Array.from({ length: 24 }, (_, index) => ({
              id: `redesign-athlete-${index}`, firstName: `Спортсменка ${index + 1}`, measurements: [],
            })),
          },
        });
      case `/api/communications/clients/${clientId}/order-cards`:
        return route.fulfill({ json: orderCards });
      default:
        return route.fulfill({ json: [] });
    }
  });
  return { errors, deliveryRequests, drafts };
}

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("Visible Inbox element has no bounds");
  return bounds;
}

async function expectInsideViewport(locator: Locator, { width, height }: (typeof viewports)[number]) {
  const bounds = await box(locator);
  expect(bounds.x).toBeGreaterThanOrEqual(-1);
  expect(bounds.y).toBeGreaterThanOrEqual(-1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(height + 1);
}

async function expectIndependentScroll(rail: Locator, historyViewport: Locator, context: Locator) {
  await rail.evaluate(element => { element.scrollTop = 0; });
  await context.evaluate(element => { element.scrollTop = 0; });
  await historyViewport.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const historyBottom = await historyViewport.evaluate(element => element.scrollTop);
  expect(historyBottom).toBeGreaterThan(0);
  await rail.evaluate(element => { element.scrollTop = 72; });
  expect(await rail.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await historyViewport.evaluate(element => element.scrollTop)).toBe(historyBottom);
  const railPosition = await rail.evaluate(element => element.scrollTop);
  await historyViewport.evaluate(element => { element.scrollTop = Math.max(0, element.scrollTop - 72); });
  expect(await historyViewport.evaluate(element => element.scrollTop)).toBeLessThan(historyBottom);
  expect(await rail.evaluate(element => element.scrollTop)).toBe(railPosition);
  const historyPosition = await historyViewport.evaluate(element => element.scrollTop);
  await context.evaluate(element => { element.scrollTop = 72; });
  expect(await context.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await rail.evaluate(element => element.scrollTop)).toBe(railPosition);
  expect(await historyViewport.evaluate(element => element.scrollTop)).toBe(historyPosition);
  await context.evaluate(element => { element.scrollTop = 0; });
  await rail.evaluate(element => { element.scrollTop = 0; });
  await historyViewport.evaluate(element => { element.scrollTop = element.scrollHeight; });
}

async function exerciseDesktopPanels(page: Page, rail: Locator, chat: Locator, context: Locator) {
  const left = page.getByRole("separator", { name: ui.resizeClients });
  const right = page.getByRole("separator", { name: ui.resizeOrders });
  const railBefore = await box(rail);
  const drag = await box(left);
  const x = drag.x + drag.width / 2;
  const y = drag.y + drag.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await box(rail)).width).toBeGreaterThan(railBefore.width + 10);

  const contextBefore = await box(context);
  await right.press("ArrowLeft");
  await expect(right).toBeFocused();
  await expect.poll(async () => (await box(context)).width).toBeGreaterThan(contextBefore.width);

  const chatBefore = await box(chat);
  await context.getByRole("button", { name: ui.collapseClientCard }).click();
  await expect(context.getByRole("tablist")).toBeHidden();
  await expect(right).toBeHidden();
  await expect.poll(async () => (await box(chat)).width).toBeGreaterThan(chatBefore.width);
  await context.getByRole("button", { name: ui.expandClientCard }).click();
  await expect(context.getByRole("tablist")).toBeVisible();
  await expect(right).toBeVisible();
}

for (const viewport of viewports) {
  const { width, height } = viewport;
  test(`Inbox redesign at ${width}x${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const { errors, deliveryRequests, drafts } = await mockInbox(page);
    await page.goto(`/?section=inbox&clientId=${clientId}`);

    const mobile = width <= 900;
    const chat = page.locator(".communications-chat");
    const header = chat.locator(".communications-chat-header");
    const desktopActions = header.locator(".communications-chat-actions");
    const mobileActions = header.locator(".communications-mobile-chat-actions");
    const rail = page.locator(".communications-clients");
    const context = page.locator(".communications-context-panel");
    const composer = chat.getByPlaceholder(ui.writeToClient.replace("{name}", clientName));
    const send = chat.getByRole("button", { name: ui.sendMessage, exact: true });
    await expect(chat.getByText(inboundText, { exact: true })).toBeVisible();
    await expect(chat.getByText(outboundText, { exact: true })).toBeVisible();
    await expect(header.getByText(clientName, { exact: true })).toBeVisible();
    await expect(chat.getByRole("tablist")).toHaveCount(0);
    await expect(header.getByRole("button", { name: /позвонить|видеозвонок|голосовой звонок/i })).toHaveCount(0);
    await expect(page.locator(".crm-nav")).toBeHidden();

    if (mobile) {
      await expect(rail).toBeHidden();
      await expect(context).toBeHidden();
      await expect(page.getByRole("separator", { name: ui.resizeClients })).toBeHidden();
      await header.getByRole("button", { name: ui.openClientList, exact: true }).click();
    } else {
      await expect(page.locator(".crm-topbar-nav")).toBeVisible();
      await expect(desktopActions).toHaveAccessibleName(ui.conversationMenu);
      await desktopActions.click();
      await expect(page.getByRole("menuitem", { name: ui.markSpam })).toBeVisible();
      await page.keyboard.press("Escape");
      const leftBounds = await box(rail);
      const chatBounds = await box(chat);
      const rightBounds = await box(context);
      expect(leftBounds.x + leftBounds.width).toBeLessThanOrEqual(chatBounds.x + 1);
      expect(chatBounds.x + chatBounds.width).toBeLessThanOrEqual(rightBounds.x + 1);
    }
    await expect(rail.getByRole("button", { name: ui.createClient })).toBeVisible();
    await expect(rail.getByRole("searchbox", { name: ui.search })).toBeVisible();
    if (mobile) {
      await page.screenshot({ path: testInfo.outputPath(`inbox-list-${width}x${height}.png`), animations: "disabled" });
      await rail.locator(".communications-client-list").getByRole("button").filter({ hasText: clientName }).click();
      await expect(rail).toBeHidden();
    }

    const channel = header.getByLabel(ui.replyChannel);
    if (mobile) {
      await expect(mobileActions).toHaveAccessibleName(ui.chatActions);
      await mobileActions.click();
    }
    await expect(channel).toHaveValue("FACEBOOK");
    await expect(channel.locator("option")).toHaveCount(2);
    if (mobile) {
      await expect(header.getByRole("button", { name: ui.clientCard, exact: true })).toBeVisible();
      await expect(desktopActions).toHaveAccessibleName(ui.conversationMenu);
      await desktopActions.click();
      await expect(page.getByRole("menuitem", { name: ui.markSpam })).toBeVisible();
      await page.keyboard.press("Escape");
      await mobileActions.click();
    } else {
      await expect(header.getByRole("button", { name: ui.openClient, exact: true })).toBeVisible();
    }

    await composer.fill(draftText);
    await expect(send).toBeEnabled();
    await expect(composer).toHaveAttribute("aria-keyshortcuts", /Control\+Enter/);
    await expectInsideViewport(composer, viewport);
    await expectInsideViewport(send, viewport);
    await send.click({ trial: true });
    await expect(chat.locator('input[type="file"]')).toBeEnabled();
    const emoji = chat.getByRole("button", { name: ui.chooseEmoji });
    await emoji.click();
    await expect(chat.getByRole("dialog", { name: ui.emojiPanel })).toBeVisible();
    await emoji.click();
    const pageSize = await page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      return { horizontal: root.scrollWidth - root.clientWidth, vertical: root.scrollHeight - root.clientHeight };
    });
    expect(pageSize.horizontal).toBeLessThanOrEqual(1);
    if (!mobile) expect(pageSize.vertical).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`inbox-chat-${width}x${height}.png`), animations: "disabled" });

    if (mobile) {
      const openContext = header.getByRole("button", { name: ui.clientCard, exact: true });
      if (!await openContext.isVisible()) await mobileActions.click();
      await openContext.click();
    }
    await expect(context.getByRole("tablist")).toBeVisible();
    for (const name of [ui.contextClient, ui.contextOrders, ui.contextTasks, ui.contextNotes, ui.contextFiles]) {
      await expect(page.getByRole("tab", { name, exact: true })).toHaveCount(1);
    }
    await context.getByRole("tab", { name: ui.contextOrders, exact: true }).click();
    await expect(context.getByRole("tabpanel")).toContainText("QA-2601");
    await context.getByRole("tab", { name: ui.contextClient, exact: true }).click();
    if (mobile) {
      await page.screenshot({ path: testInfo.outputPath(`inbox-context-${width}x${height}.png`), animations: "disabled" });
      await context.getByRole("button", { name: ui.closeClientCard }).click();
      await expect(context).toBeHidden();
      await expectInsideViewport(send, viewport);
    }

    if (width === 1920) {
      await expect(context.getByText("Спортсменка 24", { exact: true })).toBeAttached();
      await expectIndependentScroll(rail.locator(".communications-client-list"), chat.locator(".communications-messages"), context);
      await exerciseDesktopPanels(page, rail, chat, context);
      await channel.selectOption("EMAIL");
      await expect(channel).toHaveValue("EMAIL");
      await expect(composer).toHaveValue("");
      expect(drafts.get("FACEBOOK")?.content).toBe(draftText);
      await chat.getByRole("button", { name: ui.chooseReplyChannel.replace("{channel}", ui.sources.FACEBOOK) }).last().click();
      await expect(channel).toHaveValue("FACEBOOK");
      await expect(composer).toHaveValue(draftText);
    }

    expect(deliveryRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("Inbox shows the website design, sale status, shipment and outstanding balance independently", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const designImageUrl = "https://www.yoleotard.com/wp-content/uploads/qa-design.png";
  const brokenImageUrl = "https://www.yoleotard.com/wp-content/uploads/qa-missing.png";
  const trackingUrl = "https://nova.global/track/?Tracking_ID=QA-123";
  const ready = {
    ...defaultOrderCard, salesStatus: "WAITING_DEPOSIT", productionStatus: "NOT_SCHEDULED", dispatchStatus: "SHIPPED",
    designImageUrl, tracking: [{ number: "QA-123", url: trackingUrl }], deliveryCarriers: ["NOVA_GLOBAL"],
  };
  const broken = {
    ...defaultOrderCard, id: "redesign-missing-media", number: "QA-2602", salesStatus: "CANCELLED",
    isActive: false, designImageUrl: brokenImageUrl,
  };
  const { errors, deliveryRequests } = await mockInbox(page, [ready, broken]);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/5KcAAAAASUVORK5CYII=", "base64");
  await page.route(designImageUrl, route => route.fulfill({ contentType: "image/png", body: png }));
  await page.route(brokenImageUrl, route => route.fulfill({ status: 404, body: "" }));
  await page.goto(`/?section=inbox&clientId=${clientId}`);

  const context = page.locator(".communications-context-panel");
  await context.getByRole("tab", { name: ui.contextOrders, exact: true }).click();
  const cards = context.locator(".communications-context-orders article");
  const order = cards.filter({ hasText: "QA-2601" });
  await expect(order.getByText("Ожидается предоплата", { exact: true })).toBeVisible();
  await expect(order.getByText("Отправлено", { exact: true })).toBeVisible();
  await expect(order.getByText("Nova Global", { exact: true })).toBeVisible();
  await expect(order.getByText(/Остаток.*250,00/)).toBeVisible();
  await expect(order.getByRole("link", { name: /QA-123/ })).toHaveAttribute("href", trackingUrl);
  await expect.poll(() => order.locator("img").evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await order.getByRole("button", { name: /Модель заказа/ }).click();
  await expect(page.getByRole("dialog", { name: /QA-2601/ }).locator("img")).toHaveAttribute("src", designImageUrl);
  await page.keyboard.press("Escape");
  const missing = cards.filter({ hasText: "QA-2602" });
  await expect(missing.getByText("Отменено", { exact: true })).toBeVisible();
  await expect(missing.getByText(/Остаток/)).toHaveCount(0);
  await expect(missing.locator(".order-image-unavailable")).toBeVisible();
  await expect(missing.getByRole("button", { name: /Модель заказа/ })).toHaveCount(0);
  expect(deliveryRequests).toEqual([]);
  expect(errors).toEqual([]);
});

for (const width of [1366, 390]) {
  test(`Client technical details are visible in full rows and the message logo is frameless at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await mockInbox(page, undefined, true);
    await page.goto(`/?section=inbox&clientId=${clientId}`);

    const logo = page.locator(".communications-message-avatar.is-business").filter({ has: page.locator(".communications-business-logo") }).last();
    await expect(logo).toBeVisible();
    await expect(logo).toHaveCSS("border-top-width", "0px");
    await expect(logo).toHaveCSS("padding-left", "0px");
    await expect(logo).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    if (width === 390) await page.getByRole("button", { name: ui.clientCard, exact: true }).click();

    const details = page.locator(".communications-profile-details");
    await expect(details.getByRole("heading", { name: ui.clientTechnicalDetails })).toBeVisible();
    for (const [label, value] of [[ui.facebookSid, facebookSid], [ui.instagramSid, instagramSid], [ui.instagramUsername, "@test.design"]]) {
      const row = details.locator("dl > div").filter({ has: page.getByText(label, { exact: true }) });
      await expect(row.locator("dd")).toHaveText(value);
      await expect.poll(() => row.evaluate(element => {
        const name = element.querySelector("dt")!.getBoundingClientRect();
        const content = element.querySelector("dd")!.getBoundingClientRect();
        return content.x >= name.right && Math.abs(content.y - name.y) < 3
          && content.height < 22 && content.right <= window.innerWidth;
      })).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`inbox-profile-${width}.png`), animations: "disabled" });
  });
}
