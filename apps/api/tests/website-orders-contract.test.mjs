import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTargetModule } from './website-test-loader.mjs';
const { parseWebsiteOrder } = loadTargetModule('website-orders/website-orders-contract.ts');
import {websitePayload as payload} from './fixtures/website-orders.mjs';

test('v1 normalizes contacts and preserves full product evidence without charging delivery/fee twice',()=>{
 const source=payload(),result=parseWebsiteOrder(source);
 assert.equal(result.customer.email,'buyer@example.invalid');assert.equal(result.customer.phone,'+380671234567');
 assert.equal(result.totals.chargedMinor,21500);assert.equal(result.items[0].unitPriceMinor,10000);
 assert.deepEqual(JSON.parse(JSON.stringify(result.raw)),source);
});
test('calendar dates and enum values are strict while timezone offsets and international 00 phones remain supported',()=>{
 for(const mutate of [p=>p.order.orderedAt='2026-02-30T12:00:00Z',p=>p.order.paymentStatus=['paid'],p=>p.order.checkoutMode=['card'],p=>p.payment={status:['unpaid'],amountMinor:0,currency:'EUR'}]){const p=payload();mutate(p);assert.throws(()=>parseWebsiteOrder(p),e=>e.code==='WEBSITE_INVALID_PAYLOAD');}
 const p=payload();p.order.orderedAt='2026-02-28T00:30:00+02:00';p.customer.phone='00380 67 123 45 67';assert.equal(parseWebsiteOrder(p).order.orderedAt,'2026-02-27T22:30:00.000Z');assert.equal(parseWebsiteOrder(p).customer.phone,'+380671234567');
});
test('v1 rejects inconsistent totals, unsafe amounts, duplicate lines and paid without dated receipt',()=>{
 for(const change of [p=>p.totals.chargedMinor++,p=>p.items[0].quantity=1.5,p=>p.items.push({...p.items[0]}),p=>p.order.paymentStatus='paid',p=>p.totals.itemsMinor=2147483648,p=>p.secret='must-not-enter-evidence']){
  const p=payload();change(p);assert.throws(()=>parseWebsiteOrder(p),e=>e.code.startsWith('WEBSITE_'));
 }
});

test('PostgreSQL JSON strings/keys and bank invoice fee are validated before persistence',()=>{
 for(const mutate of [p=>p.items[0].properties={'bad\u0000key':'value'},p=>p.items[0].properties={nested:{value:'bad\u0000value'}},p=>p.items[0].properties={value:'\ud800'},p=>p.order.checkoutMode='bank_invoice']){
  const p=payload();mutate(p);assert.throws(()=>parseWebsiteOrder(p),e=>e.code==='WEBSITE_INVALID_PAYLOAD');
 }
});

test('direct identity uses the same canonical website marker profile as KeyCRM',()=>{
 for(const value of ['0','00123','1:a','1.5','',0]){const p=payload();p.order.externalId=value;assert.throws(()=>parseWebsiteOrder(p),e=>e.code==='WEBSITE_INVALID_PAYLOAD');}
 const p=payload();p.order.externalId='9223372036854775807';assert.equal(parseWebsiteOrder(p).order.externalId,p.order.externalId);
});
