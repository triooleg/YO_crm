import { expect, test } from "@playwright/test";

test.use({ hasTouch: true });

for (const width of [320, 390, 720, 1366]) {
  test(`message timestamps remain complete on one line at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const messages = [
      { id: "short-in", content: "Hi", direction: "INBOUND" },
      { id: "short-out", content: "Hi", direction: "OUTBOUND" },
      { id: "read-out", content: "👍", direction: "OUTBOUND", metadata: { metaReadAt: "2026-11-18T00:54:00Z" } },
      { id: "failed-out", content: "Hi", direction: "OUTBOUND", status: "FAILED" },
      { id: "long-in", content: "A long message " + "longword".repeat(35), direction: "INBOUND" },
    ].map(message => ({ conversationId: "timestamp-conversation", channel: "CHATWOOT", status: "SENT", createdAt: "2026-11-18T00:53:00Z", ...message }));
    const client = { id: "timestamp-client", displayName: "Timestamp QA", source: "CHATWOOT", preferredChannel: "CHATWOOT", orders: [], linkedChannels: ["CHATWOOT"], conversations: [{ id: "timestamp-conversation", channel: "CHATWOOT", lastMessageAt: messages[0]!.createdAt, unreadCount: 0, messages }] };
    await page.route("**/api/**", route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: "qa", role: "OWNER", displayName: "QA" } } });
      if (path === "/api/communications") return route.fulfill({ json: { items: [client], total: 1, hasMore: false, scopeCounts: { all: 1, unread: 0, waiting: 0 }, channelCounts: { CHATWOOT: 1 } } });
      if (path === "/api/communications/timestamp-client") return route.fulfill({ json: { messages } });
      if (path === "/api/clients/timestamp-client") return route.fulfill({ json: { ...client, athletes: [], workTasks: [] } });
      if (path === "/api/communications/unread-count") return route.fulfill({ json: { unreadCount: 0 } });
      return route.fulfill({ json: [] });
    });
    await page.goto("/?section=inbox&clientId=timestamp-client");
    const footers = page.locator(".communications-message-meta");
    await expect(footers).toHaveCount(5);
    await expect(footers.locator(".communications-message-source")).toHaveCount(0);
    for (const footer of await footers.all()) {
      await expect(footer).toContainText(/18\.11\.2026,\s*\d{2}:\d{2}/);
      const geometry = await footer.evaluate(element => {
        const box = element.getBoundingClientRect();
        const bubble = element.closest("article")!.getBoundingClientRect();
        return { height: box.height, line: parseFloat(getComputedStyle(element).lineHeight), left: box.left - bubble.left, right: bubble.right - box.right };
      });
      expect(geometry.height).toBeLessThanOrEqual(geometry.line * 1.5);
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeGreaterThanOrEqual(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await page.locator(".communications-messages").evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: `../../.local/inbox-message-time/time-${width}.png` });
  });
}

for (const width of [390, 1366]) {
  test(`merged inbox labels each inbound message with its own channel at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const createdAt = "2026-11-18T08:34:00Z";
    const messages = [
      { id: "ig-in", channel: "INSTAGRAM", direction: "INBOUND", content: "Instagram question" },
      { id: "wa-in", channel: "WHATSAPP", direction: "INBOUND", content: "WhatsApp question" },
      { id: "ig-out", channel: "INSTAGRAM", direction: "OUTBOUND", content: "Instagram answer" },
    ].map(message => ({ ...message, createdAt, status: "SENT" }));
    const client = {
      id: "merged-client", displayName: "Merged QA", source: "WHATSAPP", preferredChannel: "WHATSAPP", orders: [],
      linkedChannels: ["WHATSAPP", "INSTAGRAM"],
      conversations: ["WHATSAPP", "INSTAGRAM"].map(channel => ({ id: channel, channel, lastMessageAt: createdAt, unreadCount: 0 }))
    };
    const sent: { channel: string; content: string }[] = [];
    const drafts: { channel: string; content: string }[] = [];
    const savedDraftText = new Map<string, string>();
    let releaseDraft!: () => void;
    const draftGate = new Promise<void>(resolve => { releaseDraft = resolve; });
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/communications/merged-client/messages" && route.request().method() === "POST") {
        const { channel, content, draftMessageId } = route.request().postDataJSON();
        const deliveredText = draftMessageId ? savedDraftText.get(draftMessageId) : content;
        if (typeof deliveredText !== "string") return route.fulfill({ status: 409, json: { message: "Draft already used" } });
        if (draftMessageId) savedDraftText.delete(draftMessageId);
        sent.push({ channel, content: deliveredText });
        const message = { id: "qa-sent-" + channel, channel, direction: "OUTBOUND", status: "SENT", content: deliveredText, createdAt };
        messages.push(message);
        return route.fulfill({ json: message });
      }
      if (path.startsWith("/api/communications/merged-client/drafts/") && route.request().method() === "PUT") {
        const { channel, content } = route.request().postDataJSON();
        drafts.push({ channel, content });
        if (channel === "WHATSAPP" && content === "WhatsApp draft") await draftGate;
        const id = "draft-" + channel;
        savedDraftText.set(id, content);
        return route.fulfill({ json: { id, channel, direction: "OUTBOUND", status: "DRAFT", content, createdAt } });
      }
      if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: "qa", role: "OWNER", displayName: "QA" } } });
      if (path === "/api/communications") return route.fulfill({ json: { items: [client], total: 1, hasMore: false, scopeCounts: { all: 1, unread: 0, waiting: 0 } } });
      if (path === "/api/communications/merged-client") return route.fulfill({ json: { messages } });
      if (path === "/api/clients/merged-client") return route.fulfill({ json: { ...client, athletes: [], workTasks: [] } });
      return route.fulfill({ json: [] });
    });
    await page.goto("/?section=inbox&clientId=merged-client");
    const footer = (text: string) => page.locator(".communications-messages article").filter({ hasText: text }).locator(".communications-message-meta");
    const instagram = footer("Instagram question").getByRole("button", { name: "Выбрать канал ответа: Instagram" });
    const whatsapp = footer("WhatsApp question").getByRole("button", { name: "Выбрать канал ответа: WhatsApp" });
    await expect(whatsapp).toHaveAttribute("aria-pressed", "true");
    await expect(footer("Instagram answer").getByRole("img", { name: "Канал ответа: Instagram" })).toBeVisible();
    const composer = page.getByPlaceholder("Написать Merged QA…");
    await composer.fill("WhatsApp draft");
    try {
      await instagram.click();
      await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeDisabled();
      await expect(whatsapp).toHaveAttribute("aria-pressed", "true");
      await composer.press("Control+Enter");
      expect(sent).toEqual([]);
    } finally {
      releaseDraft();
    }
    await expect(instagram).toHaveAttribute("aria-pressed", "true");
    await expect(composer).toHaveValue("");
    expect(drafts).toContainEqual({ channel: "WHATSAPP", content: "WhatsApp draft" });
    expect(sent).toEqual([]);
    await composer.fill("QA reply on Instagram");
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(footer("QA reply on Instagram").getByRole("img", { name: "Канал ответа: Instagram" })).toBeVisible();
    expect(sent).toEqual([{ channel: "INSTAGRAM", content: "QA reply on Instagram" }]);
    await whatsapp.click();
    await expect(whatsapp).toHaveAttribute("aria-pressed", "true");
    await expect(composer).toHaveValue("WhatsApp draft");
    await expect(footer("QA reply on Instagram").getByRole("img", { name: "Канал ответа: Instagram" })).toBeVisible();
    await composer.fill("Updated WhatsApp reply");
    await composer.press("Control+Enter");
    await expect(footer("Updated WhatsApp reply").getByRole("img", { name: "Канал ответа: WhatsApp" })).toBeVisible();
    expect(sent).toEqual([
      { channel: "INSTAGRAM", content: "QA reply on Instagram" },
      { channel: "WHATSAPP", content: "Updated WhatsApp reply" },
    ]);
    for (const text of ["Instagram question", "WhatsApp question"]) {
      const size = width <= 480 ? 40 : 24;
      const target = await footer(text).locator("button.communications-message-source-button").boundingBox();
      expect(target?.width).toBeGreaterThanOrEqual(size);
      expect(target?.height).toBeGreaterThanOrEqual(size);
      await expect(footer(text)).toHaveCSS("white-space", "nowrap");
      await expect(footer(text)).toContainText(/18\.11\.2026,\s*\d{2}:\d{2}/);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const screenshot = `inbox-channels-${width}.png`;
    await page.screenshot({ path: process.env.YO_CRM_VISUAL_DIR ? `${process.env.YO_CRM_VISUAL_DIR}/${screenshot}` : testInfo.outputPath(screenshot) });
  });
}
