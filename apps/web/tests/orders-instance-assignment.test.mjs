import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard = await readFile(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const tabs = await readFile(new URL("../components/orders/order-expanded-tabs.tsx", import.meta.url), "utf8");

const drawer = await readFile(new URL("../components/orders/instance-measurement-drawer.tsx", import.meta.url), "utf8");

test("экземпляр изделия сохраняет спортсменку и конкретный снимок мерок", () => {
  assert.match(dashboard, /async function updateOrderItemInstance/);
  assert.match(dashboard, /`\/order-tabs\/\$\{orderId\}\/instances\/\$\{instanceId\}`/);
  assert.match(tabs, /athleteId\?: string \| null; measurementId\?: string \| null; productionStatus\?: string; expectedUpdatedAt: string/);
  assert.match(dashboard, /body: JSON\.stringify\(input\)/);
  assert.match(tabs, /InstanceMeasurementDrawer/);
  assert.match(drawer, /\/instances\/assign/);
  assert.match(drawer, /expectedUpdatedAt:t.instance.updatedAt/);
  assert.match(drawer, /measurementId,standardHeight/);
  assert.match(tabs, /onUpdateInstance/);
});

test("форма предлагает только спортсменок клиента и их версии мерок", () => {
  assert.match(tabs, /order\.client\.athletes/);
  assert.match(drawer, /athlete\?\.measurements/);
  assert.match(drawer, /instance.measurement\?\.athleteId===instance.athlete\?\.id/);
});
