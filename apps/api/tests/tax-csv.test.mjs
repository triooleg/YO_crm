import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTax } from './tax-service.test.mjs';

const { TaxesService } = loadTax('taxes.service.ts');

test('tax CSV presents Russian labels and explicit monetary columns without changing report data', async () => {
  // Exercise the public export formatter against a supplied report boundary;
  // database/FX calculation behavior is covered by the real PostgreSQL suite.
  const totals = { creditMinor: 100, debtMinor: 200, allocatedMinor: 300, paidMinor: 400, accruedMinor: 500 };
  const report = { components: { UNIFIED: totals, MILITARY: totals, ESV: totals }, incomplete: true };
  const before = JSON.stringify(report), query = { from: '2026-05', to: '2026-05' }, actor = { id: 'owner', role: 'OWNER' };
  const csv = await TaxesService.prototype.reportCsv.call({ report: async (q, a) => { assert.equal(q, query); assert.equal(a, actor); return report; } }, query, actor);
  assert.equal(csv, '\uFEFF"Компонент";"Начислено UAH коп.";"Уплачено UAH коп.";"Распределено UAH коп.";"Долг UAH коп.";"Кредит UAH коп.";"Полнота"\r\n"Единый налог";"500";"400";"300";"200";"100";"Неполный"\r\n"Военный сбор";"500";"400";"300";"200";"100";"Неполный"\r\n"ЕСВ";"500";"400";"300";"200";"100";"Неполный"');
  assert.equal(JSON.stringify(report), before);
  report.incomplete = false;
  const complete = await TaxesService.prototype.reportCsv.call({ report: async () => report }, query, actor);
  assert.ok(complete.includes('"Полный"')); assert.ok(!complete.includes('UNIFIED'));
});

test('tax CSV preserves signed numeric minor units and defensively escapes textual formula cells', async () => {
  const totals = { accruedMinor: -500, paidMinor: 400, allocatedMinor: 300, debtMinor: 200, creditMinor: 100 };
  const report = { components: { UNIFIED: totals, MILITARY: totals, ESV: totals }, incomplete: false };
  const csv = () => TaxesService.prototype.reportCsv.call({ report: async () => report }, {}, { id: 'owner', role: 'OWNER' });
  assert.ok((await csv()).includes('"Единый налог";"-500";"400"'));
  // Defensive serialization at the supplied report boundary; these are not valid money inputs.
  for (const text of ['=SUM(1;2)', '+cmd()', '-cmd()', '@cmd()', '\tcmd()', '\rcmd()', '\ncmd()', '  =cmd()', '"банк";основание']) {
    totals.accruedMinor = text;
    const cells = [...(await csv()).matchAll(/"((?:[^"]|"")*)"/g)].map(match => match[1].replaceAll('""', '"'));
    assert.equal(cells[8], text === '"банк";основание' ? text : "'" + text);
  }
});
