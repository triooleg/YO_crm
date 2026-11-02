import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinanceRequestCoordinator, canonicalFinanceRequest } from '../lib/finance-request-coordinator.ts';

test('summary sharing ignores detail evidence projection while detail requests retain it',()=>{
 assert.equal(canonicalFinanceRequest('/api/finance/report?projection=summary&evidence=page'),canonicalFinanceRequest('/api/finance/report?projection=summary'));
 assert.notEqual(canonicalFinanceRequest('/api/finance/report?evidence=page'),canonicalFinanceRequest('/api/finance/report'));
});

test('Overview and Finance share one in-flight canonical report, with independent response bodies', async () => {
  let calls=0, release;
  const coordinator=createFinanceRequestCoordinator(async()=>{calls++;await new Promise(resolve=>release=resolve);return new Response('{"value":7}');});
  const a=coordinator.request('/api/finance/report?month=2026-11&currency=EUR&tab=payments&page=1','OWNER');
  const b=coordinator.request('/api/finance/report?pageSize=10&month=2026-11&sort=date&scope=all','OWNER');
  assert.equal(calls,1);release();
  const [ra,rb]=await Promise.all([a,b]);
  assert.deepEqual(await ra.json(),{value:7});assert.deepEqual(await rb.json(),{value:7});
});
test('completed reports are revalidated, roles and valuation versions never share a request', async()=>{
  let calls=0;
  const c=createFinanceRequestCoordinator(async()=>{calls++;return new Response('{}');});
  await c.request('/api/finance/report','OWNER');await c.request('/api/finance/report','OWNER');assert.equal(calls,2);
  await Promise.all([c.request('/api/finance/report?valuationVersion=a','OWNER'),c.request('/api/finance/report?valuationVersion=b','OWNER'),c.request('/api/finance/report?valuationVersion=a','ACCOUNTANT')]);assert.equal(calls,5);
});
test('one cancelled observer does not abort another; invalidation prevents stale in-flight reuse', async()=>{
  let calls=0;const releases=[];
  const c=createFinanceRequestCoordinator(async()=>{calls++;await new Promise(resolve=>releases.push(resolve));return new Response('{}');});
  const abort=new AbortController();
  const a=c.request('/api/finance/report','OWNER',{signal:abort.signal});
  const b=c.request('/api/finance/report','OWNER');abort.abort();
  await assert.rejects(a,{name:'AbortError'});c.invalidate();
  const fresh=c.request('/api/finance/report','OWNER');assert.equal(calls,2);
  const stale=assert.rejects(b,{name:'AbortError'});releases.forEach(fn=>fn());await Promise.all([stale,fresh]);
});
test('logout/login of the same role cannot receive a previous session financial response',async()=>{
 let calls=0;const releases=[];
 const c=createFinanceRequestCoordinator(async()=>{const session=++calls;await new Promise(resolve=>releases.push(resolve));return new Response(JSON.stringify({session}));});
 const observer=new AbortController();
 const overview=c.request('/api/finance/report?projection=summary','OWNER',{signal:observer.signal});
 const oldConsumer=c.request('/api/finance/report?projection=summary','OWNER');
 const rejectedOverview=assert.rejects(overview,{name:'AbortError'}),rejectedConsumer=assert.rejects(oldConsumer,{name:'AbortError'});
 observer.abort();c.invalidate();
 const next=c.request('/api/finance/report?projection=summary','OWNER');
 releases.forEach(fn=>fn());
 await Promise.all([rejectedOverview,rejectedConsumer]);assert.deepEqual(await (await next).json(),{session:2});assert.equal(calls,2);
});
test('failures evict pending requests; arbitrary mutations are not coalesced',async()=>{
  let calls=0;const c=createFinanceRequestCoordinator(async()=>{calls++;if(calls===1)throw new Error('offline');return new Response('{}');});
  await assert.rejects(c.request('/api/finance/report','OWNER'),/offline/);
  await c.request('/api/finance/report','OWNER');
  await Promise.all([c.request('/api/orders/x/payments','OWNER',{method:'POST'}),c.request('/api/orders/x/payments','OWNER',{method:'POST'})]);assert.equal(calls,4);
});
test('canonicalization retains every substantive filter and summary projection',()=>{
  assert.notEqual(canonicalFinanceRequest('/api/finance/report?source=WEBSITE'),canonicalFinanceRequest('/api/finance/report'));
  assert.notEqual(canonicalFinanceRequest('/api/finance/report?projection=summary'),canonicalFinanceRequest('/api/finance/report'));
  assert.notEqual(canonicalFinanceRequest('/api/finance/report?clientId=a'),canonicalFinanceRequest('/api/finance/report?clientId=b'));
});
test('visiting a writable workspace prevents pre-mutation reports from being reused on return',async()=>{
 let amount=100,calls=0;const releases=[];
 const c=createFinanceRequestCoordinator(async()=>{calls++;const captured=amount;await new Promise(resolve=>releases.push(resolve));return new Response(JSON.stringify({amount:captured}));});
 const overview=c.request('/api/finance/report?projection=summary','OWNER');
 c.beforeNavigation('overview','finance');
 const finance=c.request('/api/finance/report?projection=summary','OWNER');assert.equal(calls,1);
 const oldA=assert.rejects(overview,{name:'AbortError'}),oldB=assert.rejects(finance,{name:'AbortError'});
 c.beforeNavigation('finance','orders');amount=200;
 c.beforeNavigation('orders','overview');
 const fresh=c.request('/api/finance/report?projection=summary','OWNER');assert.equal(calls,2);
 releases.forEach(fn=>fn());await Promise.all([oldA,oldB]);assert.deepEqual(await(await fresh).json(),{amount:200});
});
