import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {planOrderDiscount}=loadTargetModule('orders/order-discount.ts');
const order=()=>({id:'o',clientId:'c',currency:'EUR',type:'CUSTOM_ORDER',priceMinor:9001,discountMinor:1000,depositRequiredMinor:2700,salesStatus:'NEW_LEAD',shippingStatus:'NOT_READY',paymentStatus:'UNPAID',productionStatus:'NOT_SCHEDULED',payments:[],items:[],invoices:[]});
test('percent is a one-time half-up snapshot of authoritative undiscounted total preserving adjustments',()=>{
 const p=planOrderDiscount(order(),{mode:'PERCENT',value:5000});
 assert.equal(p.baseMinor,10001);assert.equal(p.discountMinor,5001);assert.equal(p.after.totalMinor,5000);assert.equal(p.after.depositRequiredMinor,1500);assert.equal(p.before.totalMinor,9001);assert.equal(p.after.balanceMinor,5000);
});

for(const command of [{mode:'FIXED',value:-1},{mode:'PERCENT',value:10001},{mode:'FIXED',value:10002},{mode:'FIXED',value:1.5},{mode:'BAD',value:0}])test('reject invalid discount '+JSON.stringify(command),()=>assert.throws(()=>planOrderDiscount(order(),command)));
test('zero and full discounts, void receipts, unknown FX and overpayment remain explicit',()=>{
 const o=order();o.payments=[{amountMinor:8000,currency:'EUR'},{amountMinor:999,currency:'USD',voidedAt:new Date()}];
 const p=planOrderDiscount(o,{mode:'PERCENT',value:10000});assert.equal(p.after.totalMinor,0);assert.equal(p.after.overpaymentMinor,8000);assert.equal(p.after.paidMinor,8000);assert.ok(p.warnings.length);
 assert.equal(planOrderDiscount(o,{mode:'FIXED',value:0}).after.totalMinor,10001);
 o.payments.push({amountMinor:100,currency:'USD'});const unknown=planOrderDiscount(o,{mode:'FIXED',value:0});assert.equal(unknown.after.paidMinor,null);assert.ok(unknown.blockers.length);
});
for(const field of ['salesStatus','paymentStatus','shippingStatus'])test('closed dimension blocks '+field,()=>{const o=order();o[field]=field==='salesStatus'?'COMPLETED':field==='paymentStatus'?'REFUNDED':'RETURNED';assert.ok(planOrderDiscount(o,{mode:'FIXED',value:500}).blockers.length)});
test('removing discount cannot silently underfund confirmed slot; discount may confirm a tentative slot',()=>{
 const o=order();o.productionSlot={tentative:false};o.payments=[{currency:'EUR',amountMinor:2700}];assert.ok(planOrderDiscount(o,{mode:'FIXED',value:0}).blockers.length);
 o.productionSlot.tentative=true;assert.equal(planOrderDiscount(o,{mode:'FIXED',value:3000}).confirmsProductionSlot,true);
});
test('full child coverage blocks but partial child alone does not close the discount editor',()=>{
 const o=order();o.items=[{id:'i',quantity:2,instances:[{id:'a',productionStatus:'READY'},{id:'b',productionStatus:'NOT_SCHEDULED'}]}];o.orderShipments=[{status:'SHIPPED',instances:[{id:'a'}]}];assert.equal(planOrderDiscount(o,{mode:'FIXED',value:10}).blockers.length,0);
 o.orderShipments[0].instances.push({id:'b'});assert.ok(planOrderDiscount(o,{mode:'FIXED',value:10}).blockers.length);
});

test('archive projection matches composition: archived items and pieces do not dilute full dispatch evidence',()=>{
 const o=order();o.items=[{id:'i',quantity:1,instances:[{id:'active',productionStatus:'READY'},{id:'old',archivedAt:'2026-10-01',productionStatus:'NOT_SCHEDULED'}]},{id:'old-item',quantity:1,archivedAt:'2026-10-01',instances:[{id:'old-2'}]}];o.orderShipments=[{status:'SHIPPED',instances:[{id:'active'}]}];assert.ok(planOrderDiscount(o,{mode:'FIXED',value:10}).blockers.length);
});

test('zero original total uses established deposit fallback; ordinary override ratios and immutable applied FX are preserved',()=>{
 const o=order();o.priceMinor=0;o.discountMinor=10000;o.depositRequiredMinor=0;
 assert.equal(planOrderDiscount(o,{mode:'FIXED',value:0}).after.depositRequiredMinor,5000);
 o.priceMinor=8000;o.discountMinor=2000;o.depositRequiredMinor=2400;o.payments=[{currency:'USD',amountMinor:2200,appliedCurrency:'EUR',appliedAmountMinor:2000}];
 const p=planOrderDiscount(o,{mode:'FIXED',value:4000});assert.equal(p.after.depositRequiredMinor,1800);assert.equal(p.after.paidMinor,2000);
 o.depositRequiredMinor=0;assert.equal(planOrderDiscount(o,{mode:'FIXED',value:4000}).after.depositRequiredMinor,0);
});

test('basis preserves authoritative legacy adjustments rather than recomputing item subtotal',()=>{
 const o=order();o.items=[{id:'i',quantity:1,priceMinor:7000,instances:[]}];o.deliveryMinor=900;o.discountMinor=1000;o.priceMinor=9001;
 const p=planOrderDiscount(o,{mode:'PERCENT',value:1000});assert.equal(p.baseMinor,10001);assert.equal(p.discountMinor,1000);assert.equal(p.after.totalMinor,9001);
});
