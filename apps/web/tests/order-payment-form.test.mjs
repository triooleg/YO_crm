import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source=readFileSync(new URL("../components/orders-workspace.tsx",import.meta.url),"utf8");

test("карточка заказа позволяет зарегистрировать оплату",()=>{
  for(const text of ["Добавить оплату","Способ оплаты","Остаток","История оплат"]){assert.match(source,new RegExp(text))}
  assert.match(source,/\/payments/);
});
