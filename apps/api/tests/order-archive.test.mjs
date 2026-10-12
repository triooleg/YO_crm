import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const controller = await readFile(new URL("../src/orders/orders.controller.ts", import.meta.url), "utf8");
const dto = await readFile(new URL("../src/orders/orders.dto.ts", import.meta.url), "utf8");
const service = await readFile(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");

test("orders are archived in bulk instead of being hard deleted", () => {
  assert.match(controller, /@Patch\("archive"\)[\s\S]*?@Roles\(UserRole\.OWNER, UserRole\.ADMIN\)/);
  assert.match(controller, /archiveOrders\(@Body\(\) dto: ArchiveOrdersDto/);
  assert.match(dto, /class ArchiveOrdersDto[\s\S]*?@ArrayMinSize\(1\)[\s\S]*?@ArrayMaxSize\(100\)/);
  assert.match(service, /archiveOrdersTransaction/);
  assert.doesNotMatch(controller, /@Delete\([^)]*orders/);
});

test("archive transaction preserves relations and records activity and audit history", async () => {
  const { archiveOrdersTransaction } = await import("../src/orders/order-archive.ts");
  const calls = { updated: undefined, activities: [], audits: [] };
  const orders = [
    { id: "order-2", clientId: "client-2", number: "YO-26-0002", archivedAt: null },
    { id: "order-1", clientId: "client-1", number: "YO-26-0001", archivedAt: null },
  ];
  const tx = {
    $executeRawUnsafe: async () => undefined,
    order: {
      findMany: async () => orders,
      updateMany: async ({ data }) => { calls.updated = data; return { count: orders.length }; },
    },
    activity: { create: async ({ data }) => { calls.activities.push(data); } },
    auditLog: { create: async ({ data }) => { calls.audits.push(data); } },
  };
  const archivedAt = new Date("2026-10-12T10:00:00.000Z");

  const result = await archiveOrdersTransaction(tx, ["order-2", "order-1", "order-2"], "owner-1", archivedAt);

  assert.deepEqual(result.archivedIds, ["order-1", "order-2"]);
  assert.equal(calls.updated.archivedAt, archivedAt);
  assert.deepEqual(calls.activities.map((item) => item.orderId).sort(), ["order-1", "order-2"]);
  assert.ok(calls.activities.every((item) => item.type === "ORDER_ARCHIVED"));
  assert.ok(calls.audits.every((item) => item.action === "ARCHIVE" && item.entityType === "Order"));
});

test("archive transaction is all-or-nothing when a selected order is unavailable", async () => {
  let updateCalled = false;
  const { archiveOrdersTransaction, OrderArchiveError } = await import("../src/orders/order-archive.ts");
  const tx = {
    $executeRawUnsafe: async () => undefined,
    order: {
      findMany: async () => [{ id: "order-1", clientId: "client-1", number: "YO-26-0001", archivedAt: null }],
      updateMany: async () => { updateCalled = true; },
    },
    activity: { create: async () => undefined },
    auditLog: { create: async () => undefined },
  };

  await assert.rejects(() => archiveOrdersTransaction(tx, ["order-1", "missing"], "owner-1"), (error) => error instanceof OrderArchiveError && error.code === "ORDER_ARCHIVE_SELECTION_CHANGED");
  assert.equal(updateCalled, false);
});
