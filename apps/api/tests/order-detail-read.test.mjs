import {loadTargetModule} from './overview-target-loader.mjs';
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const controllerSource = readFileSync(new URL("../src/orders/orders.controller.ts", import.meta.url), "utf8");
const HttpError = class extends Error {};
const common = { BadRequestException: HttpError, ConflictException: HttpError, Injectable: () => target => target, NotFoundException: HttpError };
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true } }).outputText;
const ordersModule = { exports: {} };
const orderRequire = specifier => {
  if (specifier === "@nestjs/common") return common;
  if (specifier === "../prisma.service") return { PrismaService: class {} };
  if (specifier === "../finance/exchange-rates") return { appliedPaymentMinor: () => 0, buildPaymentConversion: () => ({}), ExchangeRatesService: class {}, EXCHANGE_RATE_ADVISORY_LOCK: "exchange", parseExchangeRateCache: () => ({}) };
  if (specifier === "../communications/inbound-routing") return { presentClientContact: client => ({ ...client, presented: true }) };
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
  if (specifier === "./order-design-number") return { ORDER_DESIGN_NUMBER_ERROR: {}, OrderDesignNumberError: class extends Error {}, persistOrderDesignNumber: async () => ({}) };
  if (specifier === "./order-file-policy") return { buildOrderFileName: () => "file.pdf", decodeOrderFile: () => ({ originalName: "file.pdf", mimeType: "application/pdf", content: Buffer.from("file") }) };
  if (specifier === "./production-rules") return { DEFAULT_PRODUCTION_DURATION_DAYS: 21, DEFAULT_SHIPPING_LEAD_DAYS: 7, productionSetting: value => Number(value), productionWindow: () => ({}), requiresProduction: () => true, resolveProductionSlotTentative: () => true, violatesShippingLead: () => false };
  if (specifier === "./production-status-graph") return { updateProductionStatusGraph: async (tx, orderId, productionStatus, orderData = {}) => tx.order.update({ where: { id: orderId }, data: { ...orderData, productionStatus } }) };
  if (specifier === "./production-context") return { loadProductionOrders: async () => [] };
  if (specifier === "sharp") return () => ({});
  if (specifier === './order-assignment-eligibility' || specifier === './order-source' || specifier === './order-list-read-model' || specifier === './website-order-fee') return loadTargetModule('orders/'+specifier.slice(2)+'.ts');
  if (specifier === "../finance/invoice-number") return loadTargetModule("finance/invoice-number.ts");
  if (specifier === "../clients/measurement-data") return loadTargetModule("clients/measurement-data.ts");
  return nativeRequire(specifier);
};
vm.runInNewContext(compile("../src/orders/orders.service.ts"), { module: ordersModule, exports: ordersModule.exports, require: orderRequire, Buffer, console, process, setTimeout, clearTimeout });
const { OrdersService } = ordersModule.exports;

test('order search includes the displayed external business number', async () => {
  let where;
  const service = new OrdersService({ order: { findMany: async query => { where = query.where; return []; } } }, {});
  await service.list('706');
  assert.equal(JSON.parse(JSON.stringify(where.OR)).some(term => term.externalNumber?.contains === '706'), true);
});

test('paged order metrics and website count exclude archived orders behaviorally', async () => {
  const base = { type:'READY_MODEL', discipline:null, country:null, deliveryAddressSet:false, deliveryAddressText:null, deliveryAddressLine1:null, deliveryAddressLine2:null, deliveryCity:null, deliveryRegion:null, deliveryPostalCode:null, deliveryTrackingCode:null, requiredDeliveryAt:null, promisedProductionAt:null, priority:false, deliveryMinor:0, discountMinor:0, taxMinor:0, giftWrapMinor:0, paymentStatus:'UNPAID', modelImagePath:null, externalImageUrl:null, notes:null, buyerComment:null, managerComment:null, giftMessage:null, promocode:null, isGift:false, externalUpdatedAt:null, productionSlot:null, athlete:null, measurement:null, activities:[], files:[], invoices:[], shipment:null, orderShipments:[], expenses:[], compositionOperations:[], _count:{items:1}, currency:'EUR', priceMinor:10000, depositRequiredMinor:5000, salesStatus:'NEW_LEAD', productionStatus:'NOT_SCHEDULED', shippingStatus:'NOT_READY', client:{id:'client',displayName:'Buyer',country:null,city:null,address:null,postalCode:null,language:null,source:'WEBSITE',phone:null,email:null,facebook:null,instagram:null,whatsapp:null,updatedAt:new Date()}, items:[{id:'item',name:'Leotard',quantity:1,priceMinor:10000,productionStatus:'NOT_SCHEDULED',instances:[]}], payments:[] };
  const active = {...base,id:'active',number:'YO-708',createdAt:new Date('2026-10-23'),archivedAt:null,sourceSystem:'YOLEOTARD_WEBSITE',sourceAccount:'calendar.yoleotard.com',sourceLinkMode:'IMPORTED',externalId:'261023',externalNumber:'#22734',externalData:{contractVersion:1}};
  const archived = {...active,id:'archived',number:'YO-707',archivedAt:new Date('2026-10-22')};
  const rows=[active,archived];
  const db={order:{findMany:async query=>{
    const selected=query.where?.archivedAt===null?rows.filter(row=>row.archivedAt===null):query.where?.id?.in?rows.filter(row=>query.where.id.in.includes(row.id)):rows;
    return structuredClone(selected);
  }},$transaction:async run=>run(db)};
  const result=await new OrdersService(db,{}).list(undefined,{page:'1',pageSize:'20'});
  assert.equal(result.metrics.total,1);assert.equal(result.sources.total,1);assert.equal(result.sources.websiteCount,1);assert.deepEqual(result.items.map(order=>order.id),['active']);
});

test("single-order detail uses the established broad-order read RBAC", () => {
  assert.match(controllerSource, /@Get\(":id"\)\s+@Roles\(UserRole\.OWNER, UserRole\.ADMIN, UserRole\.MANAGER\)\s+detail\(/);
  assert.match(controllerSource, /detail\(@Param\("id"\) id: string\) \{ return this\.orders\.detail\(id\); \}/);
});

test("lazy detail returns the canonical order with expanded manager, finance, activity, and item measurement history", async () => {
  let query, paymentHistoryQuery;
  const activePayment = { id: "payment-active", voidedAt: null };
  const voidedPayment = { id: "payment-voided", voidedAt: new Date("2026-10-10T12:00:00.000Z"), voidReason: "Отменён" };
  const historyMeasurement = { id: "measurement-history", values: { m1: 80 } };
  const row = {
    id: "order-1", client: { id: "client-1", displayName: "Client", athletes: [{ id: "athlete-1", firstName: "Anna", measurements: [historyMeasurement] }] }, payments: [activePayment], invoices: [], activities: [],
    athlete: { id: "legacy-athlete", clientId: "client-1", archivedAt: null, firstName: "Legacy", measurements: [{ id: "legacy-history", values: { m1: 79 } }] },
    items: [{ id: "item-1", measurement: { id: "measurement-current", values: { m1: 81 } }, athlete: { id: "athlete-1", clientId: "client-1", archivedAt: null, firstName: "Anna", measurements: [historyMeasurement] } }],
  };
  const service = new OrdersService({
    order: { findFirst: async value => { query = value; return row; }, findMany:async()=>[{id:row.id,activities:[]}] },
    payment: { findMany: async value => { paymentHistoryQuery = value; return [activePayment, voidedPayment]; } },
  }, {});

  const result = await service.detail("order-1");

  assert.deepEqual(JSON.parse(JSON.stringify(query.where)), { id: "order-1", archivedAt: null });
  assert.equal(query.select.id, true);
  assert.equal(result.orderSource,"UNKNOWN");
  assert.deepEqual(JSON.parse(JSON.stringify(query.select.responsibleManager.select)), { id: true, displayName: true });
  assert.equal(query.select.activities.take > 30, true);
  assert.deepEqual(JSON.parse(JSON.stringify(query.select.payments.where)), { voidedAt: null });
  assert.deepEqual(JSON.parse(JSON.stringify(paymentHistoryQuery.where)), { orderId: "order-1" });
  assert.equal(paymentHistoryQuery.select.voidedAt, true);
  assert.equal(paymentHistoryQuery.select.voidReason, true);
  assert.equal(query.select.invoices.select.currency, true);
  assert.equal(query.select.invoices.select.dueDate, true);
  assert.equal(query.select.items.select.measurement.select.values, true);
  assert.equal(query.select.items.select.athlete.select.measurements.select.values, true);
  assert.equal(query.select.client.select.athletes.select.measurements.select.values, true);
  assert.equal(query.select.athlete.select.measurements.select.values, true);
  assert.equal(result.client.presented, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.payments)), [{ id: "payment-active", voidedAt: null }]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.paymentHistory)).map(payment => payment.id), ["payment-active", "payment-voided"]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.items[0].measurementHistory)), [historyMeasurement]);
  assert.equal("measurements" in result.items[0].athlete, false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.measurementHistory)), [{ id: "legacy-history", values: { m1: 79 } }]);
  assert.equal("measurements" in result.athlete, false);
});

test("lazy detail rejects missing or archived orders", async () => {
  let historyReads = 0;
  const service = new OrdersService({ order: { findFirst: async () => null }, payment: { findMany: async () => { historyReads++; return []; } } }, {});
  await assert.rejects(() => service.detail("missing"), HttpError);
  assert.equal(historyReads, 0);
});

for(const [operations,archivedCount,expected] of [[[],0,false],[[{id:'private-operation'}],0,true],[[],2,true]])test(`detail compositionManaged is ${expected} for operations ${operations.length} archived ${archivedCount}`,async()=>{
 let query;const historical={id:'snapshot',archivedAt:new Date(),athleteId:'a',values:{m1:80}};
 const row={id:'o',client:{id:'c',athletes:[]},items:[],athlete:null,compositionOperations:operations,_count:{items:archivedCount},measurementHistory:[historical]};
 const service=new OrdersService({order:{findFirst:async q=>{query=q;return row},findMany:async()=>[{id:'o',activities:[]}]},payment:{findMany:async()=>[]}},{});
 const result=await service.detail('o');assert.equal(result.compositionManaged,expected);assert.equal(result.items.length,0);
 assert.equal('compositionOperations' in result,false);assert.equal('_count' in result,false);
 assert.equal(query.select.compositionOperations.take,1);assert.equal(query.select.items.where.archivedAt,null);
 assert.equal(query.select.items.select.notes,true);assert.equal(query.select.items.select.discipline,true);assert.equal(query.select.items.select.archivedAt,true);
 assert.equal(query.select.items.select.instances.select.standardHeight,true);
 assert.equal(query.select.items.select.measurement.select.archivedAt,true);assert.equal(query.select.client.select.athletes.select.measurements.select.archivedAt,true);
});
