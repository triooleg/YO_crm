import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './website-test-loader.mjs';
import {websitePayload} from './fixtures/website-orders.mjs';
import {websiteDatabase} from './fixtures/website-orders-database.mjs';
const {WebsiteOrdersService}=loadTargetModule('website-orders/website-orders.service.ts');
test('first website order creates a full ready-made CRM order, client and physical pieces',async()=>{
 const db=websiteDatabase();const service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 const result=await service.ingest(websitePayload());
 assert.equal(result.ok,true);assert.equal(result.created,true);assert.equal(result.paymentStatus,'UNPAID');
 assert.equal(db.state.order.length,1);assert.equal(db.state.client.length,1);assert.equal(db.state.orderItem.length,1);assert.equal(db.state.orderItemInstance.length,2);
 assert.equal(db.state.order[0].priceMinor,21500);assert.equal(db.state.order[0].deliveryMinor,1000);assert.equal(db.state.order[0].discountMinor,1000);assert.equal(db.state.order[0].taxMinor,0);assert.equal(db.state.order[0].type,'READY_MODEL');assert.equal(db.state.order[0].depositRequiredMinor,0);
 assert.equal(db.state.payment.length,0);assert.equal(db.state.productionSlot.length,0);assert.equal(db.state.athlete.length,0);assert.equal(db.state.measurement.length,0);
});
test('concurrent first delivery creates one paid order, one client and one receipt',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']),p=websitePayload();p.order.paymentStatus='paid';p.payment={externalId:'one-event',amountMinor:21500,currency:'EUR',status:'paid',receivedAt:'2026-10-20T12:05:00Z'};
 const results=await Promise.all([service.ingest(p),service.ingest(structuredClone(p))]);assert.equal(results.filter(r=>r.created).length,1);assert.equal(new Set(results.map(r=>r.orderId)).size,1);assert.equal(db.state.client.length,1);assert.equal(db.state.order.length,1);assert.equal(db.state.payment.length,1);
});
test('quantity updates archive safe pieces and never reactivate old physical identities',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']),p=websitePayload();await service.ingest(p);
 const removed=db.state.orderItemInstance[1];removed.athleteId='manually-bound-athlete';p.items[0].quantity=1;p.totals.itemsMinor=10000;p.totals.chargedMinor=11500;const before=structuredClone(db.state);
 await assert.rejects(service.ingest(p),e=>e.code==='WEBSITE_ITEM_CONFLICT');assert.deepEqual(db.state,before);
 db.state.orderItemInstance[1].athleteId=null;await service.ingest(p);assert.equal(db.state.orderItemInstance.filter(i=>!i.archivedAt).length,1);assert.ok(db.state.orderItemInstance[1].archivedAt);
 p.items[0].quantity=2;p.totals.itemsMinor=20000;p.totals.chargedMinor=21500;await service.ingest(p);assert.equal(db.state.orderItemInstance.length,3);assert.equal(db.state.orderItemInstance[2].ordinal,3);assert.ok(db.state.orderItemInstance[1].archivedAt);
});
test('manual prices remain untouched, namespace is configured, and 00 phone-only receipts reuse the canonical buyer',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']),p=websitePayload();await service.ingest(p);db.state.order[0].priceMinor=99999;p.order.notes='New source comment';const before=structuredClone(db.state);
 await assert.rejects(service.ingest(p),e=>e.code==='WEBSITE_ORDER_CONFLICT');assert.deepEqual(db.state,before);
 const other=websitePayload();other.order.externalId='124';delete other.customer.email;other.customer.phone='00380671234567';await service.ingest(other);assert.equal(db.state.client.length,1);
 const disallowed=websitePayload();disallowed.sourceAccount='not-allowed.example';await assert.rejects(service.ingest(disallowed),e=>e.code==='WEBSITE_SOURCE_NOT_ALLOWED');
 await assert.rejects(new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>[]).ingest(websitePayload()),e=>e.code==='WEBSITE_DISABLED');
});
test('merged aliases resolve to the canonical client without rewriting its manual profile',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']),p=websitePayload();
 await db.client.create({data:{id:'alias',email:'buyer@example.invalid',archivedAt:new Date(),displayName:'Old alias'}});await db.client.create({data:{id:'canonical',displayName:'Manual Canonical',phone:'+380671234567'}});await db.clientMergeRedirect.create({data:{sourceClientId:'alias',targetClientId:'canonical'}});
 const result=await service.ingest(p);assert.equal(result.clientId,'canonical');assert.equal(db.state.client.length,2);assert.equal(db.state.client[1].displayName,'Manual Canonical');
});
test('normalized contacts reuse a client, preserve manual fields, and reject ambiguous matches atomically',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 await db.client.create({data:{id:'manual-client',firstName:'Manual',displayName:'Manual Name',email:'BUYER@example.invalid',phone:'+380 (67) 123-45-67',country:'Manual country',city:'Manual city'}});
 const p=websitePayload(),first=await service.ingest(p);assert.equal(first.clientId,'manual-client');assert.equal(db.state.client.length,1);assert.equal(db.state.client[0].displayName,'Manual Name');assert.equal(db.state.client[0].country,'Manual country');
 p.order.externalId='124';await service.ingest(p);assert.equal(db.state.client.length,1);assert.equal(db.state.order.length,2);
 await db.client.create({data:{id:'other-client',email:'other@example.invalid',displayName:'Other'}});p.order.externalId='125';p.customer.email='other@example.invalid';const before=structuredClone(db.state);
 await assert.rejects(service.ingest(p),e=>e.code==='WEBSITE_CLIENT_CONFLICT');assert.deepEqual(db.state,before);
});
test('a local KeyCRM collision fails before website business writes and never adopts its identity',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']),p=websitePayload();
 await db.client.create({data:{id:'known-client',email:'buyer@example.invalid',displayName:'Known'}});await db.order.create({data:{sourceSystem:'KEYCRM',sourceAccount:'keycrm',externalId:'remote-9',externalData:{source_uuid:'yo-checkout:v1:calendar.yoleotard.com:123'},number:'KC-9',clientId:'known-client',priceMinor:20000,currency:'EUR',createdAt:new Date(p.order.orderedAt)}});
 const before=structuredClone(db.state);await assert.rejects(service.ingest(p),e=>e.code==='WEBSITE_CROSS_PROVIDER_CONFLICT');assert.deepEqual(db.state,before);
});
test('source updates cannot modify dispatched orders or related shipment evidence',async()=>{
 for(const relation of [false,true]){
  const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']),p=websitePayload();await service.ingest(p);
  if(relation)await db.orderShipment.create({data:{orderId:db.state.order[0].id,status:'SHIPPED',trackingNumber:'synthetic-tracking'}});else db.state.order[0].shippingStatus='IN_TRANSIT';
  p.items[0].unitPriceMinor+=1000;p.totals.itemsMinor+=2000;p.totals.chargedMinor+=2000;const before=structuredClone(db.state);
  await assert.rejects(service.ingest(p),e=>e.code==='WEBSITE_ORDER_CONFLICT');assert.deepEqual(db.state,before);
 }
});
test('unpaid invoice then paid card creates one receipt , concurrent retry is a no-op',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 const p=websitePayload();p.order.checkoutMode='bank_invoice';p.totals.cardFeeMinor=0;p.totals.chargedMinor=21000;await service.ingest(p);assert.equal(db.state.payment.length,0);
 p.order.checkoutMode='card';p.order.paymentStatus='paid';p.totals.cardFeeMinor=500;p.totals.chargedMinor=21500;p.payment={externalId:'psp-100',provider:'synthetic-card',reference:'txn-100',amountMinor:21500,currency:'EUR',status:'paid',receivedAt:'2026-10-20T12:05:00Z'};
 const [a,b]=await Promise.all([service.ingest(p),service.ingest(structuredClone(p))]);assert.equal(a.orderId,b.orderId);assert.equal(a.paymentStatus,'PAID');assert.equal(b.paymentStatus,'PAID');
 assert.equal(db.state.payment.length,1);assert.equal(db.state.payment[0].amountMinor,21500);assert.equal(db.state.payment[0].method,'CARD');
 const before=structuredClone(db.state);const wrong=structuredClone(p);wrong.payment.receivedAt='2026-10-21T12:05:00Z';await assert.rejects(service.ingest(wrong),e=>e.code==='WEBSITE_PAYMENT_CONFLICT');assert.deepEqual(db.state,before);
 const otherReceipt=structuredClone(p);otherReceipt.payment.externalId='different-real-receipt';await assert.rejects(service.ingest(otherReceipt),e=>e.code==='WEBSITE_PAYMENT_CONFLICT');assert.deepEqual(db.state,before);
 const old=websitePayload();await assert.rejects(service.ingest(old),e=>e.code==='WEBSITE_PAYMENT_CONFLICT');assert.equal(db.state.payment.length,1);
});
test('retry and update preserve order identity, two item rows, images and arbitrary adjustment properties',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);const p=websitePayload();
 const first=await service.ingest(p),auditCount=db.state.auditLog.length;
 const replay=await service.ingest(structuredClone(p));assert.equal(replay.created,false);assert.equal(replay.orderId,first.orderId);assert.equal(db.state.auditLog.length,auditCount);
 p.items.push({...p.items[0],externalId:'line-2',productId:'88',quantity:1,name:'Second product',unitPriceMinor:5000});p.totals.itemsMinor+=5000;p.totals.chargedMinor+=5000;
 const update=await service.ingest(p);assert.equal(update.orderId,first.orderId);assert.equal(db.state.order.length,1);assert.equal(db.state.orderItem.length,2);assert.equal(db.state.orderItemInstance.length,3);
 assert.equal(db.state.order[0].externalImageUrl,p.items[0].imageUrl);assert.equal(db.state.orderItem[0].externalImageUrl,p.items[0].imageUrl);
 assert.deepEqual(db.state.orderItem[0].properties.reductions,{waist:2});assert.deepEqual(db.state.orderItem[0].properties.adjustedMeasurements,{chest:65});assert.deepEqual(db.state.orderItem[0].properties.selectedServices,p.items[0].selectedServices);
 assert.equal(db.state.orderItem[0].properties.color,'blue');assert.deepEqual(db.state.order[0].externalData,p);
});

test('removing an existing position fails closed on main without deleting its history',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']),p=websitePayload();
 p.items.push({...p.items[0],externalId:'second',quantity:1});p.totals.itemsMinor+=10000;p.totals.chargedMinor+=10000;await service.ingest(p);
 p.items.pop();p.totals.itemsMinor-=10000;p.totals.chargedMinor-=10000;const before=structuredClone(db.state);
 await assert.rejects(service.ingest(p),e=>e.code==='WEBSITE_ITEM_CONFLICT');assert.deepEqual(db.state,before);
});

test('opaque line and receipt identities remain scoped to canonical numeric order IDs',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 for(const [orderId,itemId] of [['2','b'],['1','a:b']]){
  const p=websitePayload();p.order.externalId=orderId;p.items[0].externalId=itemId;p.order.paymentStatus='paid';
  p.payment={externalId:itemId,amountMinor:21500,currency:'EUR',status:'paid',receivedAt:'2026-10-20T12:05:00Z'};
  await service.ingest(p);
 }
 assert.equal(db.state.order.length,2);assert.equal(db.state.orderItem.length,2);assert.equal(db.state.payment.length,2);
 assert.equal(new Set(db.state.orderItem.map(i=>i.externalId)).size,2);assert.equal(new Set(db.state.payment.map(i=>i.externalId)).size,2);
});

test('website activity and option summaries remain valid Russian Unicode',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']),p=websitePayload();await service.ingest(p);
 assert.equal(db.state.activity.find(a=>a.type==='WEBSITE_ORDER_IMPORTED').summary,'\u041f\u043e\u043b\u0443\u0447\u0435\u043d \u0437\u0430\u043a\u0430\u0437 \u0441 \u0441\u0430\u0439\u0442\u0430');
 assert.match(db.state.orderItem[0].notes,/\u041e\u043f\u0446\u0438\u0438 \u0441\u0430\u0439\u0442\u0430:/);
});

test('paid creation requires native tax capture inside the same transaction and failure is atomic',async()=>{
 const db=websiteDatabase(),p=websitePayload();p.order.paymentStatus='paid';p.payment={externalId:'native',amountMinor:21500,currency:'EUR',status:'paid',receivedAt:'2026-05-01T12:00:00Z'};
 let calls=0;const service=new WebsiteOrdersService(db,{capturePayment:async(tx,id,reason)=>{assert.equal(tx,db);assert.ok(db.state.payment.some(row=>row.id===id));assert.equal(reason,'WEBSITE_CREATE');calls++;}},()=>['calendar.yoleotard.com']);
 await service.ingest(p);await service.ingest(p);assert.equal(calls,1);assert.equal(db.state.payment.length,1);
 const failure=websiteDatabase(),broken=new WebsiteOrdersService(failure,{capturePayment:async()=>{throw Error('synthetic tax failure');}},()=>['calendar.yoleotard.com']);
 await assert.rejects(broken.ingest(p),/synthetic tax failure/);assert.ok(Object.values(failure.state).every(rows=>rows.length===0));
});
