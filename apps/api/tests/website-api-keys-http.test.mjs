import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);require('reflect-metadata');const ts=require('typescript');
const cache=new Map(),root=resolve(dirname(fileURLToPath(import.meta.url)),'../src');
function load(file){file=resolve(root,file);if(cache.has(file))return cache.get(file).exports;const m={exports:{}};cache.set(file,m);const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;new Function('require','module','exports',js)(name=>name.startsWith('.')&&existsSync(resolve(dirname(file),name+'.ts'))?load(resolve(dirname(file),name+'.ts')):require(name),m,m.exports);return m.exports;}
const {Module,HttpException}=require('@nestjs/common'),{NestFactory}=require('@nestjs/core');
const {WebsiteApiKeysController}=load('website-api-keys/website-api-keys.controller.ts'),{WebsiteApiKeysService}=load('website-api-keys/website-api-keys.service.ts');
const security=load('website-api-keys/website-api-keys.security.ts'),{AuthService}=load('auth/auth.service.ts'),{SessionGuard}=load('auth/session.guard.ts'),{RolesGuard}=load('auth/roles.guard.ts');
const {PrismaService}=load('prisma.service.ts'),{ParentMeasurementsValidationPipe}=load('parent-measurements/parent-measurements-validation.pipe.ts');
test('actual Nest guards/controller/service preserve auth, strict body, no-store and sanitized errors',async()=>{
 const old={AUTH_DISABLED:process.env.AUTH_DISABLED,WEB_ORIGIN:process.env.WEB_ORIGIN};delete process.env.AUTH_DISABLED;process.env.WEB_ORIGIN='https://crm.example.invalid';
 const password='synthetic-native-owner-password',passwordHash=await require('argon2').hash(password),ownerToken='o'.repeat(43),adminToken='a'.repeat(43);
 const users=[{id:'owner',role:'OWNER',active:true,archivedAt:null,passwordHash},{id:'admin',role:'ADMIN',active:true,archivedAt:null,passwordHash}];
 const sessions=[{id:'one',userId:'owner',tokenHash:createHash('sha256').update(ownerToken).digest('hex'),expiresAt:new Date(Date.now()+60000)},{id:'two',userId:'admin',tokenHash:createHash('sha256').update(adminToken).digest('hex'),expiresAt:new Date(Date.now()+60000)}];
 const keys=[],audit=[];let limiterFailure=false,dbFailure=false;
 const pick=(r,select)=>!r?null:select?Object.fromEntries(Object.keys(select).map(k=>[k,r[k]])):r;
 const prisma={$transaction:async fn=>fn(prisma),$executeRaw:async()=>0,$queryRaw:async()=>[],
  user:{findFirst:async({where})=>users.find(u=>(!where.id||u.id===where.id)&&u.active&&u.role===where.role)??null},
  session:{findUnique:async({where})=>{const s=sessions.find(s=>s.tokenHash===where.tokenHash);return s?{...s,user:users.find(u=>u.id===s.userId)}:null;},findFirst:async({where})=>sessions.find(s=>s.userId===where.userId&&s.tokenHash===where.tokenHash&&s.expiresAt>where.expiresAt.gt)??null},
  websiteApiKey:{findMany:async q=>{if(dbFailure)throw Error('Prisma secret digest=NO_RAW_EXCEPTION');return keys.map(k=>pick(k,q.select));},create:async({data,select})=>{const r={id:'key-'+keys.length,lastUsedAt:null,revokedAt:null,revokedById:null,...data};keys.push(r);return pick(r,select);}},
  auditLog:{create:async({data})=>{audit.push(data);return data;}}};
 class TestModule{};Module({controllers:[WebsiteApiKeysController],providers:[WebsiteApiKeysService,AuthService,SessionGuard,RolesGuard,security.WebsiteApiKeysHeadersGuard,security.WebsiteApiKeysExceptionFilter,{provide:PrismaService,useValue:prisma},{provide:security.WEBSITE_API_KEYS_RATE_LIMIT,useValue:async()=>{if(limiterFailure)throw new HttpException('private throttle',429);}}]})(TestModule);
 const app=await NestFactory.create(TestModule,{logger:false});app.use(require('cookie-parser')());app.useGlobalPipes(new ParentMeasurementsValidationPipe());await app.listen(0,'127.0.0.1');
 const base=(await app.getUrl())+'/auth/website-api-keys';
 const request=(token,body,extra={})=>fetch(base,{method:body===undefined?'GET':'POST',headers:{...(token?{Cookie:'yoleotard_crm_session='+token}:{}),...(body!==undefined?{'Content-Type':'application/json',Origin:process.env.WEB_ORIGIN,'x-website-key-csrf':security.websiteApiKeysCsrf(token)}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{
  for(const [token,status] of [[undefined,401],[adminToken,403]]){const r=await request(token);assert.equal(r.status,status);assert.equal(r.headers.get('cache-control'),'no-store');}
  const get=await request(ownerToken);assert.equal(get.status,200);const listed=await get.json();assert.deepEqual(listed.keys,[]);assert.equal(listed.csrfToken,security.websiteApiKeysCsrf(ownerToken));
  const body={name:'Website native',sourceAccount:'calendar.yoleotard.com',currentPassword:password,confirmed:true};
  assert.equal((await request(ownerToken,{...body,unknown:'keep unknown until feature validation'})).status,400);assert.equal(keys.length,0);
  assert.equal((await request(ownerToken,body,{'x-website-key-csrf':'0'.repeat(64)})).status,403);
  assert.equal((await request(ownerToken,body,{Origin:'https://evil.example'})).status,403);
  assert.equal((await request(ownerToken,{...body,currentPassword:'wrong'})).status,401);
  const created=await request(ownerToken,body);assert.equal(created.status,201);assert.equal(created.headers.get('cache-control'),'no-store');const result=await created.json();assert.match(result.secret,/^yo_crm_v1_/);assert.equal(audit.length,1);
  const after=await request(ownerToken);assert.ok(!JSON.stringify(await after.json()).includes(result.secret));
  limiterFailure=true;const throttled=await request(ownerToken);assert.equal(throttled.status,429);assert.equal(throttled.headers.get('cache-control'),'no-store');limiterFailure=false;
  dbFailure=true;const failed=await request(ownerToken);assert.equal(failed.status,503);const safeError=await failed.json();assert.equal(safeError.message,'Управление ключами временно недоступно');assert.ok(!JSON.stringify(safeError).includes('NO_RAW_EXCEPTION'));dbFailure=false;
  process.env.AUTH_DISABLED='true';assert.equal((await request(undefined)).status,401);assert.equal((await request('f'.repeat(43))).status,401);
 }finally{await app.close();for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
