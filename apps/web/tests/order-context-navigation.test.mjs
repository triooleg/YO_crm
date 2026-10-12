import test from "node:test";
import assert from "node:assert/strict";
import { canOpenOrderFinance, clearOrderContextUrl, resolveOrderContext } from "../lib/order-context.ts";
import { readFileSync } from "node:fs";

const dashboard = readFileSync(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const clients = readFileSync(new URL("../components/client-workspace.tsx", import.meta.url), "utf8");
const inbox = readFileSync(new URL("../components/communications-workspace.tsx", import.meta.url), "utf8");

test("контекст заказа находит точную запись и неизвестный id не выбирает соседний заказ", () => {
  const orders = [{ id: "order-1" }, { id: "order-2" }];
  assert.deepEqual(resolveOrderContext(orders, "?section=production&orderId=order-2"), { requested: true, order: orders[1] });
  assert.deepEqual(resolveOrderContext(orders, "?section=production&orderId=missing"), { requested: true, order: undefined });
  assert.deepEqual(resolveOrderContext(orders, "?section=production"), { requested: false, order: undefined });
});

test("очистка контекста сохраняет раздел и посторонние фильтры", () => {
  const url = clearOrderContextUrl("https://crm.yoleotard.com/?section=shipping&orderId=order-2&action=open&filter=ready&clientId=client-1");
  assert.equal(url.searchParams.get("section"), "shipping");
  assert.equal(url.searchParams.get("filter"), "ready");
  for (const key of ["orderId", "action", "clientId", "clientName"]) assert.equal(url.searchParams.has(key), false);
});

test("полный финансовый раздел заказа доступен только финансовым ролям", () => {
  for (const role of ["OWNER", "ADMIN", "ACCOUNTANT"]) assert.equal(canOpenOrderFinance(role), true);
  for (const role of ["MANAGER", "PRODUCTION", "VIEWER", ""]) assert.equal(canOpenOrderFinance(role), false);
});

test("переходы в Клиенты и Входящие сохраняют и выделяют точный заказ", () => {
  assert.match(dashboard, /onNavigate\("clients", \{ clientId: order\.client\.id, orderId: order\.id \}\)/);
  assert.match(dashboard, /onNavigate\("inbox", \{ clientId: expandedOrder\.client\.id, clientName: expandedOrder\.client\.displayName, orderId: expandedOrder\.id \}\)/);
  assert.match(clients, /initialOrderId/);
  assert.match(clients, /focused=\{o\.id === focusedOrderId\}/);
  assert.match(inbox, /initialOrderId/);
  assert.match(inbox, /focusedContextOrder/);
  assert.match(inbox, /o\.id===initialOrderId\.current\?"is-context"/);
  assert.match(clients, /\?orderId=\$\{encodeURIComponent\(contextOrderId\)\}/);
  assert.match(inbox, /clientId=\$\{encodeURIComponent\(preferredClientId\)\}/);
  assert.match(inbox, /\?orderId=\$\{encodeURIComponent\(contextOrderId\)\}/);
  assert.match(clients, /contextOrderUnavailable/);
  assert.match(inbox, /contextClientUnavailable/);
});
