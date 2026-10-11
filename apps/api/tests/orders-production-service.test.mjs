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
  if (specifier === "./production-rules") return { DEFAULT_PRODUCTION_DURATION_DAYS: 21, DEFAULT_SHIPPING_LEAD_DAYS: 7 };
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
