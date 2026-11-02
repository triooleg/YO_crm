import test from 'node:test';
import assert from 'node:assert/strict';

const optIn={skip:process.env.YO_HISTORY_PGLITE!=='1',timeout:180000};
test('full-schema restored V2 rollback preserves unrelated live history and current attention',optIn,async()=>{
 const {historyFullSchemaFixture,restoreHistoryFullSchemaFixture}=await import('./history-full-schema-fixture.mjs');const f=await historyFullSchemaFixture();let restored;
 try{const job=await f.stage([f.pilotMessage('owned-before-live')]);await f.planning.bind(job.jobId,{dialogueId:'thread-a',mode:'EXISTING',clientId:'existing',subjectId:'full-schema-existing-subject'},'synthetic-password',f.pilotOwner);
  const preview=await f.planning.dryRun(job.jobId,f.pilotOwner),run=await f.pilot.apply(job.jobId,preview.previewDigest,'synthetic-password',f.pilotOwner);
  await f.db.query(`INSERT INTO "Message" (id,"conversationId",direction,status,content,"externalId","receivedAt","createdAt",metadata) VALUES ('full-later-live','protected-ig','INBOUND','RECEIVED','Current unrelated live message','provider-native-current','2026-10-29','2026-10-29','{"provider":"META"}'::jsonb)`);
  await f.db.query(`UPDATE "Conversation" SET "unreadCount"=12,"unreadVersion"=19,"lastMessageAt"='2026-10-29',"updatedAt"='2026-10-29' WHERE id='protected-ig'`);
  const before=await f.snapshot(),owned=before.Message.find(row=>row.content==='Synthetic owned-before-live');assert.ok(owned);
  restored=await restoreHistoryFullSchemaFixture(await f.dump());assert.deepEqual(await restored.snapshot(),before);
  const repeated=await restored.pilot.apply(job.jobId,preview.previewDigest,'synthetic-password',f.pilotOwner);assert.equal(repeated.added,0);assert.equal(repeated.alreadyExists,1);assert.deepEqual(await restored.snapshot(),before);
  await restored.pilot.rollback(job.jobId,run.runId,'synthetic-password',f.pilotOwner);const after=await restored.snapshot();
  for(const table of Object.keys(before))if(!['HistoryMigrationPilotRun','AuditLog','Message'].includes(table))assert.deepEqual(after[table],before[table],`Unrelated restored table changed: ${table}`);
  assert.deepEqual(after.Message.filter(row=>row.id!==owned.id),before.Message.filter(row=>row.id!==owned.id));
  const removed=after.Message.find(row=>row.id===owned.id);assert.ok(removed.metadata.deletion.deletedAt);assert.deepEqual({...removed,metadata:owned.metadata},owned);
  await assert.rejects(restored.pilot.apply(job.jobId,preview.previewDigest,'synthetic-password',f.pilotOwner),/отозван/);
 }finally{await restored?.close();await f.close()}
});
const protectedCounts=snapshot=>Object.fromEntries(['User','Client','Athlete','Order','OrderItem','Payment','Conversation','Message','AiJob','AiJobAttempt','MessageAnalysis','AiRuntimeSetting'].map(table=>[table,snapshot[table].length]));
function preserve(baseline,current){
 for(const [table,rows] of Object.entries(baseline)){
  if(table.startsWith('HistoryMigration')||table==='AuditLog')continue;
  if(table==='Message'){
   for(const row of rows)assert.deepEqual(current.Message.find(value=>value.id===row.id),row,`Existing message changed: ${row.id}`);
  }else assert.deepEqual(current[table],rows,`Protected full-schema table changed: ${table}`);
 }
}
function retainedMessages(snapshot,ids){return snapshot.Message.filter(row=>ids.has(row.id)).map(({metadata,...row})=>row).sort((a,b)=>a.id.localeCompare(b.id));}

test('isolated 53-migration full-schema append/replay/rollback and physical PGlite dump restore',optIn,async t=>{
 const {historyFullSchemaFixture,restoreHistoryFullSchemaFixture,fullSchemaDigest}=await import('./history-full-schema-fixture.mjs');
 const f=await historyFullSchemaFixture();
 const q=(sql,params)=>f.db.query(sql,params);
 const report={scope:'SYNTHETIC_IN_MEMORY_PGLITE_ONLY',concurrency:'NOT_TESTED_SINGLE_CONNECTION_WASM',dumps:{}};
 try{
  assert.equal(f.migrations.length,53);assert.ok(f.schema.triggers.length>0);assert.ok(f.schema.constraints.length>0);
  const baseline=await f.snapshot();
  report.version=f.version;report.migrations={count:f.migrations.length,sha256:fullSchemaDigest(f.migrations),first:f.migrations[0].name,last:f.migrations.at(-1).name};
  report.historyModule={files:f.coreManifest.length,sha256:fullSchemaDigest(f.coreManifest)};
  report.schema={tables:f.schema.tables.length,constraints:f.schema.constraints.length,foreignKeys:f.schema.constraints.filter(c=>c.type==='f').length,checks:f.schema.constraints.filter(c=>c.type==='c').length,triggers:f.schema.triggers.length,functions:f.schema.functions.length,sha256:fullSchemaDigest(f.schema)};
  report.baseline={counts:protectedCounts(baseline),sha256:fullSchemaDigest(baseline)};
  async function restoreAndCompare(label,snapshot,exercise){
   const dump=await f.dump();report.dumps[label]={bytes:dump.size,sha256:fullSchemaDigest(Buffer.from(await dump.arrayBuffer()))};
   const restored=await restoreHistoryFullSchemaFixture(dump);
   try{
    assert.notEqual(restored.db,f.db,'Restore must allocate a genuinely fresh PGlite instance');
    assert.deepEqual(restored.schema,f.schema,`${label}: triggers/constraints/functions changed on restore`);
    assert.deepEqual(await restored.snapshot(),snapshot,`${label}: full database row snapshot changed on restore`);
    if(exercise)await exercise(restored);
   }finally{await restored.close();}
  }
  await t.test('full real migration chain retains triggers/FKs/CHECKs and restores seeded baseline',async()=>{
   assert.ok(f.schema.triggers.some(trigger=>trigger.name==='route_merged_client_owner'));
   assert.ok(f.schema.triggers.some(trigger=>trigger.name==='tax_entry_immutable'));
   assert.ok(f.schema.triggers.some(trigger=>trigger.name==='WebsiteApiKey_history_guard'));
   assert.ok(f.schema.constraints.every(constraint=>constraint.validated===true));
   assert.equal(baseline.Payment[0].amountMinor,19500);assert.equal(baseline.Order[0].priceMinor,39000);
   assert.equal(baseline.Message[0].aiAnalysisVersion,'protected-v7');
   await restoreAndCompare('baseline',baseline);
  });
  await t.test('actual foreign key, CHECK and immutable-history trigger reject invalid writes without weakening schema',async()=>{
   await assert.rejects(q(`INSERT INTO "Payment" (id,"orderId","amountMinor",currency,method,"receivedAt") VALUES ('rejected-payment','missing-order',1,'EUR','CASH','2024-01-01T00:00:00Z')`),error=>error.code==='23503');
   await assert.rejects(q(`INSERT INTO "HistoryMigrationJob" (id,"createdById",source,account,channel,"updatedAt") VALUES ('rejected-job','owner','NOT_KEYCRM','synthetic','INSTAGRAM','2024-01-01T00:00:00Z')`),error=>error.code==='23514');
   await assert.rejects(f.db.transaction(async pg=>{
    await pg.query(`INSERT INTO "WebsiteApiKey" (id,name,selector,digest,"sourceAccount","createdById") VALUES ('temporary-guard-key','Synthetic guard','0123456789abcdef',decode(repeat('ab',32),'hex'),'synthetic.example.test','owner')`);
    await pg.query(`UPDATE "WebsiteApiKey" SET name='Forbidden identity change' WHERE id='temporary-guard-key'`);
   }),error=>error.code==='P0001'&&/immutable/.test(error.message));
   assert.deepEqual(await f.snapshot(),baseline,'Constraint probes must leave every table exactly at baseline');
   assert.ok(f.schema.triggers.every(trigger=>trigger.enabled==='O'));
  });
  const messages=[
   f.pilotMessage('later-outbound',{dialogueId:'thread-b',timestamp:'2024-08-01T13:15:30+02:00',direction:'OUTBOUND',text:'Later source text 🧵',ordinal:0}),
   f.pilotMessage('earlier-inbound',{dialogueId:'thread-a',timestamp:'2024-01-01T12:00:00Z',direction:'INBOUND',text:'Earlier source text café',ordinal:1}),
  ];
  const job=await f.stage(messages);
  for(const dialogueId of ['thread-a','thread-b'])await f.planning.bind(job.jobId,{dialogueId,mode:'EXISTING',clientId:'existing'},'synthetic-password',f.pilotOwner);
  let run,imported;
  await t.test('two source dialogues append one client history in exact UTC chronology, atomically',async()=>{
   const preview=await f.planning.dryRun(job.jobId,f.pilotOwner);
   assert.equal(preview.newCandidates,2);assert.equal(preview.review,0);assert.deepEqual(preview.blockers,[]);
   assert.deepEqual(preview.targets.map(row=>row.dialogueId),['thread-a','thread-b']);assert.equal(new Set(preview.targets.map(row=>row.clientId)).size,1);
   const beforeAttempt=await f.snapshot();
   f.failCommit(true);
   try{await assert.rejects(f.pilot.apply(job.jobId,preview.previewDigest,'synthetic-password',f.pilotOwner),/Synthetic transaction failure/);}finally{f.failCommit(false);}
   assert.deepEqual(await f.snapshot(),beforeAttempt,'Failed transaction must retain ALL real-schema rows');
   run=await f.pilot.apply(job.jobId,preview.previewDigest,'synthetic-password',f.pilotOwner);
   assert.equal(run.added,2);assert.equal(run.createdClients,0);assert.equal(run.productionImport,false);
   const chronology=(await q(`SELECT id,content,"conversationId","createdAt","sentAt","receivedAt","aiProcessedAt","aiAnalysisVersion",to_char("createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "sqlUtc" FROM "Message" WHERE "conversationId"='protected-ig' ORDER BY "createdAt",id`)).rows;
   assert.equal(chronology.length,2);assert.deepEqual(chronology.map(row=>row.sqlUtc),['2024-01-01T12:00:00.000','2024-08-01T11:15:30.000']);
   assert.deepEqual(chronology.map(row=>row.createdAt.toISOString()),['2024-01-01T12:00:00.000Z','2024-08-01T11:15:30.000Z']);
   assert.equal(chronology[0].receivedAt.toISOString(),'2024-01-01T12:00:00.000Z');assert.equal(chronology[0].sentAt,null);
   assert.equal(chronology[1].sentAt.toISOString(),'2024-08-01T11:15:30.000Z');assert.equal(chronology[1].receivedAt,null);
   assert.ok(chronology.every(row=>row.aiProcessedAt===null&&row.aiAnalysisVersion===null));
   imported=await f.snapshot();preserve(baseline,imported);
   assert.equal(imported.HistoryMigrationOrigin.length,2);assert.equal(imported.HistoryMigrationPilotRun.length,1);
   assert.equal(new Set(imported.Message.filter(row=>row.id!=='protected-message').map(row=>row.conversationId)).size,1);
   const nativeDialogues=imported.Message.filter(row=>row.id!=='protected-message').map(row=>row.metadata.historyMigration.dialogueId).sort();assert.deepEqual(nativeDialogues,['thread-a','thread-b']);
   report.imported={added:run.added,createdClients:run.createdClients,counts:protectedCounts(imported),origins:imported.HistoryMigrationOrigin.length,sha256:fullSchemaDigest(imported),sqlUtc:chronology.map(row=>row.sqlUtc)};
  });
  if(!run||!imported)return;
  await t.test('same source replay adds zero and physical restored imported snapshot also replays zero',async()=>{
   const preview=await f.planning.dryRun(job.jobId,f.pilotOwner);assert.equal(preview.alreadyExists,2);assert.equal(preview.newCandidates,0);
   const replay=await f.pilot.apply(job.jobId,preview.previewDigest,'synthetic-password',f.pilotOwner);
   assert.equal(replay.added,0);assert.equal(replay.replayed,true);assert.deepEqual(await f.snapshot(),imported);
   await restoreAndCompare('imported',imported,async restored=>{
    const next=await restored.planning.dryRun(job.jobId,f.pilotOwner);assert.equal(next.alreadyExists,2);
    const again=await restored.pilot.apply(job.jobId,next.previewDigest,'synthetic-password',f.pilotOwner);assert.equal(again.added,0);assert.equal(again.replayed,true);assert.deepEqual(await restored.snapshot(),imported);
   });
   report.replay={added:0,restoredAdded:0};
  });
  await t.test('rollback retains only own messages as tombstones; all baseline fields and AI/unread remain unchanged',async()=>{
   const ids=new Set(imported.Message.filter(row=>row.metadata?.historyMigration?.runId===run.runId).map(row=>row.id));assert.equal(ids.size,2);
   const rolled=await f.pilot.rollback(job.jobId,run.runId,'synthetic-password',f.pilotOwner);assert.equal(rolled.rolledBack,true);
   const current=await f.snapshot();preserve(baseline,current);
   assert.deepEqual(retainedMessages(current,ids),retainedMessages(imported,ids));assert.equal(current.Message.length,3);
   for(const row of current.Message){if(ids.has(row.id)){assert.ok(row.metadata.deletion.deletedAt);assert.deepEqual(row.metadata.historyMigration,imported.Message.find(value=>value.id===row.id).metadata.historyMigration);}else assert.equal(row.metadata?.deletion,undefined);}
   assert.deepEqual(current.HistoryMigrationOrigin,imported.HistoryMigrationOrigin);assert.equal(current.HistoryMigrationPilotRun[0].status,'ROLLED_BACK');
   const preview=await f.planning.dryRun(job.jobId,f.pilotOwner);assert.equal(preview.newCandidates,0);assert.ok(preview.blockers.includes('PREVIOUS_IMPORT_ROLLED_BACK'));
   await assert.rejects(f.pilot.apply(job.jobId,preview.previewDigest,'synthetic-password',f.pilotOwner),/отозван/);assert.deepEqual(await f.snapshot(),current);
   await restoreAndCompare('rolledBack',current,async restored=>{
    const next=await restored.planning.dryRun(job.jobId,f.pilotOwner);assert.equal(next.newCandidates,0);assert.ok(next.blockers.includes('PREVIOUS_IMPORT_ROLLED_BACK'));
    await assert.rejects(restored.pilot.apply(job.jobId,next.previewDigest,'synthetic-password',f.pilotOwner),/отозван/);assert.deepEqual(await restored.snapshot(),current);
    const repeatRollback=await restored.pilot.rollback(job.jobId,run.runId,'synthetic-password',f.pilotOwner);assert.equal(repeatRollback.replayed,true);assert.deepEqual(await restored.snapshot(),current);
   });
   report.rolledBack={retainedMessages:ids.size,tombstones:current.Message.filter(row=>row.metadata?.deletion?.deletedAt).length,origins:current.HistoryMigrationOrigin.length,sha256:fullSchemaDigest(current)};
  });
  await f.verifyInputs();
  t.diagnostic(JSON.stringify(report));
 }finally{await f.close();}
});
