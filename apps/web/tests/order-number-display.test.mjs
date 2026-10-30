import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("../components/orders-workspace.tsx", import.meta.url), "utf8");
const clients = await readFile(new URL("../components/client-workspace.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const source = await readFile(new URL("../lib/order-source.ts", import.meta.url), "utf8");

test("общий список показывает только порядковую часть номера заказа", () => {
  assert.match(workspace, /orderListNumber\(o\.number\)/);
  assert.match(workspace, /function orderListNumber/);
});

test("карточка клиента показывает номер KeyCRM и сохраняет технический в подсказке", () => {
  assert.match(clients, /<strong title=\{o\.number\}>\{orderDisplayNumber\(o\)\}<\/strong>/);
});

test("заказ сайта предпочитает последовательный номер CRM и сохраняет поддержку старых номеров", () => {
  assert.match(source, /order\.sourceSystem==='YOLEOTARD_WEBSITE'/);
  assert.match(source, /order\.externalNumber/);
  assert.match(dashboard, /orderDisplayNumber\(order\)/);
  assert.match(dashboard, /title=\{order\.number\}/);
  assert.match(source, /WEB-\$\{order\.externalId\}/);
  assert.match(source, /websiteItemName/);
  assert.match(source, /\(\?:YO\|WEB\)-\[1-9\]\\d\*\$/);
});

// Execute the actual shared display helper, keeping provider fallback regressions visible.
test("годовой номер CRM сайта имеет приоритет над внешним номером", async () => {
  const {createRequire}=await import('node:module'),{runInNewContext}=await import('node:vm');
  const require=createRequire(import.meta.url),ts=require('typescript'),module={exports:{}};
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,{module,exports:module.exports,require:id=>id.includes('i18n')?{orderSourceUi:{labels:{}}}:{}});
  const display=module.exports.orderDisplayNumber;
  for(const number of ['23-101','24-0002','26-707','26-26-0001'])assert.equal(display({number,sourceSystem:'YOLEOTARD_WEBSITE',externalNumber:'22732',externalId:'22732'}),number);
  assert.equal(display({number:'YO-707',sourceSystem:'YOLEOTARD_WEBSITE',externalNumber:'22732'}),'YO-707');
  assert.equal(display({number:'legacy',sourceSystem:'YOLEOTARD_WEBSITE',externalNumber:'22732'}),'22732');
});
