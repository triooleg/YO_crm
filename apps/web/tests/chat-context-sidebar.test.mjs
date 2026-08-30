import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [communications, shell, clients, tasks, finance, orderPanel, css, locale] = await Promise.all([
  read("../components/communications-workspace.tsx"),
  read("../components/crm-shell.tsx"),
  read("../components/client-workspace.tsx"),
  read("../components/tasks-workspace.tsx"),
  read("../components/finance-workspace.tsx"),
  read("../components/order-panel.tsx"),
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
  assert.match(css, /communications-context-close\{[^}]*position:sticky/);
  for (const key of ["quickActions", "createTask", "createOrder", "createInvoice", "chatNote", "nextAction"])
    assert.match(locale, new RegExp(`${key}:`));
});

test("заказ из чата открывается поверх переписки и не переводит в Клиенты", () => {
  assert.match(shell, /<CommunicationsWorkspace onNavigate=\{navigate\}/);
  assert.doesNotMatch(communications, /onNavigate\?\.\("clients",\{action:"new-order",clientId:client\.id/);
  assert.match(communications, /openOrderFromChat/);
  assert.match(communications, /<OrderPanel/);
  assert.match(communications, /initialAthleteId=\{selectedAthleteId\}/);
  assert.match(communications, /onSaved=\{async\(\)=>/);
  assert.match(communications, /onNavigate\?\.\("finance",\{action:"new-invoice",orderId:activeOrders\[0\]\.id/);
  assert.match(tasks, /params\.get\("action"\)!=="new"/);
  assert.match(finance, /params\.get\("action"\)==="new-invoice"/);
});

test("задача из чата создаётся для активного клиента без перехода из Входящих", () => {
  assert.doesNotMatch(communications, /onNavigate\?\.\("tasks",\{action:"new",clientId:client\.id/);
  assert.match(communications, /openTaskFromChat/);
  assert.match(communications, /taskRequestVersion/);
  assert.match(communications, /isCurrentInboxDetailRequest\(request, selectedClientId\.current, taskRequestVersion\.current\)/);
  assert.match(communications, /<TaskDialog/);
  assert.match(communications, /client:\{id:client\.id,displayName:client\.displayName\}/);
  assert.match(communications, /api\("\/tasks",\{method:"POST"/);
  assert.match(communications, /onClick=\{\(\)=>void openTaskFromChat\(\)\}/);
  assert.match(tasks, /export function TaskDialog/);
});

test("правая панель показывает спортсменов и позволяет добавить нового без выхода из чата", () => {
  assert.match(communications, /communications-context-athletes/);
  assert.match(communications, /selectedAthleteId/);
  assert.match(communications, /setAddingAthlete\(true\)/);
  assert.match(communications, /<AddAthlete/);
  assert.match(clients, /export function AddAthlete/);
  for (const key of ["athletes", "noAthletes", "selectAthlete"])
    assert.match(locale, new RegExp(`${key}:`));
  assert.match(css, /communications-context-athletes/);
});

test("правую панель можно свернуть стрелкой и раскрыть без потери активного чата", () => {
  assert.match(communications, /contextCollapsed/);
  assert.match(communications, /communications-context-collapse/);
  assert.match(communications, /communications-context-panel\$\{contextOpen\?" open":""\}\$\{contextCollapsed\?" collapsed":""\}/);
  assert.match(communications, /contextCollapsed\?"0px 46px"/);
  assert.match(communications, /communications-context-collapsed-spacer/);
  assert.match(communications, /localStorage\.setItem\("communications-context-collapsed"/);
  assert.match(css, /communications-context-panel\.collapsed/);
  assert.match(css, /communications-context-collapse/);
  for (const key of ["collapseClientCard", "expandClientCard"])
    assert.match(locale, new RegExp(`${key}:`));
});

test("форма заказа не подменяет отсутствующего спортсмена именем клиента", () => {
  assert.match(orderPanel, /initialAthleteId/);
  assert.match(orderPanel, /<select[^>]*aria-label=\{orderFormUi\.selectAthlete\}/);
  assert.match(orderPanel, /orderFormUi\.noAthletes/);
  assert.doesNotMatch(orderPanel, /:client\.displayName/);
});

test("заметка клиента редактируется через отдельный аудируемый endpoint", () => {
  assert.match(communications, /\/clients\/"\+client\.id\+"\/notes/);
  assert.match(communications, /method:"PATCH"/);
});
