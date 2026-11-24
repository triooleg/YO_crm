import { expect, test } from "@playwright/test";

for (const { source, width, height, stale } of [
  { source: "FACEBOOK", width: 1920, height: 1080 },
  { source: "FACEBOOK", width: 1366, height: 768 },
  { source: "WEBSITE", width: 390, height: 844 },
  { source: "WEBSITE", width: 390, height: 844, stale: true },
]) {
  test(`first Inbox email for ${source} at ${width}px${stale ? " with updated address" : ""}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    const createdAt = "2026-11-24T08:00:00Z";
    const address = "web-order-notifications-2026-long-mailbox@example.test";
    let inboxEmail = address;
    let draft: { id: string; channel: string; createdAt: string; status: string; direction: string; content: string; metadata: { composerDraftKey?: string; composerEmail?: string } } | undefined;
    let blockDraftWrite = false;
    let addressReads = 0;
    const client = {
      id: "website-buyer", displayName: "Website Buyer", source, preferredChannel: source,
      email: address, orders: [],
      conversations: source === "FACEBOOK" ? [{ id: "facebook-conversation", channel: source, lastMessageAt: createdAt, unreadCount: 0 }] : [],
    };
    const messages = source === "FACEBOOK"
      ? [{ id: "messenger-inbound", channel: "FACEBOOK", direction: "INBOUND", status: "RECEIVED", content: "Messenger history", createdAt }]
      : [];
    const sends: unknown[] = [];
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth/me")
        return route.fulfill({ json: { user: { id: "qa", role: "OWNER", displayName: "QA" } } });
      if (path === "/api/communications") {
        if (inboxEmail !== address) addressReads++;
        return route.fulfill({ json: { items: [{ ...client, email: inboxEmail, inboxEmail }], total: 1, hasMore: false } });
      }
      if (path === "/api/communications/website-buyer")
        return route.fulfill({ json: { messages: draft ? [...messages, draft] : messages } });
      if (path.startsWith("/api/communications/website-buyer/drafts/") && request.method() === "PUT") {
        if (blockDraftWrite) return route.fulfill({ status: 503, json: { message: "Synthetic draft write failure" } });
        const body = request.postDataJSON();
        draft = {
          id: "autosaved-email-draft", channel: "EMAIL", createdAt, status: "DRAFT", direction: "OUTBOUND", content: body.content,
          metadata: { composerDraftKey: path.split("/").at(-1), composerEmail: body.expectedEmail },
        };
        return route.fulfill({ json: draft });
      }
      if (path === "/api/clients/website-buyer")
        return route.fulfill({ json: { ...client, athletes: [], workTasks: [] } });
      if (path === "/api/communications/website-buyer/messages" && request.method() === "POST") {
        const body = request.postDataJSON();
        sends.push(body);
        draft = undefined;
        const message = { id: "first-email", channel: "EMAIL", createdAt, status: "SENT", direction: "OUTBOUND", content: body.content };
        messages.push(message);
        return route.fulfill({ json: message });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto("/?section=inbox&clientId=website-buyer");
    const channel = page.getByLabel("Канал ответа");
    if (source === "WEBSITE") {
      await expect(page.locator(".communications-mobile-active-channel")).toHaveText("E-mail");
      await page.getByRole("button", { name: "Действия чата", exact: true }).click();
    }
    await expect(channel).toBeVisible();
    await expect(channel.locator('option[value="EMAIL"]')).toContainText("E-mail");
    if (source === "FACEBOOK") {
      await expect(channel).toHaveValue("FACEBOOK");
      await expect(page.getByText("Messenger history")).toBeVisible();
      await channel.selectOption("EMAIL");
    }
    await expect(channel).toHaveValue("EMAIL");
    await expect(page.locator(".communications-chat footer").getByText(address, { exact: false })).toBeVisible();
    expect(sends).toHaveLength(0);
    const content = "Synthetic first email";
    const composer = page.getByPlaceholder("Написать Website Buyer…");
    await composer.fill(content);
    const chat = page.locator(".communications-chat");
    const bounds = await chat.boundingBox();
    expect(bounds && bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    if (source === "FACEBOOK") {
      const context = await page.locator(".communications-context-panel").boundingBox();
      const controls = await page.locator(".communications-compose").boundingBox();
      expect(context && controls && controls.x + controls.width).toBeLessThanOrEqual(context!.x + 1);
    }
    await page.screenshot({ path: testInfo.outputPath(`${source.toLowerCase()}-first-email-${width}.png`) });
    if (stale) {
      await page.getByRole("button", { name: "Действия чата", exact: true }).click();
      inboxEmail = "new-mailbox@example.test";
      const send = page.getByRole("button", { name: "Отправить", exact: true });
      const confirm = page.getByRole("button", { name: "Подтвердить адрес" });
      const warning = "E-mail клиента изменился. Подтвердите новый адрес перед отправкой.";
      await expect.poll(() => addressReads, { timeout: 12000 }).toBeGreaterThan(0);
      await expect(confirm).toBeVisible();
      const unsaved = content + " with an edit";
      blockDraftWrite = true;
      await composer.fill(unsaved);
      await send.click();
      await expect(page.getByText("Не удалось сохранить черновик", { exact: true }).first()).toBeVisible();
      await expect(composer).toHaveValue(unsaved);
      expect(sends).toEqual([]);

      blockDraftWrite = false;
      await send.click();
      await expect(page.getByText(warning)).toBeVisible();
      expect(draft?.content).toBe(unsaved);
      expect(draft?.metadata.composerEmail).toBe(address);
      await page.reload();
      await expect(composer).toHaveValue(unsaved);
      await expect(confirm).toBeVisible();
      await send.click();
      await expect(page.getByText(warning)).toBeVisible();
      expect(sends).toEqual([]);
      await confirm.click();
      await expect(confirm).toBeHidden();
      expect(draft?.metadata.composerEmail).toBe(inboxEmail);
      await send.click();
      await expect(page.getByText(unsaved, { exact: true })).toBeVisible();
      expect(sends).toHaveLength(1);
      expect(sends[0]).toMatchObject({ content: unsaved, channel: "EMAIL", expectedEmail: inboxEmail });
      expect(errors).toEqual([]);
      return;
    }
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(page.getByText(content, { exact: true })).toBeVisible();
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ content, channel: "EMAIL", action: "SEND", expectedEmail: address, clientRequestId: expect.any(String) });
    expect(sends[0]).not.toHaveProperty("replyToMessageId");
    expect(errors).toEqual([]);
  });
}
