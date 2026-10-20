import assert from 'node:assert/strict';
import test from 'node:test';
import {orderTimelinePresentation,orderProductionStatusPresentation,orderMatchesProductionFilters} from '../lib/production-view.ts';

const base={productionStatus:'SCHEDULED',shippingStatus:'NOT_READY',salesStatus:'NEW_LEAD'};
test('tracking confirms shipping and completed production without inventing a date or mutating the order',()=>{
 for(const evidence of [{deliveryTrackingCode:' TRACK '},{shipment:{trackingNumber:' TRACK '}},{salesStatus:'SHIPPED'},{shipment:{shippedAt:'2026-08-31T12:00:00Z'}}]){
  const input={...base,...evidence},before=JSON.stringify(input),result=orderTimelinePresentation(input);
  assert.equal(result.shippingStatus,'SHIPPED');assert.equal(result.productionCompleted,true);
  assert.equal(result.shippedAt,evidence.shipment?.shippedAt??null);assert.equal(JSON.stringify(input),before);
 }
 assert.equal(orderTimelinePresentation({...base,deliveryTrackingCode:'   '}).productionCompleted,false);
 assert.equal(orderTimelinePresentation(base).shippingStatus,'NOT_READY');
});
test('delivery exceptions retain priority and dates are factual only',()=>{
 for(const shippingStatus of ['RETURNED','LOST','DELIVERED']){
  const result=orderTimelinePresentation({...base,shippingStatus,deliveryTrackingCode:'TRACK'});
  assert.equal(result.shippingStatus,shippingStatus);assert.equal(result.shippedAt,null);
 }
 assert.equal(orderTimelinePresentation({...base,shipment:{deliveredAt:'2026-09-01'}}).shippingStatus,'DELIVERED');
});
test('a tracked child parcel cannot finish pending or unassigned physical items',()=>{
 const sent={id:'sent',status:'SHIPPED',trackingNumber:'T1',instances:[{id:'a'}]};
 const pending={id:'pending',status:'DRAFT',instances:[{id:'b'}]};
 const input={...base,orderShipments:[sent,pending],items:[{instances:[{id:'a'},{id:'b'}]}]};
 assert.equal(orderTimelinePresentation(input).productionCompleted,false);
 assert.equal(orderTimelinePresentation(input).partial,true);
 assert.equal(orderTimelinePresentation({...input,orderShipments:[sent]}).productionCompleted,false);
 const all={...input,orderShipments:[sent,{...pending,status:'LABEL_CREATED',trackingNumber:'T2'}]};
 assert.equal(orderTimelinePresentation(all).productionCompleted,true);
 assert.equal(orderTimelinePresentation(all).shippingStatus,'SHIPPED');
 assert.equal(orderTimelinePresentation(all).shippedAt,null);
});
test('child transport exceptions remain visible, including mixed and partial shipments',()=>{
 for(const status of ['LOST','RETURNED']){
  const child={id:'p',status,trackingNumber:'T',instances:[{id:'a'}]};
  const input={...base,items:[{instances:[{id:'a'}]}],orderShipments:[child]};
  assert.equal(orderTimelinePresentation(input).shippingStatus,status);
  const mixed={...input,items:[{instances:[{id:'a'},{id:'b'}]}],orderShipments:[child,{id:'q',status:'DELIVERED',instances:[{id:'b'}]}]};
  assert.equal(orderTimelinePresentation(mixed).shippingStatus,status);
  const partial={...mixed,orderShipments:[child,{id:'q',status:'DRAFT',instances:[{id:'b'}]}]};
  assert.equal(orderTimelinePresentation(partial).shippingStatus,status);
  assert.equal(orderTimelinePresentation(partial).partial,true);
 }
});
test('child-only completion requires a complete known physical-instance cohort',()=>{
 const parcel={id:'p',status:'SHIPPED',trackingNumber:'T',instances:[{id:'a'}]};
 for(const items of [undefined,[],[{quantity:2}], [{instances:[]}], [{instances:[{id:'a'}]},{quantity:1}], [{quantity:2,instances:[{id:'a'}]}]]){
  const result=orderTimelinePresentation({...base,items,orderShipments:[parcel]});
  assert.equal(result.productionCompleted,false);assert.equal(result.partial,true);
 }
 assert.equal(orderTimelinePresentation({...base,deliveryTrackingCode:'ROOT',items:[],orderShipments:[parcel]}).productionCompleted,true);
});
test('ordinary root dispatch evidence cannot hide exceptional child transport',()=>{
 for(const status of ['LOST','RETURNED']) for(const evidence of [{salesStatus:'SHIPPED'},{deliveryTrackingCode:'ROOT'},{shipment:{trackingNumber:'ROOT'}},{shippingStatus:'DELIVERED'}]){
  const result=orderTimelinePresentation({...base,...evidence,items:[{instances:[{id:'a'}]}],orderShipments:[{id:'p',status,trackingNumber:'CHILD',instances:[{id:'a'}]}]});
  assert.equal(result.shippingStatus,status);
 }
});
test('dated production slot is displayed as scheduled without confirming a tentative deposit-gated slot',()=>{
 const input={...base,productionStatus:'NOT_SCHEDULED',productionSlot:{startsAt:'2027-01-01',endsAt:'2027-01-15',tentative:true,locked:false},items:[],client:{displayName:'Synthetic'},number:'QA',hasTrackingNumber:false,priceMinor:10000,depositRequiredMinor:5000,paidMinor:0,paymentStatus:'UNPAID'};
 const before=JSON.stringify(input);
 assert.deepEqual(orderProductionStatusPresentation(input),{domain:'production',status:'SCHEDULED'});
 assert.equal(orderTimelinePresentation(input).productionStatus,'SCHEDULED');
 const filters={query:'',payment:'all',shipping:'all',slot:'all',deadline:'all',production:'SCHEDULED'};
 assert.equal(orderMatchesProductionFilters(input,filters),true);
 assert.equal(orderMatchesProductionFilters(input,{...filters,production:'NOT_SCHEDULED'}),false);
 for(const productionSlot of [undefined,{startsAt:'bad',endsAt:'2027-01-15'},{startsAt:'2027-01-15',endsAt:'2027-01-01'},{startsAt:'2027-01-01'}])assert.equal(orderTimelinePresentation({...input,productionSlot}).productionStatus,'NOT_SCHEDULED');
 for(const productionStatus of ['SEWING','ON_HOLD','READY','CANCELLED','TENTATIVE'])assert.equal(orderTimelinePresentation({...input,productionStatus}).productionStatus,productionStatus);
 assert.equal(orderTimelinePresentation({...input,deliveryTrackingCode:'T'}).productionCompleted,true);
 assert.equal(JSON.stringify(input),before);
});
