import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdtemp,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProtectedJobStore} from '../../../tools/migrator-agent/src/checkpoint.ts';
import {historyNativeFixture} from './history-native-fixture.mjs';
import {nativeHistoryServices} from './history-native-engine-fixture.mjs';
import {loadTargetModule} from './overview-target-loader.mjs';
import {pilotOwner} from './history-migration-fixture.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
async function saved(folder){
 const bytes=await readFile(join(folder,'checkpoint.bin'));
 const parent=await mkdtemp(resolve(root,'.local/chat-history-migrator/phase-c13/source-copy-')),copy=join(parent,'private'),store=new ProtectedJobStore(copy);
 try{await store.initialize();await writeFile(join(copy,'checkpoint.bin'),bytes,{flag:'wx',mode:0o600});return await store.load();}finally{await store.close();}
}

test('retained C11 archive on native PostgreSQL: 230 messages, 342 origins, replay, restore and rollback',{
 skip:process.env.YO_HISTORY_NATIVE!=='1'||process.env.YO_HISTORY_ACTUAL_ARCHIVE!=='1',timeout:240000,
},async t=>{
 const names=['HISTORY_MIGRATION_ENABLED','HISTORY_MIGRATION_PLANNING_ENABLED','SETTINGS_ENCRYPTION_KEY'],prior=names.map(k=>process.env[k]);
 process.env.HISTORY_MIGRATION_ENABLED='true';process.env.HISTORY_MIGRATION_PLANNING_ENABLED='true';process.env.SETTINGS_ENCRYPTION_KEY='synthetic-native-actual-history-not-production';
 let f,phase='SOURCE';
 try{
  const base=resolve(root,'.local/chat-history-migrator/phase-c11'),inputPath=join(base,'archive-input'),overlapPath=join(base,'overlap-evidence');
  const inputHash=hash(await readFile(join(inputPath,'checkpoint.bin'))),overlapHash=hash(await readFile(join(overlapPath,'checkpoint.bin')));
  const inputEntries=(await readdir(inputPath)).sort(),overlapEntries=(await readdir(overlapPath)).sort();
  const data=await saved(inputPath),overlap=await saved(overlapPath);
  assert.equal(hash(data.messages),'cf2051899c52126e7b03120713629a903a5cf5ae646ef6aa27e992c968bc387d');assert.equal(overlap.sourceRawSha256,hash(data.messages));
  assert.equal(data.messages.length,349);assert.equal(data.approval.equivalences.length,112);assert.equal(overlap.deferredSourceKeys.length,7);
  const {normalizeMessage,sourceKey}=loadTargetModule('history-migration/history.ts'),deferredKeys=new Set(overlap.deferredSourceKeys);
  const ready=data.messages.filter(raw=>!deferredKeys.has(sourceKey(normalizeMessage(raw)))),deferred=data.messages.filter(raw=>deferredKeys.has(sourceKey(normalizeMessage(raw))));assert.equal(ready.length,342);assert.equal(deferred.length,7);
  phase='SCHEMA';f=await historyNativeFixture();const s=await nativeHistoryServices(f,{seed:true}),baseline=await s.snapshot();
  const scope={source:'KEYCRM',account:data.messages[0].account,channel:'INSTAGRAM'},password='synthetic-password';
  async function stage(messages){const job=await s.intake.create(scope,password,pilotOwner),paired=await s.intake.pair(job.jobId,password,pilotOwner);
   for(let start=0;start<messages.length;start+=100){const payloadJson=JSON.stringify({version:1,source:'KEYCRM',messages:messages.slice(start,start+100),completeness:{status:'PARTIAL'}});await s.intake.stage(job.jobId,`Bearer ${paired.token}`,{batchId:randomUUID(),payloadJson,checksum:hash(payloadJson)});}return job;
  }
  phase='STAGE';const job=await stage(ready);await stage(deferred);
  for(const dialogueId of [...new Set(ready.map(m=>m.dialogueId))])await s.planning.bind(job.jobId,{dialogueId,mode:'CREATE_PROPOSAL',subjectId:'synthetic_archive_subject',displayName:'Synthetic archive client'},password,pilotOwner);
  phase='PREVIEW';const preview=await s.pilot.previewArchive(job.jobId,data.approval,pilotOwner);assert.deepEqual(preview.blockers,[]);assert.equal(preview.newCandidates,230);assert.equal(preview.review,0);assert.equal(preview.conflicts,0);
  phase='APPLY';const run=await s.pilot.applyArchive(job.jobId,preview.previewDigest,data.approval,password,pilotOwner);assert.equal(run.added,230);assert.equal(run.createdClients,1);
  phase='COUNTS';const state=await s.snapshot();assert.equal(state.Message.length-baseline.Message.length,230);assert.equal(state.HistoryMigrationOrigin.length,342);assert.equal(state.MessageAttachment.length,baseline.MessageAttachment.length);if('File' in baseline)assert.deepEqual(state.File,baseline.File);
  const changedTables=new Set(['Client','Conversation','Message','HistoryMigrationJob','HistoryMigrationBatch','HistoryMigrationTarget','HistoryMigrationOrigin','HistoryMigrationIdentity','HistoryMigrationPilotRun','AuditLog']);
  for(const table of Object.keys(baseline))if(!changedTables.has(table))assert.deepEqual(state[table],baseline[table]);
  const imported=state.Message.filter(m=>m.metadata?.historyArchive);assert.equal(imported.length,230);assert.ok(imported.every(m=>m.metadata.historyArchive.time.precision==='MINUTE'&&m.metadata.historyArchive.nativeIdentityVerified===false));
  phase='ACTUAL_INBOX';const {CommunicationsService}=loadTargetModule('communications/communications.service.ts');
  const clientId=state.Client.find(client=>!baseline.Client.some(before=>before.id===client.id)).id;
  const detail=await new CommunicationsService(f.db,{}).detail(clientId,'INSTAGRAM');
  assert.equal(detail.messages.length,230);assert.deepEqual(new Set(detail.messages.map(m=>m.id)),new Set(imported.map(m=>m.id)));
  const positions=new Map();
  for(const message of detail.messages)for(const variant of message.metadata.historyArchive.sourceVariants){
   const scope=JSON.stringify([message.createdAt.toISOString(),JSON.parse(variant.sourceKey).slice(0,4)]),last=positions.get(scope);
   if(last!==undefined)assert.ok(variant.ordinal>=last,'Retained source precedence must survive the actual Inbox reader');positions.set(scope,variant.ordinal);
  }
  phase='REPLAY';assert.equal((await s.pilot.applyArchive(job.jobId,preview.previewDigest,data.approval,password,pilotOwner)).added,0);assert.deepEqual(await s.snapshot(),state);
  phase='LOGICAL_RESTORE';const restored=await f.restore(await f.dump()),r=await nativeHistoryServices(restored);assert.deepEqual(await r.snapshot(),state);
  phase='RESTORED_REPLAY';assert.equal((await r.pilot.applyArchive(job.jobId,preview.previewDigest,data.approval,password,pilotOwner)).added,0);assert.deepEqual(await r.snapshot(),state);
  phase='ROLLBACK';await r.pilot.rollback(job.jobId,run.runId,password,pilotOwner);const rolled=await r.snapshot();const {isSoftDeletedMessage}=loadTargetModule('communications/message-deletion.ts');assert.equal(rolled.Message.length,state.Message.length);assert.equal(rolled.Message.filter(m=>m.metadata?.historyArchive&&isSoftDeletedMessage(m.metadata)).length,230);
  phase='ROLLED_BACK_INBOX';await assert.rejects(new CommunicationsService(restored.db,{}).detail(clientId,'INSTAGRAM'),error=>error.getStatus?.()===404);
  phase='NO_RESURRECTION';let refused;
  try{await r.pilot.applyArchive(job.jobId,preview.previewDigest,data.approval,password,pilotOwner);}catch(error){refused=error;}
  assert.ok(refused,'Rolled-back archive must refuse reimport');assert.match(refused.message,/(отозван|Подтверждение объединяет разных или неподтверждённых клиентов)/);
  assert.deepEqual(await r.snapshot(),rolled);
  const unchanged=await s.snapshot();for(const table of Object.keys(state)){phase='ORIGINAL_UNCHANGED_'+table;assert.deepEqual(unchanged[table],state[table]);}
  phase='PAYMENTS_UNCHANGED';assert.deepEqual(rolled.Payment,baseline.Payment);
  phase='SOURCE_UNCHANGED';assert.equal(hash(await readFile(join(inputPath,'checkpoint.bin'))),inputHash);assert.equal(hash(await readFile(join(overlapPath,'checkpoint.bin'))),overlapHash);
  assert.deepEqual((await readdir(inputPath)).sort(),inputEntries);assert.deepEqual((await readdir(overlapPath)).sort(),overlapEntries);
  t.diagnostic(JSON.stringify({sourceRecords:349,ready:342,deferred:7,added:230,origins:342,replayAdded:0,restoredReplayAdded:0,rollbackHidden:230,sourceCompleteness:'UNVERIFIED',productionWrites:0}));
 }catch(error){throw Error(`Actual native archive qualification failed at ${phase} (${error.name}, ${error.meta?.code??error.code??'NO_CODE'}); source content omitted`);}
 finally{try{if(f)await f.close();}finally{names.forEach((k,i)=>prior[i]===undefined?delete process.env[k]:process.env[k]=prior[i]);}}
});
