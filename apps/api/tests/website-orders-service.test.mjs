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
 assert.equal(result.orderNumber,'YO-1');assert.equal(db.state.order[0].number,'YO-1');
 assert.ok(db.state.order[0].websiteNoticeAt instanceof Date);assert.equal(db.state.order[0].websiteReviewedAt,null);
});
test('website numbering continues the KeyCRM sequence and ignores legacy WordPress local ids',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 await db.client.create({data:{id:'history-client',displayName:'History'}});
 await db.order.create({data:{clientId:'history-client',number:'KC-707',sourceSystem:'KEYCRM',sourceAccount:'keycrm',externalId:'707',externalNumber:'KC-707',archivedAt:new Date('2026-10-01')}});
 await db.order.create({data:{clientId:'history-client',number:'WEB-22732',sourceSystem:'YOLEOTARD_WEBSITE',sourceAccount:'calendar.yoleotard.com',externalId:'50000',externalNumber:'WEB-random-old',archivedAt:new Date('2026-10-02')}});
 const result=await service.ingest(websitePayload());
 assert.equal(result.orderNumber,'YO-708');assert.equal(db.state.order.at(-1).number,'YO-708');
 const replay=await service.ingest(websitePayload());assert.equal(replay.orderNumber,'YO-708');assert.equal(db.state.order.length,3);
});
test('website numbering ignores the current WordPress local order number',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 await db.client.create({data:{id:'history-client',displayName:'History'}});
 await db.order.create({data:{clientId:'history-client',number:'KC-707',sourceSystem:'KEYCRM',sourceAccount:'keycrm',externalId:'707',externalNumber:'#707'}});
 const p=websitePayload();p.order.externalNumber='#22734';
 const result=await service.ingest(p);
 assert.equal(result.orderNumber,'YO-708');assert.equal(db.state.order.at(-1).number,'YO-708');
});
test('website numbering respects the global Order.number namespace regardless of source',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 await db.client.create({data:{id:'history-client',displayName:'History'}});
 await db.order.create({data:{clientId:'history-client',number:'YO-708',sourceSystem:null,sourceAccount:null,externalId:null}});
 const result=await service.ingest(websitePayload());
 assert.equal(result.orderNumber,'YO-709');assert.equal(db.state.order.at(-1).number,'YO-709');
});
test('two distinct concurrent website orders receive unique consecutive business numbers',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 const first=websitePayload(),second=websitePayload();second.order.externalId='124';second.items[0].externalId='line-2';second.customer.email='second@example.invalid';second.customer.phone='+380 67 222 22 22';
 const results=await Promise.all([service.ingest(first),service.ingest(second)]);
 assert.deepEqual(results.map(result=>result.orderNumber).sort(),['YO-1','YO-2']);
 assert.equal(new Set(db.state.order.map(order=>order.number)).size,2);
});
test('website card surcharge stays in its source snapshot, with no duplicate tax, payment or price',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 const p=websitePayload();p.totals.itemsMinor=28000;p.totals.deliveryMinor=300;p.delivery.amountMinor=300;p.totals.cardFeeMinor=578;p.totals.chargedMinor=28878;p.totals.discountMinor=0;p.items[0].quantity=1;p.items[0].unitPriceMinor=28000;p.order.paymentStatus='paid';p.payment={externalId:'receipt',amountMinor:28878,currency:'EUR',status:'paid',receivedAt:'2026-10-20T12:05:00Z'};
 await service.ingest(p);assert.equal(db.state.order[0].priceMinor,28878);assert.equal(db.state.order[0].taxMinor,0);assert.equal(db.state.order[0].externalData.totals.cardFeeMinor,578);assert.equal(db.state.payment.length,1);assert.equal(db.state.payment[0].amountMinor,28878);
});
test('exact replay never mutates an existing website order, payment or ownership',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 const p=websitePayload();p.items[0].name='New author\'s leotard u201cWild Graceu201d';p.order.paymentStatus='paid';p.payment={externalId:'receipt',amountMinor:21500,currency:'EUR',status:'paid',receivedAt:'2026-10-20T12:05:00Z'};
 const first=await service.ingest(p),order=db.state.order[0],item=db.state.orderItem[0];
 order.taxMinor=0;item.name=p.items[0].name;
 const payments=structuredClone(db.state.payment),clientId=order.clientId,orderId=order.id;
 const before=structuredClone(db.state);const replay=await service.ingest(p);assert.equal(replay.created,false);assert.equal(db.state.order[0].id,orderId);assert.equal(db.state.order[0].clientId,clientId);assert.equal(db.state.order[0].taxMinor,0);assert.equal(db.state.orderItem[0].name,p.items[0].name);assert.deepEqual(db.state.payment,payments);assert.deepEqual(db.state,before);
 assert.equal(first.orderId,replay.orderId);
});
test('exact replay also leaves a terminal shipment and its history untouched',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 const p=websitePayload();await service.ingest(p);db.state.order[0].shippingStatus='SHIPPED';db.state.orderItem[0].name='legacy u201cTitleu201d';
 const before=structuredClone(db.state);await service.ingest(p);assert.deepEqual(db.state,before);
});
test('late KeyCRM number is display metadata on the same technical order and cannot be overwritten',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 const p=websitePayload();await service.ingest(p);const original=db.state.order[0].number;
 p.order.externalNumber='706';await service.ingest(p);assert.equal(db.state.order.length,1);assert.equal(db.state.order[0].number,original);assert.equal(db.state.order[0].externalId,'123');assert.equal(db.state.order[0].externalNumber,'706');
 p.order.externalNumber='707';p.order.notes='changed source note';const before=structuredClone(db.state);await assert.rejects(service.ingest(p),e=>e.code==='WEBSITE_ORDER_CONFLICT');assert.deepEqual(db.state,before);
});
test('two complete client matches require review and never select a linked favorite',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 for(const id of ['one','two'])await db.client.create({data:{id,email:'BUYER@example.invalid',phone:'+380671234567',displayName:id}});
 await db.keycrmClientLink.create({data:{connectionKey:'keycrm',keycrmBuyerId:705,clientId:'one',rolledBackAt:null}});
 const before=structuredClone(db.state);await assert.rejects(service.ingest(websitePayload()),e=>e.code==='WEBSITE_CLIENT_CONFLICT');assert.deepEqual(db.state,before);
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
test('normalized contacts reuse a full match, while a partial match creates a separate buyer',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 await db.client.create({data:{id:'manual-client',firstName:'Manual',displayName:'Manual Name',email:'BUYER@example.invalid',phone:'+380 (67) 123-45-67',country:'Manual country',city:'Manual city'}});
 const p=websitePayload(),first=await service.ingest(p);assert.equal(first.clientId,'manual-client');assert.equal(db.state.client.length,1);assert.equal(db.state.client[0].displayName,'Manual Name');assert.equal(db.state.client[0].country,'Manual country');
 p.order.externalId='124';await service.ingest(p);assert.equal(db.state.client.length,1);assert.equal(db.state.order.length,2);
 await db.client.create({data:{id:'other-client',email:'other@example.invalid',displayName:'Other'}});p.order.externalId='125';p.customer.email='other@example.invalid';
 const third=await service.ingest(p);assert.notEqual(third.clientId,'manual-client');assert.notEqual(third.clientId,'other-client');assert.equal(db.state.client.length,3);assert.equal(db.state.client.find(c=>c.id==='manual-client').displayName,'Manual Name');
});
test('a KeyCRM email anchor does not match a website buyer with a different or missing phone',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 await db.client.create({data:{id:'keycrm-client',firstName:'Known',displayName:'Known buyer',email:'buyer@example.invalid'}});
 await db.client.create({data:{id:'duplicate-client',firstName:'Duplicate',displayName:'Duplicate buyer',email:'BUYER@example.invalid'}});
 await db.keycrmClientLink.create({data:{connectionKey:'keycrm',keycrmBuyerId:705,clientId:'keycrm-client',rolledBackAt:null}});
 const result=await service.ingest(websitePayload());
 assert.notEqual(result.clientId,'keycrm-client');assert.equal(db.state.order[0].clientId,result.clientId);assert.equal(db.state.client.length,3);
});
test('split email and Ukrainian phone contacts create a separate complete website buyer',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 const p=websitePayload();p.customer.phone='0932354616';
 await db.client.create({data:{id:'wrong-linked',displayName:'Unrelated buyer',email:'buyer@example.invalid',phone:'+33660279848'}});
 await db.client.create({data:{id:'actual-phone',displayName:'Actual buyer',phone:'+380932354616'}});
 await db.keycrmClientLink.create({data:{connectionKey:'keycrm',keycrmBuyerId:68,clientId:'wrong-linked',rolledBackAt:null}});
 const before=structuredClone(db.state.client);
 const result=await service.ingest(p);assert.equal(db.state.order[0].clientId,result.clientId);assert.notEqual(result.clientId,'wrong-linked');assert.notEqual(result.clientId,'actual-phone');assert.equal(db.state.client.length,3);assert.deepEqual(db.state.client.slice(0,2),before);assert.equal(db.state.client[2].phone,'0932354616');
});
test('Ukrainian phone normalization matches local and international forms in both directions',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 await db.client.create({data:{id:'local-client',displayName:'Local',email:'buyer@example.invalid',phone:'0671234567'}});
 const first=await service.ingest(websitePayload());assert.equal(first.clientId,'local-client');
 const second=websitePayload();second.order.externalId='124';second.customer.phone='0671234567';const next=await service.ingest(second);assert.equal(next.clientId,'local-client');assert.equal(db.state.client.length,1);
});
test('Ukrainian phone normalization works when optional country is absent',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 await db.client.create({data:{id:'local-client',displayName:'Local',email:'buyer@example.invalid',phone:'0671234567'}});
 const p=websitePayload();delete p.customer.country;
 const result=await service.ingest(p);assert.equal(result.clientId,'local-client');assert.equal(db.state.client.length,1);
});
test('an explicit foreign country does not infer a Ukrainian phone equivalence',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 await db.client.create({data:{id:'foreign-client',displayName:'Foreign',email:'buyer@example.invalid',phone:'0671234567'}});
 const p=websitePayload();p.customer.country='France';
 const result=await service.ingest(p);assert.notEqual(result.clientId,'foreign-client');assert.equal(db.state.client.length,2);
});
test('an unambiguous exact email and phone match beats an email-only KeyCRM anchor',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 const p=websitePayload();
 await db.client.create({data:{id:'wrong-linked',displayName:'Unrelated buyer',email:'buyer@example.invalid',phone:'+33660279848'}});
 await db.client.create({data:{id:'full-match',displayName:'Actual buyer',email:'BUYER@example.invalid',phone:'+380671234567'}});
 await db.keycrmClientLink.create({data:{connectionKey:'keycrm',keycrmBuyerId:68,clientId:'wrong-linked',rolledBackAt:null}});
 const result=await service.ingest(p);assert.equal(result.clientId,'full-match');assert.equal(db.state.order[0].clientId,'full-match');
});
test('multiple partial KeyCRM-linked contacts are never chosen for a website buyer',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 await db.client.create({data:{id:'first-client',firstName:'First',displayName:'First buyer',email:'buyer@example.invalid'}});
 await db.client.create({data:{id:'second-client',firstName:'Second',displayName:'Second buyer',email:'BUYER@example.invalid'}});
 await db.keycrmClientLink.create({data:{connectionKey:'keycrm',keycrmBuyerId:705,clientId:'first-client',rolledBackAt:null}});
 await db.keycrmClientLink.create({data:{connectionKey:'keycrm',keycrmBuyerId:706,clientId:'second-client',rolledBackAt:null}});
 const result=await service.ingest(websitePayload());assert.notEqual(result.clientId,'first-client');assert.notEqual(result.clientId,'second-client');assert.equal(db.state.client.length,3);
});
test('multiple KeyCRM links to a partial contact do not determine website ownership',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 await db.client.create({data:{id:'linked-client',email:'buyer@example.invalid',displayName:'Linked buyer'}});
 await db.client.create({data:{id:'duplicate-client',email:'BUYER@example.invalid',displayName:'Empty duplicate'}});
 await db.keycrmClientLink.create({data:{connectionKey:'keycrm',keycrmBuyerId:705,clientId:'linked-client',rolledBackAt:null}});
 await db.keycrmClientLink.create({data:{connectionKey:'keycrm',keycrmBuyerId:706,clientId:'linked-client',rolledBackAt:null}});
 const result=await service.ingest(websitePayload());assert.notEqual(result.clientId,'linked-client');assert.equal(db.state.client.length,3);
});
test('an existing website order never changes its pinned client through a new KeyCRM link',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 const p=websitePayload();const first=await service.ingest(p);
 await db.client.create({data:{id:'later-linked',email:'BUYER@example.invalid',displayName:'Other buyer'}});
 await db.keycrmClientLink.create({data:{connectionKey:'keycrm',keycrmBuyerId:705,clientId:'later-linked',rolledBackAt:null}});
 p.order.notes='Updated website note';await service.ingest(p);
 assert.equal(db.state.order[0].clientId,first.clientId);
});
test('contradictory email and phone matches do not reuse either client',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 const p=websitePayload();
 await db.client.create({data:{id:'email-owner',email:p.customer.email,displayName:'Email owner'}});
 await db.client.create({data:{id:'phone-owner',email:'someone-else@example.invalid',phone:p.customer.phone,displayName:'Phone owner'}});
 await db.keycrmClientLink.create({data:{connectionKey:'keycrm',keycrmBuyerId:705,clientId:'phone-owner',rolledBackAt:null}});
 const result=await service.ingest(p);assert.notEqual(result.clientId,'email-owner');assert.notEqual(result.clientId,'phone-owner');assert.equal(db.state.client.length,3);
});
test('partial contact with its own order history is never adopted via a KeyCRM link',async()=>{
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 await db.client.create({data:{id:'keycrm-client',email:'buyer@example.invalid',displayName:'Known buyer'}});
 await db.client.create({data:{id:'other-client',email:'BUYER@example.invalid',displayName:'Other buyer'}});
 await db.keycrmClientLink.create({data:{connectionKey:'keycrm',keycrmBuyerId:705,clientId:'keycrm-client',rolledBackAt:null}});
 await db.order.create({data:{clientId:'other-client',number:'KC-existing',sourceSystem:'KEYCRM',sourceAccount:'keycrm',externalId:'existing'}});
 const result=await service.ingest(websitePayload());assert.notEqual(result.clientId,'keycrm-client');assert.notEqual(result.clientId,'other-client');assert.equal(db.state.order.find(o=>o.number==='KC-existing').clientId,'other-client');
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
