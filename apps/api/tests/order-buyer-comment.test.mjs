import {loadTargetModule} from './overview-target-loader.mjs';
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
  if (specifier === "./production-status-graph") return { updateProductionStatusGraph: async (tx, orderId, productionStatus, orderData = {}) => tx.order.update({ where: { id: orderId }, data: { ...orderData, productionStatus } }) };
  if (specifier === "./production-context") return { loadProductionOrders: async () => [] };
  if (specifier === "sharp") return () => ({});
  if (specifier === './order-assignment-eligibility' || specifier === './order-source' || specifier === './order-list-read-model') return loadTargetModule('orders/'+specifier.slice(2)+'.ts');
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

function managerHarness(current = "Текущая заметка", options = {}) {
  const writes={updates:[],activities:[],audits:[]};
  const order={id:'order-1',clientId:'client-1',managerComment:current,buyerComment:'Пожелания клиента',notes:'Описание модели',priceMinor:12345,archivedAt:null};
  const tx={$executeRawUnsafe:async()=>1,order:{findFirst:async()=>options.missing?null:order,updateMany:async({where,data})=>{writes.updates.push({where,data});return {count:options.conflict?0:1};}},activity:{create:async({data})=>writes.activities.push(data)},auditLog:{create:async({data})=>writes.audits.push(data)}};
  return {service:new OrdersService({$transaction:callback=>callback(tx)},{}),order,writes};
}
test('manager-note route uses existing CRM roles and a required expected-value DTO',()=>{
 assert.match(controller,/@Patch\(":id\/manager-comment"\)\s+@Roles\("OWNER", "ADMIN", "MANAGER"\)/);
 assert.match(dto,/class UpdateOrderManagerCommentDto/);assert.match(dto,/expectedManagerComment/);
});
test('manager note writes only its field with atomic expectation and audited history',async()=>{
 const {service,order,writes}=managerHarness();const before=JSON.stringify(order);
 const result=await service.updateManagerComment('order-1',{managerComment:' Новая заметка\nЮнікод ',expectedManagerComment:'Текущая заметка'},{id:'manager-1'});
 assert.deepEqual(JSON.parse(JSON.stringify(writes.updates)),[{where:{id:'order-1',archivedAt:null,managerComment:'Текущая заметка'},data:{managerComment:'Новая заметка\nЮнікод'}}]);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),{id:'order-1',managerComment:'Новая заметка\nЮнікод'});
 assert.equal(JSON.stringify(order),before);assert.equal(writes.activities[0].type,'ORDER_MANAGER_COMMENT_UPDATED');
 assert.equal(writes.audits[0].actorId,'manager-1');assert.deepEqual(JSON.parse(JSON.stringify(writes.audits[0].before)),{managerComment:'Текущая заметка'});
 assert.deepEqual(JSON.parse(JSON.stringify(writes.audits[0].after)),{managerComment:'Новая заметка\nЮнікод'});
});
test('manager note empty clear and no-op retain customer wishes and avoid false history',async()=>{
 const clear=managerHarness();await clear.service.updateManagerComment('order-1',{managerComment:' ',expectedManagerComment:'Текущая заметка'},{id:'m'});
 assert.equal(clear.writes.updates[0].data.managerComment,null);
 const same=managerHarness();await same.service.updateManagerComment('order-1',{managerComment:'Текущая заметка',expectedManagerComment:'Текущая заметка'},{id:'m'});
 assert.equal(same.writes.updates.length,0);assert.equal(same.writes.audits.length,0);assert.equal(same.writes.activities.length,0);
});
test('manager note rejects stale expected text without history or writes',async()=>{
 const {service,writes}=managerHarness('Новее');await assert.rejects(()=>service.updateManagerComment('order-1',{managerComment:'Моё',expectedManagerComment:'Старое'},{id:'m'}),HttpError);
 assert.equal(writes.updates.length,0);assert.equal(writes.activities.length,0);assert.equal(writes.audits.length,0);
});
test('manager note rejects missing/archived orders and a lost atomic comparison',async()=>{
 const missing=managerHarness(null,{missing:true});await assert.rejects(()=>missing.service.updateManagerComment('order-1',{managerComment:'Новое',expectedManagerComment:null},{id:'m'}),HttpError);assert.equal(missing.writes.updates.length,0);
 const conflict=managerHarness('Текущая заметка',{conflict:true});await assert.rejects(()=>conflict.service.updateManagerComment('order-1',{managerComment:'Новое',expectedManagerComment:'Текущая заметка'},{id:'m'}),HttpError);assert.equal(conflict.writes.audits.length,0);assert.equal(conflict.writes.activities.length,0);
});
