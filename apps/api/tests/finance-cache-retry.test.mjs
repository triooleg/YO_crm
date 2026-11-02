import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {readRetryableFinanceSnapshot}=loadTargetModule('finance/finance-cache-retry.ts');
const result=(partial,age=31000)=>({payload:{partial},hit:true,key:'k',sourceRevision:'r',calculatedAt:new Date(100000-age).toISOString()});
test('only retryable incomplete reports expire; old complete and deterministic pending snapshots survive',async()=>{
 for(const value of [result(false),result(true,100)]){
  let expires=0,reads=0;const cache={read:async()=>{reads++;return value;},expire:async()=>{expires++;}};
  assert.equal(await readRetryableFinanceSnapshot(cache,{},async()=>{},async()=>{},p=>p.partial,()=>100000),value);
  assert.equal(expires,0);assert.equal(reads,1);
 }
});
test('expired provider failure uses CAS expiration then observes one newly calculated winner',async()=>{
 let reads=0,expired;const old=result(true),fresh={...result(false,0),hit:false};
 const cache={read:async()=>++reads===1?old:fresh,expire:async value=>{expired=value;return true;}};
 assert.equal(await readRetryableFinanceSnapshot(cache,{},async()=>{},async()=>{},p=>p.partial,()=>100000),fresh);
 assert.equal(expired,old);assert.equal(reads,2);
});
test('failed expiration never accepts the same expired artifact as refreshed',async()=>{
 const old=result(true),cache={read:async()=>old,expire:async()=>false};
 assert.equal(await readRetryableFinanceSnapshot(cache,{},async()=>{},async()=>{},p=>p.partial,()=>100000),null);
});
