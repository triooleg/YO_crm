import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const controller = await readFile(new URL("../src/orders/orders.controller.ts", import.meta.url), "utf8");
const service = await readFile(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");

test("коррекция продаж сайта доступна только владельцу и администратору", () => {
  assert.match(controller, /@Post\("maintenance\/website-sales"\)[\s\S]*?@Roles\(UserRole\.OWNER, UserRole\.ADMIN\)/);
  assert.match(controller, /WebsiteSalesCorrectionDto/);
});

test("коррекция выбирает источник конкретного заказа KeyCRM с непустым трек-номером", () => {
  const section = service.slice(service.indexOf("async correctWebsiteSales"), service.indexOf("async updateStatuses"));
  assert.match(section, /sourceSystem:\s*"KEYCRM"/);
  assert.match(section, /keycrmOrderSource\(order\.externalData, sourceNames\)/);
  assert.match(section, /keycrmSourceChannel[\s\S]*=== "WEBSITE"/);
  assert.match(section, /deliveryTrackingCode:\s*\{ not:\s*null \}/);
  assert.match(section, /trackingNumber:\s*\{ not:\s*null \}/);
  assert.match(section, /if \(dto\.dryRun\) return/);
  assert.match(section, /candidates: orders\.map/);
  assert.match(section, /expectedUpdatedAt/);
  assert.match(section, /expectedProductionSlotUpdatedAt/);
  assert.match(section, /expectedSourceId/);
  assert.match(section, /expectedSourceName/);
  assert.match(section, /if \(stale\) throw new ConflictException/);
});

test("применение коррекции удаляет слот, меняет тип и сохраняет аудит", () => {
  const section = service.slice(service.indexOf("async correctWebsiteSales"), service.indexOf("async updateStatuses"));
  assert.match(section, /productionSlot\.delete/);
  assert.match(section, /type:\s*"WEBSITE_SALE", productionStatus:\s*"NOT_SCHEDULED"/);
  assert.match(section, /ORDER_WEBSITE_SALE_CORRECTED/);
  assert.match(section, /entityType:\s*"ProductionSlot"/);
  assert.match(section, /entityType:\s*"Order"/);
});
