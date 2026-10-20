import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url), ts = require('typescript');
const source = readFileSync(new URL('../lib/tax-accounting.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const labels = ts.transpileModule(readFileSync(new URL('../lib/i18n.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const labelsUrl = 'data:text/javascript;base64,' + Buffer.from(labels).toString('base64');
const tax = await import('data:text/javascript;base64,' + Buffer.from(compiled.replaceAll("'./i18n'", JSON.stringify(labelsUrl))).toString('base64'));

test('tax UI amount parsing preserves integer minor units and refuses guessed/unsafe values', () => {
  assert.equal(tax.TAX_ACCOUNTING_START, '2026-05-01');
  assert.equal(tax.parseTaxMinor('1902,34'), 190234);
  assert.equal(tax.parseTaxMinor('0.01'), 1);
  assert.equal(tax.parseTaxMinor('-0.01', true), -1);
  for (const value of ['', '1.234', 'Infinity', '1e3', '-1', '90071992547409.92']) assert.equal(tax.parseTaxMinor(value), null, value);
  assert.equal(tax.taxAmount(null), '—'); assert.equal(tax.taxAmount(Number.MAX_SAFE_INTEGER + 1), '—');
  assert.equal(tax.taxMajorInput(-1), '-0.01');
  assert.ok(tax.taxDate('2026-05-01')); assert.equal(tax.taxDate('2026-02-30'), false);
});
test('month/quarter/year boundaries never use cash-report timezone or silently change accounting start', () => {
  assert.deepEqual(tax.taxBounds('2026-05', 'MONTH'), { from: '2026-05', to: '2026-05' });
  assert.deepEqual(tax.taxBounds('2026-05', 'QUARTER'), { from: '2026-04', to: '2026-06' });
  assert.deepEqual(tax.taxBounds('2027-01', 'YEAR'), { from: '2027-01', to: '2027-12' });
  assert.throws(() => tax.taxBounds('2026-13', 'MONTH'));
  for (const role of ['MANAGER', 'PRODUCTION', '', 'owner']) assert.equal(tax.canReadTaxes(role), false);
  assert.ok(tax.canReadTaxes('ACCOUNTANT')); assert.equal(tax.canManageTaxes('ACCOUNTANT'), false);
  const expense = new URL(tax.taxExpenseHref('synthetic/id', '2026-04-30T22:30:00Z'), 'http://localhost');
  assert.equal(expense.searchParams.get('period'), '2026-04'); assert.equal(expense.searchParams.get('search'), 'synthetic/id'); assert.equal(expense.searchParams.get('currency'), 'UAH'); assert.equal(expense.searchParams.get('tab'), 'expenses');
  assert.equal(tax.taxExpenseHref('id', null), undefined);
  const actualSource = tax.taxEntrySource({ snapshot: { grossMinor: 12000, incomeDate: '2026-05-01', originalPayment: { amountMinor: 10000, currency: 'EUR' } } });
  assert.deepEqual(actualSource, { amountMinor: 10000, currency: 'EUR', incomeDate: '2026-05-01' });
});
test('tax transport follows exact backend command paths, CAS, no-store and preserved operation keys', async () => {
  const calls = [], api = tax.createTaxApi(async (path, init) => { calls.push({ path, ...init, body: init.body && JSON.parse(init.body) }); return new Response('{}', { status: 200 }); });
  const command = { expectedRevision: 7, operationKey: 'synthetic-stable-key' };
  await api.settings(); await api.report('2026-05', 'QUARTER'); await api.order('order/a');
  await api.policy({ ...command, effectiveFrom: '2026-05-01', group: 3, unifiedMode: 'PERCENT', unifiedRateBps: 500, militaryRateBps: 100, esvRateBps: 2200, fixedUnifiedMinor: null });
  await api.enable({ ...command, enabled: true });
  await api.preview({ from: '2026-05-01', to: '2026-05-31' });
  await api.backfill({ ...command, from: '2026-05-01', to: '2026-05-31', token: 'exact-preview' });
  await api.settlement({ ...command, component: 'ESV', expenseId: 'synthetic-expense' });
  await api.allocate({ ...command, linkId: 'l', rootId: 'r', amountMinor: 1 });
  await api.reverseAllocation('a', { ...command, reason: 'test' });
  await api.confirm('r/a', { ...command, grossMinor: 1, incomeDate: '2026-05-01', evidence: 'test', postingPeriod: '2026-06' });
  await api.close('2026-05', { ...command, completenessEvidence: 'test' });
  await api.exemption('2026-05', { ...command, exempt: true, reason: 'test', evidence: 'test' });
  await api.correction({ ...command, rootId: 'r', period: '2026-06', amountMinor: -1, reason: 'test', evidence: 'test' });
  await api.publish('draft', command); await api.correctSettlement('l', { ...command, cancel: true, reason: 'test' });
  assert.deepEqual(calls.map(c => c.path), ['/settings', '/report?from=2026-04&to=2026-06', '/orders/order%2Fa', '/policies', '/settings', '/backfill/preview', '/backfill/apply', '/settlements', '/allocations', '/allocations/a/reverse', '/sources/r%2Fa/confirm', '/periods/2026-05/close', '/periods/2026-05/exemption', '/corrections', '/corrections/draft/publish', '/settlements/l/correct'].map(path => '/api/finance/taxes' + path));
  for (const call of calls) { assert.equal(call.credentials, 'include'); assert.equal(call.cache, 'no-store'); if (call.method !== 'GET' && !call.path.endsWith('/preview')) { assert.equal(call.body.expectedRevision, 7); assert.equal(call.body.operationKey, 'synthetic-stable-key'); } }
  assert.deepEqual(calls[5].body, { from: '2026-05-01', to: '2026-05-31' });
  assert.equal(calls[10].body.postingPeriod, '2026-06');
  const failed = tax.createTaxApi(async () => new Response('private unlocalized failure', { status: 409 }));
  await assert.rejects(() => failed.settings(), error => error.status === 409 && !error.message.includes('private'));
});
test('CSV carries UAH units, incomplete status, source snapshots and safely escapes user formulas', () => {
  const totals = { accruedMinor: 60000, paidMinor: 50000, allocatedMinor: 40000, debtMinor: 20000, creditMinor: 10000 };
  const report = { from: '2026-05', to: '2026-05', accountingStartDate: '2026-05-01', incomplete: true, pendingCount: 1, components: { UNIFIED: totals }, entries: [{ id: 'csv-root', orderId: '=cmd()', paymentId: 'synthetic', component: 'UNIFIED', baseMinor: null, amountMinor: null, kind: 'ROOT', snapshot: { currency: 'EUR', amountMinor: 1 } }], subsequentCorrections: [] };
  const csv = tax.taxCsv(report);
  assert.ok(csv.includes('UAH коп.')); assert.ok(csv.includes('Неполный')); assert.ok(csv.includes("'=cmd()")); assert.ok(csv.includes('2026-05-01')); assert.ok(csv.includes('EUR'));
  assert.equal(tax.taxEvidenceUrl('javascript:alert(1)'), undefined); assert.equal(tax.taxEvidenceUrl('https://bank.gov.ua/'), 'https://bank.gov.ua/');
});
test('CSV human labels are Russian for every component/event while evidence and formula protection survive', () => {
  const totals = { accruedMinor: 60000, paidMinor: 50000, allocatedMinor: 40000, debtMinor: 20000, creditMinor: 10000 };
  const kinds = ['ROOT', 'SOURCE', 'FINALIZE', 'REVERSE', 'RESTORE', 'ADJUST', 'DRAFT', 'RESOLVE'];
  const snapshot = { kind: 'ROOT', note: 'Основание; "банк"', raw: 'точные исходные данные' };
  const entries = kinds.map((kind, index) => ({ id: `localized-${index}`, orderId: ['=cmd()', '+cmd()', '-cmd()', '@cmd()', '\tcmd()', '\rcmd()', '  =cmd()', '\ncmd()'][index], paymentId: 'payment', component: 'UNIFIED', kind, baseMinor: 1200000, amountMinor: index === 3 ? -60000 : 60000, snapshot }));
  const report = { from: '2026-05', to: '2026-05', accountingStartDate: '2026-05-01', incomplete: false, pendingCount: 0, components: { UNIFIED: totals, MILITARY: totals, ESV: totals }, entries, subsequentCorrections: [{ ...entries[0], id: 'localized-outside', kind: 'ADJUST', orderId: 'correction' }] };
  const before = JSON.stringify(report), csv = tax.taxCsv(report);
  const cells = [...csv.matchAll(/"((?:[^"]|"")*)"/g)].map(match => match[1].replaceAll('""', '"'));
  assert.deepEqual(cells.slice(0, 8), ['Период', 'Компонент', 'Начислено UAH коп.', 'Уплачено UAH коп.', 'Распределено UAH коп.', 'Долг UAH коп.', 'Кредит UAH коп.', 'Полнота']);
  for (const label of ['Единый налог', 'Военный сбор', 'ЕСВ', 'Полный', 'Источник поступления', 'Изменение источника', 'Начисление', 'Сторно', 'Восстановление', 'Корректировка', 'Черновик', 'Сверка']) assert.ok(cells.includes(label), label);
  for (const code of [...kinds, 'UNIFIED', 'MILITARY', 'ESV']) assert.ok(!cells.includes(code), code);
  for (const entry of entries) assert.ok(cells.includes("'" + entry.orderId), entry.orderId);
  assert.equal(cells.filter(cell => cell === JSON.stringify(snapshot)).length, 9);
  assert.ok(cells.includes('60000')); assert.ok(cells.includes('-60000')); assert.ok(cells.includes('1200000'));
  assert.equal(JSON.stringify(report), before);
});


test('CSV exports overlapping ledger collections once per event ID and retains distinct identical and outside-range events', () => {
  const totals = { accruedMinor: -200, paidMinor: 0, allocatedMinor: 0, debtMinor: 0, creditMinor: 0 };
  const snapshot = { evidence: 'банк; "точная сумма"', originalPeriod: '2026-05' };
  const shared = { id: 'shared-adjustment', orderId: 'order', paymentId: 'receipt', component: 'UNIFIED', kind: 'ADJUST', baseMinor: 10000, amountMinor: -100, snapshot };
  const distinct = { ...shared, id: 'different-event-same-economics' };
  const outside = { ...shared, id: 'outside-posting-range', amountMinor: 25, snapshot: { ...snapshot, postingPeriod: '2026-09' } };
  const report = { from: '2026-05', to: '2026-07', accountingStartDate: '2026-05-01', incomplete: false, pendingCount: 0, components: { UNIFIED: totals }, entries: [shared, distinct], subsequentCorrections: [{ ...shared, snapshot: { ...snapshot } }, outside] };
  const before = JSON.stringify(report), csv = tax.taxCsv(report);
  const cells = [...csv.matchAll(/"((?:[^"]|"")*)"/g)].map(match => match[1].replaceAll('""', '"'));
  assert.equal(cells.filter(cell => cell === JSON.stringify(snapshot)).length, 2, 'shared event once; distinct identical event remains');
  assert.equal(cells.filter(cell => cell === JSON.stringify(outside.snapshot)).length, 1, 'outside-range correction retained');
  assert.equal(cells.filter(cell => cell === 'Корректировка').length, 3);
  assert.equal(cells.filter(cell => cell === '-100').length, 2, 'signed event amounts preserved without text escaping');
  assert.equal(JSON.stringify(report), before, 'formatter never mutates ledger evidence');
});

test('all isolated tax TSX exports typecheck including unintegrated panels', () => {
  const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const own = ['tax-settings-panel.tsx', 'tax-finance-panel.tsx', 'tax-order-panel.tsx'].map(name => root + 'components/taxes/' + name);
  const program = ts.createProgram(own, { ...parsed.options, incremental: false, noEmit: true });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: s => s, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
});
