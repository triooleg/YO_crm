import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const controller = readFileSync(new URL("../src/orders/orders.controller.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");

test("снимок замеров привязывается к конкретной позиции заказа", () => {
  assert.match(controller, /@Patch\(":id\/items\/:itemId\/measurement"\)/);
  assert.match(service, /measurementId\?\?null\)!==\(dto\.expectedMeasurementId\?\?null\)/);
  assert.match(service, /athlete:\{clientId:item\.order\.clientId,archivedAt:null\}/);
  assert.match(service, /const athleteId=item\.athleteId\?\?measurement\.athleteId/);
  assert.match(service, /item\.measurementId===measurement\.id&&item\.athleteId===athleteId/);
  assert.match(service, /before:\{athleteId:item\.athleteId,measurementId:item\.measurementId\}/);
  assert.match(service, /ORDER_ITEM_MEASUREMENT_BOUND/);
  assert.match(service, /entityType:"OrderItem"/);
});
