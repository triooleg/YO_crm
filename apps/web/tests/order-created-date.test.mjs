import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../lib/order-created-date.ts',import.meta.url),'utf8'),mod={exports:{}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:mod.exports,Intl,Date});
const {orderCreatedCalendarDay,changeOrderCreatedCalendarDay}=mod.exports;
test('created day is Europe/Kyiv even when UTC is a different day/year',()=>{
 assert.equal(orderCreatedCalendarDay('2026-12-31T22:30:00.000Z'),'2027-01-01');
 assert.equal(changeOrderCreatedCalendarDay('2026-10-20T10:11:12.123Z','2025-03-02'),'2025-03-02T11:11:12.123Z');
});
test('leap date is strict, invalid calendar dates and DST gaps cannot normalize silently',()=>{
 assert.equal(changeOrderCreatedCalendarDay('2026-10-20T10:11:12.123Z','2024-02-29'),'2024-02-29T11:11:12.123Z');
 for(const day of ['2025-02-29','2026-04-31','2026-2-01','0000-01-01','invalid'])assert.equal(changeOrderCreatedCalendarDay('2026-10-20T10:11:12.123Z',day),null);
 assert.equal(changeOrderCreatedCalendarDay('2026-03-28T01:30:00.000Z','2026-03-29'),null);
});
test('DST overlap prefers original offset and keeps milliseconds; unchanged day is stable',()=>{
 assert.equal(changeOrderCreatedCalendarDay('2026-10-24T00:30:00.123Z','2026-10-25'),'2026-10-25T00:30:00.123Z');
 assert.equal(changeOrderCreatedCalendarDay('2026-10-26T01:30:00.123Z','2026-10-25'),'2026-10-25T01:30:00.123Z');
 assert.equal(changeOrderCreatedCalendarDay('2026-10-25T00:30:00.123Z','2026-10-25'),'2026-10-25T00:30:00.123Z');
});
