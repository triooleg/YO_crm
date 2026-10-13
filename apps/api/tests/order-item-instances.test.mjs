import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/orders/order-item-details.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const detailsModule = { exports: {} };
vm.runInNewContext(javascript, {
  module: detailsModule,
  exports: detailsModule.exports,
  require: specifier => specifier === "@prisma/client"
    ? { PaymentStatus: {} }
    : specifier === "./production-status-graph"
      ? { updateProductionStatusGraph: async () => ({}) }
      : undefined,
  Date,
  Math,
});
const { OrderItemInstanceConflictError, reconcileOrderItemInstances } = detailsModule.exports;

function fixture(existing = []) {
  const rows = existing.map((row) => ({
    athleteId: null,
    measurementId: null,
    orderShipmentId: null,
    productionStatus: "NOT_SCHEDULED",
    plannedStartAt: null,
    plannedEndAt: null,
    startedAt: null,
    completedAt: null,
    archivedAt: null,
    ...row,
  }));
  const tx = {
    orderItemInstance: {
      findMany: async () => structuredClone(rows),
      create: async ({ data }) => {
        const row = { id: `instance-${data.ordinal}`, archivedAt: null, ...data };
        rows.push(row);
        return structuredClone(row);
      },
      update: async ({ where, data }) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        Object.assign(row, data);
        return structuredClone(row);
      },
    },
  };
  return { tx, rows };
}

const item = {
  id: "item-1",
  athleteId: "athlete-1",
  measurementId: "measurement-1",
  productionStatus: "NOT_SCHEDULED",
};

test("new design creates one stable instance per physical costume", async () => {
  const { tx, rows } = fixture();
  await reconcileOrderItemInstances(tx, item, 3);
  assert.deepEqual(rows.map((row) => row.ordinal), [1, 2, 3]);
  assert.ok(rows.every((row) => row.athleteId === "athlete-1" && row.measurementId === "measurement-1"));
});

test("quantity increase preserves old ids and appends missing ordinals", async () => {
  const { tx, rows } = fixture([{ id: "stable-1", orderItemId: "item-1", ordinal: 1 }]);
  await reconcileOrderItemInstances(tx, item, 3);
  assert.equal(rows.find((row) => row.ordinal === 1).id, "stable-1");
  assert.deepEqual(rows.map((row) => row.ordinal), [1, 2, 3]);
});

test("quantity reduction archives unused instances without deleting history", async () => {
  const { tx, rows } = fixture([
    { id: "i1", orderItemId: "item-1", ordinal: 1 },
    { id: "i2", orderItemId: "item-1", ordinal: 2 },
    { id: "i3", orderItemId: "item-1", ordinal: 3 },
  ]);
  await reconcileOrderItemInstances(tx, item, 1, new Date("2026-10-13T12:00:00Z"));
  assert.equal(rows[0].archivedAt, null);
  assert.equal(rows[1].archivedAt.toISOString(), "2026-10-13T12:00:00.000Z");
  assert.equal(rows[2].archivedAt.toISOString(), "2026-10-13T12:00:00.000Z");
});

test("quantity reduction cannot archive a shipped or started instance", async () => {
  const { tx } = fixture([
    { id: "i1", orderItemId: "item-1", ordinal: 1 },
    { id: "i2", orderItemId: "item-1", ordinal: 2, startedAt: new Date("2026-10-01T00:00:00Z") },
  ]);
  await assert.rejects(
    () => reconcileOrderItemInstances(tx, item, 1),
    (error) => error instanceof OrderItemInstanceConflictError,
  );
});

test("quantity reduction cannot archive an instance assigned to a parcel", async () => {
  const { tx } = fixture([
    { id: "i1", orderItemId: "item-1", ordinal: 1 },
    { id: "i2", orderItemId: "item-1", ordinal: 2, orderShipmentId: "shipment-1" },
  ]);
  await assert.rejects(
    () => reconcileOrderItemInstances(tx, item, 1),
    (error) => error instanceof OrderItemInstanceConflictError,
  );
});

test("quantity reduction cannot archive an instance assigned to an athlete or measurement", async () => {
  for (const protectedFields of [{ athleteId: "athlete-2" }, { measurementId: "measurement-2" }]) {
    const { tx } = fixture([
      { id: "i1", orderItemId: "item-1", ordinal: 1 },
      { id: "i2", orderItemId: "item-1", ordinal: 2, ...protectedFields },
    ]);
    await assert.rejects(
      () => reconcileOrderItemInstances(tx, item, 1),
      (error) => error instanceof OrderItemInstanceConflictError,
    );
  }
});
