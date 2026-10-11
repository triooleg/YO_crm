import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
class BadRequestException extends Error { status = 400; }
const common = {
  BadRequestException,
  ConflictException: class extends Error {},
  Injectable: () => target => target,
  NotFoundException: class extends Error {},
};
let productionLoader = async () => [];
const requireForOrders = specifier => {
  if (specifier === "@nestjs/common") return common;
  if (specifier === "../prisma.service") return { PrismaService: class {} };
  if (specifier === "../finance/exchange-rates") return {};
  if (specifier === "../communications/inbound-routing") return { presentClientContact: value => value };
  if (specifier === "../uploads") return { uploadsRoot: "uploads" };
  if (specifier === "./orders.dto") return {};
  if (specifier === "./order-delivery-address") return { DELIVERY_ADDRESS_ERROR: {}, DeliveryAddressOperationError: class extends Error {}, persistOrderDeliveryAddress: async () => ({}) };
  if (specifier === "./order-currency") return { changeOrderCurrencyTransaction: async () => ({}), OrderCurrencyChangeError: class extends Error {} };
  if (specifier === "./order-image-name") return { isOrderImageName: () => true };
  if (specifier === "./order-model-image") return { ORDER_MODEL_IMAGE_ERROR: {}, OrderModelImageOperationError: class extends Error {}, persistOrderModelImage: async () => ({}) };
  if (specifier === "./order-details") return { ORDER_DETAILS_ERROR: {}, OrderDetailsOperationError: class extends Error {}, persistOrderDetails: async () => ({}) };
  if (specifier === "./production-rules") return {
    DEFAULT_PRODUCTION_DURATION_DAYS: 21,
    DEFAULT_SHIPPING_LEAD_DAYS: 7,
    productionSetting: (_value, fallback) => fallback,
    requiresProduction: type => type !== "READY_MODEL" && type !== "ACCESSORY",
    violatesShippingLead: () => true,
  };
  if (specifier === "./production-context") return { loadProductionOrders: (...args) => productionLoader(...args) };
  if (specifier === "sharp") return () => ({});
  return nativeRequire(specifier);
};
const source = readFileSync(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true } }).outputText;
const ordersModule = { exports: {} };
vm.runInNewContext(javascript, { module: ordersModule, exports: ordersModule.exports, require: requireForOrders, Buffer, console, process, setTimeout, clearTimeout });
const { OrdersService } = ordersModule.exports;

test("некорректный или чрезмерный период производства возвращает HTTP 400", async () => {
  const service = new OrdersService({}, {});
  for (const code of ["INVALID_PRODUCTION_RANGE", "PRODUCTION_RESULT_LIMIT_EXCEEDED"]) {
    productionLoader = async () => { throw new Error(code); };
    await assert.rejects(() => service.productionList(undefined, "2026-10-01", "2027-10-03"), error => error instanceof BadRequestException && error.status === 400);
  }
});

test("исторический слот не блокирует изменение срока быстрой продажи", async () => {
  const writes = [];
  const tx = {
    $executeRawUnsafe: async () => undefined,
    order: {
      findFirst: async () => ({ id: "order-1", clientId: "client-1", type: "READY_MODEL", productionSlot: { endsAt: new Date("2026-10-20T00:00:00Z") } }),
      update: async ({ data }) => { writes.push(data); return { id: "order-1", ...data }; },
    },
    appSetting: { findUnique: async () => ({ value: 7 }) },
    activity: { create: async () => undefined },
    auditLog: { create: async () => undefined },
  };
  const service = new OrdersService({ $transaction: callback => callback(tx) }, {});
  await service.updateDeadline("order-1", { requiredDeliveryAt: "2026-10-21T00:00:00Z" }, { id: "owner-1" });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].requiredDeliveryAt.toISOString(), "2026-10-21T00:00:00.000Z");
});
