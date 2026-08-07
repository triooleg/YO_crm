import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source=readFileSync(new URL("../components/orders-workspace.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../app/orders-workspace.css",import.meta.url),"utf8");

test("список заказов поддерживает быстрое сканирование и действия",()=>{
  for(const value of ["Выбрать заказ","Сортировка","Быстрые действия","Оплачено","Остаток"]){assert.match(source,new RegExp(value))}
  assert.match(source,/orders-row-details/);
  assert.match(source,/countryFlag/);
  assert.match(css,/position:sticky/);
  assert.match(css,/orders-status--danger/);
});
