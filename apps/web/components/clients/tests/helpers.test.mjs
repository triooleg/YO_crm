import assert from 'node:assert/strict';
import test from 'node:test';
import {readWorkspaceQuery, workspaceUrl, listQuery, safeRelativeReturn, mergeInput,createClientBody} from '../helpers.mjs';
import {mergeComparisonFields,measurementIsStale,clientForNewOrder} from '../helpers.mjs';

test('merge fields are compared independently from blocking operation conflicts',()=>{
 const fields=mergeComparisonFields([{displayName:'One',country:'Ukraine',email:'a@example.test'},{displayName:'Two',country:'France',email:'b@example.test'}]);
 assert.deepEqual(fields,['displayName','country','email']);assert.ok(!fields.includes('notes'));
 assert.deepEqual(mergeComparisonFields([{country:'France'},{country:'France'}]),[]);
});
test('new orders exclude stale snapshots by default and retain original immutable measurements',()=>{
 const old={id:'old',measuredAt:new Date(Date.now()-181*86400000).toISOString()},fresh={id:'fresh',measuredAt:new Date().toISOString()};
 const client={id:'client',athletes:[{id:'athlete',measurements:[fresh,old]}]};
 assert.equal(measurementIsStale(old),true);assert.equal(measurementIsStale(fresh),false);assert.equal(measurementIsStale({measuredAt:'invalid'}),true);
 assert.deepEqual(clientForNewOrder(client).athletes[0].measurements,[fresh]);assert.deepEqual(client.athletes[0].measurements,[fresh,old]);assert.equal(clientForNewOrder(client,true),client);
});
test('deep linked client is independent of list page and filters survive return',()=>{
 const state=readWorkspaceQuery('?section=clients&page=3&pageSize=50&search=Анна&clientId=outside&tab=orders&period=2026-10');
 assert.equal(state.clientId,'outside');assert.equal(state.page,3);assert.equal(state.pageSize,50);
 const url=workspaceUrl('/?section=clients&unrelated=keep',state);
 assert.match(url,/clientId=outside/);assert.match(url,/unrelated=keep/);assert.equal(new URL(url,'http://crm').searchParams.get('search'),'Анна');
 assert.equal(new URLSearchParams(listQuery(state)).get('view'),'workspace');
});
test('invalid paging, sorting and periods fall back to safe defaults',()=>{
 const state=readWorkspaceQuery('?page=-9&pageSize=100000&sort=sql&direction=no&period=2026-99&tab=unsafe');
 assert.equal(state.page,1);assert.equal(state.pageSize,20);assert.equal(state.sort,'createdAt');assert.equal(state.direction,'desc');assert.equal(state.period,'');assert.equal(state.tab,'overview');
});
test('return navigation accepts relative CRM urls only',()=>{
 for(const value of ['https://evil.test','//evil.test','/\\evil.test','javascript:alert(1)','/\n/evil']) assert.equal(safeRelativeReturn(value),undefined);
 assert.equal(safeRelativeReturn('/?section=clients&clientId=a'), '/?section=clients&clientId=a');
});
test('merge preview uses unique sources and cannot include the target as source',()=>{
 assert.deepEqual(mergeInput('a',['a','b','b','c'],{email:'a'}),{sourceClientIds:['b','c'],fieldChoices:{email:'a'}});
 assert.throws(()=>mergeInput('a',['a'],{}));
});

test('creation normalizes email and omits blank enum and optional fields',()=>{
 assert.deepEqual(createClientBody({firstName:'  Анна  ',email:'  A@Example.com ',lastName:'',preferredChannel:'',phone:' +380 123 '}),{firstName:'Анна',email:'a@example.com',phone:'+380 123'});
});
test('selecting another client clears obsolete order action but preserves unrelated return context',()=>{
 const state=readWorkspaceQuery('?clientId=b');const url=workspaceUrl('/?section=clients&clientId=a&orderId=old&action=new-order&returnConversationId=chat',state);
 assert.equal(new URL(url,'http://crm').searchParams.has('orderId'),false);assert.equal(new URL(url,'http://crm').searchParams.has('action'),false);assert.match(url,/returnConversationId=chat/);
});
