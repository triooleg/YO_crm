import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/orders-workspace.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/orders-workspace.css", import.meta.url), "utf8");
const i18n = readFileSync(new URL("../lib/i18n.ts", import.meta.url), "utf8");

test("список заказов поддерживает настраиваемые колонки", () => {
  assert.match(source, /orders-column-settings/);
  assert.match(source, /localStorage/);
  assert.match(source, /draggable/);
  assert.match(source, /previewWidth/);
  assert.match(source, /ordersUi\.previewWidth/);
  assert.match(i18n, /Ширина предпросмотра/);
});

test("миниатюры имеют увеличенный предпросмотр, а оплата разбита на строки", () => {
  assert.match(source, /orders-image-preview/);
  assert.match(source, /orders-paid-line/);
  assert.match(source, /orders-balance-line/);
  assert.match(css, /\.orders-image-preview/);
  assert.match(css, /table-layout:fixed/);
});
