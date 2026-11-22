import { expect, test } from "@playwright/test";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWkcAAAAASUVORK5CYII=", "base64");
const image = { path: "11111111-1111-4111-8111-111111111111.png", name: "design.png", mimeType: "image/png" };
const second = { ...image, path: "22222222-2222-4222-8222-222222222222.png", name: "back.png" };

for (const channel of ["EMAIL", "WHATSAPP", "CHATWOOT", "FACEBOOK", "INSTAGRAM"] as const) {
 for (const files of [[image], [image, second]]) {
  test(`${channel} sends ${files.length} selected photos and the saved reply`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: channel === "WHATSAPP" ? 390 : 1366, height: 844 });
    const createdAt = "2026-11-20T08:00:00Z";
    const draftId = "saved-draft-with-attachment";
    const client = {
      id: "attachment-client", displayName: "Attachment QA", source: channel, preferredChannel: channel,
      email: "buyer@example.test", linkedChannels: [channel], orders: [],
      conversations: [{ id: "channel", channel, lastMessageAt: createdAt, unreadCount: 0 }],
    };
    let draftText = "Original draft";
    const legacyAttachment = channel === "EMAIL" ? { attachments: [image] } : undefined;
    let consumed = false;
    let uploads = 0;
    let draftSaves = 0;
    let adoptedDraftKey: string | undefined;
    const sent: { content?: string; attachment?: typeof image; attachments?: typeof image[]; draftMessageId?: string }[] = [];
    const retrySecond = channel === "WHATSAPP" && files.length === 2;
    let secondAttemptId: string | undefined;
    let secondTries = 0;
    const retryBundle = channel === "EMAIL" && files.length === 2;
    let bundleTries = 0;
    let firstBundle: unknown;
    let rejectedRequestId: string | undefined;
    const replyId = "incoming-email-for-reply";
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error" && !((retrySecond || retryBundle) && message.text().includes("409")) && !(retryBundle && message.text().includes("404")))
        errors.push(message.text());
    });

    await page.route("**/api/**", route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const draft = () => ({ id: draftId, channel, direction: "OUTBOUND", status: "DRAFT", content: draftText, createdAt, metadata: { ...legacyAttachment, composerDraftKey: adoptedDraftKey } });
      if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: "qa", role: "OWNER", displayName: "QA" } } });
      if (path === "/api/communications") return route.fulfill({ json: { items: [client], total: 1, hasMore: false } });
      if (path === "/api/communications/templates") return route.fulfill({ json: retryBundle ? [{ id: "template", name: "QA reply template", language: "ru", content: "Unwanted replacement" }] : [] });
      if (path === "/api/communications/attachment-client") {
        const incoming = { id: replyId, channel, direction: "INBOUND", status: "RECEIVED", content: "Incoming email", createdAt, metadata: { messageId: "<qa@example.test>", subject: "QA thread" } };
        return route.fulfill({ json: { messages: [...(retryBundle ? [incoming] : []), ...(consumed ? [] : [draft()])] } });
      }
      if (path === "/api/clients/attachment-client") return route.fulfill({ json: { ...client, athletes: [], workTasks: [] } });
      if (path.startsWith("/api/communications/attachment-client/drafts/") && request.method() === "PUT") {
        draftSaves++;
        const data = request.postDataJSON();
        if (legacyAttachment && !adoptedDraftKey) expect(data.legacyDraftId).toBe(draftId);
        adoptedDraftKey = path.split("/").at(-1);
        draftText = data.content;
        return route.fulfill({ json: draft() });
      }
      if (path === "/api/communications/attachments" && request.method() === "POST") {
        const file = files[uploads++];
        expect(request.postDataJSON()).toMatchObject({ name: file?.name, mimeType: file?.mimeType });
        return route.fulfill({ json: file });
      }
      if (["/api/communications/attachment-client/messages", "/api/communications/attachment-client/message-bundles"].includes(path) && request.method() === "POST") {
        const body = request.postDataJSON();
        const { content, attachment, attachments, draftMessageId, clientRequestId } = body;
        expect(path.endsWith("/message-bundles")).toBe(Array.isArray(attachments));
        if (retryBundle) {
          bundleTries++;
          expect(body.replyToMessageId).toBe(replyId);
          if (bundleTries === 1) {
            rejectedRequestId = clientRequestId;
            return route.fulfill({ status: 404, json: { message: "Маршрут отправки недоступен" } });
          }
          expect(clientRequestId).not.toBe(rejectedRequestId);
          if (bundleTries === 2) {
            firstBundle = body;
            return route.fulfill({ status: 409, json: { message: "Провайдер ещё проверяет письмо" } });
          }
          expect(body).toEqual(firstBundle);
        }
        if (retrySecond && attachment?.name === second.name) {
          secondTries++;
          if (secondTries === 1) {
            secondAttemptId = clientRequestId;
            return route.fulfill({ status: 409, json: { message: "Провайдер ещё проверяет отправку" } });
          }
          expect(clientRequestId).toBe(secondAttemptId);
        }
        expect(body).toMatchObject({ channel, action: "SEND", clientRequestId: expect.any(String) });
        if (draftMessageId) {
          expect(draftMessageId).toBe(draftId);
          expect(consumed).toBe(false);
          expect(draftText).toBe(content);
          consumed = true;
        }
        sent.push({ content, attachment, attachments, draftMessageId });
        return route.fulfill({ json: {
          id: draftMessageId || "sent-" + sent.length, channel, createdAt, status: "SENT",
          direction: "OUTBOUND", content: draftMessageId ? draftText : content || image.name,
        } });
      }
      return route.fulfill({ json: [] });
    });

    await page.goto("/?section=inbox&clientId=attachment-client");
    const composer = page.getByPlaceholder("Написать Attachment QA…");
    await expect(composer).toHaveValue("Original draft");
    if (retryBundle) await page.getByRole("button", { name: /QA thread/ }).click();
    const content = "Updated draft with an image";
    await composer.fill(content);
    if (legacyAttachment) {
      await expect.poll(() => draftSaves).toBeGreaterThan(0);
      await page.getByRole("button", { name: "Отправить", exact: true }).click();
      await expect(page.getByText("Прикрепите файл из сохранённого черновика заново перед отправкой.")).toBeVisible();
      expect(sent).toEqual([]);
    }
    const picker = page.locator('input[type="file"][accept*="image"]').first();
    await expect(picker).toHaveAttribute("multiple", "");
    await picker.setInputFiles(files.map(file => ({ name: file.name, mimeType: file.mimeType, buffer: png })));
    await expect(page.locator(".communications-selected-attachment")).toHaveCount(files.length);
    if (channel === "EMAIL" && files.length === 2) {
      await picker.setInputFiles({ name: "unused.png", mimeType: image.mimeType, buffer: png });
      await page.getByRole("button", { name: "Удалить вложение unused.png" }).click();
      await expect(page.locator(".communications-selected-attachment")).toHaveCount(2);
    }
    if (channel === "EMAIL" || channel === "WHATSAPP") {
      await page.screenshot({ path: testInfo.outputPath("composer.png") });
    }
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    if (retryBundle) {
      const removePhoto = page.getByRole("button", { name: "Удалить вложение back.png" });
      const template = page.getByRole("button", { name: "QA reply template" }).first();
      const cancelReply = page.locator("#email-reply-target button");
      await expect(page.getByText("Маршрут отправки недоступен")).toBeVisible();
      await expect(composer).toHaveValue(content);
      await expect(composer).not.toHaveAttribute("readonly", "");
      await expect(removePhoto).toBeEnabled();
      await expect(cancelReply).toBeEnabled();
      await page.getByRole("button", { name: "Отправить", exact: true }).click();
      await expect(page.getByText("Провайдер ещё проверяет письмо")).toBeVisible();
      await expect(page.getByRole("button", { name: "Удалить вложение back.png" })).toBeDisabled();
      await expect(composer).toHaveAttribute("readonly", "");
      await expect(cancelReply).toBeDisabled();
      await expect(template).toBeDisabled();
      await page.getByRole("button", { name: "Отправить", exact: true }).click();
      expect(bundleTries).toBe(3);
    }
    if (retrySecond) {
      await expect(page.getByText("Провайдер ещё проверяет отправку")).toBeVisible();
      await expect(composer).toHaveValue("");
      await page.getByRole("button", { name: "Отправить", exact: true }).click();
      expect(secondTries).toBe(2);
    }
    await expect(composer).toHaveValue("");
    await expect(page.locator(".communications-selected-attachment")).toHaveCount(0);

    const splitText = channel === "FACEBOOK" || channel === "INSTAGRAM";
    const bundle = channel === "EMAIL" || channel === "CHATWOOT";
    const expected: typeof sent = bundle && files.length > 1
      ? [{ content, attachments: files, draftMessageId: draftId }]
      : files.map((attachment, index) => ({
        content: !splitText && index === 0 ? content : undefined,
        draftMessageId: !splitText && index === 0 ? draftId : undefined,
        attachment,
      }));
    if (splitText) expected.push({ content, draftMessageId: draftId });
    expect(sent).toEqual(expected);
    expect(draftSaves).toBeGreaterThan(0);
    expect(uploads).toBe(files.length);
    expect(errors).toEqual([]);
  });
}
}
