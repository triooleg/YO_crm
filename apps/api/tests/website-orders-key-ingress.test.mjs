import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTargetModule } from './website-test-loader.mjs';
import { websitePayload } from './fixtures/website-orders.mjs';
import { websiteDatabase } from './fixtures/website-orders-database.mjs';
const security = loadTargetModule('website-orders/website-orders-security.ts');
const contract = loadTargetModule('website-orders/website-orders-contract.ts');

test('source canonicalization is shared and rejects URL-like or malformed account grants', () => {
  assert.equal(contract.normalizeWebsiteSourceAccount(' Calendar.Yoleotard.COM '), 'calendar.yoleotard.com');
  for (const value of [null, '', 'https://calendar.yoleotard.com', 'calendar.yoleotard.com/path', 'calendar..yoleotard.com']) {
    assert.throws(() => contract.normalizeWebsiteSourceAccount(value));
  }
});

test('async website ingress authenticates before advancing to bounded body parsing', async () => {
  const principal = {kind:'key', id:'synthetic-key', sourceAccount:'calendar.yoleotard.com'};
  const request = {headers:{authorization:'Bearer synthetic-only'}};
  let next = 0;
  const response = {setHeader(){}, status(){throw new Error('unexpected failure');}};
  const middleware = security.createWebsiteOrdersSecurity({async authenticate(header){assert.equal(header,request.headers.authorization);return principal;}});
  await middleware(request,response,()=>next++);
  assert.equal(next,1);
  assert.deepEqual(security.websiteOrderPrincipal(request),principal);
  assert.ok(!JSON.stringify(request).includes('synthetic-key'), 'trusted grant is not a serialized request body field');
});

test('ingress authentication failure never advances or exposes internal errors', async () => {
  let next = 0, status, body;
  const response = {setHeader(){},status(value){status=value;return this;},json(value){body=value;}};
  await security.createWebsiteOrdersSecurity({async authenticate(){throw new Error('PRIVATE_DATABASE_DETAIL');}})({headers:{}},response,()=>next++);
  assert.equal(next,0);
  assert.equal(status,503);
  assert.ok(!JSON.stringify(body).includes('PRIVATE_DATABASE_DETAIL'));
});

test('serialized client fields cannot fabricate an authenticated website principal', () => {
  assert.throws(()=>security.websiteOrderPrincipal({body:{principal:{kind:'key',sourceAccount:'calendar.yoleotard.com'}}}),error=>error.code==='WEBSITE_UNAUTHORIZED');
});

test('guard fallback forwards trusted IP and does not authenticate an established middleware principal twice', async () => {
  const attempts=[];
  const authenticator={async authenticate(header,ip){attempts.push([header,ip]);return {kind:'key',id:'test',sourceAccount:'calendar.yoleotard.com'};}};
  const guard=new security.WebsiteOrdersGuard(authenticator);
  const request={headers:{authorization:'Bearer test'},ip:'127.0.0.42'};
  const context={switchToHttp:()=>({getRequest:()=>request})};
  await guard.canActivate(context);
  await guard.canActivate(context);
  assert.deepEqual(attempts,[['Bearer test','127.0.0.42']]);
  const throughMiddleware={headers:{authorization:'Bearer second'},ip:'127.0.0.43'};
  await security.createWebsiteOrdersSecurity(authenticator)(throughMiddleware,{setHeader(){}},()=>{});
  await guard.canActivate({switchToHttp:()=>({getRequest:()=>throughMiddleware})});
  assert.deepEqual(attempts,[['Bearer test','127.0.0.42'],['Bearer second','127.0.0.43']]);
});

test('scoped website ingestion bypasses no legacy gate unless a matching trusted account is supplied', async () => {
  const {WebsiteOrdersService}=loadTargetModule('website-orders/website-orders.service.ts');
  const db=websiteDatabase(), service=new WebsiteOrdersService(db,{capturePayment:async()=>{}},()=>[]);
  await assert.rejects(service.ingest(websitePayload()),error=>error.code==='WEBSITE_DISABLED');
  await assert.rejects(service.ingest(websitePayload(),'other.example.invalid'),error=>error.code==='WEBSITE_SOURCE_NOT_ALLOWED');
  assert.equal(db.state.order.length,0);
  const first=await service.ingest(websitePayload(),'calendar.yoleotard.com');
  const retry=await service.ingest(websitePayload(),'calendar.yoleotard.com');
  assert.equal(first.orderId,retry.orderId);
  assert.equal(db.state.order.length,1);
  assert.equal(db.state.orderItemInstance.length,2);
  assert.equal(db.state.payment.length,0);
  const fabricated={...websitePayload(),authorizedSourceAccount:'calendar.yoleotard.com'};
  await assert.rejects(service.ingest(fabricated),error=>error.code==='WEBSITE_INVALID_PAYLOAD');
});
