import test from 'node:test';import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {readOriginalInstagramMessages}=loadTargetModule('history-migration/history-provider-originals.ts');
const {encryptSecret}=loadTargetModule('secret-box.ts');
process.env.SETTINGS_ENCRYPTION_KEY='synthetic-original-provider-proof-test-key';
test('native proof reader uses bounded GETs to the fixed official host and keeps credentials out of returned evidence',async()=>{
 const calls=[],token=encryptSecret('synthetic-token'),messages=[{id:'native',externalId:'mid/with+encoding='}];
 const transport=async(url,options)=>{calls.push({url:String(url),options});return new Response(JSON.stringify({id:messages[0].externalId,created_time:'2026-10-31T10:00:00+0000',from:{id:'customer'},to:{data:[{id:'business'}]},message:'Synthetic'}),{status:200})};
 const result=await readOriginalInstagramMessages(messages,'business','customer',token,transport);
 assert.equal(calls.length,1);assert.equal(new URL(calls[0].url).host,'graph.instagram.com');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.redirect,'error');
 assert.equal(calls[0].options.headers.Authorization,'Bearer synthetic-token');assert.equal(calls[0].url.includes('synthetic-token'),false);
 assert.equal(result[0].provider,'META_GRAPH_INSTAGRAM');assert.equal(result[0].messageId,'native');assert.equal(JSON.stringify(result).includes('synthetic-token'),false);
});
test('native proof refuses HTTP errors, oversized bodies, excess messages, redirects and malformed payloads without permissive fallback',async()=>{
 const token=encryptSecret('synthetic-token');
 for(const response of [new Response('{"error":{"code":190}}',{status:400}),new Response('x'.repeat(65537)),new Response('not-json'),new Response('[]'),new Response('{"error":{}}')])
  await assert.rejects(readOriginalInstagramMessages([{id:'native',externalId:'mid'}],'business','customer',token,async()=>response));
 await assert.rejects(readOriginalInstagramMessages(Array.from({length:21},(_,i)=>({id:'m'+i,externalId:'mid'+i})),'business','customer',token,async()=>{throw Error('must not run')}));
 await assert.rejects(readOriginalInstagramMessages([{id:'native',externalId:'mid'}],'business','customer','bad',async()=>{throw Error('must not run')}));
 await assert.rejects(readOriginalInstagramMessages([{id:'native',externalId:'mid'}],'business','customer',token,async()=>{throw Error('synthetic-redirect-refused')}));
});
