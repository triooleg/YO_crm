import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const tabs = readFileSync(new URL("../components/orders/order-expanded-tabs.tsx", import.meta.url), "utf8");
const measurementPanel = readFileSync(new URL("../components/measurement-panel.tsx", import.meta.url), "utf8");
const expanded = dashboard.slice(dashboard.indexOf("function ExpandedOrder")) + tabs;

test("заказ раскрывается в строке и подгружает подробности отдельно от списка", () => {
  assert.match(dashboard, /const \[expandedId, setExpandedId\] = useState<string>\(\)/);
  assert.match(dashboard, /async function refreshOrder/);
  assert.match(dashboard, /request\(`\/orders\/\$\{orderId\}`\)/);
  assert.match(dashboard, /<Fragment key=\{order\.id\}>/);
  assert.match(dashboard, /expandedId === order\.id && <tr className="orders-expanded-row"/);
  assert.match(dashboard, /<td colSpan=\{visibleColumns\.length \+ 1\}>/);
  assert.doesNotMatch(dashboard, /expandedOrder && <div className="orders-expanded-row"/);
  assert.doesNotMatch(dashboard, /OrderWorkspaceCard|workspaceId|setWorkspaceId/);
});

test("вид спорта редактируется через простую текстовую кнопку без стрелки select", () => {
  assert.match(dashboard, /function OrderDisciplineMenu/);
  assert.match(dashboard, /className="orders-discipline-trigger"/);
  assert.match(dashboard, /<Menu\.Dropdown>/);
  assert.match(dashboard, /if \(value === order\.discipline \|\| !DISCIPLINES\.includes/);
  assert.match(dashboard, /aria-current=\{selected \? "true" : undefined\}/);
  assert.match(dashboard, /aria-label=\{selected \? `\$\{label\}, \$\{ui\.selected\}` : label\}/);
  assert.doesNotMatch(dashboard, /const values = \["", \.\.\.DISCIPLINES\]/);
  assert.doesNotMatch(dashboard, /className="orders-discipline-select"/);
});

test("выбранная колонка и направление сортировки сохраняются между обновлениями", () => {
  assert.match(dashboard, /const SORT_SETTINGS_KEY = "orders-dashboard-sort-v1"/);
  assert.match(dashboard, /parseSavedOrderSort\(localStorage\.getItem\(SORT_SETTINGS_KEY\)\)/);
  assert.match(dashboard, /localStorage\.setItem\(SORT_SETTINGS_KEY, JSON\.stringify\(next\)\)/);
});

test("обзор сохраняет четыре независимых статуса", () => {
  assert.match(expanded, /domain="payment" status=\{order\.paymentStatus\}/);
  assert.match(expanded, /domain="production" status=\{order\.productionStatus\}/);
  assert.match(expanded, /domain="shipping" status=\{order\.shippingStatus\}/);
  assert.match(expanded, /domain="sales" status=\{order\.salesStatus\}/);
  assert.doesNotMatch(expanded, /onStatus\("(?:paymentStatus|shippingStatus)"/);
});

test("каждое изделие редактирует только собственный неизменяемый снимок замеров", () => {
  assert.match(expanded, /items\.map\(\(item/);
  assert.match(expanded, /measurement\.values/);
  assert.match(expanded, /onMeasurements\(currentItem\.persistedItemId\)/);
  assert.match(dashboard, /orderItemId=\{item\?\.id\}/);
  assert.match(measurementPanel, /\/orders\/\$\{orderId\}\/items\/\$\{orderItemId\}\/measurement/);
  assert.match(tabs, /Array\.from\(\{ length: 17 \}/);
  assert.match(expanded, /athlete\?\.measurements/);
  assert.match(expanded, /order\.measurementHistory/);
});

test("смена статуса сериализована, откатывается при ошибке и не перечитывает список", () => {
  const source = dashboard.match(/async function changeStatus\([\s\S]*?\r?\n  }\r?\n  async function changeDeadline/)?.[0] ?? "";
  assert.match(source, /statusRequests\.current\.has\(order\.id\)/);
  assert.match(source, /previous/);
  assert.match(source, /await refreshOrder\(order\.id, true\)/);
  assert.doesNotMatch(source, /await load\(\)/);
});

test("вкладки показывают реальные финансы доставку историю и безопасное пустое состояние файлов", () => {
  for (const key of ["details", "designs", "measurements", "client", "finance", "production", "delivery", "notes", "history"])
    assert.match(expanded, new RegExp(`key: "${key}"`));
  assert.match(expanded, /paymentHistory\.map/);
  assert.match(expanded, /payment\.reference|paymentMethodLabel\(payment\.method\)/);
  assert.match(expanded, /payment\.notes|paymentMethodLabel\(payment\.method\)/);
  assert.match(expanded, /order\.invoices\.map/);
  assert.match(expanded, /activities\.map/);
  assert.match(expanded, /order\.shipment\?\.trackingNumber|order\.shipment\.trackingNumber/);
  assert.match(expanded, /ui\.noFiles/);
});

test("быстрые продажи не получают производственные действия, а статусы остаются раздельными", () => {
  assert.match(expanded, /const requiresProduction = !NON_PRODUCTION_ORDER_TYPES\.has\(order\.type\)/);
  assert.match(expanded, /requiresProduction \? <div className="orders-production-current"/);
  assert.match(expanded, /requiresProduction \? <CrmButton[^>]*onClick=\{onProduction\}/);
  const statusCell = dashboard.match(/if \(id === "status"\)[\s\S]*?if \(id === "delivery"\)/)?.[0] ?? "";
  assert.match(statusCell, /order\.salesStatus/);
  assert.doesNotMatch(statusCell, /order\.productionStatus/);
});

test("новый дизайн и пустая позиция используют всех спортсменов и снимки клиента", () => {
  assert.match(dashboard, /const athletes=order\.client\.athletes\?\?uniqueOrderAthletes\(order\)/);
  assert.match(tabs, /function clientMeasurementOptions\(order: ExpandedOrderView, item: ExpandedOrderItem\)/);
  assert.match(tabs, /\(order\.client\.athletes \?\? \[\]\)\.filter\(\(athlete\) => !item\.athlete \|\| athlete\.id === item\.athlete\.id\)/);
  assert.match(expanded, /const options = currentItem \? clientMeasurementOptions\(order, currentItem\)/);
});
