import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSource,sourcePercentages} from '../lib/order-source-values.mjs';
import {readFinanceRoute,writeFinanceRoute,financeReportQuery} from '../lib/finance-report.ts';
import {createCrmNavigationHref} from '../lib/crm-sections.ts';
import {overviewTargets} from '../lib/overview-navigation.ts';
const base={month:'2026-10',currency:'EUR',range:6,tab:'payments',page:1,pageSize:10,search:'',status:'',clientId:'',categoryId:'',orderId:'',from:'',to:'',sort:'date',direction:'desc',scope:'all'};
test('source display never classifies channels or guesses unsupported origin; exact remainder percentages total 100',()=>{
 assert.equal(parseSource('INSTAGRAM'),'INSTAGRAM');assert.equal(parseSource('KEYCRM'),'');assert.equal(parseSource('NON_WEBSITE'),'NON_WEBSITE');
 assert.deepEqual(sourcePercentages([1,1,1]),[34,33,33]);assert.deepEqual(sourcePercentages([0,0,0]),[0,0,0]);assert.equal(sourcePercentages([21,0,155,324,0]).reduce((a,b)=>a+b,0),100);
});

test('all requested source filters survive navigation and finance export queries',()=>{
 for(const source of ['WEBSITE','MANUAL','INSTAGRAM','FACEBOOK','CHAT','WHATSAPP','VIBER','EMAIL','OTHER','UNKNOWN']){
  assert.equal(parseSource(source),source);
  const before={...base,source};const path=writeFinanceRoute(before,new URL('https://example.test/?section=finance'));
  assert.equal(readFinanceRoute(base,path.split('?')[1]).source,source);assert.equal(financeReportQuery(before,'v1').get('source'),source);
  assert.equal(overviewTargets.ordersSource(source,'2026-10').context.source,source);
 }
});
test('finance route round trips source, period, currency and compatible table state on reload/back and export',()=>{
 const before={...base,source:'WEBSITE',currency:'UAH',month:'2026-09',page:3,search:'KC-1',status:'PARTIAL',sort:'balance',clientId:'client-1'};
 const path=writeFinanceRoute(before,new URL('https://example.test/?section=finance&sourceChart=sources'));
 assert.deepEqual(readFinanceRoute(base,path.split('?')[1]),before);
 const query=financeReportQuery(before,'v1');assert.equal(query.get('source'),'WEBSITE');assert.equal(query.get('currency'),'UAH');assert.equal(query.get('valuationVersion'),'v1');
 const reset=writeFinanceRoute({...before,source:''},new URL('https://example.test'+path));assert.ok(!new URL('https://example.test'+reset).searchParams.has('source'));
});
test('source targets preserve cohort and currency; unrelated shell navigation clears owned source state',()=>{
 const orders=overviewTargets.ordersSource('WEBSITE','2026-09');assert.deepEqual(orders.context,{source:'WEBSITE',period:'2026-09',overviewFilter:'period'});
 const finance=overviewTargets.financeSource('UNKNOWN','2026-10','USD');assert.equal(finance.context.currency,'USD');assert.equal(finance.context.tab,'payments');
 const url=new URL(createCrmNavigationHref('tasks','?section=finance&source=WEBSITE&sourceChart=sources&page=3&period=2026-09'), 'https://example.test');
 for(const key of ['source','sourceChart','page','period'])assert.equal(url.searchParams.has(key),false);
});
