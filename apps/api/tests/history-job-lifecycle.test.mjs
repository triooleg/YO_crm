import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {historyFixture,pilotMessage,pilotOwner} from './history-migration-fixture.mjs';
import {loadTargetModule} from './overview-target-loader.mjs';
const {sealHistoryEvidence}=loadTargetModule('history-migration/history-evidence.ts');
const {openStagedPayload}=loadTargetModule('history-migration/staged-payload.ts');
const options={skip:process.env.YO_HISTORY_PGLITE!=='1',timeout:120000};
const password='synthetic-password';
const packet=message=>{const payloadJson=JSON.stringify({version:1,source:'KEYCRM',messages:[message],completeness:{status:'PARTIAL'}});return {batchId:randomUUID(),checksum:createHash('sha256').update(payloadJson).digest('hex'),payloadJson};};
async function snapshot(f){
 const state={};
 for(const table of ['User','Client','Conversation','Message','Order','Payment','HistoryMigrationJob','HistoryMigrationBatch','HistoryMigrationTarget','HistoryMigrationPilotRun','HistoryMigrationOrigin','HistoryMigrationIdentity','HistoryMigrationNativeWindow','HistoryMigrationNativeReview','AuditLog'])
  state[table]=(await f.db.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows;
 return state;
}
async function setup(environment='OPERATIONAL_NATIVE',status='APPLIED'){
 const f=await historyFixture();
 try{
  const job=await f.stage([pilotMessage()]);
  await f.planning.bind(job.jobId,{dialogueId:'thread-a',mode:'EXISTING',clientId:'existing'},password,pilotOwner);
  // Synthetic lifecycle inventory only: real C1/C2 storage and public services.
  // This fixture does not claim a native operational execution or PG qualification.
  await f.db.exec(`ALTER TABLE "HistoryMigrationPilotRun" DROP CONSTRAINT "HistoryMigrationPilotRun_environment_check";
   ALTER TABLE "HistoryMigrationPilotRun" ADD CONSTRAINT "HistoryMigrationPilotRun_environment_check" CHECK (environment IN ('ISOLATED_WASM','OPERATIONAL_NATIVE'));
   CREATE TABLE "HistoryMigrationNativeWindow" ("runId" text PRIMARY KEY REFERENCES "HistoryMigrationPilotRun"(id),"payloadEncrypted" text NOT NULL,"createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP);
   CREATE TABLE "HistoryMigrationNativeReview" (id text PRIMARY KEY,"runId" text REFERENCES "HistoryMigrationPilotRun"(id));`);
  const runId=randomUUID();
  if(environment){
   await f.db.query(`INSERT INTO "HistoryMigrationPilotRun" (id,"jobId","actorId",environment,"sourceDigest","previewDigest",status,result,"snapshotEncrypted","rolledBackAt") VALUES ($1,$2,'owner',$3,$4,$5,$6,'{}',$7,$8)`,[runId,job.jobId,environment,'a'.repeat(64),'b'.repeat(64),status,sealHistoryEvidence('PILOT_SNAPSHOT',runId,{syntheticLifecycle:true}),status==='ROLLED_BACK'?new Date():null]);
   if(environment==='OPERATIONAL_NATIVE')await f.db.query(`INSERT INTO "HistoryMigrationNativeWindow" ("runId","payloadEncrypted") VALUES ($1,$2)`,[runId,sealHistoryEvidence('NATIVE_WINDOW',runId+':synthetic-chat',{version:1,runId,status,conversationId:'synthetic-chat',channel:'INSTAGRAM',accountId:'900000000001',customerId:'800000000001',archiveStartAt:'2024-01-01T10:00:00.000Z',cutoffAt:'2024-01-01T10:01:00.000Z'})]);
  }
  return {f,job,runId};
 }catch(error){await f.close();throw error;}
}

test('new batches cannot change an operational job after APPLIED or ROLLED_BACK',options,async()=>{
 for(const status of ['APPLIED','ROLLED_BACK']){
  const {f,job}=await setup('OPERATIONAL_NATIVE',status);
  try{const before=await snapshot(f);await assert.rejects(f.intake.stage(job.jobId,'Bearer '+job.token,packet(pilotMessage('later'))),/зафиксирован|операцион|импорт/iu);assert.deepEqual(await snapshot(f),before);}
  finally{await f.close();}
 }
});
test('OP target binding including CREATE_PROPOSAL is immutable after either run status',options,async()=>{
 for(const status of ['APPLIED','ROLLED_BACK']){
  const {f,job}=await setup('OPERATIONAL_NATIVE',status);
  try{
   const before=await snapshot(f);
   for(const request of [{dialogueId:'thread-a',mode:'EXISTING',clientId:'existing'},
    {dialogueId:'thread-a',mode:'CREATE_PROPOSAL',subjectId:'synthetic-new-subject',displayName:'Synthetic new client',ownerAttested:true}]){
    await assert.rejects(f.planning.bind(job.jobId,request,password,pilotOwner),/зафиксирован|операцион|импорт/iu);
    assert.deepEqual(await snapshot(f),before,'target revision/evidence, source digest inputs, window and business rows stay unchanged');
   }
  }finally{await f.close();}
 }
});

test('pair cannot mint a new staging capability after either OP run status',options,async()=>{
 for(const status of ['APPLIED','ROLLED_BACK']){
  const {f,job}=await setup('OPERATIONAL_NATIVE',status);
  try{const before=await snapshot(f);await assert.rejects(f.intake.pair(job.jobId,password,pilotOwner),/зафиксирован|операцион|импорт/iu);assert.deepEqual(await snapshot(f),before);}
  finally{await f.close();}
 }
});

test('APPLIED close refuses without hiding rollback; agent revoke remains allowed and retains custody',options,async()=>{
 const {f,job}=await setup();
 try{
  const before=await snapshot(f);
  await assert.rejects(f.intake.revoke(job.jobId,password,pilotOwner,true),/откат|операцион|импорт/iu);assert.deepEqual(await snapshot(f),before);
  await f.intake.revoke(job.jobId,password,pilotOwner);
  const after=await snapshot(f),current=after.HistoryMigrationJob.find(row=>row.id===job.jobId);
  assert.equal(current.status,'STAGING');assert.equal(current.tokenHash,null);assert.equal(current.agentExpiresAt,null);assert.equal(current.agentRevision,before.HistoryMigrationJob[0].agentRevision+1);
  const stable=state=>Object.fromEntries(Object.entries(state).filter(([key])=>!['HistoryMigrationJob','AuditLog'].includes(key)));
  assert.deepEqual(stable(after),stable(before));assert.equal(after.AuditLog.length,before.AuditLog.length+1);assert.equal(after.AuditLog.filter(row=>row.action==='HISTORY_AGENT_REVOKED').length,1);
 }finally{await f.close();}
});
test('owner detail exposes only intakeLocked/operationalApplied lifecycle flags, including after rollback',options,async()=>{
 for(const [environment,status,locked,applied] of [[null,'APPLIED',false,false],['ISOLATED_WASM','APPLIED',false,false],['OPERATIONAL_NATIVE','APPLIED',true,true],['OPERATIONAL_NATIVE','ROLLED_BACK',true,false]]){
  const {f,job}=await setup(environment,status);
  try{
   const before=await snapshot(f),detail=await f.intake.ownerDetail(job.jobId,pilotOwner);
   assert.equal(detail.intakeLocked,locked);assert.equal(detail.operationalApplied,applied);
   assert.ok(!JSON.stringify(detail).includes('Synthetic one'));assert.ok(!('runId' in detail));assert.ok(!('grantId' in detail));
   assert.deepEqual(await snapshot(f),before);
  }finally{await f.close();}
 }
});

test('exact batch retry remains an ACK without mutation after either OP run status',options,async()=>{
 for(const status of ['APPLIED','ROLLED_BACK']){
  const {f,job}=await setup('OPERATIONAL_NATIVE',status);
  try{
   const original=await f.repository.withJob(job.jobId,async tx=>{const [batch]=await tx.batches();return {batchId:batch.batchId,checksum:batch.checksum,payloadJson:openStagedPayload(tx.job,batch)};});
   const before=await snapshot(f);
   assert.equal((await f.intake.status(job.jobId,'Bearer '+job.token)).status,'STAGING');
   await f.intake.preview(job.jobId,pilotOwner);await f.planning.dryRun(job.jobId,pilotOwner);
   await f.planning.resolve(job.jobId,{dialogueId:'thread-a',email:'business@example.test'},pilotOwner);
   const ack=await f.intake.stage(job.jobId,'Bearer '+job.token,original);
   assert.deepEqual(ack,{jobId:job.jobId,batchId:original.batchId,checksum:original.checksum,status:'STAGED'});assert.deepEqual(await snapshot(f),before);
  }finally{await f.close();}
 }
});

test('ROLLED_BACK can close, retaining its native window and every custody/business record',options,async()=>{
 const {f,job}=await setup('OPERATIONAL_NATIVE','ROLLED_BACK');
 try{
  const before=await snapshot(f);await f.intake.revoke(job.jobId,password,pilotOwner,true);
  const after=await snapshot(f);assert.equal(after.HistoryMigrationJob[0].status,'CLOSED');assert.equal(after.HistoryMigrationJob[0].tokenHash,null);
  for(const table of Object.keys(before).filter(key=>!['HistoryMigrationJob','AuditLog'].includes(key)))assert.deepEqual(after[table],before[table],table);
  const detail=await f.intake.ownerDetail(job.jobId,pilotOwner);assert.equal(detail.intakeLocked,true);assert.equal(detail.operationalApplied,false);
 }finally{await f.close();}
});

test('pre-OP and isolated-WASM-only jobs preserve pairing, new batches, proposal binding and close contracts',options,async()=>{
 for(const environment of [null,'ISOLATED_WASM']){
  const {f,job}=await setup(environment);
  try{
   const before=await snapshot(f),paired=await f.intake.pair(job.jobId,password,pilotOwner);
   await f.intake.stage(job.jobId,'Bearer '+paired.token,packet(pilotMessage('before-op')));
   const proposal=await f.planning.bind(job.jobId,{dialogueId:'thread-a',mode:'CREATE_PROPOSAL',subjectId:'synthetic-before-op',displayName:'Synthetic proposal',ownerAttested:true},password,pilotOwner);
   assert.equal(proposal.mode,'CREATE_PROPOSAL');assert.equal(proposal.revision,2);
   await f.intake.revoke(job.jobId,password,pilotOwner,true);const after=await snapshot(f);assert.equal(after.HistoryMigrationJob[0].status,'CLOSED');
   for(const table of ['Client','Conversation','Message','Order','Payment','HistoryMigrationPilotRun','HistoryMigrationNativeWindow'])assert.deepEqual(after[table],before[table],table);
  }finally{await f.close();}
 }
});

for(const nativeTable of ['HistoryMigrationNativeWindow','HistoryMigrationNativeReview']){
 test(`partial native schema with only ${nativeTable} refuses lifecycle mutations and readiness`,options,async()=>{
  const f=await historyFixture();
  try{
   const job=await f.stage([pilotMessage()]);
   await f.planning.bind(job.jobId,{dialogueId:'thread-a',mode:'EXISTING',clientId:'existing'},password,pilotOwner);
   await f.db.exec(`CREATE TABLE "${nativeTable}" (id text PRIMARY KEY)`);
   assert.equal((await f.db.query(`SELECT count(*)::int AS n FROM "HistoryMigrationPilotRun"`)).rows[0].n,0,'partial schema must refuse even without an operational run');
   const state=async()=>{
    const result={};for(const table of ['HistoryMigrationJob','HistoryMigrationBatch','HistoryMigrationTarget','HistoryMigrationPilotRun','AuditLog',nativeTable])
     result[table]=(await f.db.query(`SELECT * FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows;
    return result;
   };
   const before=await state();
   for(const action of [()=>f.intake.pair(job.jobId,password,pilotOwner),
    ()=>f.intake.stage(job.jobId,'Bearer '+job.token,packet(pilotMessage('partial-schema'))),
    ()=>f.planning.bind(job.jobId,{dialogueId:'thread-a',mode:'EXISTING',clientId:'existing'},password,pilotOwner),
    ()=>f.intake.revoke(job.jobId,password,pilotOwner,true),()=>f.intake.ownerDetail(job.jobId,pilotOwner)]){
    await assert.rejects(action(),/схема|операцион/iu);assert.deepEqual(await state(),before);
   }
  }finally{await f.close();}
 });
}
