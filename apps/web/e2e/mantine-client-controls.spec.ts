import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { join } from "node:path";

const screenshotPath = (testInfo: TestInfo, name: string) =>
  process.env.YO_CRM_VISUAL_DIR ? join(process.env.YO_CRM_VISUAL_DIR, name) : testInfo.outputPath(name);

type ClientRecord = {
  id: string;
  displayName: string;
  firstName: string;
  lastName?: string;
  country?: string;
  phone?: string;
  instagram?: string;
  language?: string;
  athletes: Array<{ id: string; firstName: string; lastName?: string; discipline?: string; measurements: [] }>;
  orders: [];
  activities: [];
};

async function mockClients(page: Page) {
  const writes: Array<{ path: string; body: unknown }> = [];
  const clients: ClientRecord[] = [
    { id: "client-eve", displayName: "Eve Emeterio", firstName: "Eve", country: "Spain", athletes: [], orders: [], activities: [] },
    { id: "client-anna", displayName: "Anna First", firstName: "Anna", country: "Italy", athletes: [], orders: [], activities: [] },
  ];

  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path === "/api/auth/me") return route.fulfill({ json: { user: { email: "qa@yoleotard.local", displayName: "QA Operator", role: "OWNER" } } });
    if (path === "/api/branding") return route.fulfill({ json: {} });
    if (method === "GET" && path === "/api/clients") {
      const search = (url.searchParams.get("search") || "").toLowerCase();
      return route.fulfill({ json: clients.filter(client => client.displayName.toLowerCase().includes(search)) });
    }
    if (method === "POST" && path === "/api/clients") {
      const body = request.postDataJSON();
      writes.push({ path, body });
      const created: ClientRecord = {
        id: "client-new",
        displayName: `${body.firstName} ${body.lastName}`.trim(),
        ...body,
        athletes: [], orders: [], activities: [],
      };
      clients.unshift(created);
      return route.fulfill({ json: created });
    }
    const athleteMatch = path.match(/^\/api\/clients\/([^/]+)\/athletes$/);
    if (method === "POST" && athleteMatch) {
      const body = request.postDataJSON();
      writes.push({ path, body });
      clients.find(client => client.id === athleteMatch[1])?.athletes.push({ id: "athlete-new", ...body, measurements: [] });
      return route.fulfill({ json: { id: "athlete-new", ...body } });
    }
    const mergeMatch = path.match(/^\/api\/clients\/([^/]+)\/merge$/);
    if (method === "POST" && mergeMatch) {
      const body = request.postDataJSON();
      writes.push({ path, body });
      return route.fulfill({ json: { id: mergeMatch[1] } });
    }
    const suggestionsMatch = path.match(/^\/api\/clients\/([^/]+)\/merge-suggestions$/);
    if (method === "GET" && suggestionsMatch) {
      return route.fulfill({ json: clients.filter(client => client.id !== suggestionsMatch[1]).map(client => ({ ...client, reasons: ["NAME"], channels: ["INSTAGRAM"] })) });
    }
    const detailMatch = path.match(/^\/api\/clients\/([^/]+)$/);
    if (method === "GET" && detailMatch) {
      const client = clients.find(item => item.id === detailMatch[1]);
      return client ? route.fulfill({ json: client }) : route.fulfill({ status: 404, json: { message: "CLIENT_NOT_FOUND" } });
    }
    return route.fulfill({ status: 501, json: { message: `Unexpected test route: ${method} ${path}` } });
  });
  return writes;
}

for (const viewport of [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Mantine-контролы клиентов сохраняют сценарии и payload — ${viewport.name}`, async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    const writes = await mockClients(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/?section=clients");

    const profileMenu = page.getByRole("button", { name: "Меню профиля" });
    await profileMenu.click();
    await expect(page.getByRole("menuitem", { name: "Настройки" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(profileMenu).toBeFocused();

    const search = page.getByPlaceholder("Имя, телефон, Instagram…");
    await expect(search).toHaveClass(/mantine-TextInput-input/);
    await search.fill("Anna");
    await expect(page.getByRole("button", { name: /Anna First/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Eve Emeterio/ })).toBeHidden();
    await search.fill("");

    const createButton = page.getByRole("button", { name: "+ Новый клиент", exact: true });
    await createButton.click();
    let dialog = page.getByRole("dialog", { name: "Новый клиент" });
    await expect(dialog.getByLabel("Имя")).toBeFocused();
    await dialog.screenshot({ path: screenshotPath(testInfo, `mantine-client-create-${viewport.width}x${viewport.height}.png`) });
    await page.keyboard.press("Escape");
    await expect(createButton).toBeFocused();
    await createButton.click();
    dialog = page.getByRole("dialog", { name: "Новый клиент" });
    await dialog.getByLabel("Имя").fill("Maria");
    await dialog.getByLabel("Фамилия").fill("Lopez");
    await dialog.getByLabel("Страна").fill("Spain");
    await dialog.getByLabel("Телефон").fill("+34600111222");
    await dialog.getByLabel("Instagram").fill("@maria_lopez");
    await dialog.getByLabel("Язык общения").fill("es");
    await dialog.getByRole("button", { name: "Создать клиента" }).click();
    await expect(page.getByRole("heading", { name: "Maria Lopez" })).toBeVisible();

    const clientTabs = page.getByRole("tablist", { name: "Разделы карточки клиента" });
    const mainTab = clientTabs.getByRole("tab", { name: "Главное" });
    const ordersTab = clientTabs.getByRole("tab", { name: "Заказы" });
    await expect(mainTab).toHaveAttribute("aria-selected", "true");
    await mainTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(ordersTab).toHaveAttribute("aria-selected", "true");
    await mainTab.click();

    const addAthlete = page.getByRole("button", { name: "+ Добавить", exact: true });
    await addAthlete.click();
    dialog = page.getByRole("dialog", { name: "Новый спортсмен" });
    await expect(dialog.getByLabel("Имя")).toBeFocused();
    await dialog.screenshot({ path: screenshotPath(testInfo, `mantine-athlete-create-${viewport.width}x${viewport.height}.png`) });
    await page.keyboard.press("Escape");
    await expect(addAthlete).toBeFocused();
    await addAthlete.click();
    dialog = page.getByRole("dialog", { name: "Новый спортсмен" });
    await dialog.getByLabel("Имя").fill("Sofia");
    await dialog.getByLabel("Фамилия").fill("Lopez");
    await dialog.getByLabel("Дисциплина").selectOption("RHYTHMIC_GYMNASTICS");
    await dialog.getByRole("button", { name: "Добавить спортсмена" }).click();
    await expect(page.getByText("Sofia Lopez")).toBeVisible();

    const mergeButton = page.getByRole("button", { name: /Объединить клиентов/ });
    await mergeButton.click();
    dialog = page.getByRole("dialog", { name: "Объединение карточек клиента" });
    const mergeSelect = dialog.getByLabel("Карточка для объединения");
    await expect(mergeSelect).toBeFocused();
    await dialog.screenshot({ path: screenshotPath(testInfo, `mantine-client-merge-${viewport.width}x${viewport.height}.png`) });
    await page.keyboard.press("Escape");
    await expect(mergeButton).toBeFocused();
    await mergeButton.click();
    dialog = page.getByRole("dialog", { name: "Объединение карточек клиента" });
    await dialog.getByLabel("Карточка для объединения").selectOption("client-eve");
    await dialog.getByRole("button", { name: "Объединить", exact: true }).click();

    expect(writes).toEqual([
      { path: "/api/clients", body: { firstName: "Maria", lastName: "Lopez", country: "Spain", phone: "+34600111222", instagram: "@maria_lopez", language: "es" } },
      { path: "/api/clients/client-new/athletes", body: { firstName: "Sofia", lastName: "Lopez", discipline: "RHYTHMIC_GYMNASTICS" } },
      { path: "/api/clients/client-new/merge", body: { sourceClientId: "client-eve" } },
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    expect(pageErrors).toEqual([]);
    await page.screenshot({ path: screenshotPath(testInfo, `mantine-clients-${viewport.width}x${viewport.height}.png`), fullPage: true });
  });
}


test('client card shows its real status and existing files instead of a placeholder',async({page})=>{
 await mockClients(page);await page.route('**/api/clients/client-eve',route=>route.fulfill({json:{id:'client-eve',displayName:'Eve Emeterio',status:'INACTIVE',athletes:[],orders:[],activities:[],files:[{id:'file-1',name:'Actual-file.pdf',path:'00000000-0000-4000-8000-000000000001.pdf',sizeBytes:20,createdAt:'2026-10-01T12:00:00Z'}]}}));
 await page.goto('/?section=clients&clientId=client-eve');await expect(page.getByText('Неактивный клиент',{exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Файлы',exact:true}).click();await expect(page.getByRole('link',{name:/Actual-file.pdf/})).toHaveAttribute('href',/client-files/);
});
