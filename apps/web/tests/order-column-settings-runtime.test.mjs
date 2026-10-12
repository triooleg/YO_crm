import assert from "node:assert/strict";
import test from "node:test";
import { migrateLegacyOrderColumnSettings, parseOrderColumnSettings } from "../lib/order-column-settings.mjs";

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

test("настройки колонок варианта A мигрируют в утверждённую таблицу", () => {
  const nextDefaults = ["client", "model", "quantity", "deadline", "payment", "production", "delivery", "status", "created", "menu"];
  const migrated = migrateLegacyOrderColumnSettings(JSON.stringify({ order: ["client", "designs", "discipline", "quantity", "nextAction", "payment"], hidden: ["designs", "discipline", "nextAction"] }), nextDefaults);
  assert.deepEqual(migrated?.order.slice(0, 5), ["client", "model", "quantity", "production", "payment"]);
  assert.deepEqual(migrated?.hidden, ["model", "production"]);
});

test("миграция legacy-настроек атомарно отклоняет повреждённые структуры", () => {
  const nextDefaults = ["client", "model", "quantity", "production"];
  assert.equal(migrateLegacyOrderColumnSettings(JSON.stringify({ order: ["quantity"], hidden: "designs" }), nextDefaults), undefined);
  assert.equal(migrateLegacyOrderColumnSettings(JSON.stringify({ order: "client", hidden: [] }), nextDefaults), undefined);
});

test("миграция legacy-настроек удаляет повторы и неизвестные поля, сохраняя одностороннюю видимость", () => {
  const nextDefaults = ["client", "model", "quantity", "production"];
  assert.deepEqual(
    migrateLegacyOrderColumnSettings(JSON.stringify({ order: ["designs", "discipline", "unknown", "designs"], hidden: ["designs"] }), nextDefaults),
    { order: ["model", "client", "quantity", "production"], hidden: [] },
  );
});
