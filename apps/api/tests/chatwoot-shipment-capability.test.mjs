import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './website-test-loader.mjs';
const {checkChatwootShipmentCapability,clearChatwootShipmentProofs}=loadTargetModule('communications/chatwoot-shipment-capability.ts');
const input={baseUrl:'https://chat.example.test',token:'synthetic-token',accountId:'2',inboxId:'3',providerConversationId:'42',conversationId:'local-chat',externalId:'2:person',allowLookup:true};
const response=body=>new Response(JSON.stringify(body),{status:200});
test('historical Chatwoot website context is proved by scoped conversation and inbox GET; cache prevents network in transaction',async()=>{
 clearChatwootShipmentProofs();const calls=[];
 const fetcher=async(url,init)=>{calls.push(url);assert.equal(init.redirect,'error');return response(url.endsWith('/inboxes/3')?{id:3,channel_type:'Channel::WebWidget'}:{id:42,inbox_id:3,account_id:2})};
 assert.equal(await checkChatwootShipmentCapability(input,fetcher),true);assert.equal(calls.length,2);
 assert.equal(await checkChatwootShipmentCapability({...input,allowLookup:false},async()=>{throw new Error('must not fetch inside transaction')}),true);
 assert.equal(await checkChatwootShipmentCapability({...input,externalId:'changed',allowLookup:false},fetcher),false);
});
for(const [label,conversation,inbox] of [
 ['wrong conversation',{id:99,inbox_id:3},{id:3,channel_type:'Channel::WebWidget'}],
 ['wrong inbox',{id:42,inbox_id:4},{id:3,channel_type:'Channel::WebWidget'}],
 ['wrong account',{id:42,inbox_id:3,account_id:9},{id:3,channel_type:'Channel::WebWidget'}],
 ['Meta relay',{id:42,inbox_id:3},{id:3,channel_type:'Channel::FacebookPage'}],
 ['unproven API relay',{id:42,inbox_id:3},{id:3,channel_type:'Channel::Api'}],
]) test(`Chatwoot proof rejects ${label}`,async()=>{clearChatwootShipmentProofs();assert.equal(await checkChatwootShipmentCapability(input,async url=>response(url.endsWith('/inboxes/3')?inbox:conversation)),false)});
test('lookup failures, unsafe URL, invalid IDs and absent proof never permit a send',async()=>{
 clearChatwootShipmentProofs();assert.equal(await checkChatwootShipmentCapability(input,async()=>{throw new Error('unavailable')}),false);
 for(const patch of [{baseUrl:'http://unsafe.test'},{providerConversationId:'42/../9'},{accountId:''},{token:''}]) assert.equal(await checkChatwootShipmentCapability({...input,...patch},async()=>{throw new Error('must not fetch')}),false);
});
