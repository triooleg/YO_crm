import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard = await readFile(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const tabs = await readFile(new URL("../components/orders/order-expanded-tabs.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/orders-dashboard.css", import.meta.url), "utf8");
const i18n = await readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8");

test("девять утверждённых вкладок остаются внутри раскрытой строки выбранного заказа", () => {
  assert.match(dashboard, /<Fragment key=\{order\.id\}>[\s\S]*orders-summary-row[\s\S]*expandedId === order\.id && <tr className="orders-expanded-row"/);
  assert.match(dashboard, /<OrderExpandedTabs/);
  assert.doesNotMatch(dashboard, /expandedOrder && <(?:main|section|div) className="orders-approved-expanded"/);
  assert.match(css, /\.orders-dashboard-table \.orders-expanded-row \.orders-approved-expanded/);
});

test("раскрытая карточка делегирует визуальные панели девяти доменным компонентам", () => {
  for (const component of [
    "OrderDetailsTab",
    "OrderDesignsTab",
    "OrderMeasurementsTab",
    "OrderClientTab",
    "OrderFinanceTab",
    "OrderProductionTab",
    "OrderDeliveryTab",
    "OrderNotesTab",
    "OrderHistoryTab",
  ]) assert.match(tabs, new RegExp(`function ${component}`));

  for (const key of ["details", "designs", "measurements", "client", "finance", "production", "delivery", "notes", "history"])
    assert.match(tabs, new RegExp(`activeTab === "${key}"`));
});

test("панели используют расширенную detail-проекцию и сохраняют честные пустые состояния только для отсутствующих данных", () => {
  for (const key of [
    "instancesUnavailable",
    "designFeaturesUnavailable",
    "productionMaterialsUnavailable",
  ]) assert.match(i18n, new RegExp(`${key}:`));
  assert.match(tabs, /ui\.instancesUnavailable/);
  assert.match(tabs, /className="orders-history-filters"/);
  assert.match(tabs, /setEventType/);
  assert.match(tabs, /setActorId/);
  assert.match(tabs, /order\.orderShipments\.map/);
  assert.match(tabs, /shipment\.instances\.map/);
  assert.match(tabs, /shipment\.customerChargeMinor/);
  assert.match(tabs, /shipment\.atelierCostMinor/);
  assert.match(tabs, /preferenceEntries\(order\.client\.preferences\)/);
  assert.match(tabs, /order\.expenses\?\.map/);
  assert.match(tabs, /activity\.actor\?\.displayName \|\| ui\.systemUser/);
  assert.doesNotMatch(tabs, /ui\.multipleShipmentsUnavailable/);
  assert.doesNotMatch(tabs, /ui\.shipmentAssignmentUnavailable/);
  assert.doesNotMatch(tabs, /ui\.shippingExpensesUnavailable/);
  assert.doesNotMatch(tabs, /ui\.clientPreferencesStoredElsewhere/);
  assert.doesNotMatch(tabs, /Red Flame|Purple Elegance|Chlo[eé]|Martin Heidi|188,37/);
});

test("существующие действия остаются колбэками OrdersDashboard", () => {
  for (const callback of [
    "onEdit",
    "onAddDesign",
    "onEditItem",
    "onMeasurements",
    "onBindMeasurement",
    "onCurrency",
    "onPayment",
    "onDelivery",
    "onCustomerWishes",
    "onUploadFile",
  ]) assert.match(tabs, new RegExp(callback));
  assert.doesNotMatch(tabs, /fetch\(/);
});

test("производство меняется по физическим экземплярам и показывает только укрупнённые статусы", () => {
  assert.match(tabs, /INSTANCE_PRODUCTION_STATUSES = \["NOT_SCHEDULED", "SCHEDULED", "SEWING", "READY", "ON_HOLD", "CANCELLED"\]/);
  assert.match(tabs, /onUpdateInstance\(instance\.id,\{productionStatus:event\.currentTarget\.value,expectedUpdatedAt:instance\.updatedAt\}\)/);
  assert.match(tabs, /value=\{coarseProductionCode\(instance\.productionStatus\)\}/);
  assert.match(tabs, /label:coarseProductionLabel\(status\)/);
  assert.doesNotMatch(tabs, /PRODUCTION_STATUSES = \[[^\]]*CUTTING/);
});
