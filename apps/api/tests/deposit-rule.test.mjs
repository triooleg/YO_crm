import test from "node:test";
import assert from "node:assert/strict";

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
