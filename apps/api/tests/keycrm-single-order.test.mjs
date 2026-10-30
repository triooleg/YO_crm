import test from 'node:test';
import assert from 'node:assert/strict';
import { KeycrmClient, ORDER_INCLUDES } from '../src/keycrm/keycrm-client.ts';

test('single-order fetch requests exactly the selected ID with the complete import relationships', async () => {
  const calls=[];
  const client=new KeycrmClient('synthetic-only',async (url,options)=>{
    calls.push({url:new URL(url),method:options.method});
    return Response.json({id:1234,source_id:1,buyer:{id:9},products:[],payments:[]});
  });
  const order=await client.getImportOrder('1234');
  assert.equal(order.id,1234);
  assert.equal(calls.length,1);
  assert.equal(calls[0].method,'GET');
  assert.equal(calls[0].url.pathname,'/v1/order/1234');
  assert.equal(calls[0].url.searchParams.get('include'),ORDER_INCLUDES);
});

test('missing single order reports not found without falling back to the order list', async () => {
  const urls=[];
  const client=new KeycrmClient('synthetic-only',async url=>{
    urls.push(new URL(url).pathname);return new Response('',{status:404});
  });
  await assert.rejects(()=>client.getImportOrder('1234'),error=>error.getStatus()===404);
  assert.deepEqual(urls,['/v1/order/1234']);
});

test('single-order fetch rejects a different or malformed provider ID before returning import data', async () => {
  for(const body of [{id:1235},null,{}, {id:'1234'}, {id:9007199254740992}]){
    const client=new KeycrmClient('synthetic-only',async()=>Response.json(body));
    await assert.rejects(()=>client.getImportOrder('1234'));
  }
});
