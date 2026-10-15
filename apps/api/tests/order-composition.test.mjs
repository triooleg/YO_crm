import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../src/orders/order-composition.ts',import.meta.url),'utf8');
const mod={exports:{}};
const shipping={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/orders/order-shipping-evidence.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:shipping,exports:shipping.exports,Set});
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,require,Date,Math,BigInt,Set,JSON});
function require(name){if(name==='node:crypto')return crypto;if(name==='./order-shipping-evidence')return shipping.exports;throw Error(name)}
import * as crypto from 'node:crypto';
const {planOrderComposition,compositionToken}=mod.exports;
function fixture(){return {id:'o',clientId:'c',updatedAt:'2026-10-15',type:'CUSTOM_ORDER',currency:'EUR',priceMinor:52000,depositRequiredMinor:26000,paymentStatus:'PARTIALLY_PAID',salesStatus:'NEW_LEAD',shippingStatus:'NOT_READY',payments:[{id:'p',amountMinor:10000,currency:'EUR'}],productionSlot:null,invoices:[],items:[{id:'i',name:'Дизайн',quantity:5,priceMinor:10000,productionStatus:'NOT_SCHEDULED',instances:Array.from({length:5},(_,n)=>({id:`x${n+1}`,ordinal:n+1,athleteId:`a${n+1}`,measurementId:`m${n+1}`,productionStatus:'NOT_SCHEDULED'}))}]};}
test('selected non-tail pieces 5→7→4 preserve remaining stable identities and root adjustments',()=>{
 const s=fixture();const grow=planOrderComposition(s,{action:'QUANTITY',itemId:'i',quantity:7});
 assert.equal(grow.after.totalMinor,72000);assert.equal(grow.after.depositRequiredMinor,36000);assert.equal(grow.createCount,2);
 s.items[0].instances.push({id:'x6',ordinal:6,productionStatus:'NOT_SCHEDULED'},{id:'x7',ordinal:7,productionStatus:'NOT_SCHEDULED'});s.items[0].quantity=7;s.priceMinor=72000;s.depositRequiredMinor=36000;
 const shrink=planOrderComposition(s,{action:'QUANTITY',itemId:'i',quantity:4,archiveInstanceIds:['x2','x4','x6']});
 assert.equal(shrink.blockers.length,0);assert.equal(shrink.after.totalMinor,42000);assert.equal(shrink.after.depositRequiredMinor,21000);assert.deepEqual(Array.from(shrink.archiveInstanceIds),['x2','x4','x6']);
 assert.deepEqual(s.items[0].instances.filter(x=>!shrink.archiveInstanceIds.includes(x.id)).map(x=>x.id),['x1','x3','x5','x7']);
});
test('shrink cannot silently choose last pieces; made or shipped chosen pieces block',()=>{
 const s=fixture();assert.ok(planOrderComposition(s,{action:'QUANTITY',itemId:'i',quantity:4}).blockers.length);
 s.items[0].instances[1].orderShipmentId='parcel';assert.ok(planOrderComposition(s,{action:'QUANTITY',itemId:'i',quantity:4,archiveInstanceIds:['x2']}).blockers.length);
 s.items[0].instances[1].orderShipmentId=null;s.items[0].instances[1].productionStatus='READY';assert.ok(planOrderComposition(s,{action:'ARCHIVE',itemId:'i'}).blockers.length);
});
test('overpayment is explicit and real receipts remain unchanged',()=>{
 const s=fixture();s.payments[0].amountMinor=60000;const original=JSON.stringify(s.payments);
 const p=planOrderComposition(s,{action:'EDIT',itemId:'i',name:'Дизайн',priceMinor:6000});
 assert.equal(p.after.totalMinor,32000);assert.equal(p.after.paidMinor,60000);assert.equal(p.after.balanceMinor,0);assert.equal(p.after.overpaymentMinor,28000);assert.equal(JSON.stringify(s.payments),original);
});
test('archive does not multiply quantity by instance count, resurrect history or discard adjustments',()=>{
 const s=fixture();s.items[0].instances.push({id:'old',ordinal:20,archivedAt:'2026-01-01',productionStatus:'READY'});
 const p=planOrderComposition(s,{action:'ARCHIVE',itemId:'i'});assert.equal(p.after.totalMinor,2000);assert.equal(p.after.quantity,0);assert.equal(p.archiveInstanceIds.length,5);assert.equal(p.nextOrdinal,21);
});
test('confirmed deposit, unknown FX and invoice dependencies are evaluated on server',()=>{
 const s=fixture();s.productionSlot={id:'slot',tentative:false,locked:false};
 assert.ok(planOrderComposition(s,{action:'QUANTITY',itemId:'i',quantity:6}).blockers.length);
 s.productionSlot=null;s.payments=[{amountMinor:5000,currency:'USD'}];const unknown=planOrderComposition(s,{action:'EDIT',itemId:'i',priceMinor:9000});assert.equal(unknown.before.paidMinor,null);assert.ok(unknown.blockers.length);
});
test('preview token binds payments, instances, shipment evidence and field order is canonical',()=>{
 const s=fixture(),token=compositionToken(s);assert.equal(token,compositionToken({...s,items:s.items}));
 s.items[0].instances[0].measurementId='changed';assert.notEqual(token,compositionToken(s));
 const t=compositionToken(s);s.payments[0].amountMinor++;assert.notEqual(t,compositionToken(s));
});
test('full child-only dispatch blocks money edits, partial child dispatch alone does not close the whole order',()=>{
 const s=fixture();s.orderShipments=[{status:'SHIPPED',trackingNumber:'child-track',instances:s.items[0].instances.map(i=>({id:i.id}))}];
 assert.ok(planOrderComposition(s,{action:'ADD',name:'Добавление',quantity:1,priceMinor:1000}).blockers.length);
 assert.ok(planOrderComposition(s,{action:'EDIT',itemId:'i',priceMinor:9000}).blockers.length);
 s.orderShipments=[{status:'SHIPPED',instances:[{id:'x1'}]},{status:'NOT_READY',instances:[{id:'x2'},{id:'x3'},{id:'x4'},{id:'x5'}]}];
 assert.equal(planOrderComposition(s,{action:'ADD',name:'Добавление',quantity:1,priceMinor:1000}).blockers.length,0);
});
