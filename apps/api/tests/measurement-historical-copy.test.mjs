import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {OrderTabsService}=loadTargetModule('orders/order-tabs.service.ts');
function fixture(sourceVersion,currentVersion){
 const stamp='2026-10-19T10:00:00.000Z',writes=[];
 const source={id:'historical',athleteId:'athlete',definitionVersion:sourceVersion,archivedAt:new Date('2026-10-18')};
 const current={id:'current',athleteId:'athlete',definitionVersion:currentVersion};
 const instance={id:'piece',athleteId:'athlete',measurementId:'current',orderItemId:'design',ordinal:1,productionStatus:'NOT_SCHEDULED',updatedAt:new Date(stamp),orderItem:{archivedAt:null}};
 const order={id:'order',clientId:'client',salesStatus:'NEW_LEAD',items:[]};
 const tx={$executeRaw:async()=>{},$executeRawUnsafe:async()=>{},$queryRaw:async()=>[],order:{findFirst:async()=>order},client:{findFirst:async()=>({id:'client'})},athlete:{findFirst:async()=>({id:'athlete'})},
  measurement:{findFirst:async({where})=>[source,current].find(s=>s.id===where.id&&s.athleteId===where.athleteId)??null,create:async({data})=>{writes.push(data);return{id:'new',...data};}},
  orderItemInstance:{findFirst:async()=>instance,updateMany:async()=>({count:1}),findUniqueOrThrow:async()=>({...instance,measurementId:'new'})},
  activity:{create:async()=>{}},auditLog:{create:async()=>{}}};
 const service=new OrderTabsService({$transaction:async work=>work(tx)});
 const input={measuredAt:'2026-10-19',m1:70,m2:56,m3:72,m6:42.5,m15:122,sourceMeasurementId:'historical',expectedMeasurementId:'current',expectedUpdatedAt:stamp};
 return {service,input,writes,source};
}
for(const [from,to] of [[null,null],['PARENT_BODY_V1','PARENT_BODY_V1'],[null,'PARENT_BODY_V1'],['PARENT_BODY_V1',null]])test(`historical instance copy ${from??'legacy'} into ${to??'legacy'} preserves selected source without allowance conversion`,async()=>{
 const f=fixture(from,to);await f.service.addInstanceMeasurement('order','piece',f.input,{id:'staff'});assert.equal(f.writes.length,1);assert.equal(f.writes[0].definitionVersion,from);assert.equal(f.writes[0].values.m6,42.5);
});
test('historical copy rejects stale target, foreign source and unknown definition before writes',async()=>{
 for(const kind of ['stale','foreign','unknown']){
  const f=fixture(null,'PARENT_BODY_V1');if(kind==='stale')f.input.expectedUpdatedAt='2026-10-18T00:00:00.000Z';if(kind==='foreign')f.source.athleteId='other';if(kind==='unknown')f.source.definitionVersion='FUTURE';
  await assert.rejects(f.service.addInstanceMeasurement('order','piece',f.input,{id:'staff'}));assert.equal(f.writes.length,0);
 }
});
