import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const service = await readFile(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");
const rules = await readFile(new URL("../src/orders/production-rules.ts", import.meta.url), "utf8");
const controller = await readFile(new URL("../src/orders/orders.controller.ts", import.meta.url), "utf8");
const financeController = await readFile(new URL("../src/finance/finance.controller.ts", import.meta.url), "utf8");
const finance = await readFile(new URL("../src/finance/finance.service.ts", import.meta.url), "utf8");
const productionSettingsService = await readFile(new URL("../src/finance/production-settings.ts", import.meta.url), "utf8");
const dto = await readFile(new URL("../src/finance/finance.dto.ts", import.meta.url), "utf8");

test("production defaults are server-owned, persisted and readable by production staff", () => {
  assert.match(rules, /DEFAULT_PRODUCTION_DURATION_DAYS\s*=\s*7/);
  assert.match(rules, /DEFAULT_SHIPPING_LEAD_DAYS\s*=\s*2/);
  assert.match(service, /defaultDurationDays/);
  assert.match(service, /shippingLeadDays/);
  assert.match(controller, /@Get\("defaults"\)[^\n]*"PRODUCTION"/);
  assert.match(dto, /UpdateProductionSettingsDto/);
  assert.doesNotMatch(dto, /UpdateSettingDto[^\n]+"production"/);
  assert.match(finance, /defaultDurationDays/);
  assert.match(finance, /shippingLeadDays/);
});

test("new order with shipping date gets an audited tentative production slot", () => {
  const create = service.slice(service.indexOf("async create(dto"));
  assert.match(create, /yoleotard-production-settings/);
  assert.match(create, /productionSlot\.create/);
  assert.match(create, /productionWindow/);
  assert.match(create, /tentative:\s*true/);
  assert.match(create, /entityType:\s*"ProductionSlot"/);
});

test("deadline and slot updates serialize with settings and enforce the shipping reserve", () => {
  const deadline = service.slice(service.indexOf("async updateDeadline"), service.indexOf("async updateProductionSlot"));
  const slot = service.slice(service.indexOf("async updateProductionSlot"), service.indexOf("async addPayment"));
  for (const block of [deadline, slot]) {
    assert.match(block, /yoleotard-production-settings/);
    assert.match(block, /shippingLeadDays/);
    assert.match(block, /violatesShippingLead/);
  }
  assert.doesNotMatch(slot, /worsensExistingViolation/);
});

test("shipping reserve changes are validated against existing active schedules under the same lock", () => {
  const save = finance.slice(finance.indexOf("async saveSetting"), finance.indexOf("private async nextNumber")) + productionSettingsService;
  assert.match(save, /yoleotard-production-settings/);
  assert.match(save, /dto\.shippingLeadDays > previousLead/);
  assert.match(save, /productionSlot\.findMany/);
  assert.match(save, /productionStatus:\s*\{\s*not:\s*"CANCELLED"/);
  assert.match(save, /requiredDeliveryAt/);
  assert.match(save, /Нельзя увеличить резерв/);
  assert.match(save, /auditLog\.create/);
  assert.match(financeController, /@Patch\("settings\/production"\)/);
  assert.match(finance, /async saveProductionSettings/);
  assert.match(finance, /saveProductionSettingsTransaction/);
});
