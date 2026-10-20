import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const filename=new URL('../src/taxes/tax-math.ts',import.meta.url);
const module={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require,Date,Intl,BigInt});
const m=module.exports;
test('approved receipt seam: 10000 UAH accrues separate 500 and100, exact half-up',()=>{
 assert.equal(m.percentMinor(1000000,500),50000);assert.equal(m.percentMinor(1000000,100),10000);
 assert.equal(m.convertMinor(1,{numerator:'1',denominator:'2'}),1);
 assert.throws(()=>m.convertMinor(Number.MAX_SAFE_INTEGER,{numerator:'2',denominator:'1'}));
});
test('May boundary uses Europe/Kyiv and valid calendar dates',()=>{
 assert.equal(m.kyivDate('2026-04-30T20:59:59Z'),'2026-04-30');
 assert.equal(m.kyivDate('2026-04-30T21:00:00Z'),'2026-05-01');
 assert.throws(()=>m.dateOnly('2026-02-30'));assert.throws(()=>m.monthKey('2026-13'));
 assert.deepEqual(Array.from(m.monthsBetween('2026-11','2027-01')),['2026-11','2026-12','2027-01']);
});
test('monthly ESV full1902.34 without orders; unknown2027 never borrows2026',()=>{
 const p={group:3,unifiedMode:'PERCENT',unifiedRateBps:500,fixedUnifiedMinor:null,militaryRateBps:100,esvRateBps:2200};
 assert.equal(m.monthlyAmount('ESV','2026-05',p).amountMinor,190234);
 assert.equal(m.monthlyAmount('ESV','2027-01',p).amountMinor,null);
 const g2={...p,group:2,unifiedMode:'FIXED',unifiedRateBps:0,fixedUnifiedMinor:170000,militaryRateBps:1000};
 assert.equal(m.monthlyAmount('UNIFIED','2026-05',g2).amountMinor,170000);
 assert.equal(m.monthlyAmount('MILITARY','2026-05',g2).amountMinor,86470);
 assert.equal(m.monthlyAmount('MILITARY','2027-01',g2).amountMinor,null);
 assert.equal(p.unifiedRateBps,500);
});
test('historical rational conversion preserves exact decimal and rejects invalid/unsafe money',()=>{
 const rate=m.decimalRational('51.4587');assert.equal(rate.numerator,'514587');assert.equal(rate.denominator,'10000');
 assert.equal(m.convertMinor(10000,rate),514587);assert.equal(m.percentMinor(514587,500),25729);
 assert.equal(m.percentMinor(-1,5000),-1);assert.throws(()=>m.percentMinor(10,10001));assert.throws(()=>m.convertMinor(1,{numerator:'0',denominator:'1'}));assert.throws(()=>m.decimalRational('1e3'));
});
