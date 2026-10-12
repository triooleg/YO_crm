import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../components/order-panel.tsx", import.meta.url), "utf8");
const i18n = readFileSync(new URL("../lib/i18n.ts", import.meta.url), "utf8");

test("раскрытый заказ позволяет заменить изображение конкретной позиции", () => {
  assert.match(dashboard, /type="file"[^>]*accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(dashboard, /ui\.changeOrderItemImage/);
  assert.match(dashboard, /request\("\/orders\/model-image"/);
  assert.match(dashboard, /`\/orders\/\$\{order\.id\}\/model-image`/);
  assert.match(dashboard, /JSON\.stringify\(\{ itemId, modelImagePath: image\.path, expectedModelImagePath \}\)/);
  assert.match(i18n, /changeOrderItemImage:\s*"Изменить изображение позиции"/);
});

test("раскрытый заказ открывает единое редактирование описания цены и главного изображения", () => {
  assert.match(dashboard, /ui\.editOrder/);
  assert.match(dashboard, /<OrderPanel[^>]*order=\{editOrder\}/);
  assert.match(panel, /`\/orders\/\$\{order\.id\}\/details`/);
  assert.match(panel, /description:description\.trim\(\),priceMinor/);
  assert.match(panel, /currency,expectedCurrency:order\.currency,priceDirty/);
  assert.match(panel, /onChange=\{e=>\{setPrice\(e\.currentTarget\.value\);setPriceDirty\(true\)\}\}/);
  assert.match(panel, /expectedDescription:order\.notes\?\?null,expectedPriceMinor:order\.priceMinor/);
  assert.match(panel, /orderFormUi\.editTitle/);
  assert.match(i18n, /editOrder:\s*"Изменить заказ"/);
});
