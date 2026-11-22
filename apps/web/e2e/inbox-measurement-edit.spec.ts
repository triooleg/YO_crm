import { expect, test, type Page } from "@playwright/test";

async function mockInbox(page: Page) {
  const postedBodies: Record<string, unknown>[] = [];
  const athlete = {
    id: "athlete-inbox-measurements",
    firstName: "Дарья",
    discipline: "RHYTHMIC_GYMNASTICS",
    measurements: [{
      id: "measurement-current",
      measuredAt: "2026-09-20T09:00:00.000Z",
      unit: "cm",
      values: { standardHeight: 162, m1: 82, m2: 67, m3: 87, m15: 145 },
    }],
  };
  const client = {
    id: "client-inbox-measurements",
    displayName: "Клиент с размерами",
    status: "ACTIVE",
    source: "FACEBOOK",
    preferredChannel: "FACEBOOK",
    orders: [],
    buyerSummary: { purchaseCount: 0, paymentTotals: [] },
    linkedChannels: ["FACEBOOK"],
    conversations: [{ id: "conversation-inbox-measurements", channel: "FACEBOOK", lastMessageAt: "2026-09-20T09:00:00.000Z", unreadCount: 0, messages: [{ content: "Размеры отправлены", createdAt: "2026-09-20T09:00:00.000Z" }] }],
  };
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path === `/api/clients/${client.id}/athletes/${athlete.id}/measurements`) {
      postedBodies.push(request.postDataJSON());
      athlete.measurements[0] = { ...athlete.measurements[0], id: "measurement-corrected", measuredAt: "2026-09-27T09:00:00.000Z", values: request.postDataJSON() };
      return route.fulfill({ json: athlete.measurements[0] });
    }
    if (request.method() !== "GET") return route.fulfill({ status: 405, json: { message: `Unexpected ${request.method()} ${path}` } });
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { email: "qa@yoleotard.local", displayName: "QA", role: "OWNER" } } });
    if (path === "/api/branding") return route.fulfill({ json: {} });
    if (path === "/api/communications/templates") return route.fulfill({ json: [] });
    if (path === "/api/communications") return route.fulfill({ json: { items: [client], total: 1, hasMore: false, channelCounts: { FACEBOOK: 1 } } });
    if (path === `/api/communications/${client.id}`) return route.fulfill({ json: { messages: [{ id: "message-inbox-measurements", content: "Размеры отправлены", channel: "FACEBOOK", direction: "INBOUND", status: "SENT", createdAt: "2026-09-20T09:00:00.000Z" }] } });
    if (path === `/api/clients/${client.id}`) return route.fulfill({ json: { ...client, athletes: [athlete], workTasks: [] } });
    return route.fulfill({ status: 501, json: { message: `Unexpected test route: ${path}` } });
  });
  return postedBodies;
}

test("mobile chat gives the message list priority and keeps chat actions reachable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await mockInbox(page);
  await page.goto("/?section=inbox");

  const chat = page.locator(".communications-chat");
  const messages = chat.locator(".communications-messages");
  const actions = chat.getByRole("button", { name: "Действия чата" });
  const spam = chat.getByRole("button", { name: "Пометить как спам" });
  await expect(chat.getByText("Размеры отправлены", { exact: true })).toBeVisible();
  await expect(chat.getByRole("button", { name: "Чаты" })).toBeVisible();
  await expect(chat.getByRole("button", { name: "Карточка клиента" })).toBeVisible();
  await expect(spam).toBeHidden();
  await expect(chat.locator(".communications-ai-manual-hint")).toBeHidden();
  const compact = (await messages.boundingBox())!.height;
  await expect(page.locator(".crm-topbar")).toHaveCSS("height", "48px");
  await page.screenshot({ path: testInfo.outputPath("inbox-compact.png") });
  expect(compact).toBeGreaterThan(300);
  await actions.click();
  await expect(spam).toBeVisible();
  await expect.poll(async () => (await messages.boundingBox())!.height).toBeLessThan(compact);
  await actions.click();
  await expect(spam).toBeHidden();
  await chat.locator('.communications-compose input[type="file"]').setInputFiles("public/meta/crm-pwa-192.png");
  await expect(chat.locator(".communications-selected-attachment img")).toBeVisible();
  await expect(chat.getByRole("button", { name: "Отправить", exact: true })).toBeEnabled();
});

for (const viewport of [{ name: "wide", width: 1920, height: 1080 }, { name: "desktop", width: 1366, height: 768 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`текущие размеры корректируются из Входящих — ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const postedBodies = await mockInbox(page);
    await page.goto("/?section=inbox");
    if (viewport.width < 700) {
      await page.getByRole("button", { name: "Карточка клиента" }).click();
      const contextPanel = page.locator(".communications-context-panel.open");
      await expect.poll(async () => {
        const box = await contextPanel.boundingBox();
        return box ? Math.ceil(box.x + box.width) : Number.POSITIVE_INFINITY;
      }).toBeLessThanOrEqual(viewport.width);
      const contextBox = await contextPanel.boundingBox();
      expect(contextBox).not.toBeNull();
      expect(contextBox!.x).toBeGreaterThanOrEqual(0);
      expect(contextBox!.x + contextBox!.width).toBeLessThanOrEqual(viewport.width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    const editButton = page.getByRole("button", { name: "Изменить размеры" });
    await expect(editButton).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`inbox-measurement-card-${viewport.width}x${viewport.height}.png`), fullPage: true });
    await editButton.click();

    const dialog = page.getByRole("dialog", { name: "Изменить размеры" });
    await expect(dialog.getByLabel("1. Обхват груди (под мышками)")).toHaveValue("82");
    await expect(dialog.getByRole("spinbutton", { name: /^15\. / })).toHaveValue("145");
    await page.screenshot({ path: testInfo.outputPath(`inbox-measurement-drawer-${viewport.width}x${viewport.height}.png`), fullPage: true });
    await dialog.getByLabel("1. Обхват груди (под мышками)").fill("82.5");
    await dialog.getByRole("button", { name: "Сохранить замеры" }).click();

    await expect(dialog).toBeHidden();
    expect(postedBodies).toHaveLength(1);
    expect(postedBodies[0]).toMatchObject({ standardHeight: 162, m1: 82.5, m2: 67, m3: 87, m15: 145 });
  });
}
