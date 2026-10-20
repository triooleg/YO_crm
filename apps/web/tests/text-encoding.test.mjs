import assert from "node:assert/strict";
import test from "node:test";

import { repairMojibake } from "../lib/text-encoding.mjs";

test("repairs historical UTF-8 text decoded as Windows-1251", () => {
  assert.equal(
    repairMojibake("РџРѕР»СѓС‡РµРЅР° РѕРїР»Р°С‚Р° 200.00 EUR"),
    "Получена оплата 200.00 EUR",
  );
});

test("keeps valid Russian and customer text unchanged", () => {
  assert.equal(repairMojibake("Создан заказ YO-26-0001"), "Создан заказ YO-26-0001");
  assert.equal(repairMojibake("Oleh Ohilko"), "Oleh Ohilko");
});
