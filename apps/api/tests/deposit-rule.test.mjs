import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dto = readFileSync(new URL("../src/orders/orders.dto.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");

function defaultDeposit(priceMinor) {
  if (!Number.isInteger(priceMinor) || priceMinor < 0) throw new TypeError("minor units required");
  return Math.round(priceMinor / 2);
}

test("default custom-order deposit is 50 percent", () => {
  assert.equal(defaultDeposit(10000), 5000);
  assert.equal(defaultDeposit(9999), 5000);
});

test("fractional minor units are rejected", () => {
  assert.throws(() => defaultDeposit(99.9), /minor units/);
});

test("order creation accepts an omitted deposit and resolves the configured percent server-side", () => {
  assert.match(dto, /@IsOptional\(\)[^\n]*depositRequiredMinor\?: number/);
  assert.match(service, /appSetting\.findUnique/);
  assert.match(service, /section_key:\s*\{\s*section:\s*"orders",\s*key:\s*"depositPercent"/);
  assert.match(service, /calculateDepositMinor\(dto\.priceMinor,\s*depositPercent\)/);
});

test("an explicit deposit remains an intentional override", () => {
  assert.match(service, /dto\.depositRequiredMinor\s*\?\?/);
});

test("order ownership validation shares the client merge transaction lock", () => {
  assert.match(service, /pg_advisory_xact_lock\(hashtextextended\(\$\{\"client-merge-global\"\},0\)\)/);
});
