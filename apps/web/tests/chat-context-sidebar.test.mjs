import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [communications, shell, clients, tasks, finance, css, locale] = await Promise.all([
  read("../components/communications-workspace.tsx"),
  read("../components/crm-shell.tsx"),
  read("../components/client-workspace.tsx"),
  read("../components/tasks-workspace.tsx"),
  read("../components/finance-workspace.tsx"),
  read("../app/communications-workspace.css"),
  read("../lib/i18n.ts"),
]);

test("вариант A показывает постоянный обзор клиента в правой панели", () => {
  for (const className of [
    "communications-context-profile",
    "communications-context-actions",
    "communications-context-note",
    "communications-context-orders",
    "communications-context-next",
  ]) assert.match(communications, new RegExp(className));
  assert.match(css, /communications-context-actions/);
  assert.match(communications, /communications-context-toggle/);
  assert.match(communications, /aria-expanded=\{contextOpen\}/);
  assert.match(css, /communications-context-panel\.open/);
  for (const key of ["quickActions", "createTask", "createOrder", "createInvoice", "chatNote", "nextAction"])
    assert.match(locale, new RegExp(`${key}:`));
});

test("быстрые действия передают выбранного клиента в рабочую форму", () => {
  assert.match(shell, /<CommunicationsWorkspace onNavigate=\{navigate\}/);
  assert.match(communications, /onNavigate\?\.\("tasks",\{action:"new",clientId:client\.id/);
  assert.match(communications, /onNavigate\?\.\("clients",\{action:"new-order",clientId:client\.id/);
  assert.match(communications, /onNavigate\?\.\("finance",\{action:"new-invoice",orderId:activeOrders\[0\]\.id/);
  assert.match(tasks, /params\.get\("action"\)!=="new"/);
  assert.match(clients, /params\.get\("action"\)==="new-order"/);
  assert.match(finance, /params\.get\("action"\)==="new-invoice"/);
});

test("заметка клиента редактируется через отдельный аудируемый endpoint", () => {
  assert.match(communications, /\/clients\/"\+client\.id\+"\/notes/);
  assert.match(communications, /method:"PATCH"/);
});
