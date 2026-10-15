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
let resolveIds = async () => [];
const requireForOrders = specifier => {
  if (specifier === "../overview/overview-order-model") return { resolveOverviewOrderIds: (...args) => resolveIds(...args) };
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
  if (specifier === './order-assignment-eligibility' || specifier === './order-source' || specifier === './order-list-read-model') return loadTargetModule('orders/'+specifier.slice(2)+'.ts');
  return nativeRequire(specifier);
};
const source = readFileSync(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true } }).outputText;
const ordersModule = { exports: {} };
vm.runInNewContext(javascript, { module: ordersModule, exports: ordersModule.exports, require: requireForOrders, Buffer, console, process, setTimeout, clearTimeout });
const { OrdersService } = ordersModule.exports;

test("Overview Orders API intersects the exact cohort with search and retains the legacy contact projection", async () => {
  const calls=[];
  const prisma={order:{findMany:async query=>{calls.push(query);return [{id:"wanted",client:{displayName:"Real"}}]}}};
  resolveIds=async (db,input)=>{assert.equal(db,prisma);assert.equal(input.overviewFilter,"ready");assert.equal(input.period,"2026-10");return ["wanted"]};
  const service=new OrdersService(prisma,{});
  const rows=await service.list(" Alice ",{overviewFilter:"ready",period:"2026-10"});
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].where.id)),{in:["wanted"]});
  assert.equal(calls[0].where.archivedAt,null);
  assert.equal(calls[0].where.OR[0].number.contains,"Alice");
  assert.equal(rows[0].client.displayName,"Real");
  calls.length=0;
  resolveIds=async()=>{throw new Error("must not resolve legacy")};
  await service.list();assert.equal("id" in calls[0].where,false);
});
test("Overview invalid context fails before querying full orders and production allows only work",async()=>{
 let queried=false;
 const service=new OrdersService({order:{findMany:async()=>{queried=true;return []}}},{});
 resolveIds=async()=>{throw new BadRequestException("bad filter")};
 await assert.rejects(()=>service.list(undefined,{overviewFilter:"invalid"}),BadRequestException);
 assert.equal(queried,false);
 await assert.rejects(()=>service.productionList(undefined,undefined,undefined,"ready"),BadRequestException);
});
test("Overview production endpoint passes the shared cohort to the safe projection loader",async()=>{
 resolveIds=async()=>["work"];
 productionLoader=async(...args)=>{assert.deepEqual(JSON.parse(JSON.stringify(args[5])),{orderIds:["work"]});return [{id:"work"}]};
 const rows=await new OrdersService({order:{}},{}).productionList(undefined,"2026-10-01","2026-10-31","work");
 assert.equal(rows[0].id,"work");
});
