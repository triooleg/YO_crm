import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url), ts = require('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../components/taxes/entry-groups.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText;
const { groupTaxEntries } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const event = (id, kind, amountMinor = null, snapshot = {}, overrides = {}) => ({ id, kind, amountMinor, snapshot, rootId: kind === 'ROOT' ? null : 'root', component: 'UNIFIED', baseMinor: null, paymentId: 'payment', createdAt: '2026-05-01', ...overrides });
const root = event('root', 'ROOT'), source = event('source', 'SOURCE');
const valued = event('valued', 'FINALIZE', 50000, { sourceId: 'source', receiptConfirmed: false, originalPayment: { amountMinor: 1000000, currency: 'UAH' }, rate: { numerator: '1', denominator: '1' } }, { baseMinor: 1000000 });
test('confirmation zero ADJUST and DRAFT do not replace net liability or fabricate pending', () => {
  const confirmed = event('confirm', 'ADJUST', 0, { sourceId: 'source', receiptConfirmed: true });
  const rows = [root, source, valued, confirmed, event('draft', 'DRAFT', 99999)];
  const before = JSON.stringify(rows), [group] = groupTaxEntries(rows);
  assert.equal(group.amountMinor, 50000); assert.equal(group.status, 'CONFIRMED'); assert.equal(group.basis, valued);
  assert.deepEqual(group.events.map(e => e.id), rows.map(e => e.id)); assert.equal(JSON.stringify(rows), before);
});
test('new source and persisted retry keep prior liability and remain pending until matching authoritative sourceId', () => {
  const pending = event('new-source', 'SOURCE', null, { state: { voidedAt: '2026-05-02' } });
  const retry = event('retry', 'RESOLVE', null, { retryFor: 'new-source', error: 'NBU_UNAVAILABLE' });
  const [group] = groupTaxEntries([root, source, valued, pending, retry]);
  assert.equal(group.amountMinor, 50000); assert.equal(group.status, 'PENDING'); assert.equal(group.basis, valued);
  const [resolved] = groupTaxEntries([root, source, valued, pending, retry, event('resolved', 'RESOLVE', null, { sourceId: pending.id, receiptConfirmed: true })]);
  assert.equal(resolved.status, 'CONFIRMED'); assert.equal(resolved.amountMinor, 50000);
});
test('reverse restore and signed adjustments are all netted; latest event delta never masquerades as total', () => {
  const [group] = groupTaxEntries([root, source, valued, event('reverse', 'REVERSE', -50000), event('restore', 'RESTORE', 50000), event('adjust', 'ADJUST', -1000, { sourceId: 'source', receiptConfirmed: true })]);
  assert.equal(group.amountMinor, 49000); assert.equal(group.basis, valued); assert.equal(group.status, 'CONFIRMED');
  assert.equal(groupTaxEntries([root, source, valued, event('reverse', 'REVERSE', -50000, { sourceId: 'source', receiptConfirmed: true })])[0].amountMinor, 0);
});
test('monthly roots, missing money and correction-only slices are distinct; components remain separate', () => {
  assert.equal(groupTaxEntries([root, source])[0].amountMinor, null);
  assert.equal(groupTaxEntries([root, source, valued])[0].status, 'REVIEW');
  const [monthly] = groupTaxEntries([event('month', 'ROOT', null, {}, { paymentId: null, component: 'ESV' }), event('month-value', 'FINALIZE', 190234, {}, { rootId: 'month', paymentId: null, component: 'ESV' })]);
  assert.equal(monthly.status, 'CALCULATED');
  assert.equal(groupTaxEntries([event('correction', 'ADJUST', -1000)])[0].status, 'PARTIAL');
  assert.equal(groupTaxEntries([root, source, valued, event('military', 'FINALIZE', 10000, {}, { component: 'MILITARY' })]).length, 2);
});
test('preserve API event order even with equal timestamps and reverse lexical UUID order; unsafe sums stay unknown', () => {
  const rows = [root, event('z-source', 'SOURCE'), event('z-final', 'FINALIZE', 50000, { sourceId: 'z-source', receiptConfirmed: true }), event('a-source', 'SOURCE')];
  assert.equal(groupTaxEntries(rows)[0].status, 'PENDING');
  assert.deepEqual(groupTaxEntries(rows)[0].events.map(e => e.id), rows.map(e => e.id));
  assert.equal(groupTaxEntries([root, event('big', 'FINALIZE', Number.MAX_SAFE_INTEGER), event('one', 'ADJUST', 1)])[0].amountMinor, null);
});
