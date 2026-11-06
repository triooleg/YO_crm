import { expect, test, type Page } from "@playwright/test";
import { communicationsUi as ui } from "../lib/i18n";

const clientId = "invoice-client";
const invoicesPath = "/api/finance/clients/" + clientId + "/invoices";
const pdfPath = invoicesPath + "/saved-2/document";
const invoices = [
  { id: "saved-1", number: "INV-001", orderNumber: "YO-101", issueDate: "2026-11-01" },
  { id: "saved-2", number: "INV-002", orderNumber: "YO-102", issueDate: "2026-11-02" },
];
const pdf = Buffer.from("%PDF-1.4\n% Synthetic Inbox attachment fixture\n%%EOF");

type InvoiceChannel = "EMAIL" | "INSTAGRAM" | "WHATSAPP" | "FACEBOOK" | "CHATWOOT";
type SendRequest = { channel: InvoiceChannel; content?: string; attachment?: { name: string }; draftMessageId?: string; replyToMessageId?: string; clientRequestId: string };
const savedDraftId = "synthetic-server-draft-id";
const replyMessageId = "synthetic-reply-message-id";

async function setup(page: Page, channel: InvoiceChannel = "EMAIL", sendMode?: "success" | "fail-text" | "lose-first-attachment-response") {
  const client = {
    id: clientId, displayName: "Invoice QA", status: "LEAD", source: channel, orders: [],
    conversations: [channel, channel === "EMAIL" ? "INSTAGRAM" : "EMAIL"].map((value, index) => ({
      id: "conversation-" + value, channel: value, unreadCount: 0,
      lastMessageAt: index === 0 ? "2026-11-06T12:00:00Z" : "2026-11-06T11:00:00Z",
    })),
  };
  const otherClient = {
    ...client, id: "other-client", displayName: "Other QA",
    conversations: [{ ...client.conversations[0], id: "other-conversation" }],
  };
  const invoiceRequests: string[] = [];
  const deliveryRequests: string[] = [];
  const sends: SendRequest[] = [];
  const drafts = new Map<InvoiceChannel, { id: string; content: string }>();
  const deliveredText: string[] = [];
  const receivedMessage = {
    id: replyMessageId, externalId: "synthetic-provider-message", channel, content: "Synthetic incoming message",
    direction: "INBOUND", status: "RECEIVED", createdAt: "2026-11-06T12:00:00Z",
    metadata: { messageId: "<synthetic@example.test>", subject: "Synthetic subject" },
  };
  const consumedDrafts: string[] = [];
  const sendError = "Синтетический сбой доставки текста";
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { id: "owner", role: "OWNER", displayName: "QA", email: "qa@example.test" } } });
    if (path === "/api/branding") return route.fulfill({ json: {} });
    if (path === "/api/communications/unread-count") return route.fulfill({ json: { unreadCount: 0 } });
    if (path === "/api/communications") return route.fulfill({ json: { items: [client, otherClient], total: 2, hasMore: false } });
    if (path === "/api/communications/" + clientId || path === "/api/communications/" + otherClient.id) {
      return route.fulfill({ json: { messages: sendMode && path.endsWith("/" + clientId) ? [receivedMessage] : [] } });
    }
    if (path.includes("/drafts/") && request.method() === "PUT") {
      const draft = request.postDataJSON();
      drafts.set(draft.channel, { id: savedDraftId, content: draft.content });
      return route.fulfill({ json: {
        id: savedDraftId, direction: "OUTBOUND", status: "DRAFT", createdAt: "2026-11-06T12:00:00Z", ...draft,
      } });
    }
    if (path === "/api/communications/attachments") {
      deliveryRequests.push(path);
      if (!sendMode) return route.fulfill({ status: 500, json: {} });
      const file = request.postDataJSON();
      expect(file).toMatchObject({ name: "INV-002.pdf", mimeType: "application/pdf" });
      return route.fulfill({ json: {
        name: file.name, mimeType: file.mimeType, sizeBytes: pdf.length, path: "/api/communications/files/synthetic.pdf",
      } });
    }
    if (path.endsWith("/messages") && request.postDataJSON()?.action === "SEND") {
      deliveryRequests.push(path);
      const send: SendRequest = request.postDataJSON();
      sends.push(send);
      if (!sendMode) return route.fulfill({ status: 500, json: {} });
      if (send.draftMessageId && send.attachment) return route.fulfill({ status: 400, json: {
        message: "Вложение сохранённого черновика отправляется отдельно",
      } });
      const draft = send.draftMessageId ? drafts.get(send.channel) : undefined;
      if (send.draftMessageId && draft?.id !== send.draftMessageId) {
        return route.fulfill({ status: 404, json: { message: "Черновик не найден" } });
      }
      if (sendMode === "fail-text" && send.content) {
        return route.fulfill({ status: 502, json: { message: sendError } });
      }
      if (sendMode === "lose-first-attachment-response" && send.attachment && sends.length === 1) {
        return route.abort("failed");
      }
      const content = draft?.content ?? send.content ?? "";
      if (content) deliveredText.push(content);
      if (send.draftMessageId) {
        drafts.delete(send.channel);
        consumedDrafts.push(send.draftMessageId);
      }
      return route.fulfill({ json: {
        id: send.draftMessageId ?? "sent-" + sends.length,
        direction: "OUTBOUND", status: "SENT", content, channel: send.channel,
        createdAt: "2026-11-06T12:01:00Z",
      } });
    }
    if (path.startsWith(invoicesPath)) {
      expect(request.method()).toBe("GET");
      invoiceRequests.push(path);
      if (path === invoicesPath) return route.fulfill({ json: invoices });
      if (path === pdfPath) return route.fulfill({ body: pdf, contentType: "application/pdf" });
      return route.fulfill({ status: 404 });
    }
    return route.fulfill({ json: [] });
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/?section=inbox");
  await page.locator(".communications-client-list>button").filter({ hasText: client.displayName }).click();
  return { invoiceRequests, deliveryRequests, sends, drafts, consumedDrafts, deliveredText, sendError };
}

async function openPicker(page: Page) {
  await page.getByRole("button", { name: /Инвойс/ }).click();
  const dialog = page.getByRole("dialog", { name: ui.invoicePickerTitle });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("selects a saved invoice without an active order and stages its scoped PDF without sending", async ({ page }) => {
  const requests = await setup(page);
  const composer = page.getByPlaceholder(ui.writeToClient.replace("{name}", "Invoice QA"));
  await composer.fill("Synthetic draft");
  const dialog = await openPicker(page);
  await dialog.getByLabel(ui.invoicePickerSelect).selectOption({ label: "INV-002 · YO-102 · 02.11.2026" });
  await dialog.getByRole("button", { name: ui.invoicePickerAttach }).click();
  await expect(dialog).toBeHidden();
  await expect(composer).toHaveValue("Synthetic draft");
  await expect(page.getByText("INV-002.pdf", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: ui.sendMessage, exact: true })).toBeEnabled();
  expect(requests.invoiceRequests).toEqual([invoicesPath, pdfPath]);
  await page.getByLabel(ui.replyChannel).selectOption("INSTAGRAM");
  await expect(page.getByRole("button", { name: ui.sendMessage, exact: true })).toBeDisabled();
  await expect(page.getByText(ui.invoicePickerSwitchChannel)).toBeVisible();
  await page.getByLabel(ui.replyChannel).selectOption("EMAIL");
  await expect(composer).toHaveValue("Synthetic draft");
  await expect(page.getByRole("button", { name: ui.sendMessage, exact: true })).toBeEnabled();
  expect(requests.deliveryRequests).toEqual([]);
});

test("an existing attachment is preserved and Instagram offers a channel hint", async ({ page }) => {
  const requests = await setup(page, "INSTAGRAM");
  let dialog = await openPicker(page);
  await expect(dialog.getByText(ui.invoicePickerSwitchChannel)).toBeVisible();
  expect(requests.invoiceRequests).toEqual([]);
  await dialog.getByRole("button", { name: ui.close }).last().click();
  await page.getByLabel(ui.replyChannel).selectOption("EMAIL");
  await page.locator('input[type="file"]').setInputFiles({ name: "existing.pdf", mimeType: "application/pdf", buffer: pdf });
  dialog = await openPicker(page);
  await dialog.getByLabel(ui.invoicePickerSelect).selectOption("saved-2");
  await expect(dialog.getByRole("button", { name: ui.invoicePickerAttach })).toBeDisabled();
  await expect(dialog.getByText(ui.invoicePickerAttachmentOccupied)).toBeVisible();
  expect(requests.invoiceRequests).toEqual([invoicesPath]);
  expect(requests.deliveryRequests).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByText("existing.pdf", { exact: true })).toBeVisible();
});

for (const scope of ["channel", "client"] as const) test(`a ${scope} change cancels an in-flight PDF selection`, async ({ page }) => {
  const requests = await setup(page);
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route(url => url.pathname === pdfPath, async route => {
    await delayed;
    await route.fulfill({ body: pdf, contentType: "application/pdf" }).catch(() => undefined);
  });
  const dialog = await openPicker(page);
  await dialog.getByLabel(ui.invoicePickerSelect).selectOption("saved-2");
  const requested = page.waitForRequest(request => new URL(request.url()).pathname === pdfPath);
  await dialog.getByRole("button", { name: ui.invoicePickerAttach }).click();
  await requested;
  try {
    if (scope === "channel") await page.getByLabel(ui.replyChannel).selectOption("INSTAGRAM", { force: true });
    else await page.locator(".communications-client-list>button").filter({ hasText: "Other QA" })
      .evaluate(button => (button as HTMLButtonElement).click());
    await expect(dialog).toBeHidden();
  } finally {
    release();
  }
  await expect(page.getByText("INV-002.pdf", { exact: true })).toHaveCount(0);
  expect(requests.deliveryRequests).toEqual([]);
});

for (const channel of ["EMAIL", "WHATSAPP"] as const) test(`${channel} sends the invoice and consumes the autosaved draft separately`, async ({ page }) => {
  const requests = await setup(page, channel, "success");
  await page.getByRole("button", {
    name: channel === "EMAIL" ? `${ui.replyToEmail}: Synthetic subject` : ui.replyToSocialMessage,
    exact: true,
  }).press("Enter");
  const composer = page.getByPlaceholder(ui.writeToClient.replace("{name}", "Invoice QA"));
  await composer.fill("Synthetic saved draft");
  await expect(page.locator(".communications-draft-status")).toHaveText(ui.draftAutosaved);
  const dialog = await openPicker(page);
  await dialog.getByLabel(ui.invoicePickerSelect).selectOption("saved-2");
  await dialog.getByRole("button", { name: ui.invoicePickerAttach }).click();
  await expect(page.getByText("INV-002.pdf", { exact: true })).toBeVisible();
  expect(requests.sends).toEqual([]);
  await expect(page.getByText(ui.invoiceSeparateSend)).toBeVisible();
  await composer.fill("Latest saved reply");
  await page.getByRole("button", { name: ui.sendMessage, exact: true }).click();
  await expect.poll(() => requests.consumedDrafts).toEqual([savedDraftId]);
  expect(requests.sends).toHaveLength(2);
  const [file, text] = requests.sends;
  expect(file).toMatchObject({ channel, attachment: { name: "INV-002.pdf" }, replyToMessageId: replyMessageId });
  expect(file?.draftMessageId).toBeUndefined();
  expect(file?.content).toBeUndefined();
  expect(text).toMatchObject({ channel, content: "Latest saved reply", draftMessageId: savedDraftId, replyToMessageId: replyMessageId });
  expect(requests.deliveredText).toEqual(["Latest saved reply"]);
  expect(text?.attachment).toBeUndefined();
  expect(text?.clientRequestId).not.toEqual(file?.clientRequestId);
  expect(requests.drafts.has(channel)).toBe(false);
  await expect(composer).toHaveValue("");
  await expect(page.getByText("INV-002.pdf", { exact: true })).toHaveCount(0);
});

for (const channel of ["FACEBOOK", "CHATWOOT"] as const) test(`${channel} partial invoice delivery clears the attachment with notice on channel switch`, async ({ page }) => {
  const requests = await setup(page, channel, "fail-text");
  const composer = page.getByPlaceholder(ui.writeToClient.replace("{name}", "Invoice QA"));
  await composer.fill("Synthetic saved draft");
  await expect(page.locator(".communications-draft-status")).toHaveText(ui.draftAutosaved);
  const dialog = await openPicker(page);
  await dialog.getByLabel(ui.invoicePickerSelect).selectOption("saved-2");
  await dialog.getByRole("button", { name: ui.invoicePickerAttach }).click();
  await expect(page.getByText("INV-002.pdf", { exact: true })).toBeVisible();

  const send = page.getByRole("button", { name: ui.sendMessage, exact: true });
  await send.click();
  await expect(page.getByText(requests.sendError)).toBeVisible();
  await expect(send).toBeEnabled();
  expect(requests.sends).toHaveLength(2);
  expect(requests.sends[0]).toMatchObject({ channel, attachment: { name: "INV-002.pdf" } });
  expect(requests.sends[1]).toMatchObject({ channel, draftMessageId: savedDraftId });
  expect(requests.drafts.get(channel)?.id).toBe(savedDraftId);

  await page.getByLabel(ui.replyChannel).selectOption("EMAIL");
  await expect(page.getByText(/Инвойс убран из сообщения/)).toBeVisible();
  await expect(page.getByText("INV-002.pdf", { exact: true })).toHaveCount(0);
  await expect(send).toBeDisabled();
  expect(requests.sends).toHaveLength(2);

  await page.getByLabel(ui.replyChannel).selectOption(channel);
  await expect(composer).toHaveValue("Synthetic saved draft");
});

test("an invoice retry keeps the same attachment payload after autosave", async ({ page }) => {
  const requests = await setup(page, "EMAIL", "lose-first-attachment-response");
  const dialog = await openPicker(page);
  await dialog.getByLabel(ui.invoicePickerSelect).selectOption("saved-2");
  await dialog.getByRole("button", { name: ui.invoicePickerAttach }).click();
  await expect(page.getByText("INV-002.pdf", { exact: true })).toBeVisible();

  const composer = page.getByPlaceholder(ui.writeToClient.replace("{name}", "Invoice QA"));
  await composer.fill("Draft saved after the first attempt");
  const send = page.getByRole("button", { name: ui.sendMessage, exact: true });
  await send.click();
  await expect.poll(() => requests.sends.length).toBe(1);
  expect(requests.sends[0]?.content).toBeUndefined();
  expect(requests.sends[0]?.draftMessageId).toBeUndefined();

  await expect(page.locator(".communications-draft-status")).toHaveText(ui.draftAutosaved);
  await send.click();
  await expect.poll(() => requests.consumedDrafts).toEqual([savedDraftId]);
  expect(requests.sends).toHaveLength(3);
  expect(requests.sends[1]).toEqual(requests.sends[0]);
  expect(requests.sends[2]).toMatchObject({ draftMessageId: savedDraftId, content: "Draft saved after the first attempt" });
  expect(requests.deliveryRequests.filter(path => path.endsWith("/attachments"))).toHaveLength(1);
  await expect(composer).toHaveValue("");
});
