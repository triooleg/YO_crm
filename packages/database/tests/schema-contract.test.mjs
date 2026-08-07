import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");

test("order keeps independent workflow dimensions", () => {
  for (const field of ["salesStatus", "productionStatus", "paymentStatus", "shippingStatus"]) {
    assert.ok(schema.includes(field));
  }
});

test("money uses integer minor units", () => {
  assert.match(schema, /priceMinor Int/);
  assert.match(schema, /depositRequiredMinor Int/);
  assert.doesNotMatch(schema, /price Float/);
});

test("orders reference immutable measurement snapshots", () => {
  assert.match(schema, /model Measurement/);
  assert.match(schema, /measuredAt DateTime/);
  assert.match(schema, /measurementId String\?/);
});
