import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const controller = await readFile(new URL("../src/orders/orders.controller.ts", import.meta.url), "utf8");
const service = await readFile(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");

test("заказ принимает новый неизменяемый snapshot замеров через защищённый endpoint", () => {
  assert.match(controller, /@Post\(":id\/measurement"\)/);
  assert.match(controller, /OrderMeasurementDto/);
  assert.match(controller, /addMeasurement\(id, dto, req\.user\)/);
  assert.match(controller, /UserRole\.PRODUCTION/);
});

test("snapshot создаётся или заменяется новым и связывается с заказом атомарно", () => {
  const method = service.slice(service.indexOf("async addMeasurement"), service.indexOf("async upload(dto"));
  assert.match(method, /\$transaction\(async \(tx\)/);
  assert.match(method, /pg_advisory_xact_lock/);
  assert.match(method, /measurementId/);
  assert.doesNotMatch(method, /Замеры для этого заказа уже сохранены/);
  assert.match(method, /previousMeasurementId/);
  assert.match(method, /\(expectedMeasurementId \?\? null\) !== previousMeasurementId/);
  assert.match(method, /ConflictException/);
  assert.match(method, /MEASUREMENT_(?:CREATED|REPLACED)/);
  assert.match(method, /Добавляйте замеры отдельно для каждого спортсмена состава/);
  assert.match(method, /athlete\.findFirst/);
  assert.match(method, /measurement\.create/);
  assert.match(method, /order\.update/);
  assert.match(method, /order\.athleteId \?\? order\.items\[0\]\?\.athleteId/);
  assert.match(method, /Спортсмены заказа не совпадают/);
  assert.match(method, /orderItem\.update/);
  assert.match(method, /MEASUREMENT_CREATED/);
  assert.match(method, /entityType:\s*"Measurement"/);
  assert.match(method, /entityType:\s*"Order"/);
});

test("сервер сохраняет точность шага 0,5 см и не обновляет старый снимок", () => {
  const method = service.slice(service.indexOf("async addMeasurement"), service.indexOf("async upload(dto"));
  assert.match(method, /Number\.isInteger\(value \* 2\)/);
  assert.doesNotMatch(method, /measurement\.update/);
  assert.match(method, /measurement\.create/);
});
