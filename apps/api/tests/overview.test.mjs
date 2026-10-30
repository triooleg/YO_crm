import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);require('reflect-metadata');
const modules=new Map();
function load(path){
 const filename=resolve(fileURLToPath(new URL('../src/',import.meta.url)),path);
 if(modules.has(filename))return modules.get(filename).exports;
 const module={exports:{}};modules.set(filename,module);
 const source=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
 const local=name=>name.startsWith('.')&&existsSync(resolve(dirname(filename),name+'.ts'))?load(resolve(dirname(filename),name+'.ts')):require(name);
 vm.runInThisContext(`(function(require,module,exports){${source}\n})`,{filename})(local,module,module.exports);return module.exports;
}
const model=load('overview/overview-order-model.ts');
const {OverviewService}=load('overview/overview.service.ts');
const {OverviewController}=load('overview/overview.controller.ts');
const {OverviewOrdersQueryDto}=load('overview/overview.dto.ts');
const NOW=new Date('2026-10-15T10:00:00Z');
const order=(extra={})=>({id:'o',type:'CUSTOM_ORDER',createdAt:new Date('2026-10-01T00:00:00Z'),sourceSystem:null,salesStatus:'NEW_LEAD',productionStatus:'NOT_SCHEDULED',paymentStatus:'UNPAID',shippingStatus:'NOT_READY',requiredDeliveryAt:new Date('2026-10-20T12:00:00Z'),priceMinor:10000,depositRequiredMinor:5000,currency:'EUR',items:[],payments:[],orderShipments:[],shipment:null,deadlineEvidence:[],...extra});

test('shared operational classification excludes planning, distrusts imported old deadlines and never calls shipping complete prematurely',()=>{
 assert.equal(model.classifyOverviewOrder(order({productionStatus:'SCHEDULED'}),NOW).work,false);
 assert.equal(model.classifyOverviewOrder(order({productionStatus:'SEWING'}),NOW).work,true);
 const imported=order({sourceSystem:'KEYCRM',requiredDeliveryAt:new Date('2020-01-01')});
 assert.equal(model.classifyOverviewOrder(imported,NOW).overdue,false);
 assert.equal(model.classifyOverviewOrder(imported,NOW).requiresVerification,true);
 assert.equal(model.classifyOverviewOrder(imported,NOW).bucket,null);
 const tracked=order({shipment:{trackingNumber:'TRACK'},productionStatus:'READY'});
 assert.equal(model.classifyOverviewOrder(tracked,NOW).ready,false);
 assert.equal(model.classifyOverviewOrder(tracked,NOW).bucket,null);
});

test('exclusive ring priority and operational readiness respect complete item aggregates, payment evidence and terminal shipping exceptions',()=>{
 const ready=order({productionStatus:'READY',items:[{productionStatus:'READY',instances:[{productionStatus:'READY'},{productionStatus:'READY'}]}]});
 assert.equal(model.classifyOverviewOrder(ready,NOW).bucket,'ready'); // Ready beats awaiting payment.
 const partial={...ready,items:[{productionStatus:'READY',instances:[{productionStatus:'READY'},{productionStatus:'SEWING'}]}]};
 assert.equal(model.classifyOverviewOrder(partial,NOW).ready,false);
 assert.equal(model.classifyOverviewOrder(partial,NOW).bucket,'work');
 assert.equal(model.classifyOverviewOrder(order(),NOW).bucket,'awaiting');
 assert.equal(model.classifyOverviewOrder(order({payments:[{amountMinor:5000,currency:'EUR'}]}),NOW).bucket,'new');
 assert.equal(model.classifyOverviewOrder(order({salesStatus:'COMPLETED',productionStatus:'READY'}),NOW).bucket,'completed');
 for(const shippingStatus of ['SHIPPED','IN_TRANSIT','RETURNED','LOST'])assert.equal(model.classifyOverviewOrder(order({shippingStatus,productionStatus:'READY'}),NOW).bucket,null);
 assert.equal(model.classifyOverviewOrder(order({shippingStatus:'LOST',salesStatus:'DELIVERED'}),NOW).bucket,null);
 assert.equal(model.classifyOverviewOrder(order({salesStatus:'CANCELLED'}),NOW).unpaid,false);
 assert.equal(model.classifyOverviewOrder(order({type:'WEBSITE_SALE',productionStatus:'SEWING'}),NOW).work,false);
 const unknown=order({payments:[{amountMinor:1000,currency:'USD',appliedCurrency:null,appliedAmountMinor:null}]});
 assert.equal(model.classifyOverviewOrder(unknown,NOW).requiresVerification,true);
 assert.equal(model.classifyOverviewOrder(unknown,NOW).unpaid,false);
});

test('only matching manual deadline evidence upgrades a KeyCRM deadline; Kyiv today excludes today from overdue',()=>{
 const imported=order({sourceSystem:'KEYCRM',requiredDeliveryAt:new Date('2026-10-14T12:00:00Z')});
 const old={metadata:{requiredDeliveryAt:'2026-10-10T12:00:00Z'}},current={metadata:{requiredDeliveryAt:'2026-10-14T12:00:00Z'}};
 assert.equal(model.classifyOverviewOrder({...imported,deadlineEvidence:[old]},NOW).overdue,false);
 assert.equal(model.classifyOverviewOrder({...imported,deadlineEvidence:[current]},NOW).overdue,true);
 assert.equal(model.classifyOverviewOrder({...imported,productionStatus:'SCHEDULED'},NOW).overdue,false);
 assert.equal(model.classifyOverviewOrder(order({requiredDeliveryAt:new Date('2026-10-15T00:00:00Z')}),NOW).overdue,false);
 assert.equal(model.classifyOverviewOrder(order({requiredDeliveryAt:new Date('2026-10-14T23:00:00Z')}),new Date('2026-10-14T22:00:00Z')).overdue,true);
});

test('partial dispatch retains unfinished production and debt/deadline flags, while tracking-only legacy orders are dispatched',()=>{
 const parcel=(id,status)=>({id,status,carrier:'DHL',trackingNumber:null,shippedAt:null,deliveredAt:null});
 const mixed=order({shippingStatus:'SHIPPED',salesStatus:'SHIPPED',requiredDeliveryAt:new Date('2026-10-14'),orderShipments:[parcel('sent','SHIPPED'),parcel('remaining','NOT_READY')],items:[{productionStatus:'SEWING',instances:[{productionStatus:'READY'},{productionStatus:'SEWING'}]}]});
 const state=model.classifyOverviewOrder(mixed,NOW);
 assert.equal(state.dispatched,false);assert.equal(state.partiallyDispatched,true);assert.equal(state.work,true);assert.equal(state.ready,false);assert.equal(state.unpaid,true);assert.equal(state.overdue,true);assert.equal(state.bucket,'work');
 assert.equal(model.classifyOverviewOrder({...mixed,shippingStatus:'DELIVERED',salesStatus:'DELIVERED'},NOW).completed,false);
 const partialReady=model.classifyOverviewOrder({...mixed,items:[{productionStatus:'READY',instances:[]}],payments:[{currency:'EUR',amountMinor:10000}]},NOW);
 assert.equal(partialReady.ready,false);assert.notEqual(partialReady.bucket,'new');
 const allSent=model.classifyOverviewOrder({...mixed,items:[{quantity:2,productionStatus:'SEWING',instances:[{id:'a',productionStatus:'READY'},{id:'b',productionStatus:'SEWING'}]}],orderShipments:[{...parcel('sent','SHIPPED'),instances:[{id:'a'}]},{...parcel('remaining','IN_TRANSIT'),instances:[{id:'b'}]}]},NOW);
 assert.equal(allSent.dispatched,true);assert.equal(allSent.work,false);assert.equal(allSent.unpaid,false);assert.equal(allSent.overdue,false);
 const tracked=model.classifyOverviewOrder(order({deliveryTrackingCode:' IMPORT-TRACK ',productionStatus:'SEWING'}),NOW);
 assert.equal(tracked.dispatched,true);assert.equal(tracked.work,false);assert.equal(tracked.bucket,null);
 assert.equal(model.overviewOrderSourceSelect.deliveryTrackingCode,true);
});

test('cancelled production and exceptional parent shipping never forecast even with an unsent active parcel',()=>{
 const parcel={id:'pending',status:'READY',carrier:'DHL',trackingNumber:null,shippedAt:null,deliveredAt:null};
 for(const extra of [{productionStatus:'CANCELLED'},{shippingStatus:'RETURNED'},{shippingStatus:'LOST'},{deliveryTrackingCode:'TRACK'}]){
  const source=order({...extra,orderShipments:extra.deliveryTrackingCode?[]:[parcel]});
  assert.deepEqual(model.eligibleUpcomingShipmentRecords([source],{horizon:7},NOW),[]);
 }
});

for(const terminalStatus of ['LOST','RETURNED'])test(`a ${terminalStatus} child does not hide remaining production or its pending shipment`,async()=>{
 const parcel=(id,status)=>({id,status,carrier:'DHL',trackingNumber:null,shippedAt:null,deliveredAt:null});
 const mixed=order({id:'mixed',productionStatus:'SEWING',shippingStatus:'NOT_READY',requiredDeliveryAt:new Date('2026-10-16T12:00:00Z'),items:[{productionStatus:'SEWING',instances:[{productionStatus:'READY'},{productionStatus:'SEWING'}]}],orderShipments:[parcel('exception',terminalStatus),parcel('remaining','NOT_READY')]});
 const state=model.classifyOverviewOrder(mixed,NOW);
 assert.equal(state.work,true);assert.equal(state.bucket,'work');assert.equal(state.dispatched,false);assert.equal(state.partiallyDispatched,true);assert.equal(state.completed,false);assert.equal(state.ready,false);
 assert.equal(state.requiresVerification,true);
 const fixture=sourceDb([mixed]),service=new OverviewService(fixture.db);
 const report=await service.orders({month:'2026-10',currency:'EUR'},NOW);
 assert.equal(report.counts.work,1);assert.equal(report.ring.segments.find(segment=>segment.key==='work').count,1);
 assert.deepEqual(await model.resolveOverviewOrderIds(fixture.tx,{overviewFilter:'work'},NOW),['mixed']);
 const shipments=await service.shipments(NOW);
 assert.equal(shipments.count7,1);assert.deepEqual(shipments.rows.map(row=>row.shipmentId),['remaining']);
 assert.deepEqual(await model.resolveOverviewShippingOrderIds(fixture.tx,{horizon:7},NOW),['mixed']);
 for(const parent of [{shippingStatus:'LOST'},{shippingStatus:'RETURNED'},{salesStatus:'COMPLETED'},{salesStatus:'DELIVERED'},{salesStatus:'REVIEW_REQUESTED'},{salesStatus:'CANCELLED'},{productionStatus:'CANCELLED'},{paymentStatus:'REFUNDED'}]){
  const closed={...mixed,...parent};
  assert.equal(model.classifyOverviewOrder(closed,NOW).work,false);
  assert.equal(model.classifyOverviewOrder(closed,NOW).bucket,null);
  assert.deepEqual(model.eligibleUpcomingShipmentRecords([closed],{horizon:7},NOW),[]);
 }
});

function sourceDb(orders){
 const calls=[];
 const tx={
  order:{findMany:async query=>{
   calls.push(['order',query]);
   let rows=orders.filter(o=>!o.archivedAt);
   if(query.where?.id?.in)rows=rows.filter(o=>query.where.id.in.includes(o.id));
   if(query.select.activities){
    rows=[...rows].sort((a,b)=>a.id.localeCompare(b.id));
    if(query.cursor)rows=rows.filter(o=>o.id>query.cursor.id);
    return rows.slice(0,query.take).map(o=>({...o,activities:o.deadlineEvidence}));
   }
   if(query.orderBy?.[0]?.createdAt)rows=[...rows].sort((a,b)=>b.createdAt-a.createdAt||b.id.localeCompare(a.id));
   return rows.slice(0,query.take??rows.length).map(o=>({...o,number:`YO-${o.id}`,client:{displayName:`Client ${o.id}`},modelImagePath:o.overviewModelImagePath===undefined?'model.jpg':o.overviewModelImagePath,externalImageUrl:o.overviewExternalImageUrl??null,items:o.overviewItems??[{modelImagePath:'item.jpg',externalImageUrl:null}]}));
  }},
  appSetting:{findMany:async()=>[]},
  $queryRaw:async()=>[{month:'2026-10',count:3n}],
 };
 const db={$transaction:async(callback,options)=>{calls.push(['transaction',options]);return callback(tx)}};
 return {db,tx,calls};
}

test('overview service counts, exclusive ring and every target-filter ID set agree; period is original creation month',async()=>{
 const orders=[order({id:'new',payments:[{amountMinor:5000,currency:'EUR'}],sourceSystem:'YOLEOTARD_WEBSITE',sourceAccount:'store',sourceLinkMode:'IMPORTED',externalId:'22727',externalData:{contractVersion:1}}),order({id:'work',productionStatus:'SEWING'}),order({id:'ready',productionStatus:'READY'}),order({id:'awaiting'}),order({id:'completed',salesStatus:'COMPLETED'}),order({id:'sent',shippingStatus:'SHIPPED'}),order({id:'cancelled',salesStatus:'CANCELLED'}),order({id:'import',sourceSystem:'KEYCRM',createdAt:new Date('2020-01-01'),requiredDeliveryAt:new Date('2020-01-01')}),order({id:'prior',createdAt:new Date('2026-09-30T23:59:59Z'),productionStatus:'SEWING'}),order({id:'archived',archivedAt:NOW})];
 const fixture=sourceDb(orders),result=await new OverviewService(fixture.db).orders({month:'2026-10',range:3,currency:'EUR'},NOW);
 assert.equal(result.counts.total,7);assert.equal(result.counts.previousTotal,1);
 assert.equal(result.ring.total,5);assert.equal(result.ring.excluded,2);
 assert.equal(result.counts.total,result.ring.total+result.ring.excluded);
 assert.equal(result.counts.work,2);assert.equal(result.counts.requiresVerification,1);
 assert.equal(result.counts.overdue,0);assert.equal(result.trend.at(-1).clients,3);
 assert.equal(result.recent.length,5);assert.equal(result.recent[0].modelImagePath,'model.jpg');
 assert.equal(result.recent.find(row=>row.id==='new').orderSource,'WEBSITE');
 for(const segment of result.ring.segments){
  const ids=await model.resolveOverviewOrderIds(fixture.tx,{overviewFilter:segment.key,period:'2026-10'},NOW);
  assert.equal(ids.length,segment.count);
 }
 assert.equal((await model.resolveOverviewOrderIds(fixture.tx,{overviewFilter:'period',period:'2026-10'},NOW)).length,result.counts.total);
 assert.equal((await model.resolveOverviewOrderIds(fixture.tx,{overviewFilter:'work'},NOW)).length,result.counts.work);
 assert.equal((await model.resolveOverviewOrderIds(fixture.tx,{overviewFilter:'ready'},NOW)).length,result.counts.ready);
 assert.equal((await model.resolveOverviewOrderIds(fixture.tx,{overviewFilter:'overdue'},NOW)).length,result.counts.overdue);
 assert.equal((await model.resolveOverviewOrderIds(fixture.tx,{overviewFilter:'unpaid'},NOW)).length,result.counts.awaitingPayment);
 assert.equal(fixture.calls[0][1].isolationLevel,'RepeatableRead');
});

test('recent website orders use their persisted external product image when no local model image exists',async()=>{
 const image='https://yoleotard.com/wp-content/uploads/order.jpg';
 const website=order({id:'website',sourceSystem:'YOLEOTARD_WEBSITE',sourceAccount:'store',sourceLinkMode:'IMPORTED',externalId:'22733',externalData:{contractVersion:1},overviewModelImagePath:null,overviewExternalImageUrl:image,overviewItems:[{modelImagePath:null,externalImageUrl:image}]});
 const result=await new OverviewService(sourceDb([website]).db).orders({month:'2026-10',currency:'EUR'},NOW);
 assert.equal(result.recent[0].orderSource,'WEBSITE');
 assert.equal(result.recent[0].modelImagePath,image);
});

test('changing the reporting source does not revoke a website order external product image',async()=>{
 const image='https://yoleotard.com/wp-content/uploads/order.jpg';
 const website=order({id:'website-override',sourceSystem:'YOLEOTARD_WEBSITE',sourceAccount:'store',sourceLinkMode:'IMPORTED',externalId:'22735',externalData:{contractVersion:1},deadlineEvidence:[{type:'ORDER_SOURCE_OVERRIDDEN',metadata:{source:'WHATSAPP'}}],overviewModelImagePath:null,overviewExternalImageUrl:image,overviewItems:[{modelImagePath:null,externalImageUrl:image}]});
 const result=await new OverviewService(sourceDb([website]).db).orders({month:'2026-10',currency:'EUR'},NOW);
 assert.equal(result.recent[0].orderSource,'WHATSAPP');
 assert.equal(result.recent[0].modelImagePath,image);
});

test('recent orders prefer a later local item image over an earlier website image',async()=>{
 const website=order({id:'website-priority',sourceSystem:'YOLEOTARD_WEBSITE',sourceAccount:'store',sourceLinkMode:'IMPORTED',externalId:'22734',externalData:{contractVersion:1},overviewModelImagePath:null,overviewExternalImageUrl:null,overviewItems:[{modelImagePath:null,externalImageUrl:'https://yoleotard.com/external.jpg'},{modelImagePath:'approved-local.jpg',externalImageUrl:null}]});
 const result=await new OverviewService(sourceDb([website]).db).orders({month:'2026-10',currency:'EUR'},NOW);
 assert.equal(result.recent[0].modelImagePath,'approved-local.jpg');
});

test('source batches cross 500 without gaps; invalid filters, horizons and report dates reject before database reads',async()=>{
 const fixture=sourceDb(Array.from({length:501},(_,i)=>order({id:String(i).padStart(4,'0')})));
 assert.equal((await model.resolveOverviewOrderIds(fixture.tx,{overviewFilter:'period',period:'2026-10'},NOW)).length,501);
 const queries=fixture.calls.filter(row=>row[0]==='order');assert.equal(queries.length,2);assert.equal(queries[0][1].take,500);assert.equal(queries[1][1].cursor.id,'0499');
 let reads=0;const forbidden={order:{findMany:async()=>{reads++;throw Error('read')}}};
 for(const input of [{overviewFilter:'bad'},{overviewFilter:'period',period:'2026-13'},{overviewFilter:'work',period:'2026-00'}])await assert.rejects(model.resolveOverviewOrderIds(forbidden,input,NOW),error=>error.getStatus()===400);
 await assert.rejects(model.resolveOverviewShippingOrderIds(forbidden,{horizon:8},NOW),error=>error.getStatus()===400);
 let transactions=0;const service=new OverviewService({$transaction:()=>{transactions++;throw Error('read')}});
 for(const input of [{month:'2026-13'},{range:4},{currency:'GBP'}])await assert.rejects(service.orders(input,NOW),error=>error.getStatus()===400);
 assert.equal(reads,0);assert.equal(transactions,0);
});

test('raw Orders period rejects query arrays and other nonstrings with 400 before reads',async()=>{
 let reads=0;const forbidden={order:{findMany:async()=>{reads++;throw Error('read')}}};
 for(const period of [['2026-10'],['2026-10','2026-11'],202610,{},null]){
  assert.throws(()=>model.validateOverviewPeriod(period,NOW),error=>error.getStatus?.()===400);
  await assert.rejects(model.resolveOverviewOrderIds(forbidden,{overviewFilter:'period',period},NOW),error=>error.getStatus?.()===400);
 }
 assert.equal(reads,0);
});

test('missing FX preserves operational counts and original recent amounts, without refreshing rates or recomputing cash',async()=>{
 const fixture=sourceDb([order({currency:'USD'})]);
 const result=await new OverviewService(fixture.db).orders({month:'2026-10',currency:'EUR'},NOW);
 assert.equal(result.counts.total,1);assert.equal(result.recent[0].amountMinor,null);
 assert.equal(result.recent[0].originalAmountMinor,10000);assert.equal(result.recent[0].originalCurrency,'USD');assert.match(result.valuationError,/курс/);
 assert.equal('receivedMinor' in result,false);
});

test('upcoming uses exact unsent parcels, excludes legacy duplicates, untrusted dates and day seven; navigation IDs match count7',async()=>{
 const parcel=(id,status)=>({id,status,carrier:'DHL',trackingNumber:null,shippedAt:null,deliveredAt:null});
 const orders=[order({id:'partial',requiredDeliveryAt:new Date('2026-10-16'),orderShipments:[parcel('sent','SHIPPED'),parcel('pending','READY')],shipment:{trackingNumber:'LEGACY'}}),order({id:'legacy',requiredDeliveryAt:new Date('2026-10-15')}),order({id:'far',requiredDeliveryAt:new Date('2026-10-22')}),order({id:'unknown',sourceSystem:'KEYCRM',requiredDeliveryAt:new Date('2026-10-16')}),order({id:'closed',salesStatus:'COMPLETED'})];
 const fixture=sourceDb(orders),result=await new OverviewService(fixture.db).shipments(NOW);
 assert.equal(result.count7,2);assert.equal(result.requiresVerification,1);
 assert.deepEqual(result.rows.map(row=>row.id),['legacy','pending','far']);
 assert.equal(result.rows.find(row=>row.id==='pending').shipmentId,'pending');
 assert.equal(result.rows.find(row=>row.id==='legacy').shipmentId,null);
 assert.ok(result.rows.every(row=>row.forecast===true));
 assert.deepEqual(await model.resolveOverviewShippingOrderIds(fixture.tx,{horizon:7},NOW),['legacy','partial']);
});

test('tasks read only the current assignee, five unfinished tasks and existing done column without creating a board',async()=>{
 let taskQuery,columnQuery;
 const tx={taskColumn:{findFirst:async query=>{columnQuery=query;return null}},workTask:{findMany:async query=>{taskQuery=query;return [{id:'t',title:'Task',columnId:'todo',dueAt:NOW,client:{displayName:'Client'}}]}}};
 const service=new OverviewService({$transaction:callback=>callback(tx)}),result=await service.tasks('current-user');
 assert.equal(taskQuery.where.assigneeId,'current-user');assert.equal(taskQuery.take,5);assert.equal(taskQuery.where.column.isDone,false);assert.equal(taskQuery.where.completedAt,null);assert.equal(taskQuery.orderBy[0].dueAt.nulls,'last');
 assert.equal(columnQuery.where.archivedAt,null);assert.equal(result.doneColumnId,null);assert.equal(result.userId,'current-user');assert.equal(result.rows[0].orderId,null);assert.equal(result.rows[0].orderNumber,null);
});

test('controller enforces real session/role guards on all read handlers and forwards task identity from authenticated user',async()=>{
 const {Reflector}=require('@nestjs/core'),{RolesGuard}=load('auth/roles.guard.ts'),{SessionGuard}=load('auth/session.guard.ts');
 const {GUARDS_METADATA,METHOD_METADATA,PATH_METADATA}=require('@nestjs/common/constants');
 const {ValidationPipe,RequestMethod}=require('@nestjs/common');
 const guard=new RolesGuard(new Reflector());
 const classes=Reflect.getMetadata(GUARDS_METADATA,OverviewController);assert.ok(classes.includes(SessionGuard)&&classes.includes(RolesGuard));
 for(const method of ['orders','tasks','messages','shipments']){
  const handler=OverviewController.prototype[method];assert.equal(Reflect.getMetadata(METHOD_METADATA,handler),RequestMethod.GET);assert.equal(Reflect.getMetadata(PATH_METADATA,handler),method);
  for(const role of ['OWNER','ADMIN','MANAGER','PRODUCTION','ACCOUNTANT']){
   const context={getHandler:()=>handler,getClass:()=>OverviewController,switchToHttp:()=>({getRequest:()=>({user:{id:'me',role}})})};
   if(['OWNER','ADMIN','MANAGER'].includes(role)||(method==='tasks'&&role==='PRODUCTION'))assert.equal(guard.canActivate(context),true);else assert.throws(()=>guard.canActivate(context),error=>error.getStatus()===403);
  }
 }
 const controller=new OverviewController({tasks:id=>({userId:id})});assert.equal(controller.tasks({user:{id:'auth-user'}}).userId,'auth-user');
 const pipe=new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true});
 assert.equal((await pipe.transform({range:'6',month:'2026-10',currency:'USD'},{type:'query',metatype:OverviewOrdersQueryDto})).range,6);
 await assert.rejects(pipe.transform({range:'4'},{type:'query',metatype:OverviewOrdersQueryDto}),error=>error.getStatus()===400);
});

test('real message SQL excludes drafts, reactions, deleted/dedup/spam/archive and uses delivered chronology with exact dialogs',async()=>{
 const {PGlite}=createRequire(new URL('../../../packages/database/package.json',import.meta.url))('@electric-sql/pglite');
 const db=new PGlite();
 try{
  await db.exec(`CREATE TABLE "Client" (id text,"displayName" text,"avatarUrl" text,"archivedAt" timestamp,"inboxSpamAt" timestamp);CREATE TABLE "Conversation" (id text,"clientId" text,channel text,"unreadCount" int,"archivedAt" timestamp);CREATE TABLE "Message" (id text,"conversationId" text,direction text,status text,content text,"createdAt" timestamp,"sentAt" timestamp,"receivedAt" timestamp,"messageType" text,metadata jsonb);`);
  await db.exec(`INSERT INTO "Client" VALUES ('client','Visible',NULL,NULL,NULL),('spam','Spam',NULL,NULL,NOW()),('archive','Archived',NULL,NOW(),NULL);INSERT INTO "Conversation" VALUES ('ig','client','INSTAGRAM',3,NULL),('fb','client','FACEBOOK',4,NULL),('spam','spam','INSTAGRAM',99,NULL),('archive','archive','INSTAGRAM',99,NULL);`);
  const add=async(id,conversationId,direction,status,content,createdAt,sentAt=null,type='text',metadata=null)=>db.query(`INSERT INTO "Message" VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9)`,[id,conversationId,direction,status,content,createdAt,sentAt,type,metadata]);
  await add('incoming','ig','INBOUND','RECEIVED','Incoming','2026-10-15T10:00:00');
  await db.query(`UPDATE "Message" SET "createdAt"='2026-10-01T10:00:00',"receivedAt"='2026-10-15T10:00:00' WHERE id='incoming'`);
  await add('sent','ig','OUTBOUND','SENT','Actual late delivery','2026-10-01T10:00:00','2026-10-15T11:00:00');
  await add('draft','ig','OUTBOUND','DRAFT','Private draft','2026-10-16T10:00:00');
  await add('failed','ig','OUTBOUND','FAILED','Failed','2026-10-16T10:00:00');
  await add('reaction','ig','INBOUND','RECEIVED','Reaction','2026-10-16T10:00:00',null,'reaction');
  await add('deleted','ig','INBOUND','RECEIVED','Deleted','2026-10-16T10:00:00',null,'text',{deletion:{deletedAt:'2026-10-16'}});
  await add('dedup','ig','OUTBOUND','SENT','Duplicate draft','2026-10-16T10:00:00',null,'text',{deduplicatedIntoMessageId:'sent'});
  await add('fb-message','fb','INBOUND','RECEIVED','Other exact channel','2026-10-15T09:00:00');
  await add('spam-message','spam','INBOUND','RECEIVED','Spam','2026-10-17T09:00:00');
  await add('archive-message','archive','INBOUND','RECEIVED','Archived','2026-10-17T09:00:00');
  const tx={conversation:{aggregate:async query=>{assert.equal(query.where.client.inboxSpamAt,null);assert.equal(query.where.archivedAt,null);return {_sum:{unreadCount:7}}}},$queryRaw:async query=>(await db.query(query.text,query.values)).rows};
  const result=await new OverviewService({$transaction:callback=>callback(tx)}).messages();
  assert.equal(result.unreadCount,7);assert.equal(result.rows.length,2);assert.equal(result.rows[0].conversationId,'ig');assert.equal(result.rows[0].preview,'Actual late delivery');assert.equal(result.rows[0].at,'2026-10-15T11:00:00.000Z');assert.equal(result.rows[1].conversationId,'fb');
  for(let index=0;index<6;index++){
   await db.query(`INSERT INTO "Conversation" VALUES ($1,'client','EMAIL',0,NULL)`,['extra'+index]);
   await add('extra'+index,'extra'+index,'INBOUND','RECEIVED','Other real dialog','2026-10-15T08:00:00');
  }
  const limited=await new OverviewService({$transaction:callback=>callback(tx)}).messages();
  assert.deepEqual(limited.rows.map(row=>row.conversationId),['ig','fb','extra0','extra1','extra2']);
 }finally{await db.close();}
});
