import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTargetModule} from './overview-target-loader.mjs';
const {classifyOrderSource,matchesOrderSource,normalizeOrderSourceFilter,CONFIRMED_WEBSITE_SOURCE,countOrderSources}=loadTargetModule('orders/order-source.ts');
const imported=(name,extra={})=>({sourceSystem:'KEYCRM',sourceAccount:'account',externalId:'42',activities:[{type:'KEYCRM_ORDER_IMPORTED',createdAt:new Date('2026-09-01'),metadata:{keycrmOrderId:'42',sourceName:name}}],...extra});

test('every requested origin has a separate proven category while manual and unknown stay independent',()=>{
 const cases={Instagram:'INSTAGRAM',Facebook:'FACEBOOK',WhatsApp:'WHATSAPP',Viber:'VIBER',Gmail:'EMAIL','E-mail':'EMAIL',Chatwoot:'CHAT','Chat KeyCRM':'CHAT',Chatway:'CHAT',Manual:'MANUAL'};
 for(const [name,expected] of Object.entries(cases)){
  assert.equal(classifyOrderSource(imported(name)),expected,name);
  assert.equal(normalizeOrderSourceFilter(expected),expected);
  assert.equal(matchesOrderSource(expected,expected),true);
 }
 assert.equal(classifyOrderSource(imported('Telegram')),'OTHER');
 assert.equal(classifyOrderSource(imported('Unverified social network')),'UNKNOWN');
 assert.equal(classifyOrderSource({activities:[{type:'ORDER_CREATED'}],client:{source:'FACEBOOK'}}),'MANUAL');
 assert.equal(classifyOrderSource({client:{source:'WHATSAPP'}}),'UNKNOWN');
 const rows=Object.entries(cases).map(([name],i)=>({id:String(i),createdAt:new Date('2026-10-02')}));
 const origins=Object.fromEntries(Object.entries(cases).map(([name],i)=>[String(i),classifyOrderSource(imported(name))]));
 const counts=countOrderSources(rows,origins,new Date('2026-10-01'),new Date('2026-11-01'));
 assert.equal(counts.length,10);assert.equal(counts.reduce((n,r)=>n+r.count,0),rows.length);
 for(const source of ['FACEBOOK','WHATSAPP','VIBER','EMAIL','CHAT','MANUAL'])assert.ok(counts.find(r=>r.source===source)?.count>0);
});
test('only persisted order provenance establishes website origin, independently of client/payment/type',()=>{
 assert.equal(classifyOrderSource(imported('yoleotard.com')),'WEBSITE');
 assert.equal(classifyOrderSource(imported('https://www.yoleotard.com/shop')),'WEBSITE');
 assert.equal(classifyOrderSource(imported('Instagram',{client:{source:'WEBSITE'},method:'CARD',type:'WEBSITE_SALE'})),'INSTAGRAM');
 assert.equal(classifyOrderSource({sourceSystem:'KEYCRM',externalId:'42',type:'WEBSITE_SALE',client:{source:'INSTAGRAM'}}),'UNKNOWN');
 for(const name of ['Сайт','WordPress','KeyCRM source #2','yoleotard.com.evil.example','https://evil.example/?ref=yoleotard.com'])assert.notEqual(classifyOrderSource(imported(name)),'WEBSITE');
});
test('manual creation is independent of communication and ambiguous imported history stays unknown',()=>{
 assert.equal(classifyOrderSource({activities:[{type:'ORDER_CREATED'}],client:{source:'INSTAGRAM'},method:'PAYPAL'}),'MANUAL');
 assert.equal(classifyOrderSource({sourceSystem:'KEYCRM',externalId:'42',activities:[{type:'ORDER_CREATED'}]}),'UNKNOWN');
 assert.equal(classifyOrderSource({}),'UNKNOWN');
 assert.equal(classifyOrderSource(imported('yoleotard.com',{externalId:'43'})),'UNKNOWN');
 assert.equal(classifyOrderSource(imported('yoleotard.com',{activities:[{type:'KEYCRM_ORDER_SYNCED',metadata:{keycrmOrderId:'42',sourceName:'KeyCRM source #9'}},{type:'KEYCRM_ORDER_IMPORTED',metadata:{keycrmOrderId:'42',sourceName:'yoleotard.com'}}]})),'UNKNOWN');
});
test('source filters distinguish other known origin from all nonwebsite and reject invalid values',()=>{
 assert.equal(matchesOrderSource('UNKNOWN','NON_WEBSITE'),true);assert.equal(matchesOrderSource('WEBSITE','NON_WEBSITE'),false);
 assert.equal(matchesOrderSource('UNKNOWN','OTHER'),false);assert.equal(matchesOrderSource('WEBSITE',''),true);
 assert.equal(normalizeOrderSourceFilter(undefined),'');assert.throws(()=>normalizeOrderSourceFilter('KEYCRM'));
});

test('conflicting provenance and matched preexisting records remain unknown, not retroactive website sales',()=>{
 assert.equal(classifyOrderSource(imported('yoleotard.com',{sourceLinkMode:'MATCHED_EXISTING'})),'UNKNOWN');
 assert.equal(classifyOrderSource(imported('Вебсайт')),'UNKNOWN');
 assert.equal(classifyOrderSource(imported('yoleotard.com',{activities:[{type:'KEYCRM_ORDER_SYNCED',metadata:{keycrmOrderId:'42',sourceName:'yoleotard.com'}},{type:'KEYCRM_ORDER_IMPORTED',metadata:{keycrmOrderId:'42',sourceName:'Instagram'}}]})),'UNKNOWN');
});

test('owner-confirmed website alias is pinned to the exact import account, raw source ID and name',()=>{
 const known=imported('Вебсайт',{sourceAccount:CONFIRMED_WEBSITE_SOURCE.account,externalData:{source_id:12}});
 assert.equal(classifyOrderSource(known),'WEBSITE');
 assert.equal(classifyOrderSource({...known,sourceAccount:'another-account'}),'UNKNOWN');
 assert.equal(classifyOrderSource({...known,externalData:{source_id:1}}),'UNKNOWN');
 assert.equal(classifyOrderSource(imported('Some unexplained source')),'UNKNOWN');
});

test('count analytics use distinct stable orders and creation month including explicit unknown categories',()=>{
 const rows=[{id:'september',createdAt:new Date('2026-09-30T23:59:59Z')},{id:'october',createdAt:new Date('2026-10-01T00:00:00Z')},{id:'october',createdAt:new Date('2026-10-01T00:00:00Z')},{id:'unresolved',createdAt:new Date('2026-10-03T00:00:00Z')}];
 const r=countOrderSources(rows,{september:'WEBSITE',october:'WEBSITE'},new Date('2026-10-01'),new Date('2026-11-01'));
 assert.equal(r.find(x=>x.source==='WEBSITE').count,1);assert.equal(r.find(x=>x.source==='UNKNOWN').count,1);assert.equal(r.reduce((n,x)=>n+x.count,0),2);
});

test('server source paging counts the whole cohort and composes source, search context, status and stable sorting',()=>{
 const {buildOrderListPage}=loadTargetModule('orders/order-list-read-model.ts');
 const rows=Array.from({length:55},(_,i)=>({id:String(i),number:'KC-'+i,orderSource:i<31?'WEBSITE':'UNKNOWN',createdAt:new Date('2026-10-01'),requiredDeliveryAt:new Date('2026-10-20'),client:{displayName:'Client'},items:[],payments:[],currency:'EUR',priceMinor:10000,depositRequiredMinor:5000,salesStatus:i===30?'CANCELLED':'NEW_LEAD',productionStatus:'NOT_SCHEDULED',shippingStatus:'NOT_READY'}));
 const r=buildOrderListPage(rows,{page:'2',pageSize:'20',source:'WEBSITE',sort:'created',direction:'desc'},new Date('2026-10-15'));
 assert.equal(r.total,31);assert.equal(r.items.length,11);assert.equal(r.metrics.total,31);assert.equal(r.sources.total,55);assert.equal(r.sources.websiteCount,31);
 const focused=buildOrderListPage(rows,{page:'1',source:'WEBSITE',sort:'created',direction:'desc',focusId:'30'});assert.equal(focused.page,2);assert.ok(focused.items.some(x=>x.id==='30'));
 const hidden=buildOrderListPage(rows,{source:'WEBSITE',focusId:'54'});assert.equal(hidden.focusFound,false);
 const active=buildOrderListPage(rows,{page:'1',source:'WEBSITE',status:'active'},new Date('2026-10-15'));assert.equal(active.total,30);
 assert.throws(()=>buildOrderListPage(rows,{page:'0'}));assert.throws(()=>buildOrderListPage(rows,{source:'KEYCRM'}));
});

test('native creation plus external import is ambiguous and does not relabel historical native order',()=>{
 assert.equal(classifyOrderSource(imported('yoleotard.com',{activities:[{type:'ORDER_CREATED'},{type:'KEYCRM_ORDER_IMPORTED',metadata:{keycrmOrderId:'42',sourceName:'yoleotard.com'}}]})),'UNKNOWN');
});

test('latest explicit staff override wins without rewriting provider provenance',()=>{
 const order=imported('Instagram',{activities:[
  {type:'ORDER_SOURCE_OVERRIDDEN',metadata:{source:'WHATSAPP'}},
  {type:'KEYCRM_ORDER_SYNCED',metadata:{keycrmOrderId:'42',sourceName:'Instagram'}},
  {type:'ORDER_SOURCE_OVERRIDDEN',metadata:{source:'FACEBOOK'}},
 ]});
 assert.equal(classifyOrderSource(order),'WHATSAPP');
 assert.equal(classifyOrderSource({...order,activities:[{type:'ORDER_SOURCE_OVERRIDDEN',metadata:{source:'KEYCRM'}}]}),'UNKNOWN');
});

test('explicit staff override remains inside the bounded projection after more than 101 provider events',()=>{
 const source=readFileSync(new URL('../src/orders/order-source.ts',import.meta.url),'utf8');
 assert.match(source,/orderBy:\[\{type:'desc'\},\{createdAt:'desc'\},\{id:'desc'\}\],take:101/);
 const activities=[{type:'ORDER_SOURCE_OVERRIDDEN',metadata:{source:'WHATSAPP'}},...Array.from({length:120},()=>({type:'KEYCRM_ORDER_SYNCED',metadata:{keycrmOrderId:'42',sourceName:'Instagram'}}))];
 assert.equal(classifyOrderSource({...imported('Instagram'),activities}),'WHATSAPP');
});
