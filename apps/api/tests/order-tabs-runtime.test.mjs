import {loadTargetModule} from './overview-target-loader.mjs';
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const measurementModule = { exports: {} };
const measurementJs = ts.transpileModule(readFileSync(new URL("../src/clients/measurement-data.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function("require", "module", "exports", measurementJs)(nativeRequire, measurementModule, measurementModule.exports);
function loadOrderTabsService() {
  const source = readFileSync(new URL("../src/orders/order-tabs.service.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const localRequire = specifier => {
    if (specifier === "./order-assignment-eligibility") return loadTargetModule("orders/order-assignment-eligibility.ts");
    if (specifier === "../clients/measurement-data") return measurementModule.exports;
    if (specifier === "../prisma.service") return { PrismaService: class PrismaService {} };
    if (specifier === "../uploads") return { uploadsRoot: () => ".local" };
    if (specifier === "./order-file-policy") return { buildOrderFileName: () => "file", decodeOrderFile: () => ({ mimeType: "text/plain", originalName: "file", content: Buffer.from("x") }) };
    if (specifier === "./order-tabs.dto") return {};
    if (specifier === "../finance/exchange-rates") return { appliedPaymentMinor: payment => payment.amountMinor };
    if (specifier === "./production-rules") return { requiresProduction: type => !["READY_MODEL", "ACCESSORY", "WEBSITE_SALE", "STOCK_SALE"].includes(type) };
    if (specifier === "./production-status-graph") return { aggregateProductionStatus: statuses => statuses.every(status => status === "READY") ? "READY" : statuses.some(status => ["MATERIALS", "CUTTING", "SEWING", "DECORATION", "QUALITY_CONTROL", "READY"].includes(status)) ? "SEWING" : statuses.some(status => status === "SCHEDULED") ? "SCHEDULED" : "NOT_SCHEDULED" };
    return nativeRequire(specifier);
  };
  vm.runInNewContext(javascript, { module, exports: module.exports, require: localRequire, console, process, Buffer });
  return module.exports.OrderTabsService;
}

function fixture({ athleteOwned = true, measurementOwned = true, orderType = "INDIVIDUAL", paidMinor = 22500, depositRequiredMinor = 22500, salesStatus='NEW_LEAD' } = {}) {
  let updates = 0;
  const aggregateWrites = [];
  const current = { id: "instance-1", orderItemId: "item-1", ordinal: 1, athleteId: "athlete-1", measurementId: "measurement-1", productionStatus: "SCHEDULED", startedAt: null, completedAt: null, updatedAt: new Date("2026-10-13T10:00:00.000Z"), orderItem: { name: "Design", order: { clientId: "client-1", salesStatus, type: orderType, currency: "EUR", depositRequiredMinor, payments: paidMinor ? [{ amountMinor: paidMinor, currency: "EUR" }] : [] } } };
  const tx = {
    $executeRawUnsafe: async () => 1,
    orderItemInstance: {
      findFirst: async () => structuredClone(current),
      update: async ({ data }) => { updates += 1; return { ...current, ...data }; },
      findMany: async ({ where }) => where.orderItemId ? [{ productionStatus: "READY" }, { productionStatus: "SCHEDULED" }] : [{ productionStatus: "READY" }, { productionStatus: "SCHEDULED" }, { productionStatus: "READY" }],
    },
    orderItem: { update: async ({ data }) => { aggregateWrites.push(["item", data.productionStatus]); return {}; } },
    order: { update: async ({ data }) => { aggregateWrites.push(["order", data.productionStatus]); return {}; } },
    athlete: { findFirst: async () => athleteOwned ? { id: "athlete-2" } : null },
    measurement: { findFirst: async () => measurementOwned ? { id: "measurement-2" } : null },
    activity: { create: async () => ({}) },
    auditLog: { create: async () => ({}) },
  };
  const OrderTabsService = loadOrderTabsService();
  return { service: new OrderTabsService({ $transaction: callback => callback(tx) }), updates: () => updates, aggregateWrites: () => aggregateWrites };
}

test("foreign athlete is rejected without changing the physical order instance", async () => {
  const target = fixture({ athleteOwned: false });
  await assert.rejects(() => target.service.updateInstance("order-1", "instance-1", { athleteId: "athlete-2", measurementId: null, expectedUpdatedAt: "2026-10-13T10:00:00.000Z" }, { id: "owner-1" }), /не принадлежит клиенту заказа/);
  assert.equal(target.updates(), 0);
});

test('completed orders cannot reenter production through an instance',async()=>{
 const target=fixture({salesStatus:'COMPLETED'});
 await assert.rejects(()=>target.service.updateInstance('order-1','instance-1',{productionStatus:'SCHEDULED',expectedUpdatedAt:'2026-10-13T10:00:00.000Z'},{id:'owner'}),/завершён/i);
 assert.equal(target.updates(),0);assert.deepEqual(target.aggregateWrites(),[]);
});

test("measurement owned by another athlete is rejected without writes", async () => {
  const target = fixture({ measurementOwned: false });
  await assert.rejects(() => target.service.updateInstance("order-1", "instance-1", { athleteId: "athlete-2", measurementId: "measurement-2", expectedUpdatedAt: "2026-10-13T10:00:00.000Z" }, { id: "owner-1" }), /не принадлежит выбранному спортсмену/);
  assert.equal(target.updates(), 0);
});

test("physical instances keep independent progress and recompute item and order summaries", async () => {
  const target = fixture();
  const updated = await target.service.updateInstance("order-1", "instance-1", { productionStatus: "READY", expectedUpdatedAt: "2026-10-13T10:00:00.000Z" }, { id: "owner-1" });
  assert.equal(updated.productionStatus, "READY");
  assert.equal(Number.isNaN(Date.parse(updated.completedAt)), false);
  assert.deepEqual(target.aggregateWrites(), [["item", "SEWING"], ["order", "SEWING"]]);
});

test("quick-sale orders cannot be moved into production through an instance", async () => {
  const target = fixture({ orderType: "WEBSITE_SALE" });
  await assert.rejects(
    () => target.service.updateInstance("order-1", "instance-1", { productionStatus: "SEWING", expectedUpdatedAt: "2026-10-13T10:00:00.000Z" }, { id: "owner-1" }),
    /не планируются в производство/,
  );
  assert.equal(target.updates(), 0);
});

test("committed instance production status requires the order deposit", async () => {
  const target = fixture({ paidMinor: 10000, depositRequiredMinor: 22500 });
  await assert.rejects(
    () => target.service.updateInstance("order-1", "instance-1", { productionStatus: "READY", expectedUpdatedAt: "2026-10-13T10:00:00.000Z" }, { id: "owner-1" }),
    /требуемой предоплаты/,
  );
  assert.equal(target.updates(), 0);
});
