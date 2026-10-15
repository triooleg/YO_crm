import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {OrderCompositionService}=loadTargetModule('orders/order-composition.service.ts');
const {compositionToken}=loadTargetModule('orders/order-composition.ts');

// Only persistence is simulated. The real service, planner, lock protocol and writer run.
function fixture(){
 let state={order:{id:'o',clientId:'c',client:{id:'c',archivedAt:null},archivedAt:null,type:'CUSTOM_ORDER',currency:'EUR',priceMinor:9000,discountMinor:1000,depositRequiredMinor:4500,paymentStatus:'PARTIALLY_PAID',productionStatus:'NOT_SCHEDULED',salesStatus:'NEW_LEAD',shippingStatus:'NOT_READY',productionSlot:null,invoices:[{id:'invoice',status:'ISSUED'}],payments:[{id:'p',amountMinor:2000,currency:'EUR'}],items:[{id:'i',quantity:1,priceMinor:10000,productionStatus:'SEWING',instances:[{id:'x',ordinal:1,productionStatus:'SEWING',measurementId:'immutable'}]}]},operations:[],activities:[],audits:[],writes:[],failAudit:false};
 const clone=()=>structuredClone(state),locks=[];
 const tx={
  $executeRaw:async()=>{locks.push('global')},$executeRawUnsafe:async()=>{locks.push('order')},$queryRaw:async()=>{locks.push('row');return []},
  order:{findFirst:async()=>state.order.archivedAt?null:structuredClone(state.order),update:async({data})=>{state.writes.push(Object.keys(data).sort());Object.assign(state.order,data);return structuredClone(state.order)}},
  orderCompositionOperation:{findUnique:async({where})=>structuredClone(state.operations.find(o=>o.operationKey===where.orderId_operationKey.operationKey)??null),create:async({data})=>{const op={id:`op${state.operations.length+1}`,...data};state.operations.push(op);return structuredClone(op)}},
  productionSlot:{update:async({data})=>{Object.assign(state.order.productionSlot,data);return structuredClone(state.order.productionSlot)}},
  activity:{create:async({data})=>{state.activities.push(data);return data}},auditLog:{create:async({data})=>{if(state.failAudit)throw Error('audit unavailable');state.audits.push(data);return data}}
 };
 // A serialized transaction boundary models lock ordering; this is not a PostgreSQL race proof.
 let queue=Promise.resolve();
 const prisma={$transaction:run=>{const result=queue.then(async()=>{const before=clone();try{return await run(tx)}catch(error){state=before;throw error}});queue=result.catch(()=>{});return result}};
 const service=new OrderCompositionService(prisma);
 return {get state(){return state},locks,service,token:()=>compositionToken(state.order),apply:(command,key='discount-key-12345',token=compositionToken(state.order),actor='manager')=>service.discountApply('o',{command,expectedToken:token,operationKey:key},{id:actor})};
}

test('preview is read only and writer preserves receipts, invoices, pieces and promised dates',async()=>{
 const f=fixture();f.state.order.productionSlot={id:'slot',tentative:false,plannedStartAt:'2026-11-01',plannedEndAt:'2026-11-02'};
 const immutable=()=>JSON.stringify({payments:f.state.order.payments,invoices:f.state.order.invoices,items:f.state.order.items,slot:f.state.order.productionSlot}),before=immutable();
 const preview=await f.service.discountPreview('o',{mode:'FIXED',value:3000});
 assert.deepEqual(Object.keys(preview).sort(),['after','baseMinor','before','blockers','currency','discountMinor','token','warnings']);assert.equal(f.state.writes.length,0);assert.equal(f.state.activities.length,0);
 const result=await f.apply({mode:'FIXED',value:3000});assert.equal(result.totalMinor,7000);assert.equal(f.state.order.depositRequiredMinor,3500);assert.equal(immutable(),before);
 assert.deepEqual(f.state.writes,[['depositRequiredMinor','discountMinor','paymentStatus','priceMinor']]);
 assert.equal(f.state.activities[0].metadata.manualDiscount,true);assert.equal(f.state.activities[0].actorId,'manager');assert.equal(f.state.audits[0].actorId,'manager');assert.ok(f.locks.includes('row'));
});

test('same-key concurrent retry is stable; same preview with distinct keys is stale',async()=>{
 const f=fixture(),token=f.token(),command={mode:'PERCENT',value:3000};
 const results=await Promise.all([f.apply(command,'same-discount-12345',token),f.apply(command,'same-discount-12345',token)]);
 assert.deepEqual(results[0],results[1]);assert.equal(f.state.operations.length,1);assert.equal(f.state.activities.length,1);
 const retry=await f.apply(command,'same-discount-12345',token);assert.deepEqual(retry,results[0]);
 await assert.rejects(f.apply(command,'same-discount-12345',token,'other-manager'),e=>e.getStatus()===409);
 const g=fixture(),gToken=g.token();const concurrent=await Promise.allSettled([g.apply(command,'first-discount-12345',gToken),g.apply({mode:'FIXED',value:4000},'second-discount-12345',gToken)]);
 assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(concurrent.filter(r=>r.status==='rejected'&&r.reason.getStatus()===409).length,1);assert.equal(g.state.operations.length,1);
});

test('payment, slot and archive changes invalidate preview; composition keys cannot replay as discounts',async()=>{
 for(const change of [s=>s.order.payments[0].amountMinor++,s=>s.order.productionSlot={id:'slot',tentative:true},s=>s.order.client.archivedAt=new Date(),s=>s.order.archivedAt=new Date()]){
  const f=fixture(),token=f.token();change(f.state);await assert.rejects(f.apply({mode:'FIXED',value:3000},'stale-discount-12345',token),e=>e.getStatus()===409);assert.equal(f.state.writes.length,0);
 }
 const f=fixture(),command={mode:'FIXED',value:3000};f.state.operations.push({id:'composition-op',operationKey:'composition-key-123',requestHash:compositionToken({command,actorId:'manager'}),result:{itemId:'x'}});
 await assert.rejects(f.apply(command,'composition-key-123'),e=>e.getStatus()===409);assert.equal(f.state.writes.length,0);
});

test('audit failure rolls back totals, marker and operation; blocked preview cannot be applied',async()=>{
 const f=fixture();f.state.failAudit=true;const before=structuredClone(f.state);await assert.rejects(f.apply({mode:'FIXED',value:3000}),/audit unavailable/);assert.deepEqual(f.state,before);
 for(const change of [s=>s.order.salesStatus='COMPLETED',s=>s.order.paymentStatus='REFUNDED',s=>s.order.payments.push({currency:'USD',amountMinor:10})]){const g=fixture();change(g.state);await assert.rejects(g.apply({mode:'FIXED',value:3000}),e=>e.getStatus()===409);assert.equal(g.state.writes.length,0);assert.equal(g.state.operations.length,0)}
});

test('explicit same-value discount records manual intent once without financial writes',async()=>{
 const f=fixture(),token=f.token(),command={mode:'FIXED',value:1000};await f.apply(command,'same-value-key-12345',token);await f.apply(command,'same-value-key-12345',token);
 assert.equal(f.state.writes.length,0);assert.equal(f.state.activities.filter(a=>a.type==='ORDER_DISCOUNT_UPDATED'&&a.metadata.manualDiscount===true).length,1);assert.equal(f.state.audits.length,1);assert.deepEqual(f.state.audits[0].before,f.state.audits[0].after);
});

test('discount can confirm an already scheduled tentative slot without touching its dates or production progress',async()=>{
 const f=fixture();f.state.order.productionStatus='SCHEDULED';f.state.order.productionSlot={id:'slot',tentative:true,plannedStartAt:'2026-11-01',plannedEndAt:'2026-11-02'};
 await f.apply({mode:'FIXED',value:7000});assert.equal(f.state.order.productionSlot.tentative,false);assert.equal(f.state.order.productionSlot.plannedStartAt,'2026-11-01');assert.equal(f.state.order.productionStatus,'SCHEDULED');assert.equal(f.state.order.items[0].instances[0].productionStatus,'SEWING');assert.equal(f.state.activities.filter(a=>a.type==='PRODUCTION_SLOT_CONFIRMED').length,1);
});
