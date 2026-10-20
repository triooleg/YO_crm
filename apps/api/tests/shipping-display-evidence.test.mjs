import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {shippingEvidence}=loadTargetModule('orders/order-shipping-evidence.ts');
const {loadProductionOrders}=loadTargetModule('orders/production-context.ts');
const {buildOrderListPage,orderListCandidateSelect}=loadTargetModule('orders/order-list-read-model.ts');
const web=loadTargetModule('../../web/lib/production-view.ts');
const now=new Date('2026-10-15');
const row=(extra={})=>({id:'o',number:'O',salesStatus:'READY_TO_SHIP',shippingStatus:'NOT_READY',productionStatus:'SEWING',paymentStatus:'UNPAID',priceMinor:10000,depositRequiredMinor:5000,currency:'EUR',client:{displayName:'Test'},createdAt:now,payments:[],items:[{quantity:2,instances:[{id:'a',productionStatus:'READY'},{id:'b',productionStatus:'SEWING'}]}],orderShipments:[],...extra});
test('all status consumers retain partial child dispatch and exceptions without closing production',async()=>{
 for(const status of ['SHIPPED','LOST','RETURNED']){
  const order=row({orderShipments:[{status,trackingNumber:'TRACK',instances:[{id:'a'}]},{status:'DRAFT',instances:[{id:'b'}]}]});
  assert.equal(shippingEvidence(order).complete,false);
  assert.equal(buildOrderListPage([order],{},now).metrics.ready,0);
  assert.equal(web.orderReadyToShip(order),false);
  const [view]=await loadProductionOrders({findMany:async()=>[order],findFirst:async()=>null},undefined,'2026-10-01','2026-10-31');
  assert.equal(view.hasTrackingNumber,true);assert.equal(view.dispatchComplete,false);assert.equal(view.partiallyShipped,true);assert.equal(view.shippedAt,null);
  assert.equal(web.productionOrderIsShipped(view),false);
  if(status!=='SHIPPED')assert.equal(web.shippingPresentation(view).code,status.toLowerCase());
 }
});
test('whole order evidence requires full coverage; explicit legacy tracking remains authoritative',()=>{
 const partial=row({orderShipments:[{status:'SHIPPED',instances:[{id:'a'}]}]});
 assert.equal(shippingEvidence(partial).complete,false);
 assert.equal(shippingEvidence({...partial,deliveryTrackingCode:'ROOT'}).complete,true);
 assert.equal(shippingEvidence(row({orderShipments:[{status:'SHIPPED',instances:[{id:'a'},{id:'b'}]}]})).complete,true);
});
test('operational work excludes closed or dispatched orders and payment waiting excludes refunds',()=>{
 for(const salesStatus of ['COMPLETED','CANCELLED','SHIPPED','DELIVERED','REVIEW_REQUESTED'])assert.equal(buildOrderListPage([row({salesStatus})],{quick:'work'},now).items.length,0);
 for(const paymentStatus of ['REFUNDED','CANCELLED'])assert.equal(web.buildProductionMetrics([{...row({paymentStatus}),paidMinor:0,hasTrackingNumber:false}],now,7,3,7).awaitingPayment,0);
});

test('candidate query preserves full coverage and parent exceptions for actual KPI eligibility',()=>{
 const project=(value,select)=>Object.fromEntries(Object.entries(select).map(([key,spec])=>[key,spec===true?value[key]:Array.isArray(value[key])?value[key].map(item=>project(item,spec.select)):value[key]?project(value[key],spec.select):null]));
 const full=row({orderShipments:[{status:'SHIPPED',instances:[{id:'a'},{id:'b'}]}]});
 const candidate=project(full,orderListCandidateSelect);
 assert.equal(shippingEvidence(candidate).complete,true);
 assert.equal(buildOrderListPage([candidate],{},now).metrics.work,0);
 for(const shippingStatus of ['LOST','RETURNED'])assert.equal(buildOrderListPage([row({shippingStatus,orderShipments:[{status:'DRAFT'}]})],{},now).metrics.work,0);
});

test('root factual delivery and all delivered children preserve delivered labels without fabricating dates',async()=>{
 const full=[{status:'DELIVERED',instances:[{id:'a'},{id:'b'}]}];
 for(const order of [row({shipment:{deliveredAt:new Date('2026-10-09')},orderShipments:[{status:'DRAFT'}]}),row({orderShipments:full})]){
  const [view]=await loadProductionOrders({findMany:async()=>[order],findFirst:async()=>null},undefined,'2026-10-01','2026-10-31');
  assert.equal(web.shippingPresentation(view).code,order.shipment?'shipped':'delivered');
  assert.equal(view.deliveredAt,null);
 }
 const cancelled=row({items:[{quantity:2,instances:[{id:'a',productionStatus:'READY'},{id:'b',productionStatus:'CANCELLED'}]}],orderShipments:[{status:'SHIPPED',instances:[{id:'a'}]}]});
 assert.equal(shippingEvidence(cancelled).complete,true);
});
