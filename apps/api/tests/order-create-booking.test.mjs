import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTargetModule } from "./overview-target-loader.mjs";

const dto = await readFile(new URL("../src/orders/orders.dto.ts", import.meta.url), "utf8");
const service = await readFile(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");

test("manual creation accepts an optional image and allows only the two initial statuses", () => {
  const createDto = dto.slice(dto.indexOf("export class CreateOrderDto"), dto.indexOf("export class AddOrderPaymentDto"));
  assert.match(createDto, /@IsOptional\(\) @IsString\(\) modelImagePath\?: string/);
  assert.match(createDto, /@IsIn\(\["NEW", "BOOKING"\]\)/);
});

test("a booking status and its base stage are persisted with the order under the catalog lock", () => {
  const create = service.slice(service.indexOf("async create(dto: CreateOrderDto"));
  assert.match(create, /dto\.initialStatus === "BOOKING"/);
  assert.ok(create.indexOf('"order-status-options"') < create.indexOf("tx.orderStatusOption.findUnique"));
  assert.doesNotMatch(create, /tx\.orderStatusOption\.create/);
  assert.match(create, /option\.archivedAt/);
  assert.match(create, /salesStatus: booking\?\.baseStatus/);
  assert.match(create, /salesStatusOptionId: booking\?\.id/);
  assert.match(create, /tentative: true/);
});

test("new and booked orders without a photo use the normal write path", async () => {
  const { OrdersService } = loadTargetModule("orders/orders.service.ts");
  const calls = [];
  const option = { id: "manual-booking", baseStatus: "NEW_LEAD", archivedAt: null };
  const tx = {
    $executeRaw: async () => undefined,
    $executeRawUnsafe: async () => undefined,
    appSetting: { findUnique: async () => null },
    client: { findFirst: async () => ({ id: "client-1" }) },
    orderStatusOption: { findUnique: async ({ where }) => {
      assert.equal(where.id, option.id);
      return option;
    } },
    websiteOrderNumberReservation: { findFirst: async () => null },
    order: {
      findMany: async () => [],
      create: async ({ data }) => {
        calls.push(data);
        return { ...data, id: "order-1" };
      },
    },
    orderItem: { findMany: async () => [] },
    activity: { create: async () => undefined },
    auditLog: { create: async () => undefined },
  };
  const service = new OrdersService({ $transaction: callback => callback(tx) });
  const base = { clientId: "client-1", type: "CUSTOM_ORDER", description: "Solo", priceMinor: 10000, currency: "EUR" };
  const actor = { id: "manager-1" };

  await service.create(base, actor);
  await service.create({ ...base, initialStatus: "BOOKING" }, actor);
  assert.equal(calls[0].salesStatusOptionId, undefined);
  assert.equal(calls[1].salesStatusOptionId, option.id);
  assert.equal(calls[1].salesStatus, "NEW_LEAD");
  assert.equal(calls[1].modelImagePath, undefined);
  assert.equal(calls[1].items.create[0].modelImagePath, undefined);

  option.archivedAt = new Date();
  await assert.rejects(service.create({ ...base, initialStatus: "BOOKING" }, actor), /Статус бронирования недоступен/);
  assert.equal(calls.length, 2);
});
