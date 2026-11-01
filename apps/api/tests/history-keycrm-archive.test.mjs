import test from 'node:test';import assert from 'node:assert/strict';
import{historyFixture,pilotOwner,pilotMessage}from'./history-migration-fixture.mjs';
import{loadTargetModule}from'./overview-target-loader.mjs';
const{IsolatedHistoryMigrationPilot}=loadTargetModule('history-migration/isolated-history-pilot.ts');
const{sourceKey,normalizeMessage}=loadTargetModule('history-migration/history.ts');
const isolated={skip:process.env.YO_HISTORY_PGLITE!=='1',timeout:120000};
const raw=(id,dialogueId='thread-a',extra={})=>pilotMessage(id,{dialogueId,sender:'contact:'+dialogueId,timestamp:'2024-01-01',sourceTimeText:'2024-01-01 12:30',sourceTimezone:'Europe/Kyiv',text:'Archived source text',attachments:[{name:'unverified-attachment-1',mimeType:'application/octet-stream',size:null,checksum:null,available:false}],...extra});
test('archive approval ordering preserves distinct Unicode identities independently of list order',()=>{
 const {validateKeycrmArchiveApproval}=loadTargetModule('history-migration/history.ts'),key=(id,dialogue)=>sourceKey(normalizeMessage(raw(id,dialogue))),a=[key('é','thread-a'),key('é','thread-b')],b=[key('e\u0301','thread-a'),key('e\u0301','thread-b')],policy='KEYCRM_SOURCE_ARCHIVE_V1';assert.notDeepEqual(a,b);assert.deepEqual(validateKeycrmArchiveApproval({policy,equivalences:[a,b]}),validateKeycrmArchiveApproval({policy,equivalences:[b,a]}));
});
test('explicit isolated KeyCRM archive preserves minute and missing inventory, reviewed aliases, replay and rollback',isolated,async()=>{
 const f=await historyFixture();try{const pilot=new IsolatedHistoryMigrationPilot(f.repository,f.backups),messages=[raw('one'),raw('two','thread-b')],job=await f.stage(messages);
  for(const dialogueId of['thread-a','thread-b'])await f.planning.bind(job.jobId,{dialogueId,mode:'EXISTING',clientId:'existing'},'synthetic-password',pilotOwner);
  const strict=await f.planning.dryRun(job.jobId,pilotOwner);assert.equal(strict.newCandidates,0);await assert.rejects(pilot.apply(job.jobId,strict.previewDigest,'synthetic-password',pilotOwner));
  const approval={policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[[sourceKey(normalizeMessage(messages[0])),sourceKey(normalizeMessage(messages[1]))]]};
  const preview=await pilot.previewArchive(job.jobId,approval,pilotOwner);assert.equal(preview.newCandidates,1);assert.equal(preview.inBatchDuplicates,1);assert.deepEqual(preview.blockers,[]);
  await assert.rejects(pilot.applyArchive(job.jobId,strict.previewDigest,approval,'synthetic-password',pilotOwner),/Предпросмотр/);
  const run=await pilot.applyArchive(job.jobId,preview.previewDigest,approval,'synthetic-password',pilotOwner);assert.equal(run.added,1);
  const rows=(await f.db.query('SELECT * FROM "Message"')).rows;assert.equal(rows.length,1);assert.equal(rows[0].metadata.historyArchive.policy,approval.policy);assert.equal(rows[0].metadata.historyArchive.time.precision,'MINUTE');assert.equal(rows[0].metadata.historyArchive.time.original,'2024-01-01 12:30');assert.equal(rows[0].metadata.historyArchive.missingAttachments.length,1);assert.equal(rows[0].metadata.historyArchive.nativeIdentityVerified,false);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM "HistoryMigrationOrigin"')).rows[0].n,2);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM "MessageAttachment"')).rows[0].n,0);
  const replay=await pilot.applyArchive(job.jobId,preview.previewDigest,approval,'synthetic-password',pilotOwner);assert.equal(replay.added,0);assert.equal(replay.alreadyExists,1);assert.equal(replay.replayed,true);
  const rolled=await pilot.rollback(job.jobId,run.runId,'synthetic-password',pilotOwner);assert.equal(rolled.rolledBack,true);await assert.rejects(pilot.applyArchive(job.jobId,preview.previewDigest,approval,'synthetic-password',pilotOwner),/отозван/);
 }finally{await f.close();}
});

test('archive refuses ambiguous time, cross-client or contradictory equivalence and metadata tampering',isolated,async()=>{
 const f=await historyFixture();try{const pilot=new IsolatedHistoryMigrationPilot(f.repository,f.backups),messages=[raw('one'),raw('two','thread-b'),raw('three','thread-a')],job=await f.stage(messages);
  for(const dialogueId of['thread-a','thread-b'])await f.planning.bind(job.jobId,{dialogueId,mode:'EXISTING',clientId:'existing'},'synthetic-password',pilotOwner);
  const keys=messages.map(m=>sourceKey(normalizeMessage(m))),approval={policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[[keys[0],keys[1]],[keys[2],keys[1]]]};
  await assert.rejects(pilot.previewArchive(job.jobId,approval,pilotOwner),/неоднознач|одном диалоге/);
  await assert.rejects(pilot.previewArchive(job.jobId,{policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[[keys[0],'foreign']]},pilotOwner));
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM "Message"')).rows[0].n,0);
  const single=await f.stage([raw('separate','thread-c',{text:'A separate archival occurrence'})]);await f.planning.bind(single.jobId,{dialogueId:'thread-c',mode:'EXISTING',clientId:'existing'},'synthetic-password',pilotOwner);const policy={policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[]},preview=await pilot.previewArchive(single.jobId,policy,pilotOwner);await pilot.applyArchive(single.jobId,preview.previewDigest,policy,'synthetic-password',pilotOwner);
  await f.db.query(`UPDATE "Message" SET metadata=jsonb_set(metadata,'{historyArchive,time,precision}','"SECOND"'::jsonb)`);await assert.rejects(pilot.applyArchive(single.jobId,preview.previewDigest,policy,'synthetic-password',pilotOwner),/измен|замечан/);
 }finally{await f.close();}
});

test('minute archive keeps unknown DST time in review and rejects native database before mutation',isolated,async()=>{
 const f=await historyFixture();try{const pilot=new IsolatedHistoryMigrationPilot(f.repository,f.backups),job=await f.stage([raw('dst','thread-a',{sourceTimeText:'2026-10-25 03:30',timestamp:'2026-10-25'})]);await f.planning.bind(job.jobId,{dialogueId:'thread-a',mode:'EXISTING',clientId:'existing'},'synthetic-password',pilotOwner);const policy={policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[]},preview=await pilot.previewArchive(job.jobId,policy,pilotOwner);assert.equal(preview.newCandidates,0);assert.equal(preview.review,1);await assert.rejects(pilot.applyArchive(job.jobId,preview.previewDigest,policy,'synthetic-password',pilotOwner));
  f.realPostgres(true);await assert.rejects(pilot.previewArchive(job.jobId,policy,pilotOwner),/изолирован|PGlite|WASM/i);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM "Message"')).rows[0].n,0);
 }finally{await f.close();}
});

test('new aliases require review; removing sealed archive metadata cannot bypass integrity across jobs',isolated,async()=>{
 const f=await historyFixture();try{const pilot=new IsolatedHistoryMigrationPilot(f.repository,f.backups),a=raw('a','thread-a',{attachments:[]}),b=raw('b','thread-b',{attachments:[]}),policy={policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[]};
  async function stage(messages){const job=await f.stage(messages);for(const dialogueId of new Set(messages.map(m=>m.dialogueId)))await f.planning.bind(job.jobId,{dialogueId,mode:'EXISTING',clientId:'existing'},'synthetic-password',pilotOwner);return job;}
  const first=await stage([a]),preview=await pilot.previewArchive(first.jobId,policy,pilotOwner);await pilot.applyArchive(first.jobId,preview.previewDigest,policy,'synthetic-password',pilotOwner);
  const second=await stage([a,b]),pairs={policy:policy.policy,equivalences:[[sourceKey(normalizeMessage(a)),sourceKey(normalizeMessage(b))]]},next=await pilot.previewArchive(second.jobId,pairs,pilotOwner);assert.equal(next.review,1);await assert.rejects(pilot.applyArchive(second.jobId,next.previewDigest,pairs,'synthetic-password',pilotOwner));
  await f.db.query(`UPDATE "Message" SET metadata=metadata-'historyArchive'`);const third=await stage([a]),damaged=await pilot.previewArchive(third.jobId,policy,pilotOwner);assert.ok(damaged.conflicts>0);await assert.rejects(pilot.applyArchive(third.jobId,damaged.previewDigest,policy,'synthetic-password',pilotOwner));
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM "HistoryMigrationOrigin"')).rows[0].n,1);
 }finally{await f.close();}
});

test('identical unavailable attachment slots retain multiplicity through exact archive replay',isolated,async()=>{
 const f=await historyFixture();try{const pilot=new IsolatedHistoryMigrationPilot(f.repository,f.backups),m=raw('two-slots');m.attachments.push({...m.attachments[0]});const job=await f.stage([m]);await f.planning.bind(job.jobId,{dialogueId:'thread-a',mode:'EXISTING',clientId:'existing'},'synthetic-password',pilotOwner);const policy={policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[]},preview=await pilot.previewArchive(job.jobId,policy,pilotOwner);await pilot.applyArchive(job.jobId,preview.previewDigest,policy,'synthetic-password',pilotOwner);const replay=await pilot.applyArchive(job.jobId,preview.previewDigest,policy,'synthetic-password',pilotOwner);assert.equal(replay.added,0);assert.equal(replay.replayed,true);assert.equal((await f.db.query('SELECT metadata FROM "Message"')).rows[0].metadata.historyArchive.missingAttachments.length,2);
 }finally{await f.close();}
});

test('duplicate scoped source observations choose the same ordinal variant in metadata and sealed origin',isolated,async()=>{
 const f=await historyFixture();try{const pilot=new IsolatedHistoryMigrationPilot(f.repository,f.backups),messages=[raw('same-id','thread-a',{ordinal:10}),raw('same-id','thread-a',{ordinal:0})],job=await f.stage(messages);await f.planning.bind(job.jobId,{dialogueId:'thread-a',mode:'EXISTING',clientId:'existing'},'synthetic-password',pilotOwner);const policy={policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[]},preview=await pilot.previewArchive(job.jobId,policy,pilotOwner);assert.equal(preview.newCandidates,1);await pilot.applyArchive(job.jobId,preview.previewDigest,policy,'synthetic-password',pilotOwner);const replay=await pilot.applyArchive(job.jobId,preview.previewDigest,policy,'synthetic-password',pilotOwner);assert.equal(replay.added,0);assert.equal(replay.replayed,true);const metadata=(await f.db.query('SELECT metadata FROM "Message"')).rows[0].metadata;assert.equal(metadata.historyArchive.sourceVariants.length,1);assert.equal(metadata.historyArchive.sourceVariants[0].ordinal,0);
 }finally{await f.close();}
});

test('full migration schema physically restores minute archives and replays without database writes',isolated,async()=>{
 const {historyFullSchemaFixture,restoreHistoryFullSchemaFixture}=await import('./history-full-schema-fixture.mjs');const f=await historyFullSchemaFixture();let restored;
 try{const job=await f.stage([raw('full-schema-minute')]);await f.planning.bind(job.jobId,{dialogueId:'thread-a',mode:'EXISTING',clientId:'existing'},'synthetic-password',pilotOwner);const policy={policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[]},preview=await f.pilot.previewArchive(job.jobId,policy,pilotOwner),run=await f.pilot.applyArchive(job.jobId,preview.previewDigest,policy,'synthetic-password',pilotOwner),before=await f.snapshot(),dump=await f.dump();restored=await restoreHistoryFullSchemaFixture(dump);assert.deepEqual(await restored.snapshot(),before);const replay=await restored.pilot.applyArchive(job.jobId,preview.previewDigest,policy,'synthetic-password',pilotOwner);assert.equal(replay.added,0);assert.deepEqual(await restored.snapshot(),before);await restored.pilot.rollback(job.jobId,run.runId,'synthetic-password',pilotOwner);await f.verifyInputs();
 }finally{await restored?.close();await f.close();}
});

test('one-to-one archive equivalences reject shared endpoints and freeze an applied grouping',isolated,async()=>{
 const f=await historyFixture();try{const pilot=new IsolatedHistoryMigrationPilot(f.repository,f.backups),messages=[raw('a'),raw('b','thread-b'),raw('c','thread-c')],keys=messages.map(m=>sourceKey(normalizeMessage(m))),job=await f.stage(messages.slice(0,2));for(const dialogueId of['thread-a','thread-b'])await f.planning.bind(job.jobId,{dialogueId,mode:'EXISTING',clientId:'existing'},'synthetic-password',pilotOwner);
  await assert.rejects(pilot.previewArchive(job.jobId,{policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[[keys[0],keys[1]],[keys[1],keys[2]]]},pilotOwner),/неоднознач|одному/);
  const approval={policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[[keys[0],keys[1]]]},preview=await pilot.previewArchive(job.jobId,approval,pilotOwner);await pilot.applyArchive(job.jobId,preview.previewDigest,approval,'synthetic-password',pilotOwner);
  await assert.rejects(pilot.previewArchive(job.jobId,{policy:approval.policy,equivalences:[]},pilotOwner),/зафиксирован|измен/);await assert.rejects(pilot.applyArchive(job.jobId,preview.previewDigest,{policy:approval.policy,equivalences:[]},'synthetic-password',pilotOwner),/зафиксирован|измен/);
  const replay=await pilot.applyArchive(job.jobId,preview.previewDigest,{policy:approval.policy,equivalences:[[keys[1],keys[0]]]},'synthetic-password',pilotOwner);assert.equal(replay.replayed,true);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM "HistoryMigrationPilotRun"')).rows[0].n,1);
 }finally{await f.close();}
});
