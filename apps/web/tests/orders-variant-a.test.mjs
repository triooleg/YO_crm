import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const tabs = readFileSync(new URL("../components/orders/order-expanded-tabs.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/orders-dashboard.css", import.meta.url), "utf8");
const expanded = dashboard.slice(dashboard.indexOf("function ExpandedOrder"), dashboard.indexOf("function OrderImageEditor"));

test("утверждённая панель заказа содержит четыре зоны и контекстную навигацию", () => {
  for (const token of ["orders-order-identity", "orders-order-flow", "orders-order-deadlines", "orders-order-actions"])
    assert.match(expanded, new RegExp(token));
  for (const callback of ["onConversation", "onClient", "onProduction", "onFinance", "onDelivery"])
    assert.match(expanded, new RegExp(callback));
  assert.match(dashboard, /onNavigate\("production", \{ orderId: order\.id \}\)/);
  assert.match(dashboard, /onNavigate\("finance", \{ orderId: order\.id \}\)/);
});

test("утверждённый макет сохраняет плотную таблицу и адаптивную нижнюю панель", () => {
  for (const selector of [".orders-dashboard", ".orders-dashboard-table", ".orders-order-overview", ".orders-order-tabs", ".orders-order-tab-panel"])
    assert.match(styles, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(styles, /@media\(max-width:900px\)/);
  assert.match(styles, /orders-dashboard-table\{[^}]*min-width:1580px/);
  assert.match(styles, /orders-order-overview\{display:grid/);
});

test("визуальные подсказки редактируемых значений и доставка сохранены", () => {
  assert.match(dashboard, /editableTextColor/);
  assert.match(styles, /orders-deadline-button strong\{color:var\(--od-editable\)\}/);
  assert.match(styles, /orders-inline-status-control \.mantine-NativeSelect-input\{[^}]*color:var\(--od-editable\)/);
  assert.match(dashboard, /function DeliveryAddressModal/);
  assert.match(dashboard, /className=\{shipped \? "orders-delivery-cell-button is-shipped" : "orders-delivery-cell-button"\}/);
});

test("основные и рукавные замеры различаются цветом", () => {
  assert.match(tabs, /\[1, 2, 3, 15\]\.includes\(number\).*is-required/);
  assert.match(tabs, /\[6, 7, 8\]\.includes\(number\).*is-sleeve/);
  assert.match(styles, /\.orders-approved-measurement-grid>div\.is-required\{[^}]*background:/);
  assert.match(styles, /\.orders-approved-measurement-grid>div\.is-sleeve\{[^}]*background:/);
});
