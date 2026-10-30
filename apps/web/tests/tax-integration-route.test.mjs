import test from 'node:test';
import assert from 'node:assert/strict';
import { readFinanceRoute, writeFinanceRoute, patchFinanceFilters, financeReportQuery } from '../lib/finance-report.ts';

const base = { month:'2026-09', currency:'EUR', range:6, tab:'payments', page:1, pageSize:10, search:'', status:'', clientId:'', categoryId:'', orderId:'', from:'', to:'', sort:'date', direction:'desc', scope:'all', source:'' };

test('tax component drilldown round-trips month, display currency and browser route', () => {
  const route = readFinanceRoute(base, '?section=finance&period=2026-10&currency=USD&tab=taxes&taxComponent=MILITARY&page=2');
  assert.equal(route.tab, 'taxes');
  assert.equal(route.taxComponent, 'MILITARY');
  assert.equal(route.month, '2026-10');
  assert.equal(route.currency, 'USD');
  const serialized = writeFinanceRoute(route, new URL('https://crm.example/?section=finance'));
  assert.deepEqual(readFinanceRoute(base, new URL(serialized, 'https://crm.example').search), route);
  assert.equal(financeReportQuery(route).get('taxComponent'), 'MILITARY');
});

test('moving from a tax component to expenses clears only tax-specific state', () => {
  const current = { ...base, tab:'taxes', taxComponent:'ESV', source:'INSTAGRAM', orderId:'order-1' };
  const next = patchFinanceFilters(current, {tab:'expenses', categoryId:'delivery'});
  assert.equal(next.taxComponent, '');
  assert.equal(next.categoryId, 'delivery');
  assert.equal(next.source, 'INSTAGRAM');
  assert.equal(next.orderId, 'order-1');
  assert.equal(next.page, 1);
});

test('unknown tax components do not survive untrusted URLs', () => {
  assert.equal(readFinanceRoute(base, '?tab=taxes&taxComponent=PAYROLL').taxComponent, '');
});
