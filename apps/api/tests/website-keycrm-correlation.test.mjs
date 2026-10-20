import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';

const {websiteCheckoutMarker,parseWebsiteCheckoutMarker,parseWebsiteOrdersKeycrmSourceMap,rejectWebsiteCheckoutCorrelation}=loadTargetModule('keycrm/website-checkout-correlation.ts');
const marker='yo-checkout:v1:calendar.yoleotard.com:123';
const source=(sourceUuid=marker,extras={})=>({connectionKey:'synthetic-connection',orderedAt:new Date('2026-10-20T12:00:00Z'),raw:{id:91,source_id:12,source_uuid:sourceUuid,buyer:{email:'synthetic-private@example.invalid'}},...extras});
function repository(matches=[]){const issues=[],queries=[];return {issues,queries,order:{findMany:async args=>{queries.push(args);return matches;}},keycrmSyncIssue:{create:async({data})=>{issues.push(data);return data;}}};}
const cohort={connectionKey:'synthetic-connection',sourceId:'12',sourceAccount:'calendar.yoleotard.com',effectiveFrom:'2026-10-20T00:00:00Z'};
const sourceMap=JSON.stringify([cohort]);

test('reserved v1 marker awaits the canonical direct order even when no direct tuple exists',async()=>{
 const db=repository(),input=source();
 assert.equal(await rejectWebsiteCheckoutCorrelation(db,input,'run','91',''),true);
 assert.equal(db.issues[0].code,'WEBSITE_CHECKOUT_AWAITING_DIRECT');
 assert.equal(db.issues[0].details.canonicalOrderId,null);
 assert.deepEqual(db.issues[0].details.keycrmPayload,input.raw);
 assert.deepEqual(db.queries[0].where,{sourceSystem:'YOLEOTARD_WEBSITE',sourceAccount:'calendar.yoleotard.com',externalId:'123'});
});

test('opted-in source requires a marker at its inclusive original-order cutoff',async()=>{
 const db=repository();assert.equal(await rejectWebsiteCheckoutCorrelation(db,source(null,{orderedAt:new Date('2026-10-20T00:00:00.000Z')}),'run','91',sourceMap),true);
 assert.equal(db.issues[0].code,'WEBSITE_CHECKOUT_MARKER_REQUIRED');assert.equal(db.queries.length,0);
});

test('source map normalizes offset instants and numeric source IDs, with empty configuration disabled',()=>{
 for(const value of [undefined,'','  ','[]'])assert.deepEqual(parseWebsiteOrdersKeycrmSourceMap(value),[]);
 assert.deepEqual(parseWebsiteOrdersKeycrmSourceMap(JSON.stringify([{...cohort,sourceId:12,effectiveFrom:'2026-10-20T03:00:00+03:00'}])),[{...cohort,effectiveFrom:'2026-10-20T00:00:00.000Z'}]);
 assert.equal(websiteCheckoutMarker(' Calendar.Yoleotard.com ','123'),marker);assert.deepEqual(parseWebsiteCheckoutMarker(marker),{sourceAccount:'calendar.yoleotard.com',externalId:'123'});
 for(const value of ['yo-checkout:v2:calendar.yoleotard.com:123','yo-checkout:v1:calendar.yoleotard.com:00123','yo-checkout:v1:Calendar.yoleotard.com:123',` ${marker}`])assert.throws(()=>parseWebsiteCheckoutMarker(value));
});

test('repeated marked import waits, then resolves the same canonical owner without adoption',async()=>{
 const matches=[],db=repository(matches);await rejectWebsiteCheckoutCorrelation(db,source(),'run-a','91','');assert.equal(db.issues[0].code,'WEBSITE_CHECKOUT_AWAITING_DIRECT');
 matches.push({id:'canonical-direct'});
 for(const run of ['run-b','run-c'])await rejectWebsiteCheckoutCorrelation(db,source(),'run-'+run,'91','');
 assert.deepEqual(db.issues.slice(1).map(i=>[i.code,i.details.canonicalOrderId]),[['WEBSITE_CHECKOUT_DUPLICATE','canonical-direct'],['WEBSITE_CHECKOUT_DUPLICATE','canonical-direct']]);
 assert.equal(matches.length,1);assert.deepEqual(db.issues[2].details.keycrmPayload,source().raw);
});

test('ambiguous exact tuple and malformed reserved marker are held without choosing an owner',async()=>{
 const ambiguous=repository([{id:'a'},{id:'b'}]);await rejectWebsiteCheckoutCorrelation(ambiguous,source(),'run','91','');assert.equal(ambiguous.issues[0].code,'WEBSITE_CHECKOUT_AMBIGUOUS');assert.equal(ambiguous.issues[0].details.canonicalOrderId,null);
 for(const value of ['yo-checkout:v2:calendar.yoleotard.com:123','yo-checkout:v1:calendar.yoleotard.com:0',{conflicting:'shape'}]){const db=repository();await rejectWebsiteCheckoutCorrelation(db,source(value),'run','91','');assert.equal(db.issues[0].code,'WEBSITE_CHECKOUT_MARKER_INVALID');assert.equal(db.queries.length,0);}
});

test('persistence errors cannot echo raw provenance through the worker error message',async()=>{
 const db=repository();db.keycrmSyncIssue.create=async()=>{throw Error(JSON.stringify(source().raw));};
 await assert.rejects(rejectWebsiteCheckoutCorrelation(db,source(),'run','91',''),error=>!error.message.includes('synthetic-private@example.invalid')&&!error.message.includes('source_uuid'));
});

test('unmarked historical and unrelated cohorts keep the legacy path; explicit markers always hold',async()=>{
 for(const input of [source(null,{orderedAt:new Date('2026-10-19T23:59:59.999Z')}),source(null,{connectionKey:'legacy-connection'}),{...source(null),raw:{source_id:13}}]){
  const db=repository();assert.equal(await rejectWebsiteCheckoutCorrelation(db,input,'run','91',sourceMap),false);assert.equal(db.issues.length,0);assert.equal(db.queries.length,0);
 }
 const db=repository();assert.equal(await rejectWebsiteCheckoutCorrelation(db,source(marker,{orderedAt:new Date('2020-01-01')}),'run','91',sourceMap),true);assert.equal(db.issues[0].code,'WEBSITE_CHECKOUT_AWAITING_DIRECT');
});

test('a marker cannot claim another site within an opted-in source cohort',async()=>{
 const db=repository();assert.equal(await rejectWebsiteCheckoutCorrelation(db,source('yo-checkout:v1:other.yoleotard.com:123'),'run','91',sourceMap),true);
 assert.equal(db.issues[0].code,'WEBSITE_CHECKOUT_SOURCE_MISMATCH');assert.equal(db.queries.length,0);
});

test('ambiguous provider source IDs cannot bypass an active opted-in connection through coercion',async()=>{
 const db=repository(),input=source(null);input.raw.source_id=[12];
 assert.equal(await rejectWebsiteCheckoutCorrelation(db,input,'run','91',sourceMap),true);assert.equal(db.issues[0].code,'WEBSITE_CHECKOUT_SOURCE_MISMATCH');assert.equal(db.queries.length,0);
});

test('invalid, duplicate or ambiguous source-map configuration fails closed without reflecting config',async()=>{
 const duplicateKeys='[{"connectionKey":"secret-config","connectionKey":"synthetic-connection","sourceId":"12","sourceAccount":"calendar.yoleotard.com","effectiveFrom":"2026-10-20T00:00:00Z"}]';
 for(const config of ['{','{}','[null]','\u00a0',JSON.stringify([cohort,cohort]),JSON.stringify([{...cohort,effectiveFrom:'2026-02-30T00:00:00Z'}]),JSON.stringify([{...cohort,effectiveFrom:'2026-10-20'}]),JSON.stringify([{...cohort,unexpected:true}]),duplicateKeys]){
  const db=repository();assert.equal(await rejectWebsiteCheckoutCorrelation(db,source(null),'run','91',config),true);assert.equal(db.issues[0].code,'WEBSITE_CHECKOUT_CONFIG_INVALID');assert.ok(!db.issues[0].message.includes(config));assert.equal(db.queries.length,0);
 }
});

const {KeycrmService}=loadTargetModule('keycrm/keycrm.service.ts');
function worker({mode='APPLY',sourceUuid=marker,matches=[],map='',linked=false,orderedAt='2026-10-20 12:00:00'}={}){
 const db=repository(matches),events=[],raw={...source(sourceUuid).raw,grand_total:'100.00',created_at:orderedAt,updated_at:'2026-10-21 12:00:00',buyer:{id:7,full_name:'Synthetic Buyer'},products:[]};
 const run={id:'run',mode,status:'RUNNING',leaseOwner:'worker',leaseUntil:new Date(Date.now()+60000),startedAt:new Date(),startedById:'synthetic-owner',configRevision:1,currentPage:1,pageSize:50,requestedFrom:null,requestedTo:new Date(),createdCount:0,updatedCount:0,skippedCount:0,failedCount:0,scannedCount:0,context:{targetOrderId:'91',sourcesComplete:true,sourceNames:{'12':'Website'},sourceCurrencies:{'12':'EUR'}}};
 db.$transaction=async callback=>callback(db);db.$executeRaw=async()=>{events.push('client-merge-global');return 0;};db.$executeRawUnsafe=async()=>0;db.$queryRaw=async()=>[];
 db.order.findUnique=async()=>{events.push('external-lookup');if(!linked)throw Error('Business lookup before hold');return {id:'linked',currency:'EUR',archivedAt:null,externalUpdatedAt:new Date('2027-01-01')};};
 const query=db.order.findMany;db.order.findMany=async args=>{events.push('direct-query');return query(args);};
 db.keycrmSyncIssue.findFirst=async()=>null;db.auditLog={create:async()=>({})};
 db.keycrmSyncRun={findUnique:async()=>run,update:async({data})=>{for(const [key,value] of Object.entries(data))run[key]=value&&typeof value==='object'&&'increment'in value?(run[key]??0)+value.increment:value;return run;}};
 const service=new KeycrmService(db,{capturePayment:async()=>assert.fail('held KeyCRM order cannot capture tax')});
 service.settings=async()=>({connectionKey:'synthetic-connection',configRevision:1,defaultCurrency:'EUR',defaultOrderType:'READY_MODEL'});
 service.client=async()=>({getImportOrder:async id=>{assert.equal(id,'91');return raw;},listOrders:async()=>assert.fail('single-order import must not fetch a bulk page')});
 return {...db,events,run,raw,service,async step(){const old=process.env.WEBSITE_ORDERS_KEYCRM_SOURCE_MAP;process.env.WEBSITE_ORDERS_KEYCRM_SOURCE_MAP=map;try{return await service.processStep(run.id,'worker');}finally{if(old===undefined)delete process.env.WEBSITE_ORDERS_KEYCRM_SOURCE_MAP;else process.env.WEBSITE_ORDERS_KEYCRM_SOURCE_MAP=old;}}};
}

for(const mode of ['DRY_RUN','APPLY'])for(const linked of [false,true])test(`native single-order worker holds reserved marker before any legacy/freshness path (${mode}, linked=${linked})`,async()=>{
 const w=worker({mode,linked});await w.step();
 assert.equal(w.run.status,'COMPLETED',JSON.stringify(w.issues));assert.equal(w.run.skippedCount,1);assert.equal(w.run.failedCount,0);assert.equal(w.issues[0].code,'WEBSITE_CHECKOUT_AWAITING_DIRECT');assert.ok(!w.events.includes('external-lookup'));
 if(mode==='APPLY')assert.ok(w.events.indexOf('client-merge-global')<w.events.indexOf('direct-query'));
});

test('native issue API hides raw provenance while retaining it in the repository',async()=>{
 const db=repository();await rejectWebsiteCheckoutCorrelation(db,source(),'run','91','');db.keycrmSyncIssue.findMany=async()=>db.issues;
 const service=new KeycrmService(db),view=await service.issues('run');
 assert.ok(!JSON.stringify(view).includes('synthetic-private@example.invalid'));assert.ok(!Object.hasOwn(view[0].details,'keycrmPayload'));assert.equal(db.issues[0].details.keycrmPayload.buyer.email,'synthetic-private@example.invalid');
});

for(const mode of ['DRY_RUN','APPLY'])test(`opted-in unmarked linked order is held before native freshness, historical import remains allowed (${mode})`,async()=>{
 const active=worker({mode,sourceUuid:null,map:sourceMap,linked:true});await active.step();assert.equal(active.run.status,'COMPLETED',JSON.stringify(active.issues));assert.equal(active.issues[0].code,'WEBSITE_CHECKOUT_MARKER_REQUIRED');assert.ok(!active.events.includes('external-lookup'));
 const historical=worker({mode,sourceUuid:null,map:sourceMap,linked:true,orderedAt:'2026-10-19 23:59:59'});await historical.step();assert.equal(historical.run.status,'COMPLETED',JSON.stringify(historical.issues));assert.equal(historical.issues.length,0);assert.ok(historical.events.includes('external-lookup'));
});

test('held raw image is not downloaded before canonical-source review',async t=>{
 const images=loadTargetModule('keycrm/keycrm-image.ts');t.mock.method(images,'materializeKeycrmOrderImage',async()=>assert.fail('held source must not download images'));
 const w=worker();w.raw.products=[{id:5,name:'Synthetic',price:'100.00',quantity:1,picture:{url:'https://example.invalid/private-image.jpg'}}];await w.step();assert.equal(w.run.status,'COMPLETED',JSON.stringify(w.issues));assert.equal(w.issues.length,1);assert.equal(w.issues[0].code,'WEBSITE_CHECKOUT_AWAITING_DIRECT');
});
