import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/orders-workspace.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/orders-dashboard.css", import.meta.url), "utf8");
const i18n = readFileSync(new URL("../lib/i18n.ts", import.meta.url), "utf8");
const api = readFileSync(new URL("../../api/src/orders/orders.service.ts", import.meta.url), "utf8");
const ui = source + dashboard + i18n;

test("Orders redesign exposes the complete operational overview", () => {
  for (const label of ["Активные", "Нужна предоплата", "Срок ≤ 7 дней", "Просрочены", "Готовы к отправке", "Завершенные"]) {
    assert.match(ui, new RegExp(label));
  }
  for (const column of ["№ / Клиент", "Кол-во", "Вид спорта", "Дизайны", "Следующее действие", "Создан", "Проблемы"]) {
    assert.match(ui, new RegExp(column));
  }
  assert.doesNotMatch(dashboard, /source:\s*"Источник"/);
});

test("Orders redesign keeps real controls and deterministic guidance", () => {
  for (const token of ["orders-filter-trigger", "orders-filter-chips", "orders-export", "orders-pagination", "nextOrderAction", "orderProblems", "OrderChannelIcon"]) {
    assert.match(dashboard, new RegExp(token));
  }
  assert.match(dashboard, /orders-expanded-designs/);
  assert.match(ui, /Финансы по заказу/);
  assert.match(ui, /Пожелания клиента/);
  assert.match(ui, /Заметки менеджера/);
  assert.match(ui, /Открыть заказ/);
  assert.match(dashboard, /!loading && !error && !shown\.length/);
  assert.match(dashboard, /onClick=\{\(\) => void load\(\)\}/);
});

test("Orders list projection supplies the redesigned table without per-row requests", () => {
  for (const field of ["discipline: true", "deliveryMinor: true", "discountMinor: true", "phone: true", "email: true"]) {
    assert.match(api, new RegExp(field));
  }
  assert.match(api, /shipment: true/);
});

test("Orders redesign has isolated responsive table and expanded layout", () => {
  assert.match(css, /\.orders-kpi-grid/);
  assert.match(css, /\.orders-command-bar/);
  assert.match(css, /\.orders-expanded-layout/);
  assert.match(css, /\.orders-table-scroll/);
  assert.match(css, /overflow-x:auto/);
});
