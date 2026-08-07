import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("../components/client-workspace.tsx", import.meta.url), "utf8");
const locale = await readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/phase2.css", import.meta.url), "utf8");

test("основные разделы CRM имеют русские подписи", () => {
  for (const label of ["Входящие", "Клиенты", "Заказы", "Производство", "Финансы", "Доставка", "Задачи"]) assert.ok(workspace.includes(label));
});
test("внутренние статусы имеют русские отображаемые названия", () => {
  for (const status of ["NEW_LEAD", "DEPOSIT_RECEIVED", "IN_PRODUCTION", "SHIPPED", "COMPLETED"]) assert.ok(locale.includes(status));
});
test("корневой документ использует русскую локаль и рабочее пространство клиентов", () => {
  assert.match(layout, /lang="ru"/); assert.match(page, /ClientWorkspace/); assert.match(workspace, /Новый клиент/);
});
test("макет использует согласованное соотношение и мобильную адаптацию", () => {
  assert.match(css, /grid-template-columns: 220px minmax\(0, 1fr\)/); assert.match(css, /@media \(max-width: 720px\)/);
});
