import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard = await readFile(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const tabs = await readFile(new URL("../components/orders/order-expanded-tabs.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/orders-dashboard.css", import.meta.url), "utf8");
const i18n = await readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8");
const invoices = await readFile(new URL("../components/invoice-workflow.tsx", import.meta.url), "utf8");

test("утверждённая таблица объединяет модель и спорт и сохраняет отдельные доменные колонки", () => {
  assert.match(dashboard, /const DEFAULT_COLUMNS: ColumnId\[\] = \["client", "model", "quantity", "deadline", "payment", "production", "delivery", "status", "created", "menu"\]/);
  assert.match(i18n, /model:\s*"Модель \/ Спорт"/);
  assert.match(i18n, /production:\s*"Производство"/);
  assert.doesNotMatch(dashboard, /orders-client-cell[\s\S]{0,500}<OrderDesigns/);
  assert.match(dashboard, /orders-model-sport-cell/);
});

test("раскрытый заказ использует обзорную панель и девять рабочих вкладок", () => {
  for (const token of [
    "orders-order-overview",
    "orders-order-identity",
    "orders-order-flow",
    "orders-order-deadlines",
    "orders-order-actions",
    "orders-order-tabs",
    "orders-order-tab-panel",
  ]) assert.match(dashboard + tabs, new RegExp(token));
  for (const key of ["details", "designs", "measurements", "client", "finance", "production", "delivery", "notes", "history"])
    assert.match(tabs, new RegExp(`key: "${key}"`));
  assert.match(css, /\.orders-order-overview/);
  assert.match(css, /\.orders-order-tabs/);
});

test("в шапке выбранного заказа источник показан один раз без дублирующего текстового бейджа", () => {
  const start = dashboard.indexOf('className="orders-order-identity"');
  const end = dashboard.indexOf('className="orders-order-flow"', start);
  assert.ok(start >= 0 && end > start);
  const identity = dashboard.slice(start, end);
  assert.doesNotMatch(identity, /<OrderSourceBadge/);
  assert.equal((identity.match(/<OrderSourceEditor /g) ?? []).length, 1);
  assert.doesNotMatch(identity, /<OrderChannelIcon channel=\{order\.client\.source\}/);
  assert.match(identity, /sourceLabel\(order\.orderSource\?\?'UNKNOWN'\)/);
});

test("номер основного дизайна показан под фотографией выбранного заказа", () => {
  assert.match(dashboard, /className="orders-order-identity-media"/);
  assert.match(dashboard, /const primaryItem = items\.find\(item=>Boolean\(item\.modelImagePath\)\)/);
  assert.match(dashboard, /primaryItem&&<DesignNumberEditor order=\{order\} item=\{primaryItem\} bridge=\{compositionActions\}/);
  assert.match(dashboard, /prefix="№ " className="orders-order-design-number"/);
  assert.match(css, /\.orders-order-design-number\{/);
});

test("смена статуса обновляет локальное состояние без повторной загрузки списка", () => {
  const source = dashboard.match(/async function changeStatus\([\s\S]*?\r?\n  }\r?\n  async function changeDeadline/)?.[0] ?? "";
  assert.match(source, /await request\(`\/orders\/\$\{order\.id\}\/statuses`/);
  assert.doesNotMatch(source, /await load\(\)/);
  assert.match(source, /await refreshOrder\(order\.id, true\)/);
  assert.match(source, /setOrders/);
  assert.match(source, /previous/);
});

test("срок готовности не подменяет плановую отправку, а инвойс сохраняет собственную валюту", () => {
  assert.match(dashboard, /label=\{ui\.plannedShipping\} value=\{ui\.notSpecifiedFeminine\}/);
  assert.doesNotMatch(dashboard + tabs, /label=\{ui\.plannedShipping\} value=\{deliveryDate\(order\)\}/);
  assert.match(invoices, /moneyLabel\(invoice\.totalMinor, invoice\.currency \|\| order\.currency\)/);
});

test("активная Mantine-вкладка получает утверждённое визуальное состояние", () => {
  assert.match(css, /\.orders-order-tabs button\[data-active\]/);
});

test("вкладки остаются компактной группой слева и не растягиваются на ширину карточки", () => {
  assert.match(css, /\.orders-dashboard-table \.orders-expanded-row \.orders-order-tabs\{[^}]*justify-content:flex-start/);
  assert.match(css, /\.orders-dashboard-table \.orders-expanded-row \.orders-order-tabs \.mantine-Tabs-tab\{[^}]*min-width:auto/);
  assert.doesNotMatch(css, /\.orders-dashboard-table \.orders-expanded-row \.orders-order-tabs\{[^}]*justify-content:space-between/);
});

test("номер выбранного заказа остаётся однострочным на рабочих разрешениях", () => {
  assert.match(css, /\.orders-order-identity h2\{[^}]*white-space:nowrap/);
});

test("нижние блоки деталей содержат три карточки без дублирования последних действий", () => {
  assert.match(css, /\.orders-tab-details-approved>\.orders-approved-card\.orders-tab-span-4\{grid-column:span 4/);
  assert.doesNotMatch(tabs, /className="orders-tab-span-full" title=\{ui\.latestActions\}/);
  assert.doesNotMatch(tabs, /const recent = order\.activities\.slice\(0, 4\)/);
});

test("раскрытая карточка ограничена viewport и получает одноколоночную мобильную раскладку", () => {
  assert.match(css, /\.orders-dashboard-table \.orders-expanded-row>td\{[^}]*position:sticky;left:0;[^}]*width:calc\(100vw - 44px\)!important/);
  assert.match(css, /\.orders-dashboard-table \.orders-expanded-row \.orders-approved-expanded\{width:calc\(100vw - 34px\);min-width:0/);
  assert.match(css, /\.orders-tab-details-approved,\.orders-tab-measurements-approved,\.orders-tab-client-approved,\.orders-tab-delivery-approved,\.orders-tab-notes-approved,\.orders-tab-history-approved\{grid-template-columns:1fr\}/);
});

test("первая колонка компактнее и не создаёт лишний разрыв перед моделью", () => {
  assert.match(css, /\.orders-dashboard-table \.orders-col-client\{width:190px!important\}/);
});
