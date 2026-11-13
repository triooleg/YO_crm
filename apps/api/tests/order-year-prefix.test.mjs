import test from 'node:test';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {loadTargetModule} from './website-test-loader.mjs';
import {websitePayload} from './fixtures/website-orders.mjs';
import {websiteDatabase} from './fixtures/website-orders-database.mjs';
const numbering=loadTargetModule('website-orders/website-order-number.ts');
test('one lifetime sequence spans prefixes, years, archived rows and compound legacy numbers',async()=>{
 const history=[{number:'YO-707'},{number:'24-708'},{number:'26-26-0003'},{number:'YO-26-0002'},{number:'KC-12',sourceSystem:'KEYCRM',externalId:'900'}],calls=[];
 const tx={$executeRawUnsafe:async(...args)=>calls.push(args),websiteOrderNumberReservation:{findFirst:async()=>null},order:{findMany:async()=>history}};
 assert.equal(await numbering.nextOrderNumber(tx,new Date('2023-12-31T22:30:00Z')),'24-901');
 assert.equal(await numbering.nextOrderNumber(tx,new Date('2024-12-31T21:30:00Z')),'24-901');
 assert.equal(await numbering.nextOrderNumber(tx,new Date('2024-12-31T22:30:00Z')),'25-901');
 assert.equal(calls[0][1],'order-business-number-v1');
});
test('new website order derives year from persisted source createdAt and replay keeps stored number',async()=>{
 const {WebsiteOrdersService}=loadTargetModule('website-orders/website-orders.service.ts'),db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 const p=websitePayload();p.order.orderedAt='2023-12-31T22:30:00Z';
 const result=await service.ingest(p);assert.equal(result.orderNumber,'24-1');assert.equal(new Date(db.state.order[0].createdAt).toISOString(),'2023-12-31T22:30:00.000Z');
 db.state.order[0].number='YO-legacy-saved';const replay=await service.ingest(p);assert.equal(replay.orderNumber,'YO-legacy-saved');
});
test('KeyCRM normalized candidate uses source creation year without changing external identity',()=>{
 const {normalizeKeycrmOrder}=loadTargetModule('keycrm/keycrm-normalizer.ts');
 const raw={id:671,created_at:'2024-01-01T00:10:00Z',source_uuid:'original-source-671',grand_total:'1.00',currency_code:'EUR',buyer:{full_name:'Synthetic'},products:[],payments:[]};
 const result=normalizeKeycrmOrder(raw,{connectionKey:'synthetic',defaultCurrency:'EUR',sourceNames:{}});assert.equal(result.number,'24-671');assert.equal(result.externalId,'671');assert.equal(result.externalNumber,'original-source-671');
});

test('cart reserves once, skips the shared sequence and keeps its number after binding',async()=>{
 const {WebsiteOrdersService}=loadTargetModule('website-orders/website-orders.service.ts');
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['calendar.yoleotard.com']);
 const source='calendar.yoleotard.com',cart='a'.repeat(64),p=websitePayload();
 await assert.rejects(service.reserveNumber('foreign.example',cart),{status:403});
 const first=await service.reserveNumber(source,cart);
 assert.equal(db.state.order.length,0);
 assert.deepEqual(await service.reserveNumber(source,cart),first);
 assert.notEqual(await db.$transaction(tx=>numbering.nextOrderNumber(tx)),first.orderNumber);
 await service.reserveNumber(source,cart,p.order.externalId);
 await assert.rejects(service.reserveNumber(source,cart,'different-order'),{status:409});
 p.order.numberReservation=cart;
 p.order.paymentStatus='paid';
 p.payment={externalId:'receipt-123',provider:'monobank',reference:'synthetic-invoice-id',merchantReference:'26-999',amountMinor:p.totals.chargedMinor,currency:'EUR',status:'paid',receivedAt:p.order.orderedAt};
 await assert.rejects(service.ingest(p),{status:409});
 assert.equal(db.state.order.length,0);
 const checkoutTest=process.env.YO_CHECKOUT_MONOBANK_TEST;
 p.payment.merchantReference=checkoutTest
  ? JSON.parse(execFileSync('php',[checkoutTest],{encoding:'utf8',env:{...process.env,YO_SYNTHETIC_CART_NUMBER:first.orderNumber}})).reference
  : first.orderNumber;
 assert.equal(p.payment.merchantReference,first.orderNumber);
 const order=await service.ingest(p);
 assert.equal(order.orderNumber,first.orderNumber);
 assert.ok(db.state.order[0].websiteNoticeAt instanceof Date);
 assert.equal((await service.ingest(p)).orderNumber,first.orderNumber);
 assert.equal(db.state.payment.length,1);
});

test('scoped Monobank test payment is recorded on an archived order without tax capture',async()=>{
 const {WebsiteOrdersService}=loadTargetModule('website-orders/website-orders.service.ts');
 const db=websiteDatabase();
 const service=new WebsiteOrdersService(db,{capturePayment:async()=>assert.fail('sandbox payment reached taxes')});
 const source='calendar.yoleotard.com',cart='b'.repeat(64),p=websitePayload();
 const {orderNumber}=await service.reserveNumber(source,cart,undefined,source);
 await service.reserveNumber(source,cart,p.order.externalId,source);
 p.order.numberReservation=cart;
 p.order.paymentStatus='paid';
 p.payment={provider:'monobank',testMode:true,reference:'sandbox-invoice',merchantReference:orderNumber,amountMinor:p.totals.chargedMinor,currency:'EUR',status:'paid',receivedAt:p.order.orderedAt};
 await assert.rejects(service.ingest(p),{status:503});
 const result=await service.ingest(p,source);
 assert.equal(result.orderNumber,orderNumber);
 assert.equal(result.paymentStatus,'PAID');
 assert.ok(db.state.order[0].archivedAt);
 assert.equal(db.state.order[0].websiteNoticeAt,null);
 assert.equal(db.state.payment[0].externalStatus,'sandbox_paid');
 assert.equal((await service.ingest(p,source)).created,false);
 assert.equal(db.state.payment.length,1);
});
