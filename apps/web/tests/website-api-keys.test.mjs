import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebsiteKeysSession } from '../lib/website-api-keys.ts';

const secret='yo_crm_v1_0123456789abcdef_'+'a'.repeat(43);
const key={id:'key-1',name:'WordPress',selector:'0123456789abcdef',sourceAccount:'calendar.yoleotard.com',createdAt:'2026-10-21T00:00:00Z',lastUsedAt:null,revokedAt:null,createdById:'owner',revokedById:null,rotatedFromId:null};
const response=value=>({ok:true,status:200,json:async()=>value});
test('create uses fresh CSRF/password/confirmation, reveals once and never includes secret in metadata',async()=>{
 const calls=[];
 const session=createWebsiteKeysSession(async(url,init)=>{calls.push({url,init});return response(init.method==='POST'?{key,secret}:{keys:[],csrfToken:'csrf-one',legacyConfigured:true});});
 await session.refresh();
 await session.submit({kind:'create',name:'WordPress',currentPassword:'synthetic-password',confirmed:true});
 assert.equal(calls[1].url,'/api/auth/website-api-keys');
 assert.equal(calls[1].init.headers['x-website-key-csrf'],'csrf-one');
 assert.deepEqual(JSON.parse(calls[1].init.body),{name:'WordPress',sourceAccount:'calendar.yoleotard.com',currentPassword:'synthetic-password',confirmed:true});
 assert.equal(session.getSnapshot().secret,secret);
 assert.equal(JSON.stringify(session.getSnapshot().keys).includes(secret),false);
 session.dismissSecret();assert.equal(session.getSnapshot().secret,null);
 await session.refresh();assert.equal(session.getSnapshot().secret,null);
});

test('unmount/auth refresh discards an in-flight secret and fetches a new CSRF',async()=>{
 let finish;let loads=0;const calls=[];
 const session=createWebsiteKeysSession(async(url,init)=>{calls.push(init);if(init.method==='POST')return new Promise(resolve=>{finish=resolve});return response({keys:[],csrfToken:'csrf-'+(++loads),legacyConfigured:false});});
 await session.refresh();const command={kind:'create',name:'WordPress',currentPassword:'never-retain',confirmed:true};const pending=session.submit(command);
 session.dispose();finish(response({key,secret}));assert.equal(await pending,false);assert.equal(session.getSnapshot().secret,null);assert.equal(command.currentPassword,'');
 await session.refresh();assert.equal(session.getSnapshot().ready,true);
 const next=session.submit({kind:'create',name:'Again',currentPassword:'p',confirmed:true});assert.equal(calls.at(-1).headers['x-website-key-csrf'],'csrf-2');session.dispose();finish(response({key,secret}));await next;assert.equal(session.getSnapshot().secret,null);
});

test('rotate sends the edited site account, keeps old key active; revoke retains metadata/history without another reveal',async()=>{
 const rotated={...key,id:'key-2',name:'Replacement',sourceAccount:'shop.yoleotard.com',rotatedFromId:key.id};let post=0;const calls=[];
 const session=createWebsiteKeysSession(async(url,init)=>{calls.push({url,init});return response(init.method==='GET'?{keys:[key],csrfToken:'fresh',legacyConfigured:true}:++post===1?{key:rotated,secret}:{key:{...key,revokedAt:'2026-10-22T00:00:00Z',revokedById:'owner'}});});
 await session.refresh();await session.submit({kind:'rotate',id:key.id,name:'Replacement',sourceAccount:' shop.yoleotard.com ',currentPassword:'p',confirmed:true});
 assert.equal(session.getSnapshot().keys.find(k=>k.id===key.id).revokedAt,null);assert.equal(session.getSnapshot().keys.length,2);
 assert.equal(calls[1].url,'/api/auth/website-api-keys/key-1/rotate');assert.equal(JSON.parse(calls[1].init.body).sourceAccount,'shop.yoleotard.com');
 session.dismissSecret();await session.submit({kind:'revoke',id:key.id,currentPassword:'p',confirmed:true});assert.equal(session.getSnapshot().keys.length,2);assert.equal(session.getSnapshot().secret,null);assert.equal(session.getSnapshot().keys[0].revokedAt,null);assert.ok(session.getSnapshot().keys.find(k=>k.id===key.id).revokedAt);
});

test('missing password/explicit confirmation never posts; server payload errors are never reflected',async()=>{
 let posts=0;const session=createWebsiteKeysSession(async(url,init)=>{if(init.method==='GET')return response({keys:[],csrfToken:'fresh',legacyConfigured:false});posts++;return {ok:false,status:400,json:async()=>({message:secret})};});
 await session.refresh();for(const input of [{currentPassword:'',confirmed:true},{currentPassword:'p',confirmed:false}])assert.equal(await session.submit({kind:'create',name:'Website',...input}),false);
 assert.equal(posts,0);await session.submit({kind:'create',name:'Website',currentPassword:'p',confirmed:true});assert.equal(session.getSnapshot().error,'save');assert.equal(JSON.stringify(session.getSnapshot()).includes(secret),false);
});

test('an older GET cannot restore old CSRF or metadata after account refresh',async()=>{
 let finish;const calls=[];let gets=0;
 const session=createWebsiteKeysSession(async(url,init)=>{calls.push(init);if(init.method==='POST')return response({key,secret});if(++gets===1)return new Promise(resolve=>{finish=resolve});return response({keys:[],csrfToken:'new-session',legacyConfigured:false});});
 const old=session.refresh();session.dispose();await session.refresh();finish(response({keys:[key],csrfToken:'old-session',legacyConfigured:true}));await old;
 assert.deepEqual(session.getSnapshot().keys,[]);assert.equal(session.getSnapshot().legacyConfigured,false);
 await session.submit({kind:'create',name:'WordPress',currentPassword:'p',confirmed:true});assert.equal(calls.at(-1).headers['x-website-key-csrf'],'new-session');
});

test('busy and open one-time secret prevent duplicate mutations and a second reveal',async()=>{
 let finish,posts=0;
 const session=createWebsiteKeysSession(async(url,init)=>{if(init.method==='GET')return response({keys:[],csrfToken:'fresh',legacyConfigured:false});posts++;return new Promise(resolve=>{finish=resolve});});
 await session.refresh();const command=()=>({kind:'create',name:'WordPress',currentPassword:'p',confirmed:true});const first=session.submit(command());assert.equal(await session.submit(command()),false);assert.equal(posts,1);
 finish(response({key:{...key,digest:'never-list-this',secret},secret}));await first;assert.equal(await session.submit(command()),false);assert.equal(posts,1);assert.equal('digest' in session.getSnapshot().keys[0],false);assert.equal('secret' in session.getSnapshot().keys[0],false);
});

test('403 invalidates CSRF and blocks writes until a fresh GET, without consuming error payload',async()=>{
 let posts=0,gets=0;
 const session=createWebsiteKeysSession(async(url,init)=>{if(init.method==='GET'){gets++;return response({keys:[],csrfToken:'csrf-'+gets,legacyConfigured:false});}posts++;return {ok:false,status:403,json:async()=>{throw new Error('must never read request/secret echo');}};});
 await session.refresh();const command=()=>({kind:'create',name:'WordPress',currentPassword:'p',confirmed:true});await session.submit(command());assert.equal(session.getSnapshot().ready,false);assert.equal(session.getSnapshot().error,'session');assert.equal(await session.submit(command()),false);assert.equal(posts,1);await session.refresh();assert.equal(session.getSnapshot().ready,true);assert.equal(gets,2);
});

test('API-contract names of100 characters are accepted without truncation',async()=>{
 let sent;const session=createWebsiteKeysSession(async(url,init)=>{if(init.method==='GET')return response({keys:[],csrfToken:'fresh',legacyConfigured:false});sent=JSON.parse(init.body);return response({key:{...key,name:sent.name},secret});});
 await session.refresh();assert.equal(await session.submit({kind:'create',name:'Я'.repeat(100),currentPassword:'p',confirmed:true}),true);assert.equal(sent.name,'Я'.repeat(100));
});
