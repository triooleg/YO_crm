import test from "node:test";
import assert from "node:assert/strict";
import { canOpenOrderFinance, clearOrderContextUrl, resolveOrderContext } from "../lib/order-context.ts";
import { readFileSync } from "node:fs";

const dashboard = readFileSync(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const clients = readFileSync(new URL("../components/client-workspace.tsx", import.meta.url), "utf8");
const details = readFileSync(new URL("../components/clients/client-details.tsx", import.meta.url), "utf8");
const history = readFileSync(new URL("../components/clients/orders.tsx", import.meta.url), "utf8");
const requests = readFileSync(new URL("../components/clients/use-workspace.ts", import.meta.url), "utf8");
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
  assert.match(dashboard, /onNavigate\("inbox", \{ clientId: order\.client\.id, clientName: order\.client\.displayName, orderId: order\.id \}\)/);
  assert.match(clients, /originOrder/);
  assert.match(clients, /focusedOrderId=\{originOrder\.current\}/);
  assert.match(details, /contextOrder=\{client\.orders\?\.find\(order=>order\.id===focusedOrderId\)\}/);
  assert.match(history, /order\.id===focusedOrderId\?"is-context"/);
  assert.match(history, /!data\.items\.some\(order=>order\.id===contextOrder\.id\)/);
  assert.match(inbox, /initialOrderId/);
  assert.match(inbox, /focusedContextOrder/);
  assert.match(inbox, /o\.id===initialOrderId\.current\?"is-context"/);
  assert.match(requests, /if\(orderId\)params\.set\("orderId",orderId\)/);
  assert.match(inbox, /clientId=\$\{encodeURIComponent\(preferredClientId\)\}/);
  assert.match(inbox, /\?orderId=\$\{encodeURIComponent\(contextOrderId\)\}/);
  assert.match(requests, /detailState\.id===detailKey\?detailState\.error:undefined/);
  assert.match(clients, /error=\{state\.detailError\}/);
  assert.match(inbox, /contextClientUnavailable/);
});

test("выбранный клиент вне страницы и возврат в чат не теряются при изменении фильтров",async()=>{
 const {readWorkspaceQuery,workspaceUrl}=await import("../components/clients/helpers.mjs");
 const state=readWorkspaceQuery("?clientId=outside&page=3&pageSize=50&search=Мария&tab=orders");
 const result=new URL(workspaceUrl("/?section=clients&returnConversationId=chat-7&returnChannel=INSTAGRAM",{...state,country:"Spain"}),"https://crm.yoleotard.com");
 assert.equal(result.searchParams.get("clientId"),"outside");assert.equal(result.searchParams.get("page"),"3");assert.equal(result.searchParams.get("tab"),"orders");assert.equal(result.searchParams.get("returnConversationId"),"chat-7");
 const other=new URL(workspaceUrl("/?section=clients&clientId=old&orderId=old-order&action=new-order",state),"https://crm.yoleotard.com");
 assert.equal(other.searchParams.has("orderId"),false);assert.equal(other.searchParams.has("action"),false);
});
