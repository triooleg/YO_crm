import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard=await readFile(new URL("../components/orders-dashboard.tsx",import.meta.url),"utf8");
const tabs=await readFile(new URL("../components/orders/order-expanded-tabs.tsx",import.meta.url),"utf8");
const panel=await readFile(new URL("../components/order-panel.tsx",import.meta.url),"utf8");
const i18n=await readFile(new URL("../lib/i18n.ts",import.meta.url),"utf8");

test("редактор заказа позволяет выбрать продажи без производства",()=>{
  assert.match(panel,/value:"WEBSITE_SALE"/);
  assert.match(panel,/value:"STOCK_SALE"/);
  assert.match(panel,/type,expectedType:order\.type/);
  assert.match(panel,/currency,expectedCurrency:order\.currency,priceDirty/);
  assert.match(dashboard,/<OrderPanel[^>]*order=\{editOrder\}/);
  assert.match(i18n,/WEBSITE_SALE:\s*"Продажа с сайта"/);
  assert.match(i18n,/STOCK_SALE:\s*"Продажа со склада"/);
});

test("каждый доступный тип заказа использует полный централизованный русский словарь",()=>{
  assert.match(tabs,/orderFormUi\.types as Record<string, string>/);
  for(const [type,label] of [
    ["CUSTOM_ORDER","Индивидуальный заказ"],["PAIR","Парный заказ"],["GROUP_ORDER","Групповой заказ"],
    ["READY_MODEL","Готовая модель"],["WEBSITE_SALE","Продажа с сайта"],["STOCK_SALE","Продажа со склада"],
    ["COPY_MODEL","Копия модели"],["MODIFIED_MODEL","Модель с изменениями"],["REPEAT_ORDER","Повторный заказ"],["ACCESSORY","Аксессуар"],
  ]){
    assert.match(panel,new RegExp(`value:"${type}"`));
    assert.match(i18n,new RegExp(`${type}:\\s*"${label}"`));
  }
});
