import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
import {historyFixture,pilotMessage,pilotOwner} from './history-migration-fixture.mjs';

const {buildHistoryPlan}=loadTargetModule('history-migration/history-plan.ts');
const {IsolatedHistoryMigrationPilot}=loadTargetModule('history-migration/isolated-history-pilot.ts');
const {sourceKey,normalizeMessage}=loadTargetModule('history-migration/history.ts');
const options={skip:process.env.YO_HISTORY_PGLITE!=='1',timeout:120000};
const raw=(dialogueId,text,ordinal)=>pilotMessage(text,{dialogueId,sender:'contact:'+dialogueId,text,ordinal,
  timestamp:'2024-01-01',sourceTimeText:'2024-01-01 12:30',sourceTimezone:'Europe/Kyiv'});

test('shared build plan, preview and apply all refuse cyclic caller-supplied archive approval before any business writes',options,async()=>{
 const f=await historyFixture();
 try{
  const messages=[raw('a','X',0),raw('a','Y',1),raw('b','Y',0),raw('b','X',1)];
  const key=m=>sourceKey(normalizeMessage(m));
  const approval={policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[[key(messages[0]),key(messages[3])],[key(messages[1]),key(messages[2])]]};
  const job=await f.stage(messages);
  for(const dialogueId of ['a','b'])await f.planning.bind(job.jobId,{dialogueId,mode:'EXISTING',clientId:'existing'},'synthetic-password',pilotOwner);
  const pilot=new IsolatedHistoryMigrationPilot(f.repository,f.backups);
  const before=await f.db.query('SELECT (SELECT count(*) FROM "Message") AS messages,(SELECT count(*) FROM "HistoryMigrationOrigin") AS origins,(SELECT count(*) FROM "HistoryMigrationPilotRun") AS runs,(SELECT count(*) FROM "AuditLog") AS audits');
  await assert.rejects(f.repository.withJob(job.jobId,tx=>buildHistoryPlan(tx,approval)),/порядок|цикл/iu);
  await assert.rejects(pilot.previewArchive(job.jobId,approval,pilotOwner),/порядок|цикл/iu);
  await assert.rejects(pilot.applyArchive(job.jobId,'a'.repeat(64),approval,'synthetic-password',pilotOwner),/порядок|цикл/iu);
  assert.deepEqual(await f.db.query('SELECT (SELECT count(*) FROM "Message") AS messages,(SELECT count(*) FROM "HistoryMigrationOrigin") AS origins,(SELECT count(*) FROM "HistoryMigrationPilotRun") AS runs,(SELECT count(*) FROM "AuditLog") AS audits'),before);
 }finally{await f.close();}
});

test('admission checks new aliases against existing visible archive constraints, while hidden history stays hidden',options,async()=>{
 const f=await historyFixture();
 try{
  const pilot=new IsolatedHistoryMigrationPilot(f.repository,f.backups),key=m=>sourceKey(normalizeMessage(m));
  async function staged(messages){
   const job=await f.stage(messages);
   for(const dialogueId of ['a','b'])await f.planning.bind(job.jobId,{dialogueId,mode:'EXISTING',clientId:'existing'},'synthetic-password',pilotOwner);
   return {job,approval:{policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[[key(messages[0]),key(messages[1])]]}};
  }
  const old=await staged([raw('a','Existing',1),raw('b','Existing',0)]);
  const accepted=await pilot.previewArchive(old.job.jobId,old.approval,pilotOwner);
  await pilot.applyArchive(old.job.jobId,accepted.previewDigest,old.approval,'synthetic-password',pilotOwner);
  const incoming=await staged([raw('a','New',0),raw('b','New',1)]);
  await assert.rejects(f.repository.withJob(incoming.job.jobId,tx=>buildHistoryPlan(tx,incoming.approval)),/порядок|цикл/iu);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM "Message"')).rows[0].n,1);
  await f.db.exec(`UPDATE "Message" SET metadata=jsonb_set(metadata,'{deletion}','{"deletedAt":"2024-01-02T00:00:00.000Z"}'::jsonb)`);
  const hidden=(await f.db.query('SELECT metadata FROM "Message"')).rows[0].metadata;
  const plan=await f.repository.withJob(incoming.job.jobId,tx=>buildHistoryPlan(tx,incoming.approval));
  assert.equal(plan.newCandidates,1);assert.deepEqual(plan.blockers,[]);
  assert.deepEqual((await f.db.query('SELECT metadata FROM "Message"')).rows[0].metadata,hidden);
 }finally{await f.close();}
});
