import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  workspace = await readFile(
    new URL("../components/client-workspace.tsx", import.meta.url),
    "utf8",
  ),
  shell = await readFile(new URL("../components/crm-shell.tsx", import.meta.url), "utf8"),
  locale = await readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8"),
  layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  css = await readFile(new URL("../app/phase2.css", import.meta.url), "utf8"),
  typography = await readFile(new URL("../app/typography.css", import.meta.url), "utf8"),
  sections = await readFile(new URL("../lib/crm-sections.ts", import.meta.url), "utf8");

test("основные разделы CRM используют централизованные русские подписи", () => {
  assert.match(shell, /navigationUi/);
  for (const key of [
    "inbox",
    "clients",
    "orders",
    "production",
    "finance",
    "shipping",
    "tasks",
  ])
    assert.match(locale, new RegExp(key + "\\s*:\\s*\"[^\"]+\""));
});

test("внутренние статусы имеют русские названия", () => {
  for (const status of [
    "NEW_LEAD",
    "DEPOSIT_RECEIVED",
    "IN_PRODUCTION",
    "SHIPPED",
    "COMPLETED",
  ])
    assert.ok(locale.includes(status));
});

test("корневой документ использует русскую локаль", () => {
  assert.match(layout, /lang="ru"/);
  assert.match(page, /CrmShell/);
  assert.match(workspace, /Новый клиент|Новый клиент/);
});

test("макет клиентов использует согласованное соотношение", () => {
  assert.match(css, /grid-template-columns: 220px minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 720px\)/);
});

test("global typography uses Ubuntu family with Cyrillic-safe fallback", () => {
  assert.match(typography, /--font-ui:Ubuntu,-apple-system,/);
  assert.ok(layout.includes("lang=\"ru\""));
});

test("prototype typography scale is global", async () => {
  assert.match(typography, /--text-ui:14px/);
  assert.match(typography, /--text-page-title:29px/);
  assert.match(
    typography,
    /button,input,select,textarea\{[^}]*font-size:var\(--text-ui\)/,
  );
  assert.match(typography, /h1\{font-size:var\(--text-page-title\)!important/);
});

test("font variables resolved from root declarations", async () => {
  assert.match(typography, /:root\{--font-ui:/);
  assert.doesNotMatch(typography, /--font-ui:var\(--font-ubuntu\)/);
});

test("collapsed navigation keeps Russian accessible names", () => {
  assert.match(shell, /aria-label=\{id==="inbox"&&unreadCount\?[\s\S]*:name\}/);
});

test("CRM без указанного раздела открывает Входящие, а не скрытую страницу клиентов", () => {
  assert.match(sections, /: "inbox"/);
  assert.match(shell, /initialSectionId="inbox"/);
});
