import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const schema=await readFile(new URL("../prisma/schema.prisma",import.meta.url),"utf8");
const migration=await readFile(new URL("../prisma/migrations/20261013130000_order_shipments_expand/migration.sql",import.meta.url),"utf8");
const model=(name)=>schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))?.[0]??"";
test("multi shipment expansion preserves legacy one-to-one contract",()=>{assert.match(model("Shipment"),/orderId\s+String\s+@unique/);assert.match(model("Order"),/shipment\s+Shipment\?/);assert.match(model("Order"),/orderShipments\s+OrderShipment\[\]/);assert.doesNotMatch(migration,/DROP INDEX "Shipment_orderId_key"/)});
test("new shipments separate customer charge from atelier expense and assign instances",()=>{const shipment=model("OrderShipment");for(const field of ["customerChargeMinor","atelierCostMinor","atelierExpenseId","status","weightGrams","lengthMm","widthMm","heightMm","isPrimary","archivedAt"])assert.match(shipment,new RegExp(`\\b${field}\\b`));assert.match(model("OrderItemInstance"),/orderShipmentId\s+String\?/);assert.match(migration,/OrderShipment_one_primary_per_order_key/)});
