import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);require('reflect-metadata');const ts=require('typescript');
const cache=new Map(),root=resolve(dirname(fileURLToPath(import.meta.url)),'../src');
function load(file){file=resolve(root,file);if(cache.has(file))return cache.get(file).exports;const m={exports:{}};cache.set(file,m);const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;new Function('require','module','exports',js)(name=>name.startsWith('.')&&existsSync(resolve(dirname(file),name+'.ts'))?load(resolve(dirname(file),name+'.ts')):require(name),m,m.exports);return m.exports;}
const sec=load('website-api-keys/website-api-keys.security.ts');
const {WebsiteApiKeysService}=load('website-api-keys/website-api-keys.service.ts');
const legacy='synthetic-env-only-credential-123456789012345';
test('purpose-separated 32-byte digests and independent canonical tokens',()=>{
 const a=sec.generateWebsiteApiKey(),b=sec.generateWebsiteApiKey();
 assert.match(a.secret,/^yo_crm_v1_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/);assert.notEqual(a.secret,b.secret);assert.notEqual(a.selector,b.selector);
 assert.equal(a.digest.length,32);assert.deepEqual(a.digest,sec.digestWebsiteApiKey(a.secret));
 assert.notDeepEqual(a.digest,require('node:crypto').createHash('sha256').update(a.secret).digest());
 assert.equal(sec.parseWebsiteApiKey(a.secret).selector,a.selector);
 for(const bad of [a.secret+'=',a.secret.replace('yo_crm_v1','yo_crm_v2'),'yo_crm_v1_x_y'])assert.equal(sec.parseWebsiteApiKey(bad),null);
});
test('valid legacy succeeds before DB and Redis access, even on a DB outage',async()=>{
 const prior=process.env.WEBSITE_ORDERS_API_TOKEN;process.env.WEBSITE_ORDERS_API_TOKEN=legacy;
 const db=new Proxy({},{get(){throw Error('DB_MUST_NOT_BE_TOUCHED');}}),service=new WebsiteApiKeysService(db,async()=>{throw Error('NO_REDIS');});
 try{const p=await service.authenticate('Bearer '+legacy);assert.deepEqual(p,{kind:'legacy'});await service.authorizeSource(p,'anything');}
 finally{if(prior===undefined)delete process.env.WEBSITE_ORDERS_API_TOKEN;else process.env.WEBSITE_ORDERS_API_TOKEN=prior;}
});
test('DB keys authenticate for their canonical stored account without env, reject wrong digest/revocation, do not write on authenticate',async()=>{
 const prior=process.env.WEBSITE_ORDERS_API_TOKEN;delete process.env.WEBSITE_ORDERS_API_TOKEN;
 const token=sec.generateWebsiteApiKey();let row={id:'key-a',selector:token.selector,digest:token.digest,digestVersion:'sha256-v1',sourceAccount:'shop.yoleotard.com',revokedAt:null};
 const db={websiteApiKey:{findUnique:async()=>row}};const service=new WebsiteApiKeysService(db,async()=>{});
 try{assert.deepEqual(await service.authenticate('Bearer '+token.secret),{kind:'key',id:'key-a',sourceAccount:'shop.yoleotard.com'});
 row={...row,digest:Buffer.alloc(32)};await assert.rejects(service.authenticate('Bearer '+token.secret),e=>e.status===401);
 row={...row,digest:token.digest,revokedAt:new Date()};await assert.rejects(service.authenticate('Bearer '+token.secret),e=>e.status===401);
 await assert.rejects(service.authenticate(['Bearer '+token.secret]),e=>e.status===503);
 }finally{if(prior!==undefined)process.env.WEBSITE_ORDERS_API_TOKEN=prior;}
});
test('forged principals and wrong scopes cannot acquire DB locks or write lastUsedAt',async()=>{
 const token=sec.generateWebsiteApiKey(),row={id:'key-a',digest:token.digest,digestVersion:'sha256-v1',sourceAccount:'calendar.yoleotard.com',revokedAt:null};let tx=0;
 const service=new WebsiteApiKeysService({websiteApiKey:{findUnique:async()=>row},$transaction:async()=>{tx++;throw Error('WRONG_SCOPE_DB_WRITE');}},async()=>{});
 const principal=await service.authenticate('Bearer '+token.secret);
 await assert.rejects(service.authorizeSource(principal,'other.example'),e=>e.status===403);
 await assert.rejects(service.authorizeSource({kind:'key',id:row.id,sourceAccount:row.sourceAccount},row.sourceAccount));
 await assert.rejects(service.authorizeSource({kind:'legacy'},row.sourceAccount));assert.equal(tx,0);
});
test('source authorization rechecks revocation and atomic 5-minute last-used condition',async()=>{
 const token=sec.generateWebsiteApiKey();const row={id:'key-a',digest:token.digest,digestVersion:'sha256-v1',sourceAccount:'calendar.yoleotard.com',revokedAt:null,lastUsedAt:null};let locks=0,writes=0;
 const db={websiteApiKey:{findUnique:async()=>row},$transaction:async fn=>fn({$queryRaw:async()=>{locks++;return [{id:row.id}];},websiteApiKey:{findUnique:async()=>row,updateMany:async q=>{assert.equal(q.where.revokedAt,null);assert.equal(q.where.sourceAccount,row.sourceAccount);const cutoff=q.where.OR[1].lastUsedAt.lte;if(!row.lastUsedAt||row.lastUsedAt<=cutoff){row.lastUsedAt=q.data.lastUsedAt;writes++;return {count:1};}return {count:0};}}})};
 const service=new WebsiteApiKeysService(db,async()=>{}),p=await service.authenticate('Bearer '+token.secret);
 await service.authorizeSource(p,row.sourceAccount);await service.authorizeSource(p,row.sourceAccount);assert.equal(writes,1);assert.equal(locks,2);
 row.revokedAt=new Date();await assert.rejects(service.authorizeSource(p,row.sourceAccount),e=>e.status===401);assert.equal(writes,1);
});

test('malformed DB-credential namespace fails401 without DB even when env fallback absent',async()=>{
 const prior=process.env.WEBSITE_ORDERS_API_TOKEN;delete process.env.WEBSITE_ORDERS_API_TOKEN;
 const service=new WebsiteApiKeysService(new Proxy({},{get(){throw Error('NO_DATABASE_LOOKUP');}}));
 try{await assert.rejects(service.authenticate('Bearer yo_crm_v1_bad'),e=>e.status===401);await assert.rejects(service.authenticate('Bearer unrelated'),e=>e.status===503);}
 finally{if(prior!==undefined)process.env.WEBSITE_ORDERS_API_TOKEN=prior;}
});

test('DB credential ingress rate-limits IP before lookup, including shared unknown fallback',async()=>{
 const {HttpException}=require('@nestjs/common');const token=sec.generateWebsiteApiKey();let lookups=0;
 const db={websiteApiKey:{findUnique:async()=>{lookups++;return null;}}};
 for(const [limiterError,status] of [[new HttpException('quota',429),429],[Error('private redis info'),503]]){
  const attempts=[];const service=new WebsiteApiKeysService(db,async(...args)=>{attempts.push(args);throw limiterError;});
  await assert.rejects(service.authenticate('Bearer '+token.secret,'127.0.0.2'),e=>e.status===status&&!e.message.includes('private'));
  assert.deepEqual(attempts,[['ingress-ip','127.0.0.2',120,60]]);assert.equal(lookups,0);
 }
 const attempts=[];const service=new WebsiteApiKeysService(db,async(...args)=>{attempts.push(args);throw new HttpException('quota',429);});
 await assert.rejects(service.authenticate('Bearer '+token.secret),e=>e.status===429);
 await assert.rejects(service.authenticate('Bearer '+token.secret,''),e=>e.status===429);
 assert.deepEqual(attempts.map(a=>a[1]),['unknown','unknown']);assert.ok(!JSON.stringify(attempts).includes(token.secret));assert.equal(lookups,0);
});
