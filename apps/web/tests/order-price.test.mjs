import assert from "node:assert/strict";
import test from "node:test";
import { parseOrderPriceMinor } from "../lib/order-price.ts";

test("цена заказа преобразуется в minor units без floating point", () => {
  assert.equal(parseOrderPriceMinor("330"), 33000);
  assert.equal(parseOrderPriceMinor("330,50"), 33050);
  assert.equal(parseOrderPriceMinor("0.01"), 1);
  assert.equal(parseOrderPriceMinor("21474836.47"), 2_147_483_647);
});

test("цена заказа отклоняет неоднозначные и небезопасные значения", () => {
  assert.equal(parseOrderPriceMinor("1.005"), null);
  assert.equal(parseOrderPriceMinor("-1"), null);
  assert.equal(parseOrderPriceMinor("1."), null);
  assert.equal(parseOrderPriceMinor("21474836.48"), null);
  assert.equal(parseOrderPriceMinor("900719925474099.92"), null);
});
