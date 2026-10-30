import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// In-memory operator contract. No DB connection, provider request or real files.
const root=resolve(process.env.YO_CRM_SOURCE_ROOT??resolve(dirname(fileURLToPath(import.meta.url)),'../../..'));
const require=createRequire(import.meta.url),load=()=>require(resolve(root,'scripts/keycrm-image-repair-apply.cjs'));
const clone=value=>structuredClone(value),stamp='2026-10-30T10:00:00.000Z',changed='2026-10-30T11:00:00.000Z';
const name='keycrm-'+('a'.repeat(32))+'.jpg',hash='c'.repeat(64),oldName='keycrm-'+('b'.repeat(32))+'.jpg';
const actorId='owner-fixture',operationId='keycrm-image-only:'+('d'.repeat(64));
const date=value=>value instanceof Date?value.toISOString():value;
function matches(row,where={}){
 if(!row)return false;
 for(const [key,value]of Object.entries(where)){
  if(value===undefined)continue;
  if(key==='AND'){if(!(Array.isArray(value)?value:[value]).every(v=>matches(row,v)))return false;continue;}
  if(key==='OR'){if(!value.some(v=>matches(row,v)))return false;continue;}
  if(key==='NOT'){if((Array.isArray(value)?value:[value]).some(v=>matches(row,v)))return false;continue;}
  let actual=row[key];
  if(value&&typeof value==='object'&&!(value instanceof Date)&&!Array.isArray(value)){
   if(value.path)actual=value.path.reduce((v,k)=>v?.[k],actual);
   if('equals'in value&&date(actual)!==date(value.equals))return false;
   if('in'in value&&!value.in.some(v=>date(v)===date(actual)))return false;
   if('not'in value&&date(actual)===date(value.not))return false;
   continue;
  }
  if(date(actual)!==date(value))return false;
 }
 return true;
}
function seed(){
 const order={id:'order-53',number:'25-53',clientId:'client-9',sourceSystem:'KEYCRM',sourceAccount:'connection-a',externalId:'53',archivedAt:null,createdAt:new Date('2025-01-02T12:00:00Z'),updatedAt:new Date(stamp),externalUpdatedAt:new Date('2026-10-01T12:00:00Z'),modelImagePath:null,externalImageUrl:'https://cdn.example.test/53.jpg',priceMinor:20000,depositRequiredMinor:10000,deliveryMinor:1200,currency:'EUR',salesStatus:'COMPLETED',productionStatus:'READY',paymentStatus:'PAID',shippingStatus:'DELIVERED',notes:'PRESERVE_BUSINESS_HISTORY'};
 const item={id:'item-701',orderId:order.id,sourceSystem:'KEYCRM',sourceAccount:'connection-a',externalId:'53:701',archivedAt:null,updatedAt:new Date(stamp),createdAt:new Date('2025-01-02T12:00:00Z'),modelImagePath:null,externalImageUrl:'https://cdn.example.test/701.jpg',name:'PRESERVE_NAME',sku:'EXACT-SKU',quantity:2,priceMinor:10000,productionStatus:'READY'};
 return {orders:[order],items:[item,{...clone(item),id:'foreign-item',orderId:'foreign-order',externalId:'54:701'}],users:[{id:actorId,role:'OWNER',active:true,archivedAt:null}],activities:[],audits:[]};
}
function plan(state){const order=state.orders[0],item=state.items[0];return {before:{id:order.id,number:order.number,sourceSystem:order.sourceSystem,sourceAccount:order.sourceAccount,externalId:order.externalId,archivedAt:null,updatedAt:date(order.updatedAt)},updates:[['Order',order],['OrderItem',item]].map(([entity,row])=>({entity,id:row.id,before:{modelImagePath:row.modelImagePath,externalImageUrl:row.externalImageUrl,updatedAt:date(row.updatedAt),sourceSystem:row.sourceSystem,sourceAccount:row.sourceAccount,externalId:row.externalId},after:{modelImagePath:name},file:{name,sha256:hash,bytes:85340},beforeFileState:'ABSENT'}))};}
function fixture({failWrite}={}){
 let state=seed();const trace={locks:[],writes:[],transactions:0,validated:[]};
 function client(getState){return {
  $executeRawUnsafe:async(sql,...args)=>{trace.locks.push({sql,args});return 1;},
  user:{findFirst:async({where}={})=>clone(getState().users.find(row=>matches(row,where))??null)},
  order:{findUnique:async({where}={})=>{const row=getState().orders.find(row=>matches(row,where));return row?clone({...row,items:getState().items.filter(i=>i.orderId===row.id)}):null;},updateMany:async({where,data})=>write('Order',getState(),where,data)},
  orderItem:{updateMany:async({where,data})=>write('OrderItem',getState(),where,data)},
  activity:{findFirst:async({where}={})=>clone(getState().activities.find(row=>matches(row,where))??null),create:async({data})=>{if(failWrite==='activity')throw Error('INJECTED_ACTIVITY_FAILURE');const row={id:'activity-'+getState().activities.length,...clone(data)};getState().activities.push(row);return clone(row);}},
  auditLog:{create:async({data})=>{if(failWrite==='audit')throw Error('INJECTED_AUDIT_FAILURE');const row={id:'audit-'+getState().audits.length,...clone(data)};getState().audits.push(row);return clone(row);}},
 };}
 function write(entity,db,where,data){trace.writes.push({entity,where:clone(where),data:clone(data)});if(failWrite===entity)return {count:0};const rows=entity==='Order'?db.orders:db.items;let count=0;for(const row of rows)if(matches(row,where)){Object.assign(row,clone(data));if(!('updatedAt'in data))row.updatedAt=new Date(changed);count++;}return {count};}
 const prisma=client(()=>state);prisma.$transaction=async callback=>{trace.transactions++;const working=clone(state),tx=client(()=>working);const result=await callback(tx);state=working;return result;};
 const entry=plan(state);const validateFile=async candidate=>{trace.validated.push(candidate);return candidate===name?{state:'VALID_LOCAL',name,sha256:hash,bytes:85340,sizeBytes:85340,mimeType:'image/jpeg'}:{state:'ABSENT',name:candidate};};
 return {prisma,entry,trace,get state(){return state;},validateFile,apply:opts=>load().applyImageOrder(prisma,entry,{operationId,actorId,validateFile,...opts})};
}
function withoutImageFields(row){const {modelImagePath,updatedAt,...rest}=clone(row);return rest;}
async function unchanged(f,options){assert.equal(typeof load().applyImageOrder,'function');const before=clone(f.state),input=clone(f.entry);let result,rejected=false;try{result=await f.apply(options);}catch(error){rejected=true;assert.ok(error instanceof Error);}if(!rejected)assert.ok(['ALREADY_APPLIED','SKIPPED','BLOCKED'].includes(result?.status),'unsafe input must reject or return explicit non-apply status');assert.deepEqual(f.state,before);assert.deepEqual(f.entry,input);}

test('operator exposes agreed applyImageOrder export',()=>{assert.equal(typeof load().applyImageOrder,'function');});

test('apply changes only requested image paths/updatedAt and appends actor-linked history',async()=>{
 const f=fixture(),before=clone(f.state),entry=clone(f.entry),result=await f.apply();assert.equal(result.status,'APPLIED');assert.equal(f.state.orders[0].modelImagePath,name);assert.equal(f.state.items[0].modelImagePath,name);
 assert.deepEqual(withoutImageFields(f.state.orders[0]),withoutImageFields(before.orders[0]));assert.deepEqual(withoutImageFields(f.state.items[0]),withoutImageFields(before.items[0]));assert.deepEqual(f.state.items[1],before.items[1]);assert.deepEqual(f.entry,entry);
 assert.ok(f.trace.locks.length>0);assert.ok(f.state.activities.length>0);assert.ok(f.state.audits.length>0);assert.ok(f.state.activities.every(row=>row.orderId==='order-53'&&row.actorId===actorId));assert.ok(f.state.audits.every(row=>row.actorId===actorId));
 for(const write of f.trace.writes)assert.ok(Object.keys(write.data).every(key=>['modelImagePath','updatedAt'].includes(key)),'image repair must never write business/provider scalar fields');
});

test('item-only repair does not populate root image or alter foreign items',async()=>{const f=fixture();f.entry.updates=f.entry.updates.filter(u=>u.entity==='OrderItem');const before=clone(f.state);assert.equal((await f.apply()).status,'APPLIED');assert.equal(f.state.orders[0].modelImagePath,null);assert.equal(f.state.items[0].modelImagePath,name);assert.deepEqual(withoutImageFields(f.state.orders[0]),withoutImageFields(before.orders[0]));assert.deepEqual(f.state.items[1],before.items[1]);});

test('same operation replay returns ALREADY_APPLIED without image or audit duplication',async()=>{const f=fixture();assert.equal((await f.apply()).status,'APPLIED');const after=clone(f.state),writes=f.trace.writes.length;assert.equal((await f.apply()).status,'ALREADY_APPLIED');assert.deepEqual(f.state,after);assert.equal(f.trace.writes.length,writes);});

for(const [nameOfCase,change]of [
 ['wrong order ID',f=>{f.entry.before.id='other-order';}],
 ['wrong order number',f=>{f.entry.before.number='25-OTHER';}],
 ['wrong order source',f=>{f.state.orders[0].sourceSystem='MANUAL';}],
 ['wrong order account',f=>{f.state.orders[0].sourceAccount='connection-b';}],
 ['wrong order external ID',f=>{f.state.orders[0].externalId='54';}],
 ['archived order',f=>{f.state.orders[0].archivedAt=new Date(changed);}],
 ['stale root timestamp',f=>{f.state.orders[0].updatedAt=new Date(changed);}],
 ['stale item timestamp',f=>{f.state.items[0].updatedAt=new Date(changed);}],
 ['wrong item source',f=>{f.state.items[0].sourceSystem='MANUAL';}],
 ['wrong item account',f=>{f.state.items[0].sourceAccount='connection-b';}],
 ['wrong item external ID',f=>{f.state.items[0].externalId='53:702';}],
 ['archived item',f=>{f.state.items[0].archivedAt=new Date(changed);}],
 ['changed upstream URL',f=>{f.state.items[0].externalImageUrl='https://cdn.example.test/changed.jpg';}],
 ['foreign order item',f=>{const foreign=f.state.items[1];f.entry.updates[1]={...f.entry.updates[1],id:foreign.id,before:{...f.entry.updates[1].before,externalId:foreign.externalId}};}],
])test(nameOfCase+' fails closed with no persisted changes',async()=>{const f=fixture();change(f);await unchanged(f);});

for(const ownerState of [{role:'MANAGER'},{active:false},{archivedAt:new Date(changed)}])test('revoked owner '+Object.keys(ownerState)[0]+' rejects without changes',async()=>{const f=fixture();Object.assign(f.state.users[0],ownerState);await unchanged(f);});

test('unknown actor rejects',async()=>{const f=fixture();await unchanged(f,{actorId:'missing-owner'});});

test('target file hash mismatch rejects all updates',async()=>{const f=fixture();await unchanged(f,{validateFile:async candidate=>({state:'VALID_LOCAL',name:candidate,sha256:'d'.repeat(64),bytes:85340})});});

test('target file absent rejects all updates',async()=>{const f=fixture();await unchanged(f,{validateFile:async candidate=>({state:'ABSENT',name:candidate})});});

for(const path of [oldName,'manual-existing-photo.jpg'])test('existing valid '+(path===oldName?'imported':'manual')+' photo remains untouched',async()=>{const f=fixture();f.state.orders[0].modelImagePath=path;f.entry.updates[0].before.modelImagePath=path;await unchanged(f,{validateFile:async candidate=>({state:'VALID_LOCAL',name:candidate,sha256:hash,bytes:85340})});});

test('manual photo path is never replaced even if file is absent',async()=>{const f=fixture();f.state.items[0].modelImagePath='manual-protected.jpg';f.entry.updates[1].before.modelImagePath='manual-protected.jpg';await unchanged(f);});

for(const failure of ['OrderItem','activity','audit'])test('transaction rollback retains all original state after '+failure+' failure',async()=>{const f=fixture({failWrite:failure}),before=clone(f.state);assert.equal(typeof load().applyImageOrder,'function');await assert.rejects(()=>f.apply());assert.deepEqual(f.state,before);});


test('unknown existing-file state fails closed',async()=>{const f=fixture();await unchanged(f,{validateFile:async candidate=>candidate===name?{state:'VALID_LOCAL',name,sha256:hash,bytes:85340}:{state:'UNKNOWN'}});});
test('archived plan is not authority to edit an archived order',async()=>{const f=fixture();f.state.orders[0].archivedAt=new Date(changed);f.entry.before.archivedAt=changed;await unchanged(f);});
test('missing exact item before-fields cannot bypass identity checks',async()=>{const f=fixture();f.entry.updates[1].before={};await unchanged(f);});

test("activity summary preserves exact Unicode",async()=>{const f=fixture();await f.apply();assert.equal(f.state.activities[0].summary,"\u041d\u0435\u0434\u043e\u0441\u0442\u0430\u044e\u0449\u0438\u0435 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f \u0432\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u044b \u0438\u0437 KeyCRM");});
