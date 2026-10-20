import assert from 'node:assert/strict';
import test from 'node:test';
import {loadTargetModule} from './overview-target-loader.mjs';

const {inheritMeasurementDefinition,createMeasurementData}=loadTargetModule('clients/measurement-data.ts');
const input={measuredAt:'2026-10-19',m1:70,m2:55,m3:75,m15:120,m6:44};
function repository(rows){return {measurement:{findFirst:async({where})=>rows.find(row=>row.id===where.id&&row.athleteId===where.athleteId)??null}};}

test('copy inherits only the owned stored definition and keeps body sleeve value unchanged',async()=>{
 const tx=repository([{id:'body',athleteId:'a',definitionVersion:'PARENT_BODY_V1',archivedAt:new Date()}]);
 const definition=await inheritMeasurementDefinition(tx,'a','body');
 const data=createMeasurementData('a',{...input,definitionVersion:'FORGED',sourceMeasurementId:'body'},definition);
 assert.equal(data.definitionVersion,'PARENT_BODY_V1');
 assert.equal(data.values.m6,44);
 assert.equal(data.values.sourceMeasurementId,undefined);
 assert.equal(data.values.definitionVersion,undefined);
 assert.match(data.source,/без припуска/);
});

test('client copy endpoint verifies source ownership inside transaction instead of trusting request flags',async()=>{
 const {ClientsService}=loadTargetModule('clients/clients.service.ts');
 const writes=[];
 const tx={...repository([{id:'body',athleteId:'a',definitionVersion:'PARENT_BODY_V1'}]),
  $executeRaw:async()=>{},$queryRaw:async()=>[],client:{findFirst:async()=>({id:'c'})},
  athlete:{findFirst:async()=>({id:'a',firstName:'Test'})},
  activity:{create:async()=>{}},auditLog:{create:async()=>{}}};
 tx.measurement.create=async({data})=>{writes.push(data);return {id:'new',...data};};
 const service=new ClientsService({$transaction:async run=>run(tx)});
 const result=await service.addMeasurement('c','a',{...input,sourceMeasurementId:'body',definitionVersion:null},{id:'staff'});
 assert.equal(result.definitionVersion,'PARENT_BODY_V1');
 await assert.rejects(()=>service.addMeasurement('c','a',{...input,sourceMeasurementId:'foreign'},{id:'staff'}));
 assert.equal(writes.length,1);
});

test('unknown definitions and foreign sources fail closed; owned historical source is independent of target CAS',async()=>{
 const tx=repository([{id:'future',athleteId:'a',definitionVersion:'FUTURE'},{id:'body',athleteId:'a',definitionVersion:'PARENT_BODY_V1'}]);
 await assert.rejects(()=>inheritMeasurementDefinition(tx,'a','future'),/Неизвестное/);
 await assert.rejects(()=>inheritMeasurementDefinition(tx,'other','body'),/не принадлежит/);
 assert.equal(await inheritMeasurementDefinition(tx,'a','body','different'),'PARENT_BODY_V1');
 assert.equal(await inheritMeasurementDefinition(tx,'a'),null);
 assert.equal(createMeasurementData('a',{...input,definitionVersion:'PARENT_BODY_V1'}).definitionVersion,null);
});

test('DTO accepts only source identity; semantic flags cannot be supplied by the client',async()=>{
 const {ValidationPipe}=await import('@nestjs/common');
 const {CreateMeasurementDto}=loadTargetModule('clients/clients.dto.ts');
 const pipe=new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true});
 const meta={type:'body',metatype:CreateMeasurementDto};
 assert.equal((await pipe.transform({...input,sourceMeasurementId:'owned'},meta)).sourceMeasurementId,'owned');
 await assert.rejects(()=>pipe.transform({...input,definitionVersion:'PARENT_BODY_V1'},meta));
 await assert.rejects(()=>pipe.transform({...input,m6IncludesAllowance:false},meta));
});

test('optional empty sleeve stays absent in the new copy rather than becoming null or zero',()=>{
 const data=createMeasurementData('a',{...input,m6:null},'PARENT_BODY_V1');
 assert.equal(Object.hasOwn(data.values,'m6'),false);
});

for(const endpoint of ['root','item','instance'])test(`${endpoint} edit inherits current snapshot definition even when source ID is omitted`,async()=>{
 const {OrdersService}=loadTargetModule('orders/orders.service.ts');
 const {OrderTabsService}=loadTargetModule('orders/order-tabs.service.ts');
 const item={id:'item',athleteId:'a',measurementId:'body',quantity:1,productionStatus:'NOT_SCHEDULED',measurement:{athleteId:'a'}};
 const order={id:'order',number:'TEST',clientId:'c',athleteId:'a',measurementId:'body',type:'CUSTOM',items:[item]};
 const instance={id:'instance',orderItemId:'item',ordinal:1,athleteId:'a',measurementId:'body',productionStatus:'NOT_SCHEDULED',updatedAt:new Date('2026-10-19T00:00:00Z'),orderItem:{archivedAt:null}};
 const writes=[];
 const tx={...repository([{id:'body',athleteId:'a',definitionVersion:'PARENT_BODY_V1'}]),
  $executeRaw:async()=>{},$executeRawUnsafe:async()=>{},$queryRaw:async()=>[],
  order:{findFirst:async()=>order,update:async({data})=>({...order,...data})},
  client:{findFirst:async()=>({id:'c'})},athlete:{findFirst:async()=>({id:'a',firstName:'Test'})},
  orderItem:{update:async({data})=>({...item,...data})},
  orderItemInstance:{findFirst:async()=>instance,findMany:async()=>[instance],updateMany:async()=>({count:1}),findUniqueOrThrow:async()=>instance},
  activity:{create:async()=>{}},auditLog:{create:async()=>{}}};
 tx.measurement.create=async({data})=>{writes.push(data);return{id:'new',...data};};
 const prisma={$transaction:async run=>run(tx)};
 const dto={...input,expectedMeasurementId:'body',...(endpoint==='instance'?{expectedUpdatedAt:instance.updatedAt.toISOString()}:{})};
 if(endpoint==='root')await new OrdersService(prisma,{}).addMeasurement('order',dto,{id:'staff'});
 if(endpoint==='item')await new OrdersService(prisma,{}).addItemMeasurement('order','item',dto,{id:'staff'});
 if(endpoint==='instance')await new OrderTabsService(prisma).addInstanceMeasurement('order','instance',dto,{id:'staff'});
 assert.equal(writes[0].definitionVersion,'PARENT_BODY_V1');
 assert.equal(writes[0].values.m6,44);
 assert.equal(writes[0].values.expectedUpdatedAt,undefined);
});
