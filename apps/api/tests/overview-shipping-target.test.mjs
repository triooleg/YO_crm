import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {ShippingService}=loadTargetModule('shipping/shipping.service.ts');
function database(){
 const expected=new Date();expected.setUTCDate(expected.getUTCDate()+1);
 const base={type:'CUSTOM',createdAt:new Date(),sourceSystem:null,salesStatus:'NEW',productionStatus:'SCHEDULED',paymentStatus:'UNPAID',shippingStatus:'NOT_READY',requiredDeliveryAt:expected,priceMinor:100,depositRequiredMinor:50,currency:'EUR',items:[],payments:[],orderShipments:[],shipment:null,activities:[]};
 const parcel={carrier:'DHL',trackingNumber:null,shippedAt:null,deliveredAt:null};
 const sources=[{...base,id:'soon'},{...base,id:'later',requiredDeliveryAt:new Date(expected.getTime()+14*86400000)},{...base,id:'sent',salesStatus:'SHIPPED'},
  {...base,id:'mixed',shippingStatus:'SHIPPED',orderShipments:[{...parcel,id:'sent-parcel',status:'SHIPPED',trackingNumber:'SENT'},{...parcel,id:'waiting-parcel',status:'NOT_READY'}]}];
 const reads=[];let snapshots=0;
 const db={order:{findMany:async query=>{reads.push(query);return query.select.salesStatus?sources:sources.filter(row=>!query.where.id||query.where.id.in.includes(row.id))}},appSetting:{findMany:async()=>[]},$transaction:async(read,options)=>{assert.equal(options.isolationLevel,'RepeatableRead');snapshots++;return read(db)}};
 return {db,reads,snapshots:()=>snapshots};
}
test('shipping upcoming uses the authoritative Overview cohort in one snapshot',async()=>{
 const fixture=database(),service=new ShippingService(fixture.db);
 const result=await service.list({filter:'upcoming',horizon:7});
 assert.deepEqual(result.orders.map(order=>order.id),['soon','mixed']);assert.equal(fixture.snapshots(),1);
 assert.deepEqual(fixture.reads.at(-1).where,{archivedAt:null,id:{in:['soon','mixed']}});
 assert.deepEqual(result.orders[1].orderShipments.map(parcel=>parcel.id),['waiting-parcel']);
 assert.deepEqual(result.orders[1].upcomingShipments.map(parcel=>parcel.shipmentId),['waiting-parcel']);
});
test('ordinary shipping list is unchanged and invalid target filters fail before reads',async()=>{
 const fixture=database(),service=new ShippingService(fixture.db);
 assert.equal((await service.list()).orders.length,4);assert.equal(fixture.snapshots(),0);
 for(const input of [{filter:'other'},{filter:'upcoming',horizon:0},{filter:'upcoming',horizon:8},{horizon:7}])await assert.rejects(()=>service.list(input),error=>error.getStatus()===400);
 assert.equal(fixture.reads.length,1);
});


test('ordinary Shipping retains an existing order-level legacy tracking code',async()=>{
 const stored={id:'legacy',number:'LEGACY',deliveryTrackingCode:'LEGACY-TRACK',shippingStatus:'NOT_READY',currency:'EUR',client:{displayName:'Example'},items:[],orderShipments:[],shipment:null};
 const db={order:{findMany:async({select})=>[Object.fromEntries(Object.entries(stored).filter(([key])=>select[key]))]},appSetting:{findMany:async()=>[]}};
 const result=await new ShippingService(db).list();assert.equal(result.orders[0].deliveryTrackingCode,'LEGACY-TRACK');assert.equal(result.orders[0].shippingStatus,'NOT_READY');
});
