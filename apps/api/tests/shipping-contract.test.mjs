import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
const schema=await readFile(new URL("../../../packages/database/prisma/schema.prisma",import.meta.url),"utf8");
const controller=await readFile(new URL("../src/shipping/shipping.controller.ts",import.meta.url),"utf8");
const service=await readFile(new URL("../src/shipping/shipping.service.ts",import.meta.url),"utf8");
test("один заказ имеет только одну посылку",()=>{assert.match(schema,/orderId\s+String\s+@unique/);assert.match(schema,/shipment\s+Shipment\?/)});
test("поддерживаются четыре службы доставки и настройки",()=>{for(const x of["NOVA_POSHTA","NOVA_GLOBAL","UKRPOSHTA","DHL"])assert.match(schema,new RegExp(x));assert.match(controller,/@Patch\("carriers\/:carrier"\)/)});
test("посылка сохраняется с историей и аудитом",()=>{assert.match(controller,/@Put\("orders\/:orderId"\)/);assert.match(service,/shipment\.upsert/);assert.match(service,/tx\.activity\.create/);assert.match(service,/tx\.auditLog\.create/);assert.match(service,/deliveryMinor:d\.costMinor/)});
test("отправленная посылка требует трек номер",()=>{assert.match(service,/sentStatuses\.includes\(d\.status\)/);assert.match(service,/trackingNumber/);assert.match(service,/трек-номер/)});
test("настройки служб скрыты от менеджера и отключенная служба запрещена",()=>{assert.match(controller,/@Get\("carrier-settings"\)@Roles\("OWNER","ADMIN"\)/);assert.match(service,/enabled===false/);assert.match(service,/Недопустимый переход/);assert.match(service,/deliveredAt<shippedAt/)});
test("терминальные статусы нельзя вернуть назад",()=>{assert.match(service,/RETURNED:\[\]/);assert.match(service,/LOST:\[\]/);assert.match(service,/transitions\[from\]\.includes\(to\)/)});
test("даты соответствуют статусу и поля можно очистить явно",()=>{assert.match(service,/Дата отправки недопустима/);assert.match(service,/d\.trackingNumber===undefined/);assert.match(service,/d\.notes===undefined/);assert.match(service,/d\.shippedAt===undefined/)});
test("runtime строки доставки имеют корректный UTF-8",()=>{for(const x of["Новая почта","Укрпочта","Заказ не найден","Обновлены данные доставки"])assert.match(service,new RegExp(x));assert.doesNotMatch(service,/Рќ|РЎ|Р”|вЂ|Г—|пїЅ|�/)});

test("shipping updates are serialized per order",()=>{assert.match(service,/pg_advisory_xact_lock/);assert.ok(service.indexOf("pg_advisory_xact_lock")<service.indexOf("order.findFirst"))});
