import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {loadTargetModule} from './overview-target-loader.mjs';
const nativeRequire=createRequire(import.meta.url);
const source=readFileSync(new URL('../src/orders/production-context.ts',import.meta.url),'utf8');
const module={exports:{}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:id=>id==='../finance/exchange-rates'?{appliedPaymentMinor:()=>0}:id==='./order-shipping-evidence'?loadTargetModule('orders/order-shipping-evidence.ts'):nativeRequire(id),Date});
const {loadProductionOrders}=module.exports;
const plain=value=>JSON.parse(JSON.stringify(value));
test('Overview operational cohort is not clipped by calendar dates or widened by an unrelated orderId',async()=>{
 const calls=[];
 const repository={findMany:async query=>{calls.push(query);return [{id:'active-old',currency:'EUR'}]},findFirst:async()=>{throw new Error('must not widen cohort')}};
 const result=await loadProductionOrders(repository,'unrelated','2026-10-01','2026-10-31',new Date('2026-10-15'),{orderIds:['active-old']});
 assert.deepEqual(plain(calls[0].where.id),{in:['active-old']});
 assert.equal('OR' in calls[0].where,false);
 assert.deepEqual(result.map(row=>row.id),['active-old']);
 assert.equal(calls[0].take,1001);
});
test('empty Overview cohort stays empty and validates invalid calendar input',async()=>{
 let where;
 const repository={findMany:async query=>{where=query.where;return []},findFirst:async()=>null};
 await loadProductionOrders(repository,undefined,undefined,undefined,new Date('2026-10-15'),{orderIds:[]});
 assert.deepEqual(plain(where.id),{in:[]});
 await assert.rejects(()=>loadProductionOrders(repository,undefined,'bad',undefined,new Date(),{orderIds:[]}),/INVALID_PRODUCTION_RANGE/);
});
