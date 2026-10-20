import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {loadTargetModule} from './website-test-loader.mjs';
import {websiteDatabase} from './fixtures/website-orders-database.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/checkout-v518.json',import.meta.url),'utf8'));
const {parseWebsiteOrder}=loadTargetModule('website-orders/website-orders-contract.ts');
const {WebsiteOrdersService}=loadTargetModule('website-orders/website-orders.service.ts');
const source='D:/Projects/CheckoutV2/yoleotard-checkout-invoice/includes/class-yo-checkout-yocrm.php';
const php=spawnSync('php',['--version'],{encoding:'utf8',timeout:10000});

test('Checkout 5.1.8 fixture preserves actual colon identities, optional empties and PHP array shapes',()=>{
 const bank=fixture.cases.find(c=>c.name==='unpaid-bank').payload;
 const paid=fixture.cases.find(c=>c.name==='paid-card').payload;
 assert.equal(fixture.pluginVersion,'5.1.8');
 assert.deepEqual(bank.items.map(i=>i.externalId),['518:item-1:101:fit-blue','518:item-2:202:standard']);
 assert.equal(paid.payment.externalId,'518:monobank:synthetic-invoice');
 assert.equal(bank.order.externalNumber,'');assert.equal(bank.customer.phone,'');assert.equal(bank.customer.addressLine2,'');
 assert.equal(bank.delivery.serviceName,'');assert.equal(bank.items[1].imageUrl,'');assert.equal(bank.items[1].notes,'');
 assert.equal(bank.order.checkoutMode,'bank_invoice');assert.equal(bank.order.paymentStatus,'unpaid');assert.ok(!Object.hasOwn(bank,'payment'));
 assert.equal(paid.order.paymentStatus,'paid');assert.equal(paid.payment.receivedAt,'2026-10-20T12:05:00+00:00');
 assert.deepEqual(bank.items[0].selectedServices,[{key:'size_adaptation',label:'Size adaptation',priceMinor:1000}]);
 assert.deepEqual(bank.items[0].reductions,{waist:2});assert.deepEqual(bank.items[0].adjustedMeasurements,{waist:[60.5,61]});
 assert.deepEqual(bank.items[1].selectedServices,[]);assert.deepEqual(bank.items[1].reductions,[]);assert.deepEqual(bank.items[1].adjustedMeasurements,[]);
 assert.deepEqual(bank.items[1].properties,{configurationKey:'standard',selectedServices:[],reductionsCm:[],adjustedMeasurementsCm:[]});
 assert.deepEqual(bank.totals,{itemsMinor:15000,discountMinor:2000,deliveryMinor:1000,cardFeeMinor:0,chargedMinor:16000});
 assert.deepEqual(paid.totals,{itemsMinor:15000,discountMinor:2000,deliveryMinor:1000,cardFeeMinor:480,chargedMinor:16480});
});

for(const example of fixture.cases){
 test(`actual PHP build_payload matches complete saved synthetic oracle: ${example.name}`,{skip:!existsSync(source)||php.status!==0},()=>{
  assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'),fixture.sourceSha256,'Plugin source changed: review and regenerate oracle explicitly');
  const result=spawnSync('php',['-r',fixture.phpHarness,source],{input:JSON.stringify(example.input),encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');
  assert.deepEqual(JSON.parse(result.stdout),example.payload);
 });

 test(`CRM public parser accepts unmodified real Checkout payload: ${example.name}`,()=>{
  const payload=structuredClone(example.payload),before=structuredClone(payload);
  const parsed=parseWebsiteOrder(payload);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.raw)),before);
  assert.deepEqual(payload,before);
  assert.equal(parsed.items.length,2);assert.equal(parsed.totals.chargedMinor,before.totals.chargedMinor);
  assert.equal(parsed.payment?.externalId,before.payment?.externalId);
 });
}

test('actual plugin unpaid then paid ingest preserves two lines, raw properties and a single immutable receipt on retry',async()=>{
 const bank=fixture.cases.find(c=>c.name==='unpaid-bank').payload;
 const paid=fixture.cases.find(c=>c.name==='paid-card').payload;
 const db=websiteDatabase(),service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>['shop.example.invalid']);
 const first=await service.ingest(structuredClone(bank));
 assert.equal(first.paymentStatus,'UNPAID');assert.equal(db.state.payment.length,0);
 assert.equal(db.state.order[0].priceMinor,16000);assert.equal(db.state.order[0].discountMinor,2000);
 assert.equal(db.state.orderItem.length,2);assert.equal(db.state.orderItemInstance.length,2);
 for(let index=0;index<2;index++){
  assert.equal(db.state.orderItem[index].externalId,JSON.stringify(['518',bank.items[index].externalId]));
  assert.equal(db.state.orderItem[index].priceMinor,bank.items[index].unitPriceMinor);
  assert.deepEqual(db.state.orderItem[index].properties.originalProperties,bank.items[index].properties);
 }
 assert.deepEqual(db.state.order[0].externalData,bank);
 const second=await service.ingest(structuredClone(paid));
 assert.equal(second.orderId,first.orderId);assert.equal(second.clientId,first.clientId);assert.equal(second.paymentStatus,'PAID');
 assert.equal(db.state.client.length,1);assert.equal(db.state.order.length,1);assert.equal(db.state.orderItem.length,2);
 assert.equal(db.state.order[0].priceMinor,16480);assert.equal(db.state.payment.length,1);
 assert.equal(db.state.payment[0].externalId,'["518","518:monobank:synthetic-invoice"]');
 assert.equal(db.state.payment[0].amountMinor,16480);assert.equal(db.state.payment[0].currency,'EUR');
 assert.deepEqual(db.state.order[0].externalData,paid);
 const before=structuredClone(db.state);await service.ingest(structuredClone(paid));assert.deepEqual(db.state,before);
});

test('plugin-compatible optional empties do not admit nonempty arrays, scalars or corrupted net totals',()=>{
 const example=fixture.cases.find(c=>c.name==='paid-card').payload;
 for(const key of ['properties','reductions','adjustedMeasurements'])for(const value of [[{}],['unexpected'],'unexpected',1,true]){
  const p=structuredClone(example);p.items[1][key]=value;
  assert.throws(()=>parseWebsiteOrder(p),e=>e.code==='WEBSITE_INVALID_PAYLOAD');
 }
 for(const mutate of [p=>p.totals.chargedMinor--,p=>p.totals.itemsMinor++,p=>p.delivery.amountMinor++,p=>p.payment.amountMinor--,p=>p.totals.cardFeeMinor=-1]){
  const p=structuredClone(example);mutate(p);assert.throws(()=>parseWebsiteOrder(p),e=>e.code.startsWith('WEBSITE_'));
 }
});
