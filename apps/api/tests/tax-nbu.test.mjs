import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTax } from './tax-service.test.mjs';
const {parseHistoricalRate,strictNbuJson,HistoricalNbuService}=loadTax('historical-nbu.service.ts');
const fixture='[{"r030":978,"txt":"Євро","rate":51.4587,"cc":"EUR","exchangedate":"01.05.2026"}]';
test('official May1 NBU evidence retains514587/10000 and exact original date',()=>{
 const r=parseHistoricalRate(fixture,'EUR','2026-05-01','https://bank.gov.ua/test');assert.equal(r.numerator,'514587');assert.equal(r.denominator,'10000');assert.equal(r.incomeDate,'2026-05-01');assert.equal(r.raw,fixture);
});
test('ambiguous/duplicate/mismatched NBU evidence cannot finalize tax',()=>{
 for(const raw of [fixture.replace('"cc":"EUR"','"cc":"USD","cc":"EUR"'),fixture.replace('"exchangedate":','"exchangedate":"02.05.2026","exchangedate":'),fixture.replace('"rate":51.4587','"rate":99,"rate":51.4587'),fixture.replace('"cc":"EUR"','"cc":"USD"'),fixture.replace('01.05.2026','02.05.2026'),'[]',fixture.replace('51.4587','0')])assert.throws(()=>parseHistoricalRate(raw,'EUR','2026-05-01','https://bank.gov.ua/test'));
 assert.throws(()=>strictNbuJson('['.repeat(20)+'0'+']'.repeat(20)));assert.throws(()=>strictNbuJson(' '.repeat(32001)));
});
test('UAH requires no network and historical date is retained',async()=>{const r=await new HistoricalNbuService().rate('UAH','2026-05-01');assert.equal(r.numerator,'1');assert.equal(r.incomeDate,'2026-05-01');});
