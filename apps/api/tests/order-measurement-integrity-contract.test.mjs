import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");

test("создание заказа проверяет верхнеуровневый снимок замеров внутри транзакции", () => {
  const transaction = service.slice(service.indexOf("return this.prisma.$transaction(async (tx) =>", service.indexOf("async create(dto")));

  assert.match(transaction, /measurementRefs/);
  assert.match(transaction, /measurement\.findMany/);
  assert.match(transaction, /dto\.measurementId/);
  assert.match(transaction, /dto\.athleteId/);
  assert.match(transaction, /athlete:\s*\{\s*clientId:\s*dto\.clientId/);
});

test("каждый снимок замеров позиции должен принадлежать выбранному спортсмену заказа", () => {
  assert.match(service, /items\.flatMap/);
  assert.match(service, /item\.measurementId/);
  assert.match(service, /item\.athleteId/);
  assert.match(service, /measurementById\.get\(reference\.measurementId\) !== reference\.athleteId/);
  assert.match(service, /Снимок замеров не принадлежит выбранному спортсмену клиента/);
});
