import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { buildOrderFileName, decodeOrderFile } from "../src/orders/order-file-policy.ts";

const orderService = (await readFile(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8")).replace(/\s+/g, "");

test("accepts approved order file types and keeps the stored extension server-owned", () => {
  const source = Buffer.from("%PDF-1.7\nfile-content");
  const decoded = decodeOrderFile({ name: "Эскиз.final.pdf", mimeType: "application/pdf", data: `data:application/pdf;base64,${source.toString("base64")}` });
  assert.equal(decoded.originalName, "Эскиз.final.pdf");
  assert.equal(decoded.mimeType, "application/pdf");
  assert.equal(decoded.content.toString(), "%PDF-1.7\nfile-content");
  assert.match(buildOrderFileName(decoded.mimeType), /^[0-9a-f-]+\.pdf$/);
});

test("rejects executable and oversized order files", () => {
  assert.throws(() => decodeOrderFile({ name: "virus.exe", mimeType: "application/x-msdownload", data: "data:application/x-msdownload;base64,AA==" }), /формат/i);
  assert.throws(() => decodeOrderFile({ name: "large.pdf", mimeType: "application/pdf", data: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64") }), /5 МБ/i);
});

test("rejects mismatched data URLs, malformed base64, and non-AI PostScript files", () => {
  assert.throws(() => decodeOrderFile({ name: "photo.png", mimeType: "image/png", data: "data:image/jpeg;base64,AA==" }), /не совпадает/i);
  assert.throws(() => decodeOrderFile({ name: "photo.png", mimeType: "image/png", data: "%%%=" }), /содержимое/i);
  assert.throws(() => decodeOrderFile({ name: "drawing.eps", mimeType: "application/postscript", data: "AA==" }), /Illustrator/i);
  assert.throws(() => decodeOrderFile({ name: "forged.pdf", mimeType: "application/pdf", data: Buffer.from("not-a-pdf").toString("base64") }), /формату/i);
});

test("file persistence shares the order archive lock and rechecks active state",()=>{
  const upload = orderService.slice(orderService.indexOf("asyncuploadOrderFile"),orderService.indexOf("asyncupdateModelImage"));
  assert.match(upload,/pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
  assert.match(upload,/tx\.order\.findFirst\(\{where:\{id:orderId,archivedAt:null\}/);
  assert.match(upload,/if\(!activeOrder\)thrownewNotFoundException\("Заказненайден"\)/);
  assert.ok(upload.indexOf("pg_advisory_xact_lock")<upload.indexOf("tx.orderFile.create"));
});

const nativeRequire = createRequire(import.meta.url);
class BadRequestException extends Error {}
class ConflictException extends Error {}
class NotFoundException extends Error {}
const common = { BadRequestException, ConflictException, Injectable: () => target => target, NotFoundException };
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true } }).outputText;

async function serviceFixture({ failAudit = false } = {}) {
  const uploadRoot = await mkdtemp(join(tmpdir(), "yo-order-file-"));
  const ordersModule = { exports: {} };
  const orderRequire = specifier => {
    if (specifier === "@nestjs/common") return common;
    if (specifier === "../prisma.service") return { PrismaService: class {} };
    if (specifier === "../finance/exchange-rates") return { appliedPaymentMinor: () => 0, buildPaymentConversion: () => ({}), ExchangeRatesService: class {}, EXCHANGE_RATE_ADVISORY_LOCK: "exchange", parseExchangeRateCache: () => ({}) };
    if (specifier === "../communications/inbound-routing") return { presentClientContact: value => value };
    if (specifier === "../keycrm/keycrm-normalizer") return { keycrmSourceChannel: () => "UNKNOWN" };
    if (specifier === "../uploads") return { uploadsRoot: () => uploadRoot };
    if (specifier === "./orders.dto") return {};
    if (specifier === "./order-archive") return { archiveOrdersTransaction: async () => ({}), OrderArchiveError: class extends Error {}, ORDER_ARCHIVE_ERROR: {} };
    if (specifier === "./order-delivery-address") return { DELIVERY_ADDRESS_ERROR: {}, DeliveryAddressOperationError: class extends Error {}, persistOrderDeliveryAddress: async () => ({}) };
    if (specifier === "./order-currency") return { changeOrderCurrencyTransaction: async () => ({}), OrderCurrencyChangeError: class extends Error {} };
    if (specifier === "./order-image-name") return { isOrderImageName: () => true };
    if (specifier === "./order-model-image") return { ORDER_MODEL_IMAGE_ERROR: {}, OrderModelImageOperationError: class extends Error {}, persistOrderModelImage: async () => ({}) };
    if (specifier === "./order-details") return { ORDER_DETAILS_ERROR: {}, OrderDetailsOperationError: class extends Error {}, persistOrderDetails: async () => ({}) };
    if (specifier === "./order-item-details") return { ORDER_ITEM_DETAILS_ERROR: {}, OrderItemDetailsError: class extends Error {}, persistAddedOrderItem: async () => ({}), persistOrderItemDetails: async () => ({}) };
    if (specifier === "./order-file-policy") return { buildOrderFileName: () => "uploaded.pdf", decodeOrderFile: () => ({ originalName: "Эскиз.pdf", mimeType: "application/pdf", content: Buffer.from("%PDF-1.7\norder-file") }) };
    if (specifier === "./production-rules") return { DEFAULT_PRODUCTION_DURATION_DAYS: 21, DEFAULT_SHIPPING_LEAD_DAYS: 7, productionSetting: value => Number(value), productionWindow: () => ({}), requiresProduction: () => true, resolveProductionSlotTentative: () => true, violatesShippingLead: () => false };
    if (specifier === "./production-context") return { loadProductionOrders: async () => [] };
    if (specifier === "sharp") return () => ({});
    return nativeRequire(specifier);
  };
  vm.runInNewContext(compile("../src/orders/orders.service.ts"), { module: ordersModule, exports: ordersModule.exports, require: orderRequire, Buffer, console, process, setTimeout, clearTimeout });
  const state = { files: [], activities: [], audits: [], locks: [] };
  const activeOrder = { id: "order-1", clientId: "client-1", number: "YO-26-0001" };
  const prisma = {
    order: { findFirst: async () => activeOrder },
    $transaction: async callback => {
      const draft = structuredClone(state);
      const tx = {
        $executeRawUnsafe: async (_sql, key) => draft.locks.push(key),
        order: { findFirst: async () => activeOrder },
        orderFile: { create: async ({ data }) => { const file = { id: "file-1", ...data }; draft.files.push(file); return file; } },
        activity: { create: async ({ data }) => draft.activities.push(data) },
        auditLog: { create: async ({ data }) => { if (failAudit) throw new Error("audit unavailable"); draft.audits.push(data); } },
      };
      const result = await callback(tx);
      Object.assign(state, draft);
      return result;
    },
  };
  const { OrdersService } = ordersModule.exports;
  return { service: new OrdersService(prisma, {}), state, uploadRoot };
}

test("order file is persisted with activity and audit and remains readable after reload", async t => {
  const target = await serviceFixture();
  t.after(() => rm(target.uploadRoot, { recursive: true, force: true }));
  const file = await target.service.uploadOrderFile("order-1", {}, { id: "owner-1" });
  assert.equal(file.id, "file-1");
  assert.deepEqual(target.state.locks, ["order-1"]);
  assert.equal(target.state.files.length, 1);
  assert.equal(target.state.activities[0].type, "ORDER_FILE_UPLOADED");
  assert.equal(target.state.audits[0].entityType, "OrderFile");
  assert.equal((await readFile(join(target.uploadRoot, "order-files", "uploaded.pdf"), "utf8")), "%PDF-1.7\norder-file");
});

test("transaction failure rolls back metadata and removes the physical file", async t => {
  const target = await serviceFixture({ failAudit: true });
  t.after(() => rm(target.uploadRoot, { recursive: true, force: true }));
  await assert.rejects(() => target.service.uploadOrderFile("order-1", {}, { id: "owner-1" }), /audit unavailable/);
  assert.deepEqual(target.state.files, []);
  assert.deepEqual(target.state.activities, []);
  assert.deepEqual(target.state.audits, []);
  await assert.rejects(() => access(join(target.uploadRoot, "order-files", "uploaded.pdf")));
});
