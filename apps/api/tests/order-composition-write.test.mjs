import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as crypto from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {ProductionStatus} from '@prisma/client';
function load(name,deps){const mod={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/orders/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,require:n=>{if(n in deps)return deps[n];throw Error(n)},Date,Math,BigInt,Set,JSON});return mod.exports;}
const domain=load('order-composition',{'node:crypto':crypto,'./order-shipping-evidence':load('order-shipping-evidence',{})});
const {applyOrderComposition}=load('order-composition-write',{'./order-composition':domain,'./order-image-name':{isOrderImageName:()=>true},'./production-status-graph':load('production-status-graph',{'@prisma/client':{ProductionStatus}})});
function fixture(){
 let state={order:{id:'o',clientId:'c',client:{id:'c',archivedAt:null},type:'CUSTOM_ORDER',currency:'EUR',priceMinor:50000,depositRequiredMinor:25000,paymentStatus:'PARTIALLY_PAID',productionStatus:'NOT_SCHEDULED',salesStatus:'NEW_LEAD',shippingStatus:'NOT_READY',productionSlot:null,invoices:[],payments:[{id:'p',amountMinor:10000,currency:'EUR'}],items:[{id:'i',name:'Дизайн',quantity:5,priceMinor:10000,productionStatus:'NOT_SCHEDULED',instances:Array.from({length:5},(_,n)=>({id:`x${n+1}`,ordinal:n+1,athleteId:`a${n+1}`,measurementId:`m${n+1}`,productionStatus:'NOT_SCHEDULED'}))}]},operations:[],audits:[],activities:[],newId:0,failAudit:false};
 const clone=v=>structuredClone(v),item=id=>state.order.items.find(i=>i.id===id);
 const tx={
  $executeRaw:async()=>0,$executeRawUnsafe:async()=>0,$queryRaw:async()=>[],
  order:{findFirst:async()=>clone(state.order),update:async({data})=>{Object.assign(state.order,data);return clone(state.order)}},
  orderItem:{create:async({data})=>{const result={id:`newitem${++state.newId}`,instances:[],...data};state.order.items.push(result);return clone(result)},update:async({where,data})=>{Object.assign(item(where.id),data);return clone(item(where.id))},findUniqueOrThrow:async({where})=>clone(item(where.id)),updateMany:async({where,data})=>{let count=0;for(const i of state.order.items)if(!(where.archivedAt===null&&i.archivedAt)&&(!where.productionStatus?.in||where.productionStatus.in.includes(i.productionStatus))){Object.assign(i,data);count++}return {count}}},
  orderItemInstance:{createMany:async({data})=>{for(const d of data)item(d.orderItemId).instances.push({id:`newinstance${++state.newId}`,...d});return {count:data.length}},updateMany:async({where,data})=>{let count=0;for(const parent of state.order.items)for(const i of parent.instances)if((!where.orderItemId||where.orderItemId===parent.id)&&(!where.id||where.id.in.includes(i.id))&&!i.archivedAt&&!(where.orderItem?.archivedAt===null&&parent.archivedAt)&&(!where.productionStatus?.in||where.productionStatus.in.includes(i.productionStatus))){Object.assign(i,data);count++}return{count}}},
  orderCompositionOperation:{findUnique:async({where})=>clone(state.operations.find(o=>o.orderId===where.orderId_operationKey.orderId&&o.operationKey===where.orderId_operationKey.operationKey)),create:async({data})=>{const op={id:`op${++state.newId}`,...data};state.operations.push(op);return clone(op)}},
  athlete:{findFirst:async({where})=>({id:where.id})},measurement:{findFirst:async({where})=>({id:where.id})},
  activity:{create:async({data})=>{state.activities.push(data);return data}},auditLog:{create:async({data})=>{if(state.failAudit)throw Error('audit unavailable');state.audits.push(data);return data}},
  productionSlot:{update:async({data})=>{Object.assign(state.order.productionSlot,data);return clone(state.order.productionSlot)}}
 };
 const execute=async(command,key='operation-key-12345',token=domain.compositionToken(state.order))=>{const original=clone(state);try{return await applyOrderComposition(tx,'o',command,token,key,'owner')}catch(e){state=original;throw e}};
 return {get state(){return state},execute,token:()=>domain.compositionToken(state.order)};
}
test('quantity 5→7→4 archives chosen IDs and grow never restores old numbered pieces',async()=>{
 const f=fixture();await f.execute({action:'QUANTITY',itemId:'i',quantity:7},'grow-operation-123');
 const before=f.state.order.items[0].instances,added=before.filter(i=>i.ordinal>5);assert.equal(added.length,2);assert.ok(added.every(i=>i.athleteId===null&&i.measurementId===null));
 await f.execute({action:'QUANTITY',itemId:'i',quantity:4,archiveInstanceIds:['x2','x4',added[0].id]},'shrink-operation-123');
 const survivors=f.state.order.items[0].instances.filter(i=>!i.archivedAt);assert.deepEqual(survivors.map(i=>i.id),['x1','x3','x5',added[1].id]);assert.equal(f.state.order.priceMinor,40000);
 await f.execute({action:'QUANTITY',itemId:'i',quantity:5},'regrow-operation-123');assert.equal(f.state.order.items[0].instances.at(-1).ordinal,8);assert.ok(f.state.order.items[0].instances.find(i=>i.id==='x2').archivedAt);
});
test('same operation retry is exactly idempotent even after later edits; different payload conflicts',async()=>{
 const f=fixture(),command={action:'ADD',name:'Новый дизайн',quantity:2,priceMinor:8000},token=f.token();
 const first=await f.execute(command,'same-operation-123',token);await f.execute({action:'EDIT',itemId:'i',name:'Изменено'},'other-operation-123');
 const second=await f.execute(command,'same-operation-123',token);assert.deepEqual(JSON.parse(JSON.stringify(second)),JSON.parse(JSON.stringify(first)));assert.equal(f.state.order.items.length,2);assert.equal(f.state.order.priceMinor,66000);
 await assert.rejects(f.execute({...command,quantity:3},'same-operation-123',token),/другого изменения/);assert.equal(f.state.operations.length,2);
});
test('duplicate has new IDs and no provider or athlete/measurement/shipping identity by default',async()=>{
 const f=fixture();Object.assign(f.state.order.items[0],{sourceSystem:'KEYCRM',sourceAccount:'a',externalId:'99',discipline:'RHYTHMIC_GYMNASTICS',sku:'SKU',notes:'Особенности'});
 await f.execute({action:'DUPLICATE',itemId:'i'},'duplicate-operation-123');const item=f.state.order.items[1];assert.equal(item.quantity,5);assert.equal(item.sourceSystem,undefined);assert.equal(item.externalId,undefined);assert.equal(item.discipline,'RHYTHMIC_GYMNASTICS');assert.equal(item.notes,'Особенности');assert.ok(item.instances.every(i=>!i.athleteId&&!i.measurementId&&!i.orderShipmentId));
});
test('archive retains original positive quantity, snapshots and receipts; stale preview cannot write',async()=>{
 const f=fixture(),token=f.token();f.state.order.payments[0].amountMinor=20000;const payments=JSON.stringify(f.state.order.payments);
 await assert.rejects(f.execute({action:'ARCHIVE',itemId:'i'},'archive-operation-123',token),/предварительный/);assert.equal(f.state.operations.length,0);
 await f.execute({action:'ARCHIVE',itemId:'i'},'archive-operation-123');const item=f.state.order.items[0];assert.equal(item.quantity,5);assert.ok(item.archivedAt);assert.equal(item.instances[0].measurementId,'m1');assert.ok(item.instances.every(i=>i.archivedAt));assert.equal(f.state.order.priceMinor,0);assert.equal(JSON.stringify(f.state.order.payments),payments);
});
test('audit failure rolls back the entire composition including new instances and operation reservation',async()=>{
 const f=fixture();f.state.failAudit=true;const old=JSON.stringify(f.state.order);await assert.rejects(f.execute({action:'ADD',name:'New',quantity:3,priceMinor:1000}),/audit unavailable/);assert.equal(JSON.stringify(f.state.order),old);assert.equal(f.state.operations.length,0);
});
test('adding or growing physical pieces cannot leave incomplete production marked READY',async()=>{
 for(const command of [{action:'ADD',name:'Ещё дизайн',quantity:1,priceMinor:1000},{action:'QUANTITY',itemId:'i',quantity:6}]){
  const f=fixture();f.state.order.productionStatus='READY';f.state.order.items[0].productionStatus='READY';for(const instance of f.state.order.items[0].instances)instance.productionStatus='READY';
  await f.execute(command);assert.equal(f.state.order.productionStatus,'SEWING');const instances=f.state.order.items.flatMap(i=>i.instances);assert.equal(instances.filter(i=>i.productionStatus==='READY').length,5);assert.equal(instances.filter(i=>i.productionStatus==='NOT_SCHEDULED').length,1);
 }
});
test('tentative slot confirmation preserves archived designs and their historical production byte for byte',async()=>{
 const f=fixture();f.state.order.productionSlot={id:'slot',tentative:true,locked:false};f.state.order.items.push({id:'archived',name:'History',quantity:1,priceMinor:5000,archivedAt:new Date('2026-01-01'),productionStatus:'READY',instances:[{id:'old',ordinal:1,productionStatus:'READY',archivedAt:new Date('2026-01-01')}]});
 const old=JSON.stringify(f.state.order.items[1]);await f.execute({action:'EDIT',itemId:'i',priceMinor:3000});assert.equal(f.state.order.productionSlot.tentative,false);assert.equal(JSON.stringify(f.state.order.items[1]),old);
});
test('editing the primary design photo and archiving it keep the order thumbnail on the active primary',async()=>{
 const f=fixture();f.state.order.modelImagePath='old.jpg';f.state.order.items[0].modelImagePath='old.jpg';
 await f.execute({action:'EDIT',itemId:'i',modelImagePath:'new.jpg'},'photo-operation-123');assert.equal(f.state.order.modelImagePath,'new.jpg');
 await f.execute({action:'ADD',name:'Следующий',quantity:1,priceMinor:1000,modelImagePath:'second.jpg'},'second-design-123');
 await f.execute({action:'ARCHIVE',itemId:'i'},'archive-primary-123');assert.equal(f.state.order.modelImagePath,'second.jpg');assert.equal(f.state.order.items[0].modelImagePath,'new.jpg');
});


test('5→7→4 preserves every surviving original assignment and production field',async()=>{
 const f=fixture(),before=structuredClone(f.state.order.items[0].instances.filter(i=>['x1','x3','x5'].includes(i.id)));
 await f.execute({action:'QUANTITY',itemId:'i',quantity:7},'survivor-grow-key-123');const added=f.state.order.items[0].instances.filter(i=>i.ordinal>5);
 await f.execute({action:'QUANTITY',itemId:'i',quantity:4,archiveInstanceIds:['x2','x4',added[0].id]},'survivor-shrink-key-123');
 assert.deepEqual(f.state.order.items[0].instances.filter(i=>['x1','x3','x5'].includes(i.id)),before);
});

test('price edit preserves custom deposit ratio, issued invoice, receipts, confirmed slot dates and assignments',async()=>{
 const f=fixture();f.state.order.depositRequiredMinor=15000;f.state.order.productionSlot={id:'slot',tentative:false,locked:false,plannedStartAt:'2026-11-01',plannedEndAt:'2026-11-02'};
 f.state.order.invoices=[{id:'invoice',status:'ISSUED',snapshot:{totalMinor:50000}}];
 const history=()=>JSON.stringify({payments:f.state.order.payments,invoices:f.state.order.invoices,slot:f.state.order.productionSlot,instances:f.state.order.items[0].instances}),before=history();
 await f.execute({action:'EDIT',itemId:'i',priceMinor:6000},'custom-deposit-key-123');
 assert.equal(f.state.order.priceMinor,30000);assert.equal(f.state.order.depositRequiredMinor,9000);assert.equal(history(),before);
});

for(const action of ['ADD','DUPLICATE','ARCHIVE'])test(`core ${action} retains progress of an unmaterialized active legacy sibling`,async()=>{
 const f=fixture();const legacy={...structuredClone(f.state.order.items[0]),id:'legacy',quantity:1,productionStatus:'SEWING',instances:[]};f.state.order.items.push(legacy);f.state.order.productionStatus='SEWING';const before=structuredClone(legacy);
 const command=action==='ADD'?{action,name:'Fresh',quantity:1,priceMinor:1000}:{action,itemId:'i'};
 await f.execute(command,`legacy-progress-${action}`);
 assert.notEqual(f.state.order.productionStatus,'NOT_SCHEDULED');assert.notEqual(f.state.order.productionStatus,'READY');assert.deepEqual(f.state.order.items.find(i=>i.id==='legacy'),before);
});
