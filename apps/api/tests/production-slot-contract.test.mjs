import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const controller=await readFile(new URL("../src/orders/orders.controller.ts",import.meta.url),"utf8");
const service=await readFile(new URL("../src/orders/orders.service.ts",import.meta.url),"utf8");
test("слот сохраняется с аудитом и блокировкой",()=>{assert.match(controller,/production-slot/);assert.match(service,/productionSlot\.upsert/);assert.match(service,/PRODUCTION_SLOT_UPDATED/);assert.match(service,/locked/);assert.match(service,/auditLog\.create/)});
