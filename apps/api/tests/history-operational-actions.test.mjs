import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {loadTargetModule} from './overview-target-loader.mjs';
import {historyFixture,pilotMessage,pilotOwner} from './history-migration-fixture.mjs';
const {HistoryOperationalActionsService}=loadTargetModule('history-migration/history-operational-actions.service.ts');
const {saveOperationalPreparation}=loadTargetModule('history-migration/history-operational-preparation.ts');
const options={skip:process.env.YO_HISTORY_PGLITE!=='1',timeout:120000};
async function setup(){const f=await historyFixture(),before=process.env.HISTORY_MIGRATION_OPERATIONAL_ENABLED;process.env.HISTORY_MIGRATION_OPERATIONAL_ENABLED='true';
 await f.db.exec(`CREATE TABLE "AppSetting" (id TEXT PRIMARY KEY,section TEXT NOT NULL,key TEXT NOT NULL,value JSONB NOT NULL,"updatedAt" TIMESTAMP(3) NOT NULL,UNIQUE(section,key))`);
 const transaction=f.prisma.$transaction;f.prisma.$transaction=action=>transaction(tx=>{
  tx.appSetting={findUnique:async({where})=>(await tx.$queryRaw`SELECT * FROM "AppSetting" WHERE section=${where.section_key.section} AND key=${where.section_key.key}`)[0]??null,
   upsert:async({create})=>(await tx.$queryRaw`INSERT INTO "AppSetting" (id,section,key,value,"updatedAt") VALUES (${randomUUID()},${create.section},${create.key},${JSON.stringify(create.value)}::jsonb,CURRENT_TIMESTAMP) ON CONFLICT(section,key) DO UPDATE SET value=EXCLUDED.value,"updatedAt"=CURRENT_TIMESTAMP RETURNING *`)[0]};
  return action(tx);
 });
 const one=pilotMessage('one',{timestamp:'2024-01-01',sourceTimeText:'2024-01-01 12:30',sourceTimezone:'Europe/Kyiv',sender:'contact:thread-a',text:'Exact duplicate'}),two={...one,dialogueId:'thread-b',sender:'contact:thread-b'};
 const job=await f.stage([one,two]);for(const dialogueId of ['thread-a','thread-b'])await f.planning.bind(job.jobId,{dialogueId,mode:'EXISTING',clientId:'existing'},'synthetic-password',pilotOwner);
 const calls=[],context={jobId:job.jobId,actorId:'owner',clientId:'existing',sourceDigest:'a'.repeat(64),previewDigest:'b'.repeat(64),candidateSnapshot:'c'.repeat(64),targetIdentity:{cluster:'123',databaseName:'synthetic',databaseOid:1},migrationSetDigest:'d'.repeat(64)};
 const core={prepareContext:async(...args)=>{calls.push(['preview',...args]);return {...context,preview:{discovered:2,newCandidates:1,alreadyExists:0,review:0,conflicts:0,blockers:[],sourceCompleteness:'UNVERIFIED'}}},prepare:async(...args)=>{calls.push(['prepare',...args]);return context},applyArchive:async(...args)=>{calls.push(['apply',...args]);return {added:1,productionImport:true}},rollback:async(...args)=>{calls.push(['rollback',...args]);return {rolledBack:true}}};
 const actions=new HistoryOperationalActionsService(f.repository,core);
 return {f,job,calls,context,actions,async close(){await f.close();before===undefined?delete process.env.HISTORY_MIGRATION_OPERATIONAL_ENABLED:process.env.HISTORY_MIGRATION_OPERATIONAL_ENABLED=before}};
}
test('owner action proposes exact aliases server-side and never accepts caller archive/context/grant data',options,async()=>{
 const s=await setup();try{
  await s.actions.preview(s.job.jobId,pilotOwner);assert.equal(s.calls[0][2].equivalences.length,1);
  await s.actions.prepare(s.job.jobId,'synthetic-password',pilotOwner);assert.equal(s.calls[1][0],'prepare');assert.equal(s.calls[1][3],'synthetic-password');
  await assert.rejects(s.actions.preview(s.job.jobId,{...pilotOwner,id:'other-owner'}));assert.equal(s.calls.length,2);
 }finally{await s.close()}
});
test('fresh apply requires sealed preparation and a current matching host publication while status exposes no secrets',options,async()=>{
 const s=await setup();try{
  assert.equal((await s.actions.status(s.job.jobId,pilotOwner)).grantReady,false);
  await assert.rejects(s.actions.apply(s.job.jobId,s.context.previewDigest,'synthetic-password',pilotOwner));assert.equal(s.calls.length,0);
  const archive={policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[]};await s.f.repository.withJob(s.job.jobId,tx=>saveOperationalPreparation(tx,archive,s.context,tx.actor.passwordHash));
  const grantId=randomUUID(),receipt={version:1,grantId,sourceDigest:s.context.sourceDigest,previewDigest:s.context.previewDigest,ciphertextDigest:'e'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString()};
  await s.f.db.query(`INSERT INTO "AppSetting" (id,section,key,value,"updatedAt") VALUES ('published','history.operational.grant',$1,$2::jsonb,CURRENT_TIMESTAMP)`,[s.job.jobId,JSON.stringify(receipt)]);
  const status=await s.actions.status(s.job.jobId,pilotOwner);assert.equal(status.prepared,true);assert.equal(status.grantReady,true);assert.equal(JSON.stringify(status).includes(grantId),false);assert.equal(JSON.stringify(status).includes('current-hash'),false);
  await assert.rejects(s.actions.apply(s.job.jobId,'f'.repeat(64),'synthetic-password',pilotOwner));
  await s.actions.apply(s.job.jobId,s.context.previewDigest,'synthetic-password',pilotOwner);assert.equal(s.calls[0][0],'apply');assert.equal(s.calls[0][6],grantId);
 }finally{await s.close()}
});

test('validated APPLIED or ROLLED_BACK run clears stale prepared/grant readiness without deleting evidence',options,async()=>{
 const s=await setup();
 try{
  await s.f.repository.withJob(s.job.jobId,tx=>saveOperationalPreparation(tx,{policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[]},s.context,tx.actor.passwordHash));
  const grantId=randomUUID(),published={version:1,grantId,sourceDigest:s.context.sourceDigest,previewDigest:s.context.previewDigest,ciphertextDigest:'e'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString()};
  await s.f.db.query(`INSERT INTO "AppSetting" (id,section,key,value,"updatedAt") VALUES ('stale-publication','history.operational.grant',$1,$2::jsonb,CURRENT_TIMESTAMP)`,[s.job.jobId,JSON.stringify(published)]);
  assert.equal((await s.actions.status(s.job.jobId,pilotOwner)).grantReady,true);
  // Lifecycle inventory fixture only; no claim of native execution.
  await s.f.db.exec(`ALTER TABLE "HistoryMigrationPilotRun" DROP CONSTRAINT "HistoryMigrationPilotRun_environment_check";
   ALTER TABLE "HistoryMigrationPilotRun" ADD CONSTRAINT "HistoryMigrationPilotRun_environment_check" CHECK (environment IN ('ISOLATED_WASM','OPERATIONAL_NATIVE'));`);
  const runId=randomUUID();
  await s.f.db.query(`INSERT INTO "HistoryMigrationPilotRun" (id,"jobId","actorId",environment,"sourceDigest","previewDigest",result,"snapshotEncrypted") VALUES ($1,$2,'owner','OPERATIONAL_NATIVE',$3,$4,'{"added":1}','synthetic-lifecycle-only')`,[runId,s.job.jobId,s.context.sourceDigest,s.context.previewDigest]);
  const evidence=(await s.f.db.query(`SELECT * FROM "AppSetting" ORDER BY id`)).rows;
  for(const state of ['APPLIED','ROLLED_BACK']){
   await s.f.db.query(`UPDATE "HistoryMigrationPilotRun" SET status=$1 WHERE id=$2`,[state,runId]);
   const status=await s.actions.status(s.job.jobId,pilotOwner);
   assert.deepEqual(status,{enabled:true,prepared:false,expiresAt:null,grantReady:false,previewDigest:null,run:{runId,status:state,added:1}});
   assert.deepEqual((await s.f.db.query(`SELECT * FROM "AppSetting" ORDER BY id`)).rows,evidence,'preparation/publication bytes must remain intact');
  }
  await s.f.db.query(`UPDATE "HistoryMigrationPilotRun" SET result='{"added":-1}'::jsonb WHERE id=$1`,[runId]);
  await assert.rejects(s.actions.status(s.job.jobId,pilotOwner),/состояние/iu);
 }finally{await s.close();}
});
