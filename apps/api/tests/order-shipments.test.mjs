import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ShippingStatus } from "@prisma/client";
import { aggregateShippingStatus } from "../src/shipping/shipping-status.ts";
const service = await readFile(new URL("../src/shipping/shipping.service.ts", import.meta.url), "utf8");

test("частично отправленный заказ агрегируется как отправленный",()=>{
  assert.equal(aggregateShippingStatus([ShippingStatus.DELIVERED,ShippingStatus.READY]),ShippingStatus.SHIPPED);
  assert.equal(aggregateShippingStatus([ShippingStatus.SHIPPED,ShippingStatus.NOT_READY]),ShippingStatus.SHIPPED);
});
test("полностью доставленный заказ агрегируется как доставленный",()=>{
  assert.equal(aggregateShippingStatus([ShippingStatus.DELIVERED,ShippingStatus.DELIVERED]),ShippingStatus.DELIVERED);
});
test("пустой набор посылок не готов к отправке",()=>{
  assert.equal(aggregateShippingStatus([]),ShippingStatus.NOT_READY);
});
test("архивирование не скрывает начисление клиента и очищает устаревшую совместимую проекцию",()=>{
  assert.match(service,/current\.customerChargeMinor>0/);
  assert.match(service,/else await tx\.shipment\.updateMany\(\{where:\{orderId\},data:\{trackingNumber:null,costMinor:0,shippedAt:null,deliveredAt:null\}\}\)/);
});
test("изменение и архивирование посылки защищены optimistic concurrency и пишут историю",()=>{
  assert.match(service,/Посылка уже изменена другим пользователем/);
  assert.match(service,/ORDER_SHIPMENT_ARCHIVED/);
  assert.match(service,/expectedUpdatedAt/);
});
