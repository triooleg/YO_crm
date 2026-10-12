import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const controller = readFileSync(new URL("../src/orders/orders.controller.ts", import.meta.url), "utf8");
const dto = readFileSync(new URL("../src/orders/orders.dto.ts", import.meta.url), "utf8");
class HttpError extends Error {}
const common = { BadRequestException: HttpError, ConflictException: HttpError, Injectable: () => target => target, NotFoundException: HttpError };
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true } }).outputText;
const module = { exports: {} };
const orderRequire = specifier => {
  if (specifier === "@nestjs/common") return common;
  if (specifier === "../prisma.service") return { PrismaService: class {} };
  if (specifier === "../finance/exchange-rates") return { appliedPaymentMinor: () => 0, buildPaymentConversion: () => ({}), ExchangeRatesService: class {}, EXCHANGE_RATE_ADVISORY_LOCK: "exchange", parseExchangeRateCache: () => ({}) };
  if (specifier === "../communications/inbound-routing") return { presentClientContact: value => value };
  if (specifier === "../keycrm/keycrm-normalizer") return { keycrmSourceChannel: () => "UNKNOWN" };
  if (specifier === "../uploads") return { uploadsRoot: () => "uploads" };
  if (specifier === "./orders.dto") return {};
  if (specifier === "./order-archive") return { archiveOrdersTransaction: async () => ({}), OrderArchiveError: class extends Error {}, ORDER_ARCHIVE_ERROR: {} };
  if (specifier === "./order-delivery-address") return { DELIVERY_ADDRESS_ERROR: {}, DeliveryAddressOperationError: class extends Error {}, persistOrderDeliveryAddress: async () => ({}) };
  if (specifier === "./order-currency") return { changeOrderCurrencyTransaction: async () => ({}), OrderCurrencyChangeError: class extends Error {} };
  if (specifier === "./order-image-name") return { isOrderImageName: () => true };
  if (specifier === "./order-model-image") return { ORDER_MODEL_IMAGE_ERROR: {}, OrderModelImageOperationError: class extends Error {}, persistOrderModelImage: async () => ({}) };
  if (specifier === "./order-details") return { ORDER_DETAILS_ERROR: {}, OrderDetailsOperationError: class extends Error {}, persistOrderDetails: async () => ({}) };
  if (specifier === "./order-item-details") return { ORDER_ITEM_DETAILS_ERROR: {}, OrderItemDetailsError: class extends Error {}, persistOrderItemDetails: async () => ({}) };
  if (specifier === "./order-file-policy") return { buildOrderFileName: () => "file.pdf", decodeOrderFile: () => ({ originalName: "file.pdf", mimeType: "application/pdf", content: Buffer.from("file") }) };
  if (specifier === "./production-rules") return { DEFAULT_PRODUCTION_DURATION_DAYS: 21, DEFAULT_SHIPPING_LEAD_DAYS: 7, productionSetting: value => Number(value), productionWindow: () => ({}), requiresProduction: () => true, resolveProductionSlotTentative: () => true, violatesShippingLead: () => false };
  if (specifier === "./production-context") return { loadProductionOrders: async () => [] };
  if (specifier === "sharp") return () => ({});
  return nativeRequire(specifier);
};
vm.runInNewContext(compile("../src/orders/orders.service.ts"), { module, exports: module.exports, require: orderRequire, Buffer, console, process, setTimeout, clearTimeout });
const { OrdersService } = module.exports;

function harness(current = "Старое пожелание") {
  const writes = { update: [], activities: [], audits: [] };
  const order = { id: "order-1", clientId: "client-1", buyerComment: current, notes: "Описание модели", archivedAt: null, salesStatus: "NEW_LEAD" };
  const tx = {
    $executeRawUnsafe: async () => 1,
    order: {
      findFirst: async () => order,
      update: async ({ data }) => { writes.update.push(data); return { ...order, ...data }; },
    },
    activity: { create: async ({ data }) => { writes.activities.push(data); return data; } },
    auditLog: { create: async ({ data }) => { writes.audits.push(data); return data; } },
  };
  return { service: new OrdersService({ $transaction: callback => callback(tx) }, {}), order, writes };
}

test("маршрут пожеланий клиента защищён установленными ролями и отдельным DTO", () => {
  assert.match(controller, /@Patch\(":id\/buyer-comment"\)\s+@Roles\("OWNER", "ADMIN", "MANAGER"\)/);
  assert.match(controller, /updateBuyerComment\(@Param\("id"\) id: string/);
  assert.match(dto, /class UpdateOrderBuyerCommentDto/);
  assert.match(dto, /expectedBuyerComment/);
});

test("обновление пожелания меняет только buyerComment и сохраняет историю", async () => {
  const { service, writes } = harness();
  const result = await service.updateBuyerComment("order-1", { buyerComment: "  Новое пожелание  ", expectedBuyerComment: "Старое пожелание" }, { id: "owner-1" });
  assert.deepEqual(JSON.parse(JSON.stringify(writes.update)), [{ buyerComment: "Новое пожелание" }]);
  assert.equal(result.notes, "Описание модели");
  assert.equal(writes.activities.length, 1);
  assert.equal(writes.activities[0].type, "ORDER_BUYER_COMMENT_UPDATED");
  assert.equal(writes.audits.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(writes.audits[0].before)), { buyerComment: "Старое пожелание" });
  assert.deepEqual(JSON.parse(JSON.stringify(writes.audits[0].after)), { buyerComment: "Новое пожелание" });
});

test("пустое пожелание становится null, а no-op не создаёт ложную историю", async () => {
  const empty = harness("Текст");
  await empty.service.updateBuyerComment("order-1", { buyerComment: "   ", expectedBuyerComment: "Текст" }, { id: "owner-1" });
  assert.deepEqual(JSON.parse(JSON.stringify(empty.writes.update)), [{ buyerComment: null }]);

  const same = harness("Текст");
  await same.service.updateBuyerComment("order-1", { buyerComment: "Текст", expectedBuyerComment: "Текст" }, { id: "owner-1" });
  assert.equal(same.writes.update.length, 0);
  assert.equal(same.writes.activities.length, 0);
  assert.equal(same.writes.audits.length, 0);
});

test("устаревшее ожидаемое значение не перезаписывает пожелание", async () => {
  const { service, writes } = harness("Уже изменено");
  await assert.rejects(() => service.updateBuyerComment("order-1", { buyerComment: "Мой вариант", expectedBuyerComment: "Старое" }, { id: "owner-1" }), HttpError);
  assert.equal(writes.update.length, 0);
  assert.equal(writes.activities.length, 0);
  assert.equal(writes.audits.length, 0);
});
