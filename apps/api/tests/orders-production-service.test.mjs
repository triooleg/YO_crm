import {loadTargetModule} from './overview-target-loader.mjs';
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
  if (specifier === "../keycrm/keycrm-normalizer") return { keycrmSourceChannel: () => "UNKNOWN" };
  if (specifier === "../uploads") return { uploadsRoot: "uploads" };
  if (specifier === "./orders.dto") return {};
  if (specifier === "./order-archive") return { archiveOrdersTransaction: async () => ({}), OrderArchiveError: class extends Error {}, ORDER_ARCHIVE_ERROR: {} };
  if (specifier === "./order-delivery-address") return { DELIVERY_ADDRESS_ERROR: {}, DeliveryAddressOperationError: class extends Error {}, persistOrderDeliveryAddress: async () => ({}) };
  if (specifier === "./order-currency") return { changeOrderCurrencyTransaction: async () => ({}), OrderCurrencyChangeError: class extends Error {} };
  if (specifier === "./order-image-name") return { isOrderImageName: () => true };
  if (specifier === "./order-model-image") return { ORDER_MODEL_IMAGE_ERROR: {}, OrderModelImageOperationError: class extends Error {}, persistOrderModelImage: async () => ({}) };
  if (specifier === "./order-details") return { ORDER_DETAILS_ERROR: {}, OrderDetailsOperationError: class extends Error {}, persistOrderDetails: async () => ({}) };
  if (specifier === "./order-item-details") return { ORDER_ITEM_DETAILS_ERROR: {}, OrderItemDetailsError: class extends Error {}, persistOrderItemDetails: async () => ({}) };
  if (specifier === "./order-design-number") return { ORDER_DESIGN_NUMBER_ERROR: {}, OrderDesignNumberError: class extends Error {}, persistOrderDesignNumber: async () => ({}) };
  if (specifier === "./order-file-policy") return { buildOrderFileName: () => "file.pdf", decodeOrderFile: () => ({ originalName: "file.pdf", mimeType: "application/pdf", content: Buffer.from("file") }) };
  if (specifier === "./production-rules") return {
    DEFAULT_PRODUCTION_DURATION_DAYS: 21,
    DEFAULT_SHIPPING_LEAD_DAYS: 7,
    productionSetting: (_value, fallback) => fallback,
    requiresProduction: type => !["READY_MODEL", "ACCESSORY", "WEBSITE_SALE", "STOCK_SALE"].includes(type),
    violatesShippingLead: () => true,
  };
  if (specifier === "./production-status-graph") return { updateProductionStatusGraph: async (tx, orderId, productionStatus, orderData = {}) => { const order = await tx.order.update({ where: { id: orderId }, data: { ...orderData, productionStatus } }); await tx.orderItem?.updateMany?.({ where: { orderId }, data: { productionStatus } }); await tx.orderItemInstance?.updateMany?.({ where: { orderItem: { orderId }, archivedAt: null }, data: { productionStatus } }); return order; } };
  if (specifier === "./production-context") return { loadProductionOrders: (...args) => productionLoader(...args) };
  if (specifier === "sharp") return () => ({});
  if (specifier === './order-assignment-eligibility' || specifier === './order-source' || specifier === './order-list-read-model' || specifier === './website-order-fee') return loadTargetModule('orders/'+specifier.slice(2)+'.ts');
  if (specifier === "../finance/invoice-number") return loadTargetModule("finance/invoice-number.ts");
  if (specifier === "../clients/measurement-data") return loadTargetModule("clients/measurement-data.ts");
  return nativeRequire(specifier);
};
const source = readFileSync(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true } }).outputText;
const ordersModule = { exports: {} };
vm.runInNewContext(javascript, { module: ordersModule, exports: ordersModule.exports, require: requireForOrders, Buffer, console, process, setTimeout, clearTimeout });
const { OrdersService } = ordersModule.exports;

test('completed orders cannot create or edit production slots and keep history intact',async()=>{
 for(const productionSlot of [null,{id:'historical-slot'}]){
  const writes=[];
  const tx={$executeRawUnsafe:async()=>undefined,order:{findFirst:async()=>({id:'closed',type:'CUSTOM_ORDER',salesStatus:'COMPLETED',productionSlot,payments:[]})},appSetting:{findUnique:async()=>({value:2})},productionSlot:{upsert:async()=>{writes.push('slot');return {id:'new'}}},activity:{create:async()=>writes.push('activity')},auditLog:{create:async()=>writes.push('audit')}};
  const service=new OrdersService({$transaction:callback=>callback(tx)},{});
  await assert.rejects(()=>service.updateProductionSlot('closed',{startsAt:'2026-10-01',endsAt:'2026-10-05'},{id:'owner'}),error=>error instanceof BadRequestException&&/завершён/i.test(error.message));
  assert.deepEqual(writes,[]);
 }
});

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
