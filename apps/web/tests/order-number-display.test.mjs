import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("../components/orders-workspace.tsx", import.meta.url), "utf8");
const clients = await readFile(new URL("../components/client-workspace.tsx", import.meta.url), "utf8");

test("общий список показывает только порядковую часть номера заказа", () => {
  assert.match(workspace, /orderListNumber\(o\.number\)/);
  assert.match(workspace, /function orderListNumber/);
});

test("карточка клиента сохраняет полный номер заказа", () => {
  assert.match(clients, /<strong>\{o\.number\}<\/strong>/);
});