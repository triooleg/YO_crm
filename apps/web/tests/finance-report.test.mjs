import test from 'node:test';
import assert from 'node:assert/strict';
import { moveFinanceMonth, financeReportQuery, comparisonPercent, moneyLabel, originalMinor, patchFinanceFilters, FINANCE_PAGE_SIZES } from '../lib/finance-report.ts';

test('month navigation crosses year boundaries without losing the month',()=>{
  assert.equal(moveFinanceMonth('2026-01',-1),'2025-12');
  assert.equal(moveFinanceMonth('2026-12',1),'2027-01');
});
test('report and export share filters and valuation, not hidden defaults',()=>{
  const query=financeReportQuery({month:'2026-10',currency:'USD',range:6,tab:'expenses',page:2,pageSize:10,search:'KC-675',status:'',clientId:'',categoryId:'delivery',orderId:'',from:'2026-10-01',to:'',sort:'amount',direction:'desc',scope:'all'},'snapshot-1');
  assert.equal(query.get('currency'),'USD');assert.equal(query.get('categoryId'),'delivery');
  assert.equal(query.get('valuationVersion'),'snapshot-1');assert.equal(query.get('page'),'2');
  assert.equal(query.has('status'),false);
});
test('comparisons handle zero base and negative result without infinity',()=>{
  assert.equal(comparisonPercent(100,0),null);
  assert.equal(comparisonPercent(-500,1000),-150);
  assert.equal(comparisonPercent(0,0),0);
  assert.match(moneyLabel(3450,'USD'),/34,50/);
});
test('display formatter preserves safe integer cents and negative sub-unit sign',()=>{
  const compact=value=>value.replace(/[\s\u00a0\u202f]/g,'');
  assert.match(compact(moneyLabel(9007199254740990,'EUR')),/90071992547409,90/);
  assert.match(compact(moneyLabel(Number.MAX_SAFE_INTEGER,'EUR')),/90071992547409,91/);
  assert.match(compact(moneyLabel(-1,'EUR')),/-0,01/);
});
test('currency symbols match the selector across Intl runtimes',()=>{
  assert.match(moneyLabel(100,'UAH'),/₴/);
  assert.match(moneyLabel(100,'USD'),/\$/);
});
test('original tooltip amounts follow the financial column and retain unknown allocations',()=>{
  const payment={originalAmountMinor:10000,originalPaidMinor:2000,originalBalanceMinor:8000,status:'PARTIAL'};
  assert.equal(originalMinor(payment,'amount'),10000);
  assert.equal(originalMinor(payment,'paid'),2000);
  assert.equal(originalMinor(payment,'balance'),8000);
  const invoice={originalAmountMinor:10000,status:'PAID',paidMinor:10000,balanceMinor:0};
  assert.equal(originalMinor(invoice,'paid'),10000);
  assert.equal(originalMinor(invoice,'balance'),0);
  assert.equal(originalMinor({...invoice,status:'ISSUED',paidMinor:null,balanceMinor:null},'paid'),null);
  assert.equal(originalMinor({...invoice,status:'ISSUED',paidMinor:null,balanceMinor:null},'balance'),null);
});
test('tab transitions clear only incompatible filters and use API page sizes',()=>{
  assert.deepEqual(FINANCE_PAGE_SIZES,[10,25,50,100]);
  const current={tab:'payments',clientId:'client-1',categoryId:'',status:'PARTIAL',orderId:'order-1',search:'needle',from:'2026-10-01',to:'2026-10-31',page:3};
  for(const next of [{tab:'expenses'},{tab:'expenses',categoryId:'materials'},{tab:'expenses',categoryId:'',scope:'all'}]){
    const result=patchFinanceFilters(current,next);
    assert.equal(result.clientId,'');assert.equal(result.status,'');assert.equal(result.page,1);
    for(const key of ['orderId','search','from','to'])assert.equal(result[key],current[key]);
    assert.equal(result.categoryId,next.categoryId||'');
  }
  const expense={...current,tab:'expenses',categoryId:'materials'};
  for(const tab of ['payments','invoices'])assert.equal(patchFinanceFilters(expense,{tab}).categoryId,'');
  assert.equal(patchFinanceFilters(current,{search:'new'}).clientId,'client-1');
  assert.equal(patchFinanceFilters(current,{page:2}).page,2);
});
