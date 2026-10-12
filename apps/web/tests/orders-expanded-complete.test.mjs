import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const measurementPanel = readFileSync(new URL("../components/measurement-panel.tsx", import.meta.url), "utf8");
const expanded = dashboard.slice(dashboard.indexOf("function ExpandedOrder"), dashboard.indexOf("function OrderImageEditor"));

test("заказ раскрывается в строке и подгружает подробности отдельно от списка", () => {
  assert.match(dashboard, /const \[expandedId, setExpandedId\] = useState<string>\(\)/);
  assert.match(dashboard, /async function refreshOrder/);
  assert.match(dashboard, /request\(`\/orders\/\$\{orderId\}`\)/);
  assert.match(dashboard, /expandedOrder && <div className="orders-expanded-row"/);
  assert.doesNotMatch(dashboard, /OrderWorkspaceCard|workspaceId|setWorkspaceId/);
});

test("обзор сохраняет четыре независимых статуса", () => {
  assert.match(expanded, /domain="payment" status=\{order\.paymentStatus\}/);
  assert.match(expanded, /domain="production" status=\{order\.productionStatus\}/);
  assert.match(expanded, /domain="shipping" status=\{order\.shippingStatus\}/);
  assert.match(expanded, /domain="sales" status=\{order\.salesStatus\}/);
  assert.doesNotMatch(expanded, /onStatus\("(?:paymentStatus|shippingStatus)"/);
});

test("каждое изделие редактирует только собственный неизменяемый снимок замеров", () => {
  assert.match(expanded, /items\.map\(\(item\)/);
  assert.match(expanded, /values=\{item\.measurement\.values\}/);
  assert.match(expanded, /onMeasurements\(item\.persistedItemId\)/);
  assert.match(dashboard, /orderItemId=\{item\?\.id\}/);
  assert.match(measurementPanel, /\/orders\/\$\{orderId\}\/items\/\$\{orderItemId\}\/measurement/);
  assert.match(dashboard, /Array\.from\(\{ length: 17 \}/);
  assert.match(expanded, /measurementHistory: order\.measurementHistory/);
});

test("смена статуса сериализована, откатывается при ошибке и не перечитывает список", () => {
  const source = dashboard.match(/async function changeStatus\([\s\S]*?\r?\n  }\r?\n  async function changeDeadline/)?.[0] ?? "";
  assert.match(source, /statusRequests\.current\.has\(order\.id\)/);
  assert.match(source, /previous/);
  assert.match(source, /await refreshOrder\(order\.id\)/);
  assert.doesNotMatch(source, /await load\(\)/);
});

test("вкладки показывают реальные финансы доставку историю и безопасное пустое состояние файлов", () => {
  for (const key of ["details", "designs", "measurements", "client", "finance", "production", "delivery", "notes", "history"])
    assert.match(expanded, new RegExp(`key: "${key}"`));
  assert.match(expanded, /paymentHistory\.map/);
  assert.match(expanded, /ui\.paymentReference.*payment\.reference/);
  assert.match(expanded, /ui\.paymentNote.*payment\.notes/);
  assert.match(expanded, /order\.invoices\.map/);
  assert.match(expanded, /visibleActivities\.map/);
  assert.match(expanded, /order\.shipment\?\.trackingNumber/);
  assert.match(expanded, /ui\.noFiles/);
});

test("быстрые продажи не получают производственные действия, а статусы остаются раздельными", () => {
  assert.match(expanded, /const requiresProduction = !NON_PRODUCTION_ORDER_TYPES\.has\(order\.type\)/);
  assert.match(expanded, /requiresProduction && <CrmButton[^>]*onClick=\{onProduction\}/);
  assert.match(expanded, /requiresProduction \? <CrmNativeSelect[^>]*productionStatus/);
  const statusCell = dashboard.match(/if \(id === "status"\)[\s\S]*?if \(id === "delivery"\)/)?.[0] ?? "";
  assert.match(statusCell, /order\.salesStatus/);
  assert.doesNotMatch(statusCell, /order\.productionStatus/);
});
