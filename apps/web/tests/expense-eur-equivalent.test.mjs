import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../lib/expense-eur-equivalent.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Intl,Date});
const {expenseEurEquivalent:eq}=exports,now=new Date('2026-10-27T12:00:00Z');
const cache={effectiveDate:'2026-10-27',fetchedAt:now.toISOString(),rates:[{baseCurrency:'EUR',quoteCurrency:'UAH',numerator:'50',denominator:'1'},{baseCurrency:'EUR',quoteCurrency:'USD',numerator:'11',denominator:'10'}]};
test('expense equivalents use current official rational rates without changing original minor amounts',()=>{
 assert.equal(eq(139600,'UAH',cache,now),2792);assert.equal(eq(1100,'USD',cache,now),1000);assert.equal(eq(1,'EUR',undefined,now),1);assert.equal(eq(25,'UAH',cache,now),1);assert.equal(eq(0,'UAH',cache,now),0);
 assert.equal(eq(100,'UAH',{...cache,fetchedAt:'2026-10-26T12:00:00Z'},now),null);assert.equal(eq(100,'UAH',{...cache,effectiveDate:'2026-09-01'},now),null);assert.equal(eq(100,'GBP',cache,now),null);assert.equal(eq(100,'UAH',undefined,now),null);assert.equal(eq(1.5,'UAH',cache,now),null);
});
