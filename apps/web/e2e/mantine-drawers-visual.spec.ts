import { expect, test, type Page, type Route } from "@playwright/test";

const client = {
  id: "client-visual",
  displayName: "Visual Client",
  firstName: "Visual",
  status: "CLIENT",
  source: "MANUAL",
  athletes: [{
    id: "athlete-visual",
    firstName: "Anna",
    measurements: [{
      id: "measurement-visual",
      measuredAt: "2026-09-01T12:00:00.000Z",
      source: "Ручной ввод",
      notes: "Контрольная карточка для визуальной проверки.",
      values: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`m${index + 1}`, 50 + index / 2])),
    }],
  }],
  orders: [],
  activities: [],
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function mockClient(page: Page, mutate: (route: Route, path: string) => Promise<boolean>) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (await mutate(route, path)) return;
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { email: "qa@yoleotard.local", displayName: "QA", role: "OWNER" } } });
    if (path === "/api/branding") return route.fulfill({ json: {} });
    if (path === "/api/clients") return route.fulfill({ json: [client] });
    if (path === `/api/clients/${client.id}`) return route.fulfill({ json: client });
    if (path === "/api/orders/defaults") return route.fulfill({ json: { depositPercent: 50 } });
    if (path === "/api/orders/model-image") return route.fulfill({ json: { path: "model.jpg" } });
    return route.fulfill({ status: 501, json: { message: `Unexpected ${request.method()} ${path}` } });
  });
}

async function assertViewport(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  const dialog = page.getByRole("dialog");
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.height).toBeLessThanOrEqual(viewport.height);
}

for (const viewport of [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Drawer заказа: open, busy и error — ${viewport.name}`, async ({ page }, testInfo) => {
    const gate = deferred();
    let mode: "busy" | "error" = "busy";
    await mockClient(page, async (route, path) => {
      if (path === "/api/orders" && route.request().method() === "POST") {
        if (mode === "busy") {
          await gate.promise;
          await route.fulfill({ json: { id: "order-created" } });
        } else {
          await route.fulfill({ status: 500, json: { message: "ORDER_VISUAL_ERROR" } });
        }
        return true;
      }
      return false;
    });
    await page.setViewportSize(viewport);
    await page.goto("/?section=clients");
    await page.getByRole("button", { name: /Visual Client/ }).click();
    await page.getByRole("button", { name: "+ Новый заказ" }).click();
    let dialog = page.getByRole("dialog", { name: "Новый заказ" });
    await assertViewport(page);
    await dialog.screenshot({ path: testInfo.outputPath(`order-open-${viewport.width}x${viewport.height}.png`) });
    await dialog.getByLabel("Описание изделия").fill("Купальник Aurora");
    await dialog.getByLabel("Общая цена").fill("320");
    await dialog.locator('input[type="file"]').setInputFiles({ name: "model.png", mimeType: "image/png", buffer: Buffer.from("png") });
    await dialog.getByRole("button", { name: "Создать заказ" }).click();
    await expect(dialog.getByRole("button", { name: "Создание…" })).toBeDisabled();
    await dialog.screenshot({ path: testInfo.outputPath(`order-busy-${viewport.width}x${viewport.height}.png`) });
    gate.resolve();
    await expect(dialog).toBeHidden();

    mode = "error";
    await page.getByRole("button", { name: "+ Новый заказ" }).click();
    dialog = page.getByRole("dialog", { name: "Новый заказ" });
    await dialog.getByLabel("Описание изделия").fill("Купальник Aurora");
    await dialog.getByLabel("Общая цена").fill("320");
    await dialog.locator('input[type="file"]').setInputFiles({ name: "model.png", mimeType: "image/png", buffer: Buffer.from("png") });
    await dialog.getByRole("button", { name: "Создать заказ" }).click();
    const orderError = dialog.getByRole("alert");
    await expect(orderError).toContainText("ORDER_VISUAL_ERROR");
    await orderError.scrollIntoViewIfNeeded();
    await dialog.screenshot({ path: testInfo.outputPath(`order-error-${viewport.width}x${viewport.height}.png`) });
  });

  test(`Drawer замеров: editor, viewer и error — ${viewport.name}`, async ({ page }, testInfo) => {
    await mockClient(page, async (route, path) => {
      if (path.endsWith("/measurements") && route.request().method() === "POST") {
        await route.fulfill({ status: 409, json: { message: "MEASUREMENT_VISUAL_ERROR" } });
        return true;
      }
      return false;
    });
    await page.setViewportSize(viewport);
    await page.goto("/?section=clients");
    await page.getByRole("button", { name: /Visual Client/ }).click();
    await page.getByRole("button", { name: "+ Замеры" }).click();
    let dialog = page.getByRole("dialog", { name: "Новые замеры" });
    await assertViewport(page);
    await dialog.screenshot({ path: testInfo.outputPath(`measurement-editor-${viewport.width}x${viewport.height}.png`) });
    for (const name of ["1. Обхват груди (под мышками)", "2. Обхват талии (по резинке)", "3. Обхват бёдер", "15. Обхват через пах и плечо"]) {
      await dialog.getByLabel(name).fill("50");
    }
    await dialog.getByRole("button", { name: "Сохранить замеры" }).click();
    const measurementError = dialog.getByRole("alert");
    await expect(measurementError).toContainText("MEASUREMENT_VISUAL_ERROR");
    await measurementError.scrollIntoViewIfNeeded();
    await dialog.screenshot({ path: testInfo.outputPath(`measurement-error-${viewport.width}x${viewport.height}.png`) });
    await dialog.getByRole("button", { name: "Закрыть" }).click();

    await page.locator('button[title="Просмотреть замеры"]').click();
    dialog = page.getByRole("dialog", { name: "Замеры" });
    await assertViewport(page);
    await dialog.screenshot({ path: testInfo.outputPath(`measurement-viewer-${viewport.width}x${viewport.height}.png`) });
  });
}
