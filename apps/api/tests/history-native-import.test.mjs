import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {readdir,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {historyNativeFixture} from './history-native-fixture.mjs';
import {nativeHistoryServices} from './history-native-engine-fixture.mjs';
import {pilotMessage,pilotOwner,pilotScope} from './history-migration-fixture.mjs';

test('shared archive transaction engine exists without a registered native writer',()=>{
 const {HistoryMigrationTransactionEngine}=loadTargetModule('history-migration/history-transaction-engine.ts');
 assert.equal(typeof HistoryMigrationTransactionEngine,'function');
});

test('same archive engine on owned native PostgreSQL: append, restore, replay, selective rollback',{skip:process.env.YO_HISTORY_NATIVE!=='1',timeout:180000},async t=>{
 const names=['HISTORY_MIGRATION_ENABLED','HISTORY_MIGRATION_PLANNING_ENABLED','SETTINGS_ENCRYPTION_KEY'],before=names.map(k=>process.env[k]);
 process.env.HISTORY_MIGRATION_ENABLED='true';process.env.HISTORY_MIGRATION_PLANNING_ENABLED='true';process.env.SETTINGS_ENCRYPTION_KEY='synthetic-native-history-not-production';
 let f;
 try{
  f=await historyNativeFixture();const s=await nativeHistoryServices(f,{seed:true}),baseline=await s.snapshot();
  const {IsolatedHistoryMigrationPilot}=loadTargetModule('history-migration/isolated-history-pilot.ts');
  const job=await s.intake.create(pilotScope,'synthetic-password',pilotOwner),pair=await s.intake.pair(job.jobId,'synthetic-password',pilotOwner);
  const m=pilotMessage('native-minute',{timestamp:'2024-01-01',sourceTimeText:'2024-01-01 12:30',sourceTimezone:'Europe/Kyiv'});
  const payloadJson=JSON.stringify({version:1,source:'KEYCRM',messages:[m],completeness:{status:'PARTIAL'}});
  await s.intake.stage(job.jobId,`Bearer ${pair.token}`,{batchId:randomUUID(),payloadJson,checksum:createHash('sha256').update(payloadJson).digest('hex')});
  await s.planning.bind(job.jobId,{dialogueId:m.dialogueId,mode:'CREATE_PROPOSAL',subjectId:'synthetic-person',displayName:'Synthetic native pilot'},'synthetic-password',pilotOwner);
  const approval={policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[]};
  const guarded=new IsolatedHistoryMigrationPilot(s.repository,s.backups);
  const beforeRefusals=await s.snapshot();
  await assert.rejects(guarded.previewArchive(job.jobId,approval,pilotOwner),/WASM/);
  await assert.rejects(guarded.apply(job.jobId,'a'.repeat(64),'synthetic-password',pilotOwner),/WASM/);
  await assert.rejects(guarded.applyArchive(job.jobId,'a'.repeat(64),approval,'synthetic-password',pilotOwner),/WASM/);
  await assert.rejects(guarded.rollback(job.jobId,randomUUID(),'synthetic-password',pilotOwner),/WASM/);
  assert.deepEqual(await s.snapshot(),beforeRefusals);
  let preview=await s.pilot.previewArchive(job.jobId,approval,pilotOwner);assert.equal(preview.newCandidates,1);
  const staged=await s.snapshot();
  await assert.rejects(s.pilot.applyArchive(job.jobId,preview.previewDigest,approval,'wrong-password',pilotOwner),/Invalid fixture password/);
  await assert.rejects(s.pilot.applyArchive(job.jobId,preview.previewDigest,approval,'synthetic-password',{...pilotOwner,id:'other-owner'}),/владельца/);
  assert.deepEqual(await s.snapshot(),staged);
  await f.db.$executeRaw`UPDATE "User" SET active=false WHERE id='owner'`;
  try{await assert.rejects(s.pilot.previewArchive(job.jobId,approval,pilotOwner),/Owner unavailable/);}finally{await f.db.$executeRaw`UPDATE "User" SET active=true WHERE id='owner'`;}
  assert.deepEqual(await s.snapshot(),staged);
  const authenticate=s.backups.reauthenticate,originalHash=staged.User.find(u=>u.id==='owner').passwordHash;
  s.backups.reauthenticate=async(...args)=>{const verified=await authenticate(...args);await f.db.$executeRaw`UPDATE "User" SET "passwordHash"='synthetic-revoked-hash' WHERE id='owner'`;return verified;};
  try{await assert.rejects(s.pilot.applyArchive(job.jobId,preview.previewDigest,approval,'synthetic-password',pilotOwner),/владельца/);}finally{s.backups.reauthenticate=authenticate;await f.db.$executeRaw`UPDATE "User" SET "passwordHash"=${originalHash} WHERE id='owner'`;}
  assert.deepEqual(await s.snapshot(),staged);
  await s.planning.bind(job.jobId,{dialogueId:m.dialogueId,mode:'CREATE_PROPOSAL',subjectId:'synthetic-person',displayName:'Changed native pilot'},'synthetic-password',pilotOwner);
  await assert.rejects(s.pilot.applyArchive(job.jobId,preview.previewDigest,approval,'synthetic-password',pilotOwner),/Предпросмотр/);
  preview=await s.pilot.previewArchive(job.jobId,approval,pilotOwner);
  const entered=Promise.withResolvers(),release=Promise.withResolvers(),writer=await f.connect();
  const active=writer.$transaction(async tx=>{await tx.$executeRaw`LOCK TABLE "Client" IN ROW EXCLUSIVE MODE`;entered.resolve();await release.promise;},{timeout:10000});await entered.promise;
  try{await assert.rejects(s.pilot.applyArchive(job.jobId,preview.previewDigest,approval,'synthetic-password',pilotOwner),e=>e.meta?.code==='55P03');}finally{release.resolve();await active;}
  await assert.rejects(s.pilot.applyArchive(job.jobId,'b'.repeat(64),approval,'synthetic-password',pilotOwner),/Предпросмотр/);
  const run=await s.pilot.applyArchive(job.jobId,preview.previewDigest,approval,'synthetic-password',pilotOwner);assert.equal(run.added,1);
  const state=await s.snapshot();assert.equal(state.Message.length,baseline.Message.length+1);assert.deepEqual(state.Order,baseline.Order);assert.deepEqual(state.Payment,baseline.Payment);
  for(const table of Object.keys(baseline)){
   const rows=new Map(state[table].map(row=>[row.id, row]));
   for(const row of baseline[table]){assert.ok(row.id,'Synthetic sentinel must have a stable id');assert.deepEqual(rows.get(row.id),row);}
  }
  assert.equal((await s.pilot.applyArchive(job.jobId,preview.previewDigest,approval,'synthetic-password',pilotOwner)).added,0);assert.deepEqual(await s.snapshot(),state);
  await assert.rejects(f.restore({}),/Only this owned cluster/);
  const alteredGrant=await f.dump(),dumpFiles=(await readdir(f.home)).filter(name=>/^dump-[a-f0-9]+\.pgdump$/.test(name));assert.equal(dumpFiles.length,1);
  await appendFile(join(f.home,dumpFiles[0]),Buffer.from('synthetic-corruption'));
  const databases=await f.db.$queryRaw`SELECT count(*)::int AS n FROM pg_database`;
  await assert.rejects(f.restore(alteredGrant),/checksum changed/);
  assert.deepEqual(await f.db.$queryRaw`SELECT count(*)::int AS n FROM pg_database`,databases);
  const restored=await f.restore(await f.dump()),r=await nativeHistoryServices(restored);assert.deepEqual(await r.snapshot(),state);
  assert.equal((await r.pilot.applyArchive(job.jobId,preview.previewDigest,approval,'synthetic-password',pilotOwner)).added,0);assert.deepEqual(await r.snapshot(),state);
  const [imported]=await restored.db.$queryRaw`SELECT id FROM "Message" WHERE metadata->'historyArchive' IS NOT NULL`;
  await restored.db.$executeRaw`INSERT INTO "MessageAnalysis" (id,"messageId",extractor,"analysisVersion",intent,"updatedAt") VALUES ('native-dependent',${imported.id},'synthetic','v1','test',CURRENT_TIMESTAMP)`;
  await assert.rejects(r.pilot.rollback(job.jobId,run.runId,'synthetic-password',pilotOwner),/Состояние изменилось/);
  await restored.db.$executeRaw`DELETE FROM "MessageAnalysis" WHERE id='native-dependent'`;
  await restored.db.$executeRaw`INSERT INTO "Message" (id,"conversationId",direction,status,content,"createdAt") VALUES ('native-unrelated','protected-email','INBOUND','RECEIVED','Synthetic later unrelated message',CURRENT_TIMESTAMP)`;
  await r.pilot.rollback(job.jobId,run.runId,'synthetic-password',pilotOwner);
  await assert.rejects(r.pilot.applyArchive(job.jobId,preview.previewDigest,approval,'synthetic-password',pilotOwner),/отозван/);
  assert.deepEqual((await r.snapshot()).Payment,baseline.Payment);assert.deepEqual(await s.snapshot(),state);
  assert.equal((await restored.db.$queryRaw`SELECT count(*)::int AS n FROM "Message" WHERE id='native-unrelated'`)[0].n,1);
  const rolled=await r.snapshot(),{isSoftDeletedMessage}=loadTargetModule('communications/message-deletion.ts');
  assert.ok(isSoftDeletedMessage(rolled.Message.find(m=>m.id===imported.id).metadata));
  const migratedMessage=state.Message.find(m=>m.id===imported.id),createdConversation=state.Conversation.find(c=>c.id===migratedMessage.conversationId);
  assert.ok(rolled.Conversation.find(c=>c.id===createdConversation.id).archivedAt);assert.ok(rolled.Client.find(c=>c.id===createdConversation.clientId).archivedAt);
  assert.deepEqual(rolled.HistoryMigrationOrigin,state.HistoryMigrationOrigin);assert.deepEqual(rolled.HistoryMigrationIdentity,state.HistoryMigrationIdentity);
  assert.ok(rolled.AuditLog.some(a=>a.action==='HISTORY_ISOLATED_PILOT_ROLLED_BACK'));
  for(const table of Object.keys(baseline)){const rows=new Map(rolled[table].map(row=>[row.id,row]));for(const row of baseline[table])assert.deepEqual(rows.get(row.id),row);}
  t.diagnostic('Native shared-engine append/replay/logical-restore/rollback PASS; no production writes');
 }finally{if(f)await f.close();names.forEach((k,i)=>before[i]===undefined?delete process.env[k]:process.env[k]=before[i]);}
});
