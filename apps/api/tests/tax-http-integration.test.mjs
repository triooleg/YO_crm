import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const require=createRequire(import.meta.url);require('reflect-metadata');
const cache=new Map();
function load(relative){const file=resolve(dirname(fileURLToPath(import.meta.url)),'../src',relative);if(cache.has(file))return cache.get(file).exports;const m={exports:{}};cache.set(file,m);const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;new Function('require','module','exports',js)(name=>name.startsWith('.')&&existsSync(resolve(dirname(file),name+'.ts'))?load(resolve(dirname(file),name+'.ts')):require(name),m,m.exports);return m.exports;}
const {ParentMeasurementsValidationPipe}=load('parent-measurements/parent-measurements-validation.pipe.ts');
const {Module,ValidationPipe,UnauthorizedException}=require('@nestjs/common'),{NestFactory}=require('@nestjs/core');
const {TaxesController}=load('taxes/taxes.controller.ts'),{TaxesService}=load('taxes/taxes.service.ts'),{AuthService}=load('auth/auth.service.ts'),{SessionGuard}=load('auth/session.guard.ts'),{RolesGuard}=load('auth/roles.guard.ts');
test('tax HTTP boundary enforces sessions, roles, DTOs and no-store with actual Nest guards',async()=>{
 const calls=[];const taxes={settings:async actor=>{calls.push(['settings',actor.role]);return {accountingStartDate:'2026-05-01',enabled:false,revision:0}},saveSettings:async(d,actor)=>{calls.push(['save',actor.role,d]);return {enabled:d.enabled}},report:async()=>({currency:'UAH'}),settle:async(d,actor)=>{calls.push(['settle',actor.role,d]);return {kind:'PAYMENT_LINK'}}};
 class TestModule{};Module({controllers:[TaxesController],providers:[SessionGuard,RolesGuard,{provide:TaxesService,useValue:taxes},{provide:AuthService,useValue:{userForToken:async token=>{if(!['OWNER','ADMIN','ACCOUNTANT','MANAGER','PRODUCTION'].includes(token))throw new UnauthorizedException();return {id:'test-'+token,role:token}}}}]})(TestModule);
 const app=await NestFactory.create(TestModule,{logger:false});app.use(require('cookie-parser')());app.useGlobalPipes(new ParentMeasurementsValidationPipe());await app.listen(0,'127.0.0.1');
 const base=await app.getUrl();const request=(path,role,body)=>fetch(base+'/finance/taxes'+path,{method:body?'POST':'GET',headers:{...(role?{Cookie:'yoleotard_crm_session='+role}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await request('/settings')).status,401);
  for(const role of ['MANAGER','PRODUCTION'])assert.equal((await request('/settings',role)).status,403);
  for(const role of ['OWNER','ADMIN','ACCOUNTANT']){const r=await request('/settings',role);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((await r.json()).accountingStartDate,'2026-05-01');}
  const command={enabled:true,expectedRevision:0,operationKey:'http-command'};
  assert.equal((await request('/settings','ACCOUNTANT',command)).status,403);
  const before=calls.length;assert.equal((await request('/settings','OWNER',{...command,unexpected:'not allowed'})).status,400);assert.equal(calls.length,before);
  assert.equal((await request('/settings','OWNER',{...command,expectedRevision:0.5})).status,400);
  assert.equal((await request('/settings','OWNER',command)).status,201);
  assert.equal((await request('/settlements','ACCOUNTANT',{operationKey:'settle-test',expectedRevision:0,component:'MILITARY',expenseId:'test-expense'})).status,201);
  assert.equal(calls.at(-1)[1],'ACCOUNTANT');assert.equal((await request('/report?from=2026-13','OWNER')).status,400);
 }finally{await app.close();}
});
