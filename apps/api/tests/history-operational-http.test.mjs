import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {randomUUID} from 'node:crypto';
import {loadTargetModule} from './overview-target-loader.mjs';
const require=createRequire(import.meta.url);
test('operational HTTP keeps owner sessions, strict small DTOs, reauthentication delegation and sanitized previews',async()=>{
 const {NestFactory,Reflector}=require('@nestjs/core'),{Module,UnauthorizedException}=require('@nestjs/common');
 const {HistoryOperationalController}=loadTargetModule('history-migration/history-operational.controller.ts');
 const {HistoryOperationalActionsService}=loadTargetModule('history-migration/history-operational-actions.service.ts');
 const {HistoryPasswordDto,ApplyOperationalHistoryDto}=loadTargetModule('history-migration/history-migration.dto.ts');
 const {SessionGuard}=loadTargetModule('auth/session.guard.ts'),{RolesGuard}=loadTargetModule('auth/roles.guard.ts'),{AuthService}=loadTargetModule('auth/auth.service.ts');
 const {ParentMeasurementsValidationPipe}=loadTargetModule('parent-measurements/parent-measurements-validation.pipe.ts');
 const {historyMigrationBodyParser}=loadTargetModule('history-migration/history-migration-security.ts');
 Reflect.defineMetadata('design:paramtypes',[HistoryOperationalActionsService],HistoryOperationalController);
 Reflect.defineMetadata('design:paramtypes',[AuthService],SessionGuard);Reflect.defineMetadata('design:paramtypes',[Reflector],RolesGuard);
 for(const [name,types]of [['preview',[String,Object,Object]],['prepare',[String,HistoryPasswordDto,Object]],['status',[String,Object]],['apply',[String,ApplyOperationalHistoryDto,Object]],['rollback',[String,String,HistoryPasswordDto,Object]]])
  Reflect.defineMetadata('design:paramtypes',types,HistoryOperationalController.prototype,name);
 const calls=[],id=randomUUID(),runId=randomUUID(),digest='a'.repeat(64),password='synthetic-password';
 const plan={jobId:id,clientId:'client',sourceDigest:digest,previewDigest:digest,equivalenceCount:1,preview:{discovered:2,newCandidates:1,alreadyExists:0,review:0,conflicts:0,blockers:[],sourceCompleteness:'UNVERIFIED'},targetIdentity:{databaseName:'private-do-not-expose'},stagedBody:'private-source-text'};
 const actions={preview:async(...args)=>{calls.push(['preview',...args]);return plan},prepare:async(...args)=>{calls.push(['prepare',...args]);return plan},status:async()=>({enabled:true,prepared:false,grantReady:false,expiresAt:null,previewDigest:null,run:null}),apply:async(...args)=>{calls.push(['apply',...args]);return {runId,added:1,alreadyExists:0,replayed:false,productionImport:true}},rollback:async(...args)=>{calls.push(['rollback',...args]);return {runId,rolledBack:true}}};
 const auth={userForToken:async token=>{if(!['owner','admin','manager'].includes(token))throw new UnauthorizedException();return {id:token,role:token.toUpperCase()}}};
 class Fixture{}Module({controllers:[HistoryOperationalController],providers:[{provide:HistoryOperationalActionsService,useValue:actions},{provide:SessionGuard,useValue:new SessionGuard(auth)},{provide:RolesGuard,useValue:new RolesGuard(new Reflector())},{provide:AuthService,useValue:auth}]})(Fixture);
 const previous=process.env.HISTORY_MIGRATION_TRUSTED_PROXIES;process.env.HISTORY_MIGRATION_TRUSTED_PROXIES='127.0.0.1';
 const app=await NestFactory.create(Fixture,{logger:false,abortOnError:false,bodyParser:false});
 app.use('/api/admin/history-migration',...historyMigrationBodyParser('16kb'));app.use(require('cookie-parser')());app.setGlobalPrefix('api');app.useGlobalPipes(new ParentMeasurementsValidationPipe());await app.listen(0,'127.0.0.1');
 const base=await app.getUrl()+'/api/admin/history-migration/jobs/'+id+'/operational';
 const send=(path,body={},role='owner',headers={})=>fetch(base+path,{method:body===null?'GET':'POST',headers:{'X-Forwarded-Proto':'https',...(body===null?{}:{'Content-Type':'application/json'}),...(role?{Cookie:'yoleotard_crm_session='+role}:{}),...headers},...(body===null?{}:{body:JSON.stringify(body)}),redirect:'error'});
 try{
  for(const role of [null,'admin','manager']){const response=await send('/apply',{previewDigest:digest,currentPassword:password},role,{Authorization:'Bearer stage-only'});assert.equal(response.status,role?403:401);assert.equal(response.headers.get('cache-control'),'no-store')}
  assert.equal(calls.length,0);
  for(const body of [{target:'other'},{archiveApprovalJson:'{}'},{verified:true}])assert.equal((await send('/preview',body)).status,400);
  for(const body of [{previewDigest:digest,currentPassword:''},{previewDigest:'bad',currentPassword:password},{previewDigest:digest,currentPassword:password,grantId:randomUUID()},{previewDigest:digest,currentPassword:password,backupVerified:true}])assert.equal((await send('/apply',body)).status,400);
  assert.equal(calls.length,0);
  const preview=await send('/preview');assert.equal(preview.status,201);const body=await preview.json();assert.equal(body.preview.newCandidates,1);assert.equal('targetIdentity' in body,false);assert.equal(JSON.stringify(body).includes('private-source'),false);
  assert.equal((await send('/prepare',{currentPassword:password})).status,201);
  assert.equal((await send('/apply',{previewDigest:digest,currentPassword:password})).status,201);assert.deepEqual(calls.at(-1),['apply',id,digest,password,{id:'owner',role:'OWNER'}]);
  assert.equal((await send('/runs/'+runId+'/rollback',{currentPassword:password})).status,201);assert.equal(calls.at(-1)[0],'rollback');
  assert.equal((await send('/status',null)).status,200);assert.equal((await send('/prepared-context',null)).status,404);
 }finally{await app.close();previous===undefined?delete process.env.HISTORY_MIGRATION_TRUSTED_PROXIES:process.env.HISTORY_MIGRATION_TRUSTED_PROXIES=previous}
});
