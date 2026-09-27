import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import vm from "node:vm";

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, {compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports:{}};
  vm.runInNewContext(javascript,{module,exports:module.exports});
  return module.exports;
}
const {editableInboxMeasurementValues,inboxMeasurements} = await load("../lib/inbox-measurements.ts");
const {navigationUi} = await load("../lib/i18n.ts");

test("API snapshots show the stored height standard without claiming measured height",()=>{
  const rows = inboxMeasurements({id:"m1",measuredAt:"2026-09-01",height:null,chest:"63.50",unit:"cm",values:{standardHeight:138}});
  assert.equal(rows[0].field,"standardHeight");
  assert.equal(rows[0].value,138);
  assert.equal(rows.some(row=>row.field==="height"),false);
  assert.equal(rows[1].value,"63.50");
});
test("actual measured height takes priority and missing measurements stay absent",()=>{
  assert.equal(inboxMeasurements({id:"m2",measuredAt:"2026-09-01",height:"137.50",values:{standardHeight:138}})[0].field,"height");
  assert.equal(inboxMeasurements().length,0);
});
test("latest inbox snapshot can prefill the immutable measurement editor",()=>{
  const values=editableInboxMeasurementValues({
    id:"m3",
    measuredAt:"2026-09-01",
    values:{standardHeight:"162",m1:"82.5",m2:67,m3:"87",m15:145,ignored:"text"},
  });
  assert.deepEqual({...values},{standardHeight:162,m1:82.5,m2:67,m3:87,m15:145});
});
test("all server roles have Russian profile labels",async()=>{
  const schema=await readFile(new URL("../../../packages/database/prisma/schema.prisma",import.meta.url),"utf8");
  const roles=schema.match(/enum UserRole\s*\{([^}]+)\}/)[1].trim().split(/\s+/);
  for(const role of roles)assert.match(navigationUi.userRoles[role],/[А-Яа-я]/,role);
});
