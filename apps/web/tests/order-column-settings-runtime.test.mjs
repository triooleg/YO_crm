import assert from "node:assert/strict";
import test from "node:test";
import { parseOrderColumnSettings } from "../lib/order-column-settings.mjs";

const defaults = ["client", "quantity", "discipline", "designs"];

test("настройки столбцов fail-closed отклоняют повреждённые и частичные структуры", () => {
  assert.equal(parseOrderColumnSettings("{", defaults), undefined);
  assert.equal(parseOrderColumnSettings("null", defaults), undefined);
  assert.equal(parseOrderColumnSettings(JSON.stringify({ order: "client", hidden: [] }), defaults), undefined);
  assert.equal(parseOrderColumnSettings(JSON.stringify({ order: ["client"], hidden: "designs" }), defaults), undefined);
});

test("настройки столбцов удаляют повторы и неизвестные идентификаторы атомарно", () => {
  assert.deepEqual(
    parseOrderColumnSettings(JSON.stringify({ order: ["quantity", "unknown", "quantity"], hidden: ["designs", "unknown", "designs"] }), defaults),
    { order: ["quantity", "client", "discipline", "designs"], hidden: ["designs"] },
  );
});

test("пустая сохранённая конфигурация дополняется текущим набором столбцов", () => {
  assert.deepEqual(parseOrderColumnSettings(JSON.stringify({}), defaults), { order: defaults, hidden: [] });
  assert.equal(parseOrderColumnSettings(null, defaults), undefined);
});
