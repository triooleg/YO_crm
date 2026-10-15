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
  assert.deepEqual(calls[1][1], { where: { orderId: "order-1", archivedAt: null }, data: { productionStatus: "SCHEDULED" } });
  assert.deepEqual(calls[2][1], { where: { orderItem: { orderId: "order-1", archivedAt: null }, archivedAt: null }, data: { productionStatus: "SCHEDULED" } });
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
    where: { orderItem: { orderId: "order-1", archivedAt: null }, archivedAt: null, productionStatus: { in: ["NOT_SCHEDULED", "TENTATIVE", "SCHEDULED"] } },
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
    where: { orderItem: { orderId: "order-1", archivedAt: null }, archivedAt: null },
    data: { productionStatus: "READY" },
  });
});

test('preserveProgress keeps historical READY and active READY item summaries while scheduling only planning state',async()=>{
 const items=[{id:'ready',archivedAt:null,productionStatus:'READY'},{id:'historical',archivedAt:new Date(),productionStatus:'READY'},{id:'planning',archivedAt:null,productionStatus:'NOT_SCHEDULED'}];
 const pieces=items.map(item=>({id:item.id,archivedAt:null,orderItem:item,productionStatus:item.productionStatus}));
 const tx={order:{update:async({data})=>({id:'o',...data})},orderItem:{updateMany:async({where,data})=>{for(const item of items)if((where.archivedAt===undefined||!item.archivedAt)&&(!where.productionStatus?.in||where.productionStatus.in.includes(item.productionStatus)))Object.assign(item,data)}},orderItemInstance:{updateMany:async({where,data})=>{for(const item of pieces)if(!item.archivedAt&&(!('archivedAt' in where.orderItem)||!item.orderItem.archivedAt)&&(!where.productionStatus?.in||where.productionStatus.in.includes(item.productionStatus)))Object.assign(item,data)}}};
 await updateProductionStatusGraph(tx,'o','SCHEDULED',{}, {preserveProgress:true});
 assert.deepEqual(items.map(item=>item.productionStatus),['READY','READY','SCHEDULED']);
 assert.deepEqual(pieces.map(item=>item.productionStatus),['READY','READY','SCHEDULED']);
});
