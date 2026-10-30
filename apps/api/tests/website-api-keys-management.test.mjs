import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);require('reflect-metadata');const ts=require('typescript'),argon=require('argon2');
const cache=new Map(),root=resolve(dirname(fileURLToPath(import.meta.url)),'../src');
function load(file){file=resolve(root,file);if(cache.has(file))return cache.get(file).exports;const m={exports:{}};cache.set(file,m);const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;new Function('require','module','exports',js)(name=>name.startsWith('.')&&existsSync(resolve(dirname(file),name+'.ts'))?load(resolve(dirname(file),name+'.ts')):require(name),m,m.exports);return m.exports;}
const {WebsiteApiKeysService}=load('website-api-keys/website-api-keys.service.ts');
const {websiteApiKeysCsrf}=load('website-api-keys/website-api-keys.security.ts');
const {ServiceUnavailableException,HttpException}=require('@nestjs/common');
const password='synthetic-owner-password-only',passwordHash=await argon.hash(password,{type:argon.argon2id});
const session='s'.repeat(43),actor={id:'owner-a',role:'OWNER'},origin='https://crm.example.invalid';
process.env.WEB_ORIGIN=origin;
const ctx=()=>({sessionToken:session,ip:'127.0.0.1',origin,contentType:'application/json',csrf:websiteApiKeysCsrf(session),fetchSite:'same-origin'});
const createInput=()=>({name:'Website main',sourceAccount:' CALENDAR.YOLEOTARD.COM ',currentPassword:password,confirmed:true});
function fixture(limiter=async()=>{}){
 let state={users:[{...actor,active:true,archivedAt:null,passwordHash}],sessions:[{id:'session-a',userId:actor.id,tokenHash:createHash('sha256').update(session).digest('hex'),expiresAt:new Date(Date.now()+60_000)}],keys:[],audit:[],failAudit:false,locked:[]};let onLock;
 const select=(row,q)=>!row?null:q?.select?Object.fromEntries(Object.keys(q.select).map(k=>[k,row[k]])):row;
 const db={get state(){return state;},set onLock(value){onLock=value;},$transaction:async fn=>{const before=structuredClone(state);try{return await fn(db);}catch(e){state=before;throw e;}},
  $executeRaw:async(strings,...args)=>{assert.match(strings.join('?'),/pg_advisory_xact_lock\(hashtext\(/);state.locked.push(args[0]);onLock?.(state);return 0;},$queryRaw:async()=>[],
  user:{findFirst:async({where})=>state.users.find(u=>u.id===where.id&&u.active&&u.archivedAt===null&&u.role===where.role)??null},
  session:{findFirst:async({where})=>state.sessions.find(s=>s.userId===where.userId&&s.tokenHash===where.tokenHash&&s.expiresAt>where.expiresAt.gt)??null},
  websiteApiKey:{create:async({data,select:s})=>{const row={id:'key-'+(state.keys.length+1),lastUsedAt:null,revokedAt:null,revokedById:null,...data};state.keys.push(row);return select(row,{select:s});},
   findUnique:async q=>select(state.keys.find(k=>q.where.id?k.id===q.where.id:k.selector===q.where.selector),q),findMany:async q=>state.keys.map(k=>select(k,q)),
   update:async q=>{const row=state.keys.find(k=>k.id===q.where.id);Object.assign(row,q.data);return select(row,q);}},
  auditLog:{create:async q=>{if(state.failAudit)throw Error('Synthetic Prisma query digest=SHOULD_NOT_LEAK');state.audit.push(q.data);return q.data;}}};
 return {db,service:new WebsiteApiKeysService(db,limiter)};
}
test('management requires actual session even AUTH_DISABLED and fresh active OWNER',async()=>{
 const {db,service}=fixture();const old=process.env.AUTH_DISABLED;process.env.AUTH_DISABLED='true';
 try{db.state.sessions=[];await assert.rejects(service.list(actor,ctx()),e=>e.getStatus()===401);await assert.rejects(service.create(actor,createInput(),ctx()),e=>e.getStatus()===401);assert.equal(db.state.keys.length,0);}
 finally{if(old===undefined)delete process.env.AUTH_DISABLED;else process.env.AUTH_DISABLED=old;}
 const second=fixture();second.db.onLock=state=>{state.users[0].role='MANAGER';};await assert.rejects(second.service.create(actor,createInput(),ctx()),e=>e.getStatus()===401);assert.equal(second.db.state.keys.length,0);
});
test('create persists only a digest, exposes exact metadata and reveals secret once after atomic audit',async()=>{
 const {db,service}=fixture();const result=await service.create(actor,createInput(),ctx());
 assert.equal(result.key.sourceAccount,'calendar.yoleotard.com');assert.equal(result.key.createdById,actor.id);assert.equal(result.key.rotatedFromId,null);assert.equal(result.key.revokedById,null);
 assert.equal(db.state.locked[0],actor.id);assert.equal(db.state.audit.length,1);assert.equal(db.state.keys[0].digest.length,32);
 assert.equal(Object.keys(result.key).sort().join(','),'createdAt,createdById,id,lastUsedAt,name,revokedAt,revokedById,rotatedFromId,selector,sourceAccount');
 const listed=await service.list(actor,ctx());assert.equal(listed.csrfToken,websiteApiKeysCsrf(session));assert.equal(listed.keys.length,1);
 const journal=JSON.stringify({listed,audit:db.state.audit});assert.ok(!journal.includes(result.secret));assert.ok(!journal.includes('digest'));assert.ok(!journal.includes(password));
});
test('password is rechecked from fresh row after native user lock',async()=>{
 const {db,service}=fixture();const newer=await argon.hash('different-synthetic-password');db.onLock=state=>{state.users[0].passwordHash=newer;};
 await assert.rejects(service.create(actor,createInput(),ctx()),e=>e.getStatus()===401);assert.equal(db.state.keys.length,0);
});
test('audit failure rolls back key creation and exposes neither secret nor raw query',async()=>{
 const {db,service}=fixture();db.state.failAudit=true;
 await assert.rejects(service.create(actor,createInput(),ctx()),e=>e.getStatus()===503&&!e.message.includes('digest')&&!e.message.includes('SHOULD_NOT_LEAK'));
 assert.equal(db.state.keys.length,0);assert.equal(db.state.audit.length,0);
});
test('rotation can bind the replacement to another canonical site account without mutating the old key',async()=>{
 const {db,service}=fixture();const first=await service.create(actor,createInput(),ctx());
 const second=await service.rotate(actor,first.key.id,{name:'Next key',sourceAccount:' SHOP.YOLEOTARD.COM ',currentPassword:password,confirmed:true},ctx());
 assert.equal(second.key.rotatedFromId,first.key.id);assert.equal(second.key.sourceAccount,'shop.yoleotard.com');assert.equal(db.state.keys[0].sourceAccount,'calendar.yoleotard.com');assert.notEqual(second.secret,first.secret);assert.ok(db.state.keys.every(k=>!k.revokedAt));
 await service.revoke(actor,first.key.id,{currentPassword:password,confirmed:true},ctx());const n=db.state.audit.length;
 await service.revoke(actor,first.key.id,{currentPassword:password,confirmed:true},ctx());assert.equal(db.state.audit.length,n);assert.equal(db.state.keys[0].revokedById,actor.id);assert.equal(db.state.keys[1].revokedAt,null);
 await assert.rejects(service.revoke(actor,first.key.id,{currentPassword:'wrong',confirmed:true},ctx()),e=>e.getStatus()===401);
});
test('rotation rejects a missing or malformed replacement account without creating a key',async()=>{
 const {db,service}=fixture();const first=await service.create(actor,createInput(),ctx());
 for(const body of [{name:'Next key',currentPassword:password,confirmed:true},{name:'Next key',sourceAccount:'https://shop.yoleotard.com/path',currentPassword:password,confirmed:true}])await assert.rejects(service.rotate(actor,first.key.id,body,ctx()),e=>e.getStatus()===400);
 assert.equal(db.state.keys.length,1);assert.equal(db.state.audit.length,1);
});
test('confirmation, strict fields, origin, JSON and session-bound CSRF reject without mutations',async()=>{
 const {db,service}=fixture();for(const bad of [{...createInput(),confirmed:false},{...createInput(),extra:'not allowed'},{...createInput(),sourceAccount:'other.example'},{...createInput(),name:'   '}])await assert.rejects(service.create(actor,bad,ctx()));
 for(const context of [{...ctx(),origin:'https://evil.example'},{...ctx(),contentType:'text/plain'},{...ctx(),csrf:'0'.repeat(64)},{...ctx(),fetchSite:'cross-site'},{...ctx(),sessionToken:'x'.repeat(43)}])await assert.rejects(service.create(actor,createInput(),context));
 assert.equal(db.state.keys.length,0);assert.equal(db.state.audit.length,0);
});
test('separate actor/IP Redis limits fail closed and preserve 429 without DB mutation',async()=>{
 const calls=[];const good=fixture(async(...args)=>{calls.push(args);});await good.service.create(actor,createInput(),ctx());assert.deepEqual(calls.map(c=>c[0]),['manage-ip','manage-actor']);
 for(const error of [new ServiceUnavailableException(),new HttpException('limited',429),Error('redis private detail')]){
  const {db,service}=fixture(async()=>{throw error;});await assert.rejects(service.create(actor,createInput(),ctx()),e=>e.getStatus()===(error.getStatus?.()===429?429:503));assert.equal(db.state.keys.length,0);
 }
});
test('JSON dangerous extra keys cannot be silently erased by class-transformer',async()=>{
 const {db,service}=fixture();const payload=JSON.parse(JSON.stringify(createInput()).slice(0,-1)+',"__proto__":{"ignored":true}}');
 await assert.rejects(service.create(actor,payload,ctx()),e=>e.getStatus()===400);assert.equal(db.state.keys.length,0);
});
test('configured origin remains mandatory even a same-origin GET without Origin header',async()=>{
 const {service}=fixture(),prior=process.env.WEB_ORIGIN;delete process.env.WEB_ORIGIN;
 try{await assert.rejects(service.list(actor,{...ctx(),origin:undefined}),e=>e.getStatus()===503);}
 finally{process.env.WEB_ORIGIN=prior;}
});
