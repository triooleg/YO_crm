import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard = await readFile(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const tabs = await readFile(new URL("../components/orders/order-expanded-tabs.tsx", import.meta.url), "utf8");
const i18n = await readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8");

test("создание и изменение посылки используют существующие shipping endpoints и refreshOrder", () => {
  assert.match(dashboard, /async function createOrderShipment/);
  assert.match(dashboard, /`\/shipping\/orders\/\$\{orderId\}\/shipments`[\s\S]*method:\s*"POST"/);
  assert.match(dashboard, /`\/shipping\/orders\/\$\{orderId\}\/shipments\/\$\{shipmentId\}`[\s\S]*method:\s*"PUT"/);
  assert.match(dashboard, /await refreshOrder\(orderId\)/);
  assert.doesNotMatch(dashboard, /`\/shipping\/orders\/\$\{orderId\}\/shipments[^`]*`[\s\S]{0,120}method:\s*"DELETE"/);
});

test("форма Mantine передаёт полный UpsertOrderShipmentDto и доступные экземпляры", () => {
  for (const field of ["carrier", "trackingNumber", "customerChargeMinor", "atelierCostMinor", "currency", "status", "shippedAt", "deliveredAt", "weightGrams", "lengthMm", "widthMm", "heightMm", "instanceIds", "expectedUpdatedAt"])
    assert.match(tabs, new RegExp(`${field}[,:]`));
  assert.match(tabs, /OrderShipmentForm/);
  assert.match(tabs, /CrmCheckbox/);
  assert.match(tabs, /instance\.orderShipment\?\.id === shipment\?\.id/);
  assert.match(tabs, /onCreateShipment/);
  assert.match(tabs, /onUpdateShipment/);
  assert.match(tabs, /shipment\.updatedAt/);
  assert.doesNotMatch(tabs, /onDeleteShipment|onArchiveShipment/);
});

test("кнопки и справочники посылок централизованы в русском i18n", () => {
  for (const key of ["addShipment", "editShipment", "shipmentCarrier", "shipmentStatus", "shipmentStatusLabels", "carriers", "shipmentInstances", "saveShipment"])
    assert.match(i18n, new RegExp(`${key}:`));
  assert.match(tabs, /ui\.addShipment/);
  assert.match(tabs, /ui\.editShipment/);
});

test("форма посылки остаётся внутри вкладки Доставка раскрытой строки", () => {
  assert.match(dashboard, /expandedId === order\.id && <tr className="orders-expanded-row"/);
  assert.match(tabs, /activeTab === "delivery" && <OrderDeliveryTab/);
  assert.match(tabs, /<Modal opened=\{Boolean\(shipmentEditor\)\}/);
});
