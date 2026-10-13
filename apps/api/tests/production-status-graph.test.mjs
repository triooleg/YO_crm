import assert from "node:assert/strict";
import test from "node:test";
import { updateProductionStatusGraph } from "../src/orders/production-status-graph.ts";

test("production status graph updates order designs and active physical instances", async () => {
  const calls = [];
  const tx = {
    order: { update: async (args) => { calls.push(["order", args]); return { id: "order-1", ...args.data }; } },
    orderItem: { updateMany: async (args) => { calls.push(["items", args]); return { count: 2 }; } },
    orderItemInstance: { updateMany: async (args) => { calls.push(["instances", args]); return { count: 3 }; } },
  };

  const result = await updateProductionStatusGraph(tx, "order-1", "SCHEDULED", { paymentStatus: "DEPOSIT_PAID" });

  assert.equal(result.productionStatus, "SCHEDULED");
  assert.deepEqual(calls.map(([kind]) => kind), ["order", "items", "instances"]);
  assert.deepEqual(calls[0][1].data, { paymentStatus: "DEPOSIT_PAID", productionStatus: "SCHEDULED" });
  assert.deepEqual(calls[1][1], { where: { orderId: "order-1" }, data: { productionStatus: "SCHEDULED" } });
  assert.deepEqual(calls[2][1], { where: { orderItem: { orderId: "order-1" }, archivedAt: null }, data: { productionStatus: "SCHEDULED" } });
});

test("automatic slot confirmation preserves instances that already have production progress", async () => {
  const calls = [];
  const tx = {
    order: { update: async (args) => { calls.push(["order", args]); return { id: "order-1", ...args.data }; } },
    orderItem: { updateMany: async (args) => { calls.push(["items", args]); return { count: 2 }; } },
    orderItemInstance: { updateMany: async (args) => { calls.push(["instances", args]); return { count: 2 }; } },
  };
  await updateProductionStatusGraph(tx, "order-1", "SCHEDULED", {}, { preserveProgress: true });
  assert.deepEqual(calls[2][1], {
    where: { orderItem: { orderId: "order-1" }, archivedAt: null, productionStatus: { in: ["NOT_SCHEDULED", "TENTATIVE", "SCHEDULED"] } },
    data: { productionStatus: "SCHEDULED" },
  });
});

test("explicit order-level progress keeps the aggregate deterministic by updating physical instances", async () => {
  const calls = [];
  const tx = {
    order: { update: async (args) => { calls.push(["order", args]); return { id: "order-1", ...args.data }; } },
    orderItem: { updateMany: async (args) => { calls.push(["items", args]); return { count: 2 }; } },
    orderItemInstance: { updateMany: async (args) => { calls.push(["instances", args]); return { count: 3 }; } },
  };
  await updateProductionStatusGraph(tx, "order-1", "READY");
  assert.deepEqual(calls.map(([kind]) => kind), ["order", "items", "instances"]);
  assert.deepEqual(calls[2][1], {
    where: { orderItem: { orderId: "order-1" }, archivedAt: null },
    data: { productionStatus: "READY" },
  });
});
