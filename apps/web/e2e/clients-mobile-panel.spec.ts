import { expect, test } from "@playwright/test";
import { clientsWorkspaceUi as ui } from "../lib/i18n";
import { fixture } from "../components/clients/tests/fixtures";

for (const width of [320, 390]) {
  test(`mobile clients keep the list visible and restore controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const calls = await fixture(page);
    await page.goto("/?section=clients");
    const search = page.getByRole("textbox", { name: ui.search, exact: true });
    const table = page.locator(".clients-table");
    await expect(table.locator("tbody tr")).toHaveCount(3);
    await expect(page.locator(".crm-topbar")).toBeHidden();
    await expect(page.locator(".clients-page-header")).toBeHidden();
    await expect(page.getByRole("button", { name: "+ Новый клиент", exact: true })).toBeHidden();
    const panel = page.getByRole("button", { name: "Показать панель клиентов", exact: true });
    await expect(panel).toBeVisible();
    await expect(search).toBeVisible();
    expect((await table.boundingBox())!.y).toBeLessThan(110);
    await page.getByRole("checkbox", { name: `${ui.select}: scarletsteward`, exact: true }).check();
    await table.evaluate(element => { element.dataset.mobileIdentity = "same-table"; });
    const horizontal = page.locator(".clients-table-panel .mantine-ScrollArea-viewport");
    await horizontal.evaluate(element => { element.scrollLeft = 70; });
    const listGets = calls.filter(call => call.path === "/api/clients").length;
    await panel.press("Enter");
    await expect(page.locator(".crm-topbar")).toBeVisible();
    await expect(page.locator(".clients-page-header")).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Новый клиент", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Фильтры", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Период создания", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Только список", exact: true }).click();
    await expect(panel).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Период создания", exact: true })).toBeHidden();
    await expect(table).toHaveAttribute("data-mobile-identity", "same-table");
    await expect(page.getByRole("checkbox", { name: `${ui.select}: scarletsteward`, exact: true })).toBeChecked();
    expect(await horizontal.evaluate(element => element.scrollLeft)).toBe(70);
    expect(calls.filter(call => call.path === "/api/clients").length).toBe(listGets);
    // Open a client from the real table after restoring its leading columns.
    await horizontal.evaluate(element => { element.scrollLeft = 0; });
    await page.getByRole("button", { name: "scarletsteward", exact: true }).click();
    await expect(page.locator(".clients-drawer")).toBeVisible();
    await page.getByRole("button", { name: ui.back, exact: true }).click();
    await expect(panel).toBeVisible();
    await search.fill("Gina");
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await panel.click();
    await page.getByRole("button", { name: "Только список", exact: true }).click();
    await expect(search).toHaveValue("Gina");
    await expect(table.locator("tbody tr")).toHaveCount(1);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `../../.local/mobile-clients/clients-${width}.png` });
  });
}

test("desktop clients retain panels", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await fixture(page);
  await page.goto("/?section=clients");
  await expect(page.locator(".clients-table tbody tr")).toHaveCount(3);
  await expect(page.locator(".crm-topbar")).toBeVisible();
  await expect(page.locator(".clients-page-header")).toBeVisible();
  await expect(page.getByRole("button", { name: "Показать панель клиентов", exact: true })).toBeHidden();
});

for (const width of [720, 721]) {
  test(`client compact mode respects the mobile boundary at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    await page.goto("/?section=clients");
    await expect(page.locator(".clients-table tbody tr")).toHaveCount(3);
    const panel = page.getByRole("button", { name: "Показать панель клиентов", exact: true });
    if (width === 720) {
      await expect(panel).toBeVisible();
      await expect(page.locator(".crm-topbar")).toBeHidden();
      await panel.click();
      await expect(page.locator(".crm-topbar")).toBeVisible();
    } else {
      await expect(panel).toBeHidden();
      await expect(page.locator(".crm-topbar")).toBeVisible();
    }
  });
}
