import test from 'node:test';import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
import {historyFixture,pilotMessage,pilotOwner} from './history-migration-fixture.mjs';
const isolated={skip:process.env.YO_HISTORY_PGLITE!=='1',timeout:120000};
async function prepared(subjectId){
 const f=await historyFixture(),q=(sql,params)=>f.db.query(sql,params);
 await q(`INSERT INTO "Conversation" (id,"clientId",channel,"unreadCount","unreadVersion","lastMessageAt","updatedAt") VALUES ('existing-conversation','existing','INSTAGRAM',7,9,'2026-01-01','2026-01-01')`);
 const {IsolatedHistoryMigrationPilot}=loadTargetModule('history-migration/isolated-history-pilot.ts'),pilot=new IsolatedHistoryMigrationPilot(f.repository,f.backups);
 const job=await f.stage([pilotMessage('historical')]);await f.planning.bind(job.jobId,{mode:'EXISTING',clientId:'existing',dialogueId:'thread-a',...(subjectId?{subjectId}:{})},'synthetic-password',pilotOwner);
 const preview=await f.planning.dryRun(job.jobId,pilotOwner),run=await pilot.apply(job.jobId,preview.previewDigest,'synthetic-password',pilotOwner);
 return {f,q,pilot,job,preview,run,async live(){await q(`INSERT INTO "Message" (id,"conversationId",direction,status,content,"externalId","receivedAt","createdAt",metadata) VALUES ('later-live','existing-conversation','INBOUND','RECEIVED','Unrelated current message','provider-live','2026-10-29','2026-10-29','{"provider":"META"}'::jsonb)`);await q(`UPDATE "Conversation" SET "unreadCount"=8,"unreadVersion"=10,"lastMessageAt"='2026-10-29',"updatedAt"='2026-10-29' WHERE id='existing-conversation'`);}};
}
test('isolated rollback hides only run-owned history after an unrelated live message and attention update',isolated,async()=>{
 const {f,q,pilot,job,run,live}=await prepared();
 try{await live();const conversation=(await q('SELECT * FROM "Conversation"')).rows,client=(await q('SELECT * FROM "Client"')).rows,liveBefore=(await q(`SELECT * FROM "Message" WHERE id='later-live'`)).rows;
  await pilot.rollback(job.jobId,run.runId,'synthetic-password',pilotOwner);
  assert.deepEqual((await q(`SELECT * FROM "Message" WHERE id='later-live'`)).rows,liveBefore);assert.deepEqual((await q('SELECT * FROM "Conversation"')).rows,conversation);assert.deepEqual((await q('SELECT * FROM "Client"')).rows,client);
  assert.equal((await q(`SELECT count(*)::int AS n FROM "Message" WHERE metadata #>> '{deletion,deletedAt}' IS NOT NULL`)).rows[0].n,1);assert.equal((await q('SELECT count(*)::int AS n FROM "Message"')).rows[0].n,2);
 }finally{await f.close()}
});
test('exact V2 replay after unrelated live traffic reports zero additions without weakening fresh dry-run',isolated,async()=>{
 const {f,q,pilot,job,preview,live}=await prepared();
 try{await live();const before=(await q('SELECT * FROM "Message" ORDER BY id')).rows,conversation=(await q('SELECT * FROM "Conversation"')).rows;
  const current=await f.planning.dryRun(job.jobId,pilotOwner);assert.ok(current.blockers.includes('UNVERIFIED_EXISTING_PROVENANCE'));assert.equal(current.newCandidates,0);
  const repeated=await pilot.apply(job.jobId,preview.previewDigest,'synthetic-password',pilotOwner);assert.equal(repeated.replayed,true);assert.equal(repeated.added,0);assert.equal(repeated.alreadyExists,1);
  assert.deepEqual((await q('SELECT * FROM "Message" ORDER BY id')).rows,before);assert.deepEqual((await q('SELECT * FROM "Conversation"')).rows,conversation);assert.equal((await q('SELECT count(*)::int AS n FROM "HistoryMigrationPilotRun"')).rows[0].n,1);
 }finally{await f.close()}
});
test('legacy encrypted snapshots retain the old conservative replay and rollback rules',isolated,async()=>{
 const {f,q,pilot,job,preview,run,live}=await prepared();
 try{const {openHistoryEvidence,sealHistoryEvidence}=loadTargetModule('history-migration/history-evidence.ts'),{captureIsolatedHistoryState}=loadTargetModule('history-migration/isolated-history-state.ts');
  const [stored]=(await q('SELECT "snapshotEncrypted" FROM "HistoryMigrationPilotRun" WHERE id=$1',[run.runId])).rows;
  const snapshot=openHistoryEvidence('PILOT_SNAPSHOT',run.runId,stored.snapshotEncrypted);delete snapshot.custodyVersion;delete snapshot.createdIdentityIds;
  snapshot.stateDigest=await f.prisma.$transaction(tx=>captureIsolatedHistoryState(tx,snapshot));
  await q('UPDATE "HistoryMigrationPilotRun" SET "snapshotEncrypted"=$1 WHERE id=$2',[sealHistoryEvidence('PILOT_SNAPSHOT',run.runId,snapshot),run.runId]);
  assert.equal((await pilot.apply(job.jobId,preview.previewDigest,'synthetic-password',pilotOwner)).added,0);
  await live();await assert.rejects(pilot.apply(job.jobId,preview.previewDigest,'synthetic-password',pilotOwner),/замечания|изменил/);await assert.rejects(pilot.rollback(job.jobId,run.runId,'synthetic-password',pilotOwner),/изменил|зависимост/);
  assert.equal((await q(`SELECT count(*)::int AS n FROM "Message" WHERE metadata #>> '{deletion,deletedAt}' IS NOT NULL`)).rows[0].n,0);
 }finally{await f.close()}
});
test('unknown custody versions and malformed authenticated snapshot records fail before any rollback mutation',isolated,async()=>{
 const {f,q,pilot,job,run}=await prepared();
 try{const {openHistoryEvidence,sealHistoryEvidence}=loadTargetModule('history-migration/history-evidence.ts');const [stored]=(await q('SELECT "snapshotEncrypted" FROM "HistoryMigrationPilotRun" WHERE id=$1',[run.runId])).rows;
  const snapshot=openHistoryEvidence('PILOT_SNAPSHOT',run.runId,stored.snapshotEncrypted);
  for(const patch of [null,0,1,3,'2',{},[]].map(custodyVersion=>({custodyVersion})).concat([{createdIdentityIds:null},{createdIdentityIds:['bad','bad']},{createdMessageIds:null},{createdMessageIds:['same','same']},{allConversationIds:[]},{stateDigest:'not-a-digest'}])){
   await q('UPDATE "HistoryMigrationPilotRun" SET "snapshotEncrypted"=$1 WHERE id=$2',[sealHistoryEvidence('PILOT_SNAPSHOT',run.runId,{...snapshot,...patch}),run.runId]);
   await assert.rejects(pilot.rollback(job.jobId,run.runId,'synthetic-password',pilotOwner),/контрольной точки/);
   assert.equal((await q(`SELECT count(*)::int AS n FROM "Message" WHERE metadata #>> '{deletion,deletedAt}' IS NOT NULL`)).rows[0].n,0);
  }
 }finally{await f.close()}
});
test('owned edits, replies, tasks, attachments and conversation identity changes block V2 rollback atomically',isolated,async t=>{
 const {f,q,pilot,job,run}=await prepared();
 try{const [owned]=(await q('SELECT * FROM "Message"')).rows;
  const cases=[
   ['text edit',async()=>q(`UPDATE "Message" SET content='Changed' WHERE id=$1`,[owned.id]),async()=>q('UPDATE "Message" SET content=$1 WHERE id=$2',[owned.content,owned.id])],
   ['new task',async()=>q(`INSERT INTO "WorkTask" (id,"sourceMessageId") VALUES ('dependent',$1)`,[owned.id]),async()=>q(`DELETE FROM "WorkTask" WHERE id='dependent'`)],
   ['new reply',async()=>q(`INSERT INTO "Message" (id,"conversationId",direction,status,content,"replyToMessageId") VALUES ('reply','existing-conversation','OUTBOUND','SENT','Reply',$1)`,[owned.id]),async()=>q(`DELETE FROM "Message" WHERE id='reply'`)],
   ['new attachment',async()=>q(`INSERT INTO "MessageAttachment" (id,"messageId",type) VALUES ('dependent',$1,'image')`,[owned.id]),async()=>q(`DELETE FROM "MessageAttachment" WHERE id='dependent'`)],
   ['channel change',async()=>q(`UPDATE "Conversation" SET channel='FACEBOOK' WHERE id='existing-conversation'`),async()=>q(`UPDATE "Conversation" SET channel='INSTAGRAM' WHERE id='existing-conversation'`)],
   ['archive change',async()=>q(`UPDATE "Conversation" SET "archivedAt"=CURRENT_TIMESTAMP WHERE id='existing-conversation'`),async()=>q(`UPDATE "Conversation" SET "archivedAt"=NULL WHERE id='existing-conversation'`)]
  ];
  for(const [name,change,undo]of cases)await t.test(name,async()=>{await change();try{await assert.rejects(pilot.rollback(job.jobId,run.runId,'synthetic-password',pilotOwner),/изменил|зависимост/);assert.equal((await q(`SELECT status FROM "HistoryMigrationPilotRun" WHERE id=$1`,[run.runId])).rows[0].status,'APPLIED');assert.equal((await q(`SELECT metadata #>> '{deletion,deletedAt}' AS deleted FROM "Message" WHERE id=$1`,[owned.id])).rows[0].deleted,null)}finally{await undo()}});
 }finally{await f.close()}
});
test('rollback transaction failure preserves all rows and a successful retry cannot resurrect history',isolated,async()=>{
 const {f,q,pilot,job,preview,run,live}=await prepared();
 try{await live();const before=(await q('SELECT * FROM "Message" ORDER BY id')).rows;f.failCommit(true);await assert.rejects(pilot.rollback(job.jobId,run.runId,'synthetic-password',pilotOwner),/Synthetic transaction failure/);f.failCommit(false);
  assert.deepEqual((await q('SELECT * FROM "Message" ORDER BY id')).rows,before);assert.equal((await q('SELECT status FROM "HistoryMigrationPilotRun" WHERE id=$1',[run.runId])).rows[0].status,'APPLIED');
  await pilot.rollback(job.jobId,run.runId,'synthetic-password',pilotOwner);const after=(await q('SELECT * FROM "Message" ORDER BY id')).rows;
  assert.equal((await pilot.rollback(job.jobId,run.runId,'synthetic-password',pilotOwner)).replayed,true);assert.deepEqual((await q('SELECT * FROM "Message" ORDER BY id')).rows,after);await assert.rejects(pilot.apply(job.jobId,preview.previewDigest,'synthetic-password',pilotOwner),/отозван/);
 }finally{await f.close()}
});
test('V2 replay refuses NEW actions even when a previously non-owned message disappears without other blockers',isolated,async()=>{
 const {f,q,pilot}=await prepared();
 try{const job=await f.stage([pilotMessage('historical'),pilotMessage('additional')]);await f.planning.bind(job.jobId,{mode:'EXISTING',clientId:'existing',dialogueId:'thread-a'},'synthetic-password',pilotOwner);
  const preview=await f.planning.dryRun(job.jobId,pilotOwner);assert.equal((await pilot.apply(job.jobId,preview.previewDigest,'synthetic-password',pilotOwner)).added,1);
  const [old]=(await q(`SELECT id FROM "Message" WHERE content='Synthetic historical'`)).rows;await q('DELETE FROM "HistoryMigrationOrigin" WHERE "messageId"=$1',[old.id]);await q('DELETE FROM "Message" WHERE id=$1',[old.id]);
  const current=await f.planning.dryRun(job.jobId,pilotOwner);assert.equal(current.newCandidates,1);assert.deepEqual(current.blockers,[]);
  await assert.rejects(pilot.apply(job.jobId,preview.previewDigest,'synthetic-password',pilotOwner),/замечания|изменил/);assert.equal((await q('SELECT count(*)::int AS n FROM "Message"')).rows[0].n,1);
 }finally{await f.close()}
});
test('run-owned identities on existing clients remain in custody for both replay and rollback',isolated,async()=>{
 const {f,q,pilot,job,preview,run}=await prepared('confirmed-subject');
 try{const identities=(await q('SELECT * FROM "HistoryMigrationIdentity" WHERE "runId"=$1',[run.runId])).rows;assert.equal(identities.length,1);await q('DELETE FROM "HistoryMigrationIdentity" WHERE "runId"=$1',[run.runId]);
  await assert.rejects(pilot.apply(job.jobId,preview.previewDigest,'synthetic-password',pilotOwner),/изменил|зависимост/);await assert.rejects(pilot.rollback(job.jobId,run.runId,'synthetic-password',pilotOwner),/изменил|зависимост/);
  assert.equal((await q(`SELECT count(*)::int AS n FROM "Message" WHERE metadata #>> '{deletion,deletedAt}' IS NOT NULL`)).rows[0].n,0);assert.equal((await q('SELECT status FROM "HistoryMigrationPilotRun" WHERE id=$1',[run.runId])).rows[0].status,'APPLIED');
 }finally{await f.close()}
});
