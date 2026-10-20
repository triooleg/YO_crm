import assert from 'node:assert/strict';
import test from 'node:test';
import {loadTargetModule} from './overview-target-loader.mjs';
const {OrderMeasurementAssignmentsService}=loadTargetModule('orders/order-measurement-assignments.service.ts');
const {OrderTabsService}=loadTargetModule('orders/order-tabs.service.ts');
const {OrdersService}=loadTargetModule('orders/orders.service.ts');
const stamp='2026-10-19T10:00:00.000Z';
const actor={id:'owner'};
const fields={measuredAt:stamp,m1:80,m2:65,m3:85,m15:140};
function fixture(options={}) {
 const order={id:'order',number:'YO-1',type:'CUSTOM_ORDER',clientId:'client',athleteId:'athlete',measurementId:'old',salesStatus:'CONFIRMED',productionStatus:'SEWING',shippingStatus:'NOT_SHIPPED',depositRequiredMinor:0,payments:[],...options.order};
 const item={id:'item',orderId:'order',name:'Solo',quantity:1,athleteId:'athlete',measurementId:'old',productionStatus:'NOT_SCHEDULED',...options.item};
 const instance={id:'instance',orderItemId:'item',ordinal:1,athleteId:'athlete',measurementId:'old',updatedAt:new Date(stamp),productionStatus:'SEWING',archivedAt:null,startedAt:null,completedAt:null,orderShipment:null,...options.instance};
 order.items=options.rootOnly?[]:[item];
 const definitions={old:null,next:'PARENT_BODY_V1',...options.definitions};
 const state={instances:[instance,...(options.extraInstances??[])],snapshots:[],audits:[],activities:[],writes:0};
 const tx={
  $executeRaw:async()=>{},$executeRawUnsafe:async()=>{},$queryRaw:async()=>[],
  client:{findFirst:async()=>({id:'client'})},athlete:{findFirst:async()=>({id:'athlete',firstName:'Anna'})},
  order:{findFirst:async()=>structuredClone(order),update:async({data})=>{state.writes++;return {...order,...data}}},
  orderItem:{findFirst:async()=>({...item,order}),update:async({data})=>{state.writes++;return {...item,...data}}},
  measurement:{findFirst:async({where})=>where.id in definitions?{id:where.id,athleteId:'athlete',definitionVersion:definitions[where.id],archivedAt:null}:null,
   create:async({data})=>{state.writes++;const row={id:'created',...data};state.snapshots.push(row);return row}},
  orderItemInstance:{
   findFirst:async({where})=>{const row=state.instances.find(row=>row.id===where.id);return row?structuredClone({...row,orderItem:{...item,order}}):null},
   findMany:async({where})=>structuredClone(state.instances.filter(row=>(!where.orderItemId||row.orderItemId===where.orderItemId)&&(where.athleteId===undefined||row.athleteId===where.athleteId)&&(where.measurementId===undefined||row.measurementId===where.measurementId))),
   findUniqueOrThrow:async({where})=>structuredClone(state.instances.find(row=>row.id===where.id)),
   updateMany:async({where,data})=>{if(options.casMiss||where.id===options.failCasAt)return {count:0};let count=0;for(const row of state.instances){if(where.id&&row.id!==where.id)continue;if(where.orderItemId&&row.orderItemId!==where.orderItemId)continue;if(where.athleteId!==undefined&&row.athleteId!==where.athleteId)continue;if(where.measurementId!==undefined&&row.measurementId!==where.measurementId)continue;if(where.updatedAt&&row.updatedAt.getTime()!==where.updatedAt.getTime())continue;Object.assign(row,data,{updatedAt:new Date('2026-10-19T10:01:00Z')});count++;state.writes++}return {count}},
   update:async({where,data})=>{const row=state.instances.find(row=>row.id===where.id);if(options.casMiss||where.updatedAt&&row.updatedAt.getTime()!==where.updatedAt.getTime())throw Object.assign(new Error('not found'),{code:'P2025'});Object.assign(row,data,{updatedAt:new Date('2026-10-19T10:01:00Z')});state.writes++;return row},
   create:async()=>{throw new Error('unexpected instance creation')}
  },
  activity:{create:async({data})=>{state.activities.push(data)}},auditLog:{create:async({data})=>{state.audits.push(data)}}
 };
 const attempts=[];
 for(const [model,methods] of Object.entries({order:['update'],orderItem:['update'],measurement:['create'],orderItemInstance:['create','update','updateMany'],activity:['create'],auditLog:['create']}))for(const method of methods){const original=tx[model][method];tx[model][method]=async(...args)=>{attempts.push(model+'.'+method);return original(...args)}}
 const prisma={$transaction:async callback=>{const previous=structuredClone(state);try{return await callback(tx)}catch(error){Object.assign(state,previous);throw error}}};
 return {state,attempts,bulk:new OrderMeasurementAssignmentsService(prisma),tabs:new OrderTabsService(prisma),orders:new OrdersService(prisma,{}),tx};
}
const targets=[{id:'instance',expectedUpdatedAt:stamp}];
const bulkInput={targets,athleteId:'athlete',measurementId:'next'};
test('bulk parent-body WIP rejects without confirmation before any writes',async()=>{
 const f=fixture();await assert.rejects(f.bulk.assign('order',bulkInput,actor),/Подтвердите/);assert.equal(f.state.writes,0);assert.deepEqual(f.attempts,[]);assert.equal(f.state.audits.length,0);
});
const editInput={...fields,expectedMeasurementId:'old',expectedUpdatedAt:stamp};
const updateInput={measurementId:'next',expectedUpdatedAt:stamp};
for(const [name,invoke] of [
 ['instance snapshot',f=>f.tabs.addInstanceMeasurement('order','instance',editInput,actor)],
 ['direct instance',f=>f.tabs.updateInstance('order','instance',updateInput,actor)],
 ['cohort bind',f=>f.orders.bindItemMeasurement('order','item',{measurementId:'next',expectedMeasurementId:'old'},actor)],
 ['cohort item snapshot',f=>f.orders.addItemMeasurement('order','item',editInput,actor)],
 ['cohort root snapshot',f=>f.orders.addMeasurement('order',editInput,actor)],
 ['root-only snapshot',f=>f.orders.addMeasurement('order',editInput,actor)],
])test(name+' rejects parent-body WIP before creating snapshot or writing',async()=>{
 const f=fixture({definitions:{old:'PARENT_BODY_V1'},rootOnly:name==='root-only snapshot'});
 await assert.rejects(invoke(f),/Подтвердите|явное назначение/);assert.equal(f.state.writes,0);assert.deepEqual(f.attempts,[]);assert.equal(f.state.snapshots.length,0);assert.equal(f.state.audits.length,0);
});

const confirmation={confirmProduction:true,reason:'  Уточнены мерки после согласования  '};
const enabled={
 bulk:(f,input)=>f.bulk.assign('order',{...bulkInput,...input},actor),
 snapshot:(f,input)=>f.tabs.addInstanceMeasurement('order','instance',{...editInput,...input},actor),
 direct:(f,input)=>f.tabs.updateInstance('order','instance',{...updateInput,...input},actor),
};
for(const [name,invoke] of Object.entries(enabled)) {
 for(const invalid of [{},{confirmProduction:false,reason:'reason'},{confirmProduction:'true',reason:'reason'},{confirmProduction:true,reason:''},{confirmProduction:true,reason:'   '},{confirmProduction:true,reason:'x'.repeat(2001)}])test(`${name}: invalid confirmation ${JSON.stringify(invalid).slice(0,90)} rejects`,async()=>{
  const f=fixture({definitions:{old:'PARENT_BODY_V1'}});await assert.rejects(invoke(f,invalid),/Подтвердите/);assert.deepEqual(f.attempts,[]);
 });
 test(name+': confirmation succeeds and same-transaction audit binds old/new linkage and versions',async()=>{
  const f=fixture({definitions:{old:'PARENT_BODY_V1'}});await invoke(f,confirmation);
  const audit=f.state.audits.find(row=>row.entityType==='OrderItemInstance');
  assert.equal(audit.before.measurementId,'old');assert.equal(new Date(audit.before.updatedAt).toISOString(),stamp);
  assert.equal(audit.after.measurementId,name==='snapshot'?'created':'next');
  assert.deepEqual(JSON.parse(JSON.stringify(audit.after.productionConfirmation)),{confirmProduction:true,reason:'Уточнены мерки после согласования'});
  assert.ok(new Date(audit.after.updatedAt).getTime()>new Date(stamp).getTime());
 });
 test(name+': stale CAS rejects confirmed request before any writes',async()=>{
  const f=fixture({definitions:{old:'PARENT_BODY_V1'},instance:{updatedAt:new Date('2026-10-19T10:02:00Z')}});
  await assert.rejects(invoke(f,confirmation),/уже измен/);assert.deepEqual(f.attempts,[]);
 });
 test(name+': lost update CAS rolls back snapshots and audit',async()=>{
  const f=fixture({definitions:{old:'PARENT_BODY_V1'},casMiss:true});await assert.rejects(invoke(f,confirmation),/уже измен/);
  assert.equal(f.state.writes,0);assert.equal(f.state.snapshots.length,0);assert.equal(f.state.audits.length,0);
 });
 for(const productionStatus of ['SEWING','CUTTING','MATERIALS','DECORATION','QUALITY_CONTROL'])test(`${name}: ${productionStatus} requires confirmation`,async()=>{
  const f=fixture({definitions:{old:'PARENT_BODY_V1'},instance:{productionStatus}});await assert.rejects(invoke(f,{}),/Подтвердите/);assert.deepEqual(f.attempts,[]);
 });
 for(const productionStatus of ['NOT_SCHEDULED','TENTATIVE','SCHEDULED']) {
  test(`${name}: ${productionStatus} without startedAt allows parent-body change`,async()=>{const f=fixture({definitions:{old:'PARENT_BODY_V1'},instance:{productionStatus}});await invoke(f,{});assert.ok(f.state.writes>0)});
  test(`${name}: ${productionStatus} with startedAt requires confirmation`,async()=>{const f=fixture({definitions:{old:'PARENT_BODY_V1'},instance:{productionStatus,startedAt:new Date(stamp)}});await assert.rejects(invoke(f,{}),/Подтвердите/);assert.deepEqual(f.attempts,[])});
 }
 test(name+': legacy-to-legacy WIP preserves baseline',async()=>{const f=fixture({definitions:{old:null,next:null}});await invoke(f,{});assert.ok(f.state.writes>0);assert.ok(f.state.audits.every(row=>!row.after?.productionConfirmation))});
 for(const terminal of [{instance:{productionStatus:'READY'}},{instance:{productionStatus:'CANCELLED'}},{instance:{completedAt:new Date(stamp)}},{order:{salesStatus:'COMPLETED'}},{order:{salesStatus:'CANCELLED'}},{order:{salesStatus:'REVIEW_REQUESTED'}},{instance:{orderShipment:{shippedAt:new Date(stamp)}}}])test(`${name}: terminal ${JSON.stringify(terminal)} remains forbidden with confirmation`,async()=>{
  const f=fixture({...terminal,definitions:{old:'PARENT_BODY_V1'}});await assert.rejects(invoke(f,confirmation),/Нельзя менять/);assert.deepEqual(f.attempts,[]);
 });
}
for(const name of ['bulk','direct'])for(const measurementId of ['next',null])test(`${name}: old parent-body to ${measurementId??'null'} requires confirmation`,async()=>{
 const f=fixture({definitions:{old:'PARENT_BODY_V1',next:null}});await assert.rejects(enabled[name](f,{measurementId}),/Подтвердите/);assert.deepEqual(f.attempts,[]);
});
for(const name of ['bulk','direct'])test(name+': same parent-body linkage WIP is a no-op for confirmation',async()=>{
 const f=fixture({definitions:{old:'PARENT_BODY_V1'}});await enabled[name](f,{measurementId:'old'});assert.ok(f.state.audits.every(row=>!row.after?.productionConfirmation));
});
test('bulk: costume-size-only change does not require parent-body confirmation',async()=>{const f=fixture({definitions:{old:'PARENT_BODY_V1'}});await enabled.bulk(f,{measurementId:'old',standardHeight:170});assert.equal(f.state.instances[0].standardHeight,170)});
test('direct: resetting status while changing parent-body linkage cannot bypass',async()=>{const f=fixture();await assert.rejects(enabled.direct(f,{productionStatus:'NOT_SCHEDULED'}),/Подтвердите/);assert.deepEqual(f.attempts,[])});
test('direct: unrelated status reset with unchanged parent-body linkage preserves baseline',async()=>{const f=fixture({definitions:{old:'PARENT_BODY_V1'}});await enabled.direct(f,{measurementId:'old',productionStatus:'NOT_SCHEDULED'});assert.equal(f.state.instances[0].productionStatus,'NOT_SCHEDULED')});
test('snapshot: copied parent-body source guards initially empty started assignment',async()=>{const f=fixture({instance:{measurementId:null}});await assert.rejects(enabled.snapshot(f,{expectedMeasurementId:null,sourceMeasurementId:'next'}),/Подтвердите/);assert.deepEqual(f.attempts,[])});
test('bulk: mixed preproduction and WIP validates whole selection before any write',async()=>{const f=fixture({instance:{productionStatus:'NOT_SCHEDULED'},extraInstances:[{id:'z-instance',orderItemId:'item',athleteId:'athlete',measurementId:'old',updatedAt:new Date(stamp),productionStatus:'SEWING',archivedAt:null}]});await assert.rejects(enabled.bulk(f,{targets:[...targets,{id:'z-instance',expectedUpdatedAt:stamp}]}),/Подтвердите/);assert.deepEqual(f.attempts,[])});
const cohort={
 bind:(f,input={})=>f.orders.bindItemMeasurement('order','item',{measurementId:'next',expectedMeasurementId:'old',...input},actor),
 item:(f,input={})=>f.orders.addItemMeasurement('order','item',{...editInput,...input},actor),
 root:(f,input={})=>f.orders.addMeasurement('order',{...editInput,...input},actor),
};
for(const [name,invoke] of Object.entries(cohort)) {
 for(const opts of [
  {definitions:{old:'PARENT_BODY_V1'},instance:{productionStatus:'NOT_SCHEDULED',startedAt:new Date(stamp)}},
  {definitions:{old:'PARENT_BODY_V1'},instance:{productionStatus:'NOT_SCHEDULED'},item:{productionStatus:'SEWING'}},
 ])test(`cohort ${name}: WIP/started guard ignores request confirmation without cohort CAS`,async()=>{const f=fixture(opts);await assert.rejects(invoke(f,confirmation),/явное назначение/);assert.deepEqual(f.attempts,[])});
 test(`cohort ${name}: legacy WIP preserves baseline`,async()=>{const f=fixture({definitions:{old:null,next:null}});await invoke(f);assert.ok(f.state.writes>0)});
 test(`cohort ${name}: parent-body preproduction permits writes`,async()=>{const f=fixture({definitions:{old:'PARENT_BODY_V1'},instance:{productionStatus:'NOT_SCHEDULED'},order:{productionStatus:'NOT_SCHEDULED'}});await invoke(f);assert.ok(f.state.writes>0)});
 test(`cohort ${name}: newly started matching child fails atomically`,async()=>{const f=fixture({definitions:{old:'PARENT_BODY_V1'},instance:{productionStatus:'NOT_SCHEDULED'},extraInstances:[{id:'new-child',orderItemId:'item',athleteId:'athlete',measurementId:'old',productionStatus:'SEWING',archivedAt:null}],order:{productionStatus:'NOT_SCHEDULED'}});await assert.rejects(invoke(f),/явное назначение/);assert.deepEqual(f.attempts,[])});
 test(`cohort ${name}: stale reference rejects without writes`,async()=>{const f=fixture();await assert.rejects(invoke(f,{expectedMeasurementId:'stale'}),/уже измен/);assert.deepEqual(f.attempts,[])});
 test(`cohort ${name}: terminal matching child remains forbidden`,async()=>{const f=fixture({definitions:{old:'PARENT_BODY_V1'},instance:{productionStatus:'READY'}});await assert.rejects(invoke(f,confirmation),/Нельзя менять/);assert.deepEqual(f.attempts,[])});
}
test('cohort bind: parent-body to legacy WIP cannot escape',async()=>{const f=fixture({definitions:{old:'PARENT_BODY_V1',next:null}});await assert.rejects(cohort.bind(f),/явное назначение/);assert.deepEqual(f.attempts,[])});
test('cohort bind: identical linkage remains a no-op in WIP',async()=>{const f=fixture({definitions:{old:'PARENT_BODY_V1'}});await cohort.bind(f,{measurementId:'old'});assert.deepEqual(f.attempts,[])});
test('cohort item: excluded WIP child with independent linkage is unchanged',async()=>{const f=fixture({definitions:{old:'PARENT_BODY_V1'},instance:{productionStatus:'SEWING',measurementId:'independent'},order:{productionStatus:'NOT_SCHEDULED'}});await cohort.item(f);assert.equal(f.state.instances[0].measurementId,'independent')});
test('cohort item: mirroring a parent-body root WIP reference requires explicit instance flow before snapshot',async()=>{const f=fixture({definitions:{old:'PARENT_BODY_V1'},instance:{productionStatus:'NOT_SCHEDULED'},order:{productionStatus:'SEWING'}});await assert.rejects(cohort.item(f),/явное назначение/);assert.deepEqual(f.attempts,[])});

for(const name of ['bulk','direct']) {
 test(name+': legacy to parent-body WIP requires confirmation',async()=>{const f=fixture();await assert.rejects(enabled[name](f,{}),/Подтвердите/);assert.deepEqual(f.attempts,[])});
 test(name+': confirmed clearing parent-body records reason and null reference',async()=>{const f=fixture({definitions:{old:'PARENT_BODY_V1'}});await enabled[name](f,{...confirmation,measurementId:null});const audit=f.state.audits.find(row=>row.entityType==='OrderItemInstance');assert.equal(audit.after.measurementId,null);assert.equal(audit.after.productionConfirmation.confirmProduction,true)});
 test(name+': 2000-character reason is accepted',async()=>{const f=fixture();await enabled[name](f,{confirmProduction:true,reason:'x'.repeat(2000)});assert.equal(f.state.audits[0].after.productionConfirmation.reason.length,2000)});
}
test('cohort bind: incoming parent-body to legacy WIP cohort fails closed',async()=>{const f=fixture();await assert.rejects(cohort.bind(f),/явное назначение/);assert.deepEqual(f.attempts,[])});
for(const name of ['root','item'])test(`cohort ${name}: copied parent-body source with empty old reference fails closed`,async()=>{const f=fixture({order:{measurementId:null},item:{measurementId:null},instance:{measurementId:null}});await assert.rejects(cohort[name](f,{expectedMeasurementId:null,sourceMeasurementId:'next'}),/явное назначение/);assert.deepEqual(f.attempts,[])});
test('bulk: later stale target prevents first write',async()=>{const f=fixture({extraInstances:[{id:'z-instance',orderItemId:'item',athleteId:'athlete',measurementId:'old',updatedAt:new Date('2026-10-19T10:02:00Z'),productionStatus:'SEWING',archivedAt:null}]});await assert.rejects(enabled.bulk(f,{...confirmation,targets:[...targets,{id:'z-instance',expectedUpdatedAt:stamp}]}),/уже измен/);assert.deepEqual(f.attempts,[])});
test('bulk: later CAS failure rolls back first target and all audit',async()=>{const f=fixture({extraInstances:[{id:'z-instance',orderItemId:'item',athleteId:'athlete',measurementId:'old',updatedAt:new Date(stamp),productionStatus:'SEWING',archivedAt:null}],failCasAt:'z-instance'});await assert.rejects(enabled.bulk(f,{...confirmation,targets:[...targets,{id:'z-instance',expectedUpdatedAt:stamp}]}),/уже измен/);assert.equal(f.state.writes,0);assert.deepEqual(f.state.instances.map(row=>row.measurementId),['old','old']);assert.equal(f.state.audits.length,0)});
const {ValidationPipe}=await import('@nestjs/common');
const {AssignOrderMeasurementsDto}=loadTargetModule('orders/order-measurement-assignments.dto.ts');
const {CreateInstanceMeasurementDto,UpdateOrderItemInstanceDto}=loadTargetModule('orders/order-tabs.dto.ts');
for(const [Dto,input] of [[AssignOrderMeasurementsDto,bulkInput],[CreateInstanceMeasurementDto,editInput],[UpdateOrderItemInstanceDto,updateInput]])test(Dto.name+': real global whitelist retains typed confirmation and bounded reason',async()=>{
 const pipe=new ValidationPipe({whitelist:true,transform:true});const metadata={type:'body',metatype:Dto};
 const valid=await pipe.transform({...input,...confirmation},metadata);assert.equal(valid.confirmProduction,true);assert.equal(valid.reason,confirmation.reason);
 for(const invalid of [{confirmProduction:'true',reason:'reason'},{confirmProduction:true,reason:'x'.repeat(2001)},{confirmProduction:true,reason:23}])await assert.rejects(pipe.transform({...input,...invalid},metadata));
});
for(const name of ['snapshot','root','item'])test(name+': independent owned legacy copy source still guards stored parent-body WIP',async()=>{const f=fixture({definitions:{old:'PARENT_BODY_V1',next:null}});await assert.rejects(name==='snapshot'?enabled.snapshot(f,{sourceMeasurementId:'next'}):cohort[name](f,{sourceMeasurementId:'next'}),/Подтвердите|явное назначение/);assert.deepEqual(f.attempts,[])});
for(const name of ['snapshot','root','item'])test(name+': independent parent-body copy source guards old legacy WIP',async()=>{const f=fixture();await assert.rejects(name==='snapshot'?enabled.snapshot(f,{sourceMeasurementId:'next'}):cohort[name](f,{sourceMeasurementId:'next'}),/Подтвердите|явное назначение/);assert.deepEqual(f.attempts,[])});
test('snapshot: confirmed parent-body to owned legacy copy creates legacy snapshot and audits',async()=>{const f=fixture({definitions:{old:'PARENT_BODY_V1',next:null}});await enabled.snapshot(f,{...confirmation,sourceMeasurementId:'next'});assert.equal(f.state.snapshots[0].definitionVersion,null);assert.equal(f.state.audits.find(row=>row.entityType==='OrderItemInstance').after.productionConfirmation.confirmProduction,true)});
