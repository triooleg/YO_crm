import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
import {historyFixture,pilotMessage,pilotOwner} from './history-migration-fixture.mjs';

const isolated={skip:process.env.YO_HISTORY_PGLITE!=='1',timeout:120000};
const password='synthetic-password';
const {HistoryMigrationTransactionEngine}=loadTargetModule('history-migration/history-transaction-engine.ts');
const {IsolatedHistoryMigrationPilot}=loadTargetModule('history-migration/isolated-history-pilot.ts');

// Test adapter only: no native database, Nest registration or supplied database URL.
class OperationalEngine extends HistoryMigrationTransactionEngine{
 executionMode='OPERATIONAL_NATIVE';
 constructor(f){super(f.backups);this.fixture=f;}
 withJob(id,action){return this.fixture.repository.withJob(id,action);}
 async nativeBinding(){return {conversationId:'existing-conversation',accountId:'synthetic-account',customerId:'synthetic-customer'};}
}

async function prepared(Engine=OperationalEngine){
 const f=await historyFixture();
 try{
  await f.db.exec(`ALTER TABLE "HistoryMigrationPilotRun" ADD COLUMN "nativeConversationId" text,
   ADD COLUMN "nativeAccountId" text, ADD COLUMN "nativeCustomerId" text;`);
  // Model the parent-owned additive migration only inside this in-memory fixture.
  await f.db.exec(`ALTER TABLE "HistoryMigrationPilotRun" DROP CONSTRAINT "HistoryMigrationPilotRun_environment_check";
   ALTER TABLE "HistoryMigrationPilotRun" ADD CONSTRAINT "HistoryMigrationPilotRun_environment_check"
   CHECK (environment IN ('ISOLATED_WASM','OPERATIONAL_NATIVE'));
   ALTER TABLE "HistoryMigrationPilotRun" ADD CONSTRAINT "HistoryMigrationPilotRun_native_binding_check" CHECK (
    (environment='ISOLATED_WASM' AND "nativeConversationId" IS NULL AND "nativeAccountId" IS NULL AND "nativeCustomerId" IS NULL)
    OR (environment='OPERATIONAL_NATIVE' AND "nativeConversationId" IS NOT NULL AND "nativeAccountId" IS NOT NULL AND "nativeCustomerId" IS NOT NULL));`);
  await f.db.exec(`INSERT INTO "Conversation" (id,"clientId",channel,"externalId","updatedAt")
   VALUES ('existing-conversation','existing','INSTAGRAM','synthetic-account:synthetic-customer',CURRENT_TIMESTAMP);`);
  const job=await f.stage([pilotMessage('historical')]);
  await f.planning.bind(job.jobId,{mode:'EXISTING',clientId:'existing',dialogueId:'thread-a'},password,pilotOwner);
  const preview=await f.planning.dryRun(job.jobId,pilotOwner);
  const engine=Engine===IsolatedHistoryMigrationPilot?new Engine(f.repository,f.backups):new Engine(f);
  return {f,job,preview,engine};
 }catch(error){await f.close();throw error;}
}

test('fixed operational execution identifies the stored run, apply, replay, rollback and audit truthfully',isolated,async()=>{
 const {f,job,preview,engine}=await prepared();
 try{
  const applied=await engine.apply(job.jobId,preview.previewDigest,password,pilotOwner);
  assert.equal(applied.productionImport,true);
  const [run]=(await f.db.query('SELECT * FROM "HistoryMigrationPilotRun" WHERE id=$1',[applied.runId])).rows;
  assert.equal(run.environment,'OPERATIONAL_NATIVE');
  assert.equal(run.result.productionImport,true);
  const replay=await engine.apply(job.jobId,preview.previewDigest,password,pilotOwner);
  assert.equal(replay.replayed,true);assert.equal(replay.added,0);assert.equal(replay.productionImport,true);
  const rollback=await engine.rollback(job.jobId,applied.runId,password,pilotOwner);
  assert.equal(rollback.productionImport,true);
  assert.equal((await engine.rollback(job.jobId,applied.runId,password,pilotOwner)).productionImport,true);
  const actions=(await f.db.query(`SELECT action FROM "AuditLog" WHERE action IN
   ('HISTORY_OPERATIONAL_NATIVE_APPLIED','HISTORY_OPERATIONAL_NATIVE_ROLLED_BACK') ORDER BY action`)).rows;
  assert.deepEqual(actions.map(row=>row.action),['HISTORY_OPERATIONAL_NATIVE_APPLIED','HISTORY_OPERATIONAL_NATIVE_ROLLED_BACK']);
 }finally{await f.close();}
});

async function durableState(f){
 const result={};
 for(const table of ['Client','Conversation','Message','HistoryMigrationOrigin','HistoryMigrationIdentity','HistoryMigrationPilotRun','AuditLog','Order','Payment'])
  result[table]=(await f.db.query(`SELECT * FROM "${table}" ORDER BY id`)).rows;
 return result;
}

test('cross-environment replay and rollback refuse before APPLIED or ROLLED_BACK shortcuts without writes',isolated,async()=>{
 for(const Engine of [OperationalEngine,IsolatedHistoryMigrationPilot]){
  const {f,job,preview,engine}=await prepared(Engine);
  try{
   const applied=await engine.apply(job.jobId,preview.previewDigest,password,pilotOwner);
   const other=Engine===OperationalEngine?new IsolatedHistoryMigrationPilot(f.repository,f.backups):new OperationalEngine(f);
   for(const status of ['APPLIED','ROLLED_BACK']){
    await f.db.query('UPDATE "HistoryMigrationPilotRun" SET status=$1 WHERE id=$2',[status,applied.runId]);
    const before=await durableState(f);
    await assert.rejects(other.apply(job.jobId,preview.previewDigest,password,pilotOwner),/среда выполнения/i);
    await assert.rejects(other.rollback(job.jobId,applied.runId,password,pilotOwner),/среда выполнения/i);
    assert.deepEqual(await durableState(f),before,'mode mismatch cannot modify history, custody, audit or finance');
   }
  }finally{await f.close();}
 }
});

test('executor planning refusal reaches preview, ordinary apply and archive apply without persistent writes',isolated,async()=>{
 class RefusingPlan extends OperationalEngine{
  async buildPlan(){throw Error('SYNTHETIC_NATIVE_EVIDENCE_REFUSAL');}
 }
 const {f,job,preview,engine}=await prepared(RefusingPlan);
 try{
  const before=await durableState(f),approval={policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[]};
  await assert.rejects(engine.previewArchive(job.jobId,approval,pilotOwner),/SYNTHETIC_NATIVE_EVIDENCE_REFUSAL/);
  await assert.rejects(engine.apply(job.jobId,preview.previewDigest,password,pilotOwner),/SYNTHETIC_NATIVE_EVIDENCE_REFUSAL/);
  await assert.rejects(engine.applyArchive(job.jobId,preview.previewDigest,approval,password,pilotOwner),/SYNTHETIC_NATIVE_EVIDENCE_REFUSAL/);
  assert.deepEqual(await durableState(f),before);
 }finally{await f.close();}
});

class BindingEngine extends OperationalEngine{
 async beforeApply(tx,plan,runId){
  await tx.db.$executeRaw`INSERT INTO "SyntheticEngineWindow" ("runId","conversationId","previewDigest")
   SELECT "id","nativeConversationId",${plan.previewDigest} FROM "HistoryMigrationPilotRun" WHERE "id"=${runId}`;
 }
}

async function requireAtomicBinding(f){
 await f.db.exec(`CREATE TABLE "SyntheticEngineWindow" (
  "runId" text PRIMARY KEY REFERENCES "HistoryMigrationPilotRun"(id),
  "conversationId" text NOT NULL REFERENCES "Conversation"(id),"previewDigest" text NOT NULL);
 CREATE FUNCTION require_synthetic_engine_window() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
  IF NOT EXISTS (SELECT 1 FROM "SyntheticEngineWindow" WHERE "runId"=NEW.metadata #>> '{historyMigration,runId}'
   AND "conversationId"=NEW."conversationId") THEN RAISE EXCEPTION 'SYNTHETIC_WINDOW_MISSING'; END IF;
  RETURN NEW;
 END $$;
 CREATE TRIGGER require_engine_window BEFORE INSERT ON "Message" FOR EACH ROW EXECUTE FUNCTION require_synthetic_engine_window();`);
}

test('operational conversation and window bind to the inserted run before any imported message is written',isolated,async()=>{
 const {f,job,preview,engine}=await prepared(BindingEngine);
 try{
  await requireAtomicBinding(f);
  const applied=await engine.apply(job.jobId,preview.previewDigest,password,pilotOwner);
  assert.equal(applied.added,1);
  assert.deepEqual((await f.db.query('SELECT * FROM "SyntheticEngineWindow"')).rows,
   [{runId:applied.runId,conversationId:'existing-conversation',previewDigest:preview.previewDigest}]);
  const [run]=(await f.db.query('SELECT * FROM "HistoryMigrationPilotRun" WHERE id=$1',[applied.runId])).rows;
  assert.equal(run.nativeConversationId,'existing-conversation');
  assert.equal(run.nativeAccountId,'synthetic-account');
  assert.equal(run.nativeCustomerId,'synthetic-customer');
 }finally{await f.close();}
});

test('an incomplete native binding fails its INSERT check before beforeApply can attempt a late repair',isolated,async()=>{
 class IncompleteBinding extends OperationalEngine{
  missing='all';
  async nativeBinding(tx,plan){return this.missing==='all'?null:{...await super.nativeBinding(tx,plan),[this.missing]:null};}
  async beforeApply(){throw Error('LATE_REPAIR_MUST_NOT_RUN');}
 }
 const {f,job,preview,engine}=await prepared(IncompleteBinding);
 try{
  const before=await durableState(f);
  for(const field of ['all','conversationId','accountId','customerId']){
   engine.missing=field;
   await assert.rejects(engine.apply(job.jobId,preview.previewDigest,password,pilotOwner),
    error=>error.constraint==='HistoryMigrationPilotRun_native_binding_check');
   assert.deepEqual(await durableState(f),before);
  }
 }finally{await f.close();}
});

test('executor integrity refusal blocks replay, rollback and already-rolled-back acknowledgement without writes',isolated,async()=>{
 class IntegrityEngine extends BindingEngine{
  async beforeReplay(tx,plan,run){
   assert.equal(plan.sourceDigest,run.sourceDigest);
   const rows=await tx.db.$queryRaw`SELECT "runId" FROM "SyntheticEngineWindow" WHERE "runId"=${run.id} AND "previewDigest"=${run.previewDigest}`;
   if(!rows.length)throw Error('SYNTHETIC_WINDOW_INTEGRITY_REFUSAL');
  }
  async beforeRollback(tx,run){
   const rows=await tx.db.$queryRaw`SELECT "runId" FROM "SyntheticEngineWindow" WHERE "runId"=${run.id}`;
   if(!rows.length)throw Error('SYNTHETIC_WINDOW_INTEGRITY_REFUSAL');
  }
 }
 const {f,job,preview,engine}=await prepared(IntegrityEngine);
 try{
  await requireAtomicBinding(f);
  const applied=await engine.apply(job.jobId,preview.previewDigest,password,pilotOwner);
  await f.db.query('DELETE FROM "SyntheticEngineWindow" WHERE "runId"=$1',[applied.runId]);
  let before=await durableState(f);
  await assert.rejects(engine.apply(job.jobId,preview.previewDigest,password,pilotOwner),/SYNTHETIC_WINDOW_INTEGRITY_REFUSAL/);
  await assert.rejects(engine.rollback(job.jobId,applied.runId,password,pilotOwner),/SYNTHETIC_WINDOW_INTEGRITY_REFUSAL/);
  assert.deepEqual(await durableState(f),before);
  await f.db.query('UPDATE "HistoryMigrationPilotRun" SET status=\'ROLLED_BACK\' WHERE id=$1',[applied.runId]);
  before=await durableState(f);
  await assert.rejects(engine.rollback(job.jobId,applied.runId,password,pilotOwner),/SYNTHETIC_WINDOW_INTEGRITY_REFUSAL/);
  assert.deepEqual(await durableState(f),before);
 }finally{await f.close();}
});

test('a failed beforeApply or failed commit rolls back the run, window and every imported row together',isolated,async()=>{
 class RefusingBinding extends BindingEngine{
  async beforeApply(tx,plan,runId){await super.beforeApply(tx,plan,runId);throw Error('SYNTHETIC_BACKUP_REFUSAL');}
 }
 for(const Engine of [RefusingBinding,BindingEngine]){
  const {f,job,preview,engine}=await prepared(Engine);
  try{
   await requireAtomicBinding(f);const before=await durableState(f);
   if(Engine===BindingEngine)f.failCommit(true);
   await assert.rejects(engine.apply(job.jobId,preview.previewDigest,password,pilotOwner),
    Engine===BindingEngine?/Synthetic transaction failure/:/SYNTHETIC_BACKUP_REFUSAL/);
   f.failCommit(false);
   assert.deepEqual(await durableState(f),before);
   assert.equal((await f.db.query('SELECT * FROM "SyntheticEngineWindow"')).rows.length,0);
  }finally{await f.close();}
 }
});

test('operational V2 replay and selective rollback tolerate unrelated native messages, receipts and attention',isolated,async()=>{
 const {f,job,preview,engine}=await prepared();
 try{
  await f.db.exec('CREATE TABLE "SyntheticNativeReceipt" (id text PRIMARY KEY,"messageId" text REFERENCES "Message"(id),status text);');
  const applied=await engine.apply(job.jobId,preview.previewDigest,password,pilotOwner);
  await f.db.exec(`INSERT INTO "Message" (id,"conversationId",direction,status,content,"externalId","receivedAt","createdAt",metadata)
   VALUES ('later-native','existing-conversation','INBOUND','RECEIVED','Synthetic current message','native-mid','2026-11-01','2026-11-01','{"provider":"META"}');
   INSERT INTO "SyntheticNativeReceipt" VALUES ('later-receipt','later-native','DELIVERED');
   UPDATE "Conversation" SET "unreadCount"=8,"unreadVersion"=10,"lastMessageAt"='2026-11-01',"updatedAt"='2026-11-01' WHERE id='existing-conversation';`);
  const before=await durableState(f),receipts=(await f.db.query('SELECT * FROM "SyntheticNativeReceipt"')).rows;
  const replay=await engine.apply(job.jobId,preview.previewDigest,password,pilotOwner);
  assert.equal(replay.added,0);assert.equal(replay.replayed,true);assert.equal(replay.productionImport,true);
  assert.deepEqual(await durableState(f),before,'zero-add replay cannot change business data or custody');
  await engine.rollback(job.jobId,applied.runId,password,pilotOwner);
  const after=await durableState(f);
  assert.deepEqual(after.Message.find(m=>m.id==='later-native'),before.Message.find(m=>m.id==='later-native'));
  assert.deepEqual((await f.db.query('SELECT * FROM "SyntheticNativeReceipt"')).rows,receipts);
  for(const table of ['Client','Conversation','HistoryMigrationOrigin','HistoryMigrationIdentity','Order','Payment'])assert.deepEqual(after[table],before[table]);
  assert.equal(after.Message.length,before.Message.length);
  assert.equal(after.Message.filter(m=>m.metadata?.deletion?.deletedAt).length,1);
  await assert.rejects(engine.apply(job.jobId,preview.previewDigest,password,pilotOwner),/отозван/);
 }finally{await f.close();}
});

test('operational mode never exempts altered imported messages from V2 custody verification',isolated,async()=>{
 const {f,job,preview,engine}=await prepared();
 try{
  const applied=await engine.apply(job.jobId,preview.previewDigest,password,pilotOwner);
  await f.db.query(`UPDATE "Message" SET content='Synthetic edited history' WHERE metadata #>> '{historyMigration,runId}'=$1`,[applied.runId]);
  const before=await durableState(f);
  await assert.rejects(engine.apply(job.jobId,preview.previewDigest,password,pilotOwner),/замечания|изменилось/);
  await assert.rejects(engine.rollback(job.jobId,applied.runId,password,pilotOwner),/изменилось|зависимост/);
  assert.deepEqual(await durableState(f),before);
 }finally{await f.close();}
});

test('public WASM pilot preserves the original schema, result, audit and mandatory native-database rejection',isolated,async()=>{
 const f=await historyFixture();
 try{
  const job=await f.stage([pilotMessage('wasm-default')]);
  await f.planning.bind(job.jobId,{mode:'EXISTING',clientId:'existing',dialogueId:'thread-a'},password,pilotOwner);
  const preview=await f.planning.dryRun(job.jobId,pilotOwner),engine=new IsolatedHistoryMigrationPilot(f.repository,f.backups);
  const before=await durableState(f);f.realPostgres(true);
  await assert.rejects(engine.apply(job.jobId,preview.previewDigest,password,pilotOwner),/WASM/);
  assert.deepEqual(await durableState(f),before);f.realPostgres(false);
  const applied=await engine.apply(job.jobId,preview.previewDigest,password,pilotOwner);
  assert.equal(applied.productionImport,false);
  assert.equal((await f.db.query('SELECT environment FROM "HistoryMigrationPilotRun"')).rows[0].environment,'ISOLATED_WASM');
  assert.equal((await f.db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='HistoryMigrationPilotRun' AND column_name='nativeConversationId'`)).rows.length,0);
  assert.equal((await engine.apply(job.jobId,preview.previewDigest,password,pilotOwner)).productionImport,false);
  assert.equal((await engine.rollback(job.jobId,applied.runId,password,pilotOwner)).productionImport,false);
  assert.deepEqual((await f.db.query(`SELECT action FROM "AuditLog" WHERE action LIKE 'HISTORY_ISOLATED_PILOT_%' ORDER BY action`)).rows.map(r=>r.action),
   ['HISTORY_ISOLATED_PILOT_APPLIED','HISTORY_ISOLATED_PILOT_ROLLED_BACK']);
 }finally{await f.close();}
});
