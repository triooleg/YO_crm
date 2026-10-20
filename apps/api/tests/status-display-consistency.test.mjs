import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {buildOrderListPage}=loadTargetModule('orders/order-list-read-model.ts');
const {classifyOverviewOrder}=loadTargetModule('overview/overview-order-model.ts');
const now=new Date('2026-10-15T10:00:00Z');
const row=(overrides={})=>({id:'ready',number:'READY-1',type:'CUSTOM_ORDER',createdAt:new Date('2026-10-01'),sourceSystem:null,salesStatus:'READY_TO_SHIP',productionStatus:'SCHEDULED',shippingStatus:'NOT_READY',paymentStatus:'PARTIALLY_PAID',currency:'EUR',priceMinor:40000,depositRequiredMinor:20000,payments:[],items:[],orderShipments:[],client:{displayName:'Ready'},deadlineEvidence:[],...overrides});
test('explicit Ready to ship is counted and opens the same ready cohort across Orders and Overview',()=>{
 const orders=[row(),row({id:'closed',salesStatus:'COMPLETED'}),row({id:'cancelled',salesStatus:'CANCELLED'}),row({id:'sent',deliveryTrackingCode:'TRACK'})];
 const all=buildOrderListPage(orders,{},now),filtered=buildOrderListPage(orders,{quick:'ready'},now);
 assert.equal(all.metrics.ready,1);assert.deepEqual(filtered.items.map(x=>x.id),['ready']);
 assert.equal(classifyOverviewOrder(orders[0],now).ready,true);
 for(const closed of orders.slice(1))assert.equal(classifyOverviewOrder(closed,now).ready,false);
});

test('source filter combines with readiness and source sorting without adding a table column',()=>{
 const rows=[row({id:'z',orderSource:'WEBSITE'}),row({id:'a',orderSource:'FACEBOOK'}),row({id:'b',orderSource:'MANUAL'})];
 assert.deepEqual(buildOrderListPage(rows,{sort:'source',direction:'asc'},now).items.map(x=>x.orderSource),['FACEBOOK','MANUAL','WEBSITE']);
 assert.deepEqual(buildOrderListPage(rows,{sort:'source',direction:'desc',quick:'ready',source:'FACEBOOK'},now).items.map(x=>x.id),['a']);
});
