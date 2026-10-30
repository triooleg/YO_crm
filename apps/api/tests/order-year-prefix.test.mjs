import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './website-test-loader.mjs';
import {websitePayload} from './fixtures/website-orders.mjs';
import {websiteDatabase} from './fixtures/website-orders-database.mjs';
const numbering=loadTargetModule('website-orders/website-order-number.ts');
test('one lifetime sequence spans prefixes, years, archived rows and compound legacy numbers',async()=>{
 const history=[{number:'YO-707'},{number:'24-708'},{number:'26-26-0003'},{number:'YO-26-0002'},{number:'KC-12',sourceSystem:'KEYCRM',externalId:'900'}],calls=[];
 const tx={$executeRawUnsafe:async(...args)=>calls.push(args),order:{findMany:async()=>history}};
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
