import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {buildFinanceReport,financeReportCsv}=loadTargetModule('finance/finance-report-model.ts');
const now=new Date('2026-10-15T12:00:00Z');
const o=(id,extra={})=>({id,number:id,clientId:id,client:{displayName:id},createdAt:new Date('2026-09-01'),priceMinor:10000,currency:'EUR',salesStatus:'NEW_LEAD',paymentStatus:'PARTIAL',shippingStatus:'NOT_READY',...extra});
const p=(id,orderId,amountMinor,extra={})=>({id,orderId,amountMinor,currency:'EUR',receivedAt:new Date('2026-10-01'),method:'PAYPAL',...extra});
const valuation={provider:'NBU',cache:{version:1,provider:'NBU',officialUrl:'https://bank.gov.ua',effectiveDate:'2026-10-15',fetchedAt:now.toISOString(),rates:[{baseCurrency:'EUR',quoteCurrency:'UAH',numerator:'50',denominator:'1',decimal:'50',sourceSeriesOrValcode:'EUR'},{baseCurrency:'USD',quoteCurrency:'UAH',numerator:'40',denominator:'1',decimal:'40',sourceSeriesOrValcode:'USD'}]}};
const data=()=>({orders:[o('web'),o('manual')],orderSources:{web:'WEBSITE',manual:'MANUAL'},payments:[p('a','web',2500),p('b','web',1500),p('void','web',700,{voidedAt:now}),p('c','manual',6000)],expenses:[],invoices:[],categories:[]});
const build=(s=data(),q={})=>buildFinanceReport(s,{month:'2026-10',currency:'EUR',range:6,...q},valuation,now);

test('all source buckets retain exact receipt totals, filter identities and CSV labels in each currency',()=>{
 const labels={WEBSITE:'С сайта',MANUAL:'Ручной / CRM',INSTAGRAM:'Instagram',FACEBOOK:'Facebook',CHAT:'Чат',WHATSAPP:'WhatsApp',VIBER:'Viber',EMAIL:'E-mail',OTHER:'Другое',UNKNOWN:'Не определён'};
 const keys=Object.keys(labels),s={orders:keys.map(key=>o(key)),orderSources:Object.fromEntries(keys.map(key=>[key,key])),payments:keys.map((key,i)=>p('p-'+key,key,(i+1)*100)),expenses:[],invoices:[],categories:[]};
 s.payments.push(s.payments[0],p('void','FACEBOOK',999999,{voidedAt:now}));
 for(const [currency,multiplier] of [['EUR',1],['USD',1.25],['UAH',50]]){
  const all=build(s,{currency});assert.equal(all.sourceAnalytics.breakdown.length,10);assert.equal(all.current.receivedMinor,5500*multiplier);
  assert.equal(all.sourceAnalytics.breakdown.reduce((n,row)=>n+row.amountMinor,0),all.current.receivedMinor);
  assert.equal(all.sourceAnalytics.trend.at(-1).breakdown.reduce((n,row)=>n+row.amountMinor,0),all.current.receivedMinor);
  for(const source of keys){
   const r=build(s,{currency,source});assert.equal(r.table.total,1);assert.equal(r.table.rows[0].orderSource,source);assert.equal(r.table.rows[0].orderId,source);
   assert.equal(r.current.receivedMinor,all.current.receivedMinor);assert.match(financeReportCsv(r,'payments'),new RegExp(labels[source]));
  }
 }
});

test('client debt KPI sums only unpaid active remainders and never cancelled or fully paid orders',()=>{
 const s={orders:[o('unpaid'),o('partial'),o('paid',{paymentStatus:'PAID'}),o('cancelled',{salesStatus:'CANCELLED'}),o('cancelled-unpaid',{salesStatus:'CANCELLED'}),o('completed',{salesStatus:'COMPLETED'}),o('archived',{archivedAt:now})].map(row=>({...row,requiredDeliveryAt:new Date('2026-10-20')})),payments:[p('partial','partial',2500),p('paid','paid',10000),p('cancelled','cancelled',2000)],expenses:[],invoices:[],categories:[]};
 for(const [currency,multiplier] of [['EUR',1],['USD',1.25],['UAH',50]]){
  const r=build(s,{currency,scope:'forecast'});assert.equal(r.debtMinor,17500*multiplier);assert.equal(r.forecastMinor,r.debtMinor);
  assert.equal(r.table.total,2);assert.deepEqual(new Set(r.table.rows.map(row=>row.orderId)),new Set(['unpaid','partial']));
  assert.ok(r.upcoming.every(row=>['unpaid','partial'].includes(row.orderId)));
  assert.equal(r.current.receivedMinor,14500*multiplier,'actual receipts from cancelled orders remain historical income');
  assert.doesNotMatch(financeReportCsv(r,'payments'),/cancelled|completed|archived/);
 }
});
test('online proceeds are actual received-month valid receipts, not order price or payment method',()=>{
 const r=build();assert.equal(r.current.receivedMinor,10000);assert.equal(r.sourceAnalytics.websiteReceivedMinor,4000);assert.equal(r.sourceAnalytics.breakdown.reduce((n,x)=>n+x.amountMinor,0),10000);
 assert.equal(r.sourceAnalytics.trend.find(x=>x.month==='2026-10').breakdown.find(x=>x.source==='WEBSITE').amountMinor,4000);
 const filtered=build(data(),{source:'WEBSITE'});assert.equal(filtered.table.total,1);assert.equal(filtered.table.rows[0].orderId,'web');assert.equal(filtered.current.receivedMinor,10000);assert.equal(filtered.debtMinor,r.debtMinor);
 assert.match(financeReportCsv(filtered,'payments'),/С сайта/);
});

test('all currencies value each original receipt exactly once, with void, partial and unknown provenance preserved',()=>{
 const s=data();s.payments.push(s.payments[0]);s.orders.push(s.orders[0]);
 for(const [currency,website,total] of [['EUR',4000,10000],['USD',5000,12500],['UAH',200000,500000]]){const r=build(s,{currency});assert.equal(r.sourceAnalytics.websiteReceivedMinor,website);assert.equal(r.current.receivedMinor,total);assert.equal(r.table.total,2);}
 const u=data();u.payments.push(p('unlinked',null,1000));const r=build(u);assert.equal(r.sourceAnalytics.breakdown.find(x=>x.source==='UNKNOWN').amountMinor,1000);assert.equal(r.current.receivedMinor,11000);assert.equal(r.sourceAnalytics.websiteReceivedMinor,4000);
 const cancelled=data();cancelled.orders[0].salesStatus='CANCELLED';cancelled.orders[0].paymentStatus='REFUNDED';assert.equal(build(cancelled).sourceAnalytics.websiteReceivedMinor,4000);
 cancelled.payments=cancelled.payments.map(x=>x.orderId==='web'?{...x,voidedAt:now}:x);assert.equal(build(cancelled).sourceAnalytics.websiteReceivedMinor,0);
 assert.throws(()=>build(data(),{source:'FACEBOOK_CLIENT_CHANNEL'}));
 const old=data();old.orders=[];assert.equal(build(old).sourceAnalytics.websiteReceivedMinor,0);
});
