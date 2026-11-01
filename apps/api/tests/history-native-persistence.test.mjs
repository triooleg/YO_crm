import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {historyNativeFixture} from './history-native-fixture.mjs';
import {loadTargetModule} from './overview-target-loader.mjs';

// Opt in with YO_HISTORY_NATIVE=1. Uses the existing private Windows PG16
// fixture and all repository migrations; never accepts an external database.

test('owned native operational persistence retains custody and rejects invalid/partial bindings',{skip:process.env.YO_HISTORY_NATIVE!=='1',timeout:180000},async t=>{
 const previousKey=process.env.SETTINGS_ENCRYPTION_KEY;process.env.SETTINGS_ENCRYPTION_KEY='synthetic-owned-native-storage-test-not-production';
 let f;
 try{
  f=await historyNativeFixture();
  await f.db.$executeRawUnsafe(`INSERT INTO "User" (id,email,"passwordHash",role,"displayName","updatedAt") VALUES ('foundation-owner','foundation@example.invalid','synthetic','OWNER','Synthetic owner',CURRENT_TIMESTAMP)`);
  await f.db.$executeRawUnsafe(`INSERT INTO "Client" (id,"firstName","displayName",source,"updatedAt") VALUES ('foundation-client','Synthetic','Synthetic','MANUAL',CURRENT_TIMESTAMP)`);
  for(const id of ['foundation-conversation','other-conversation'])await f.db.$executeRawUnsafe(`INSERT INTO "Conversation" (id,"clientId",channel,"updatedAt","archivedAt") VALUES ($1,'foundation-client',$2::"ContactChannel",CURRENT_TIMESTAMP,NULL)`,id,id==='foundation-conversation'?'INSTAGRAM':'FACEBOOK');
  await f.db.$executeRawUnsafe(`INSERT INTO "HistoryMigrationJob" (id,"createdById",source,account,channel,"updatedAt") VALUES ('foundation-job','foundation-owner','KEYCRM','synthetic','INSTAGRAM',CURRENT_TIMESTAMP)`);
  await f.db.$executeRawUnsafe(`INSERT INTO "HistoryMigrationPilotRun" (id,"jobId","actorId","sourceDigest","previewDigest",result,"snapshotEncrypted") VALUES ('legacy','foundation-job','foundation-owner',$1,$2,'{}','legacy-sealed')`,'f'.repeat(64),'b'.repeat(64));
  const legacyBefore=(await f.db.$queryRawUnsafe(`SELECT * FROM "HistoryMigrationPilotRun" WHERE id='legacy'`))[0];
  await f.db.$queryRawUnsafe('SELECT "nativeConversationId" FROM "HistoryMigrationPilotRun" LIMIT 0');
  assert.equal(legacyBefore.environment,'ISOLATED_WASM');
  assert.equal(legacyBefore.nativeConversationId,null);assert.equal(legacyBefore.nativeAccountId,null);assert.equal(legacyBefore.nativeCustomerId,null);
  let sequence=0;
  const run=async(db,id,environment='OPERATIONAL_NATIVE',conversation='foundation-conversation',account=environment==='OPERATIONAL_NATIVE'?'receiver':null,customer=environment==='OPERATIONAL_NATIVE'?'customer':null)=>db.$executeRawUnsafe(`INSERT INTO "HistoryMigrationPilotRun" (id,"jobId","actorId",environment,"nativeConversationId","nativeAccountId","nativeCustomerId","sourceDigest","previewDigest",result,"snapshotEncrypted") VALUES ($1,'foundation-job','foundation-owner',$2,$3,$4,$5,$6,$7,'{}','synthetic-sealed-snapshot')`,id,environment,conversation,account,customer,(++sequence).toString(16).padStart(64,'0'),'b'.repeat(64));
  const window=async(db,id)=>db.$executeRawUnsafe(`INSERT INTO "HistoryMigrationNativeWindow" ("runId","payloadEncrypted") VALUES ($1,'synthetic-sealed-window')`,id);
  const rows=table=>f.db.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY 1`);
  await t.test('legacy WASM remains valid without a native binding',async()=>{await run(f.db,'wasm','ISOLATED_WASM',null);});
  await t.test('operational run and window must commit together',async()=>{
   await assert.rejects(run(f.db,'missing-window'));
   await assert.rejects(run(f.db,'missing-conversation','OPERATIONAL_NATIVE',null));
   await assert.rejects(run(f.db,'missing-account','OPERATIONAL_NATIVE','foundation-conversation',null));
   await assert.rejects(run(f.db,'invalid-environment','OTHER',null));
   assert.equal((await rows('HistoryMigrationPilotRun')).length,2);
   await f.db.$transaction(async tx=>{await run(tx,'operational');await window(tx,'operational');});
   await assert.rejects(window(f.db,'operational'));
  });
  await t.test('window cannot be orphaned, belong to WASM or disappear independently',async()=>{
   await assert.rejects(window(f.db,'absent-run'));
   await assert.rejects(window(f.db,'wasm'));
   await assert.rejects(f.db.$executeRawUnsafe(`DELETE FROM "HistoryMigrationNativeWindow" WHERE "runId"='operational'`));
   assert.equal((await rows('HistoryMigrationNativeWindow')).length,1);
  });
  const idHash=id=>createHash('sha256').update(id).digest('hex');
  const review=async(id,sha='c'.repeat(64),provider='META',account='receiver',message='native-message',conversation='foundation-conversation',envelope=null,scope=JSON.stringify([provider,account,'customer',message]))=>f.db.$executeRawUnsafe(`INSERT INTO "HistoryMigrationNativeReview" (id,"runId","conversationId","scopeKey","payloadHash",reason,"payloadEncrypted","webhookEnvelopeId") VALUES ($1,'operational',$2,$3,$4,'OLDER_THAN_CUTOFF','synthetic-sealed-event',$5)`,idHash(id),conversation,scope,sha,envelope);
  await t.test('exact retries are unique; changed payloads and native scopes remain distinct',async()=>{
   await review('review');await assert.rejects(review('duplicate'));
   await review('variant','d'.repeat(64));await review('other-account','c'.repeat(64),'META','receiver-2');
   await review('other-provider','c'.repeat(64),'CHATWOOT');await review('other-message','c'.repeat(64),'META','receiver','message-2');
   assert.equal((await rows('HistoryMigrationNativeReview')).length,5);
   await assert.rejects(review('invalid-sha','not-a-sha'));await assert.rejects(review('wrong-conversation','e'.repeat(64),'META','receiver','native-message','other-conversation'));
   await assert.rejects(review('missing-envelope','e'.repeat(64),'META','receiver','native-message','foundation-conversation','absent'));
  });
  await t.test('large canonical scopes avoid PostgreSQL index limits and retain strict variant uniqueness',async()=>{
   const scope=JSON.stringify(['META',randomBytes(1800).toString('hex')]);assert.ok(scope.length>3000&&scope.length<=4096);
   await review('large','c'.repeat(64),'META','receiver','native-message','foundation-conversation',null,scope);
   await assert.rejects(review('large-duplicate','c'.repeat(64),'META','receiver','native-message','foundation-conversation',null,scope));
   await review('large-variant','d'.repeat(64),'META','receiver','native-message','foundation-conversation',null,scope);
   await assert.rejects(review('over-limit','c'.repeat(64),'META','receiver','native-message','foundation-conversation',null,'x'.repeat(4097)));
  });
  await t.test('optional envelope is a restrictive foreign key',async()=>{
   await f.db.$executeRawUnsafe(`INSERT INTO "WebhookEnvelope" (id,provider,payload,"payloadHash") VALUES ('envelope','HISTORY_NATIVE_REVIEW','{}',$1)`,'c'.repeat(64));
   await review('with-envelope','e'.repeat(64),'META','receiver','native-message','foundation-conversation','envelope');
   await assert.rejects(f.db.$executeRawUnsafe(`DELETE FROM "WebhookEnvelope" WHERE id='envelope'`));
  });
  const {PrismaHistoryNativeStorage}=loadTargetModule('history-migration/history-native-storage.ts');
  const {guardHistoryNativeEvent}=loadTargetModule('history-migration/history-native-reconciliation.ts');
  const {sealHistoryEvidence,openHistoryEvidence}=loadTargetModule('history-migration/history-evidence.ts');
  const windowContent={version:1,conversationId:'foundation-conversation',channel:'INSTAGRAM',accountId:'receiver',customerId:'customer',runId:'operational',status:'APPLIED',archiveStartAt:'2024-04-18T00:41:00.000Z',cutoffAt:'2026-08-10T11:10:00.000Z'};
  const sealedWindow=sealHistoryEvidence('NATIVE_WINDOW','operational:foundation-conversation',windowContent);
  await f.db.$executeRawUnsafe(`UPDATE "HistoryMigrationNativeWindow" SET "payloadEncrypted"=$1 WHERE "runId"='operational'`,sealedWindow);
  const event={conversationId:'foundation-conversation',channel:'INSTAGRAM',accountId:'receiver',customerId:'customer',provider:'META',nativeMessageId:'integration-mid',direction:'INBOUND',originalTimestamp:'2026-08-10T11:09:59.999Z',rawPayload:{text:'Synthetic retained complete body',attachment:{url:'https://example.invalid/synthetic'}},envelope:{synthetic:true,exactBytes:'retained'}};
  const guarded=ev=>f.db.$transaction(tx=>guardHistoryNativeEvent(new PrismaHistoryNativeStorage(tx),ev));
  await t.test('actual Prisma storage and guard persist one exact retry and a second payload variant',async()=>{
   const beforeReviews=await rows('HistoryMigrationNativeReview'),beforeEnvelopes=await rows('WebhookEnvelope');
   const first=await guarded(event);assert.equal(first.action,'REVIEW');assert.equal(first.created,true);
   const snapshotReviews=await rows('HistoryMigrationNativeReview'),snapshotEnvelopes=await rows('WebhookEnvelope');
   const retry=await guarded(event);assert.equal(retry.created,false);assert.equal(retry.reviewId,first.reviewId);
   assert.deepEqual(await rows('HistoryMigrationNativeReview'),snapshotReviews);assert.deepEqual(await rows('WebhookEnvelope'),snapshotEnvelopes);
   const second=await guarded({...event,rawPayload:{...event.rawPayload,text:'Conflicting native payload'}});assert.equal(second.created,true);assert.notEqual(second.reviewId,first.reviewId);
   const finalReviews=await rows('HistoryMigrationNativeReview');assert.equal(finalReviews.length-beforeReviews.length,2);assert.equal((await rows('WebhookEnvelope')).length-beforeEnvelopes.length,2);
   const evidence=openHistoryEvidence('NATIVE_REVIEW',first.reviewId,finalReviews.find(r=>r.id===first.reviewId).payloadEncrypted);assert.deepEqual(JSON.parse(evidence.eventJson),event);
   const beforeCount=finalReviews.length;assert.equal((await guarded({...event,originalTimestamp:windowContent.cutoffAt})).action,'PASS');assert.equal((await rows('HistoryMigrationNativeReview')).length,beforeCount);
   // A valid encrypted body cannot authenticate corrupted SQL routing/index keys.
   for(const [column,value]of [['scopeKey','wrong-scope'],['payloadHash','f'.repeat(64)],['reason','MISSING_WINDOW']]){
    await assert.rejects(f.db.$transaction(async tx=>{
     await tx.$executeRawUnsafe(`UPDATE "HistoryMigrationNativeReview" SET "${column}"=$1 WHERE id=$2`,value,first.reviewId);
     return guardHistoryNativeEvent(new PrismaHistoryNativeStorage(tx),event);
    }),/Конфликт доказательств/);
    assert.deepEqual(await rows('HistoryMigrationNativeReview'),finalReviews);
   }
   await f.db.$executeRawUnsafe(`UPDATE "HistoryMigrationNativeReview" SET status='RESOLVED' WHERE id=$1`,first.reviewId);
   assert.equal((await guarded(event)).created,false);
  });
  await t.test('missing/corrupt window never means ordinary traffic and cannot acknowledge partial evidence',async()=>{
   const beforeReviews=await rows('HistoryMigrationNativeReview'),beforeEnvelopes=await rows('WebhookEnvelope');let reason,ack=false;
   await assert.rejects((async()=>{await f.db.$transaction(async tx=>{
    await tx.$executeRawUnsafe(`DELETE FROM "HistoryMigrationNativeWindow" WHERE "runId"='operational'`);
    const result=await guardHistoryNativeEvent(new PrismaHistoryNativeStorage(tx),{...event,nativeMessageId:'missing-window-mid'});reason=result.reason;assert.equal(result.action,'REVIEW');
   });ack=true;})());
   assert.equal(reason,'MISSING_WINDOW');assert.equal(ack,false);assert.deepEqual(await rows('HistoryMigrationNativeReview'),beforeReviews);assert.deepEqual(await rows('WebhookEnvelope'),beforeEnvelopes);
   await assert.rejects(f.db.$transaction(async tx=>{
    await tx.$executeRawUnsafe(`UPDATE "HistoryMigrationNativeWindow" SET "payloadEncrypted"='corrupt' WHERE "runId"='operational'`);
    return guardHistoryNativeEvent(new PrismaHistoryNativeStorage(tx),{...event,nativeMessageId:'corrupt-window-mid'});
   }));
   assert.deepEqual(await rows('HistoryMigrationNativeReview'),beforeReviews);assert.equal((await rows('HistoryMigrationNativeWindow'))[0].payloadEncrypted,sealedWindow);
  });
  await t.test('actual review insert failure rolls back its envelope and never acknowledges delivery',async()=>{
   await f.db.$executeRawUnsafe(`CREATE FUNCTION foundation_review_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic review insert failure'; END; $$`);
   await f.db.$executeRawUnsafe(`CREATE TRIGGER foundation_review_fault BEFORE INSERT ON "HistoryMigrationNativeReview" FOR EACH ROW EXECUTE FUNCTION foundation_review_fault()`);
   const beforeReviews=await rows('HistoryMigrationNativeReview'),beforeEnvelopes=await rows('WebhookEnvelope');let acknowledged=false;
   try{await assert.rejects((async()=>{await guarded({...event,nativeMessageId:'failure-mid'});acknowledged=true;})());}
   finally{await f.db.$executeRawUnsafe(`DROP TRIGGER foundation_review_fault ON "HistoryMigrationNativeReview"`);await f.db.$executeRawUnsafe(`DROP FUNCTION foundation_review_fault()`);}
   assert.equal(acknowledged,false);assert.deepEqual(await rows('HistoryMigrationNativeReview'),beforeReviews);assert.deepEqual(await rows('WebhookEnvelope'),beforeEnvelopes);
  });
  await t.test('rollback status retains independent binding, window and complete review evidence',async()=>{
   const beforeWindows=await rows('HistoryMigrationNativeWindow'),beforeReviews=await rows('HistoryMigrationNativeReview');
   await f.db.$executeRawUnsafe(`UPDATE "HistoryMigrationPilotRun" SET status='ROLLED_BACK',"rolledBackAt"=CURRENT_TIMESTAMP WHERE id='operational'`);
   assert.deepEqual(await rows('HistoryMigrationNativeWindow'),beforeWindows);assert.deepEqual(await rows('HistoryMigrationNativeReview'),beforeReviews);
   const [record]=await f.db.$queryRawUnsafe(`SELECT * FROM "HistoryMigrationPilotRun" WHERE id='operational'`);assert.equal(record.nativeConversationId,'foundation-conversation');
   assert.equal(record.nativeAccountId,'receiver');assert.equal(record.nativeCustomerId,'customer');
   await assert.rejects(f.db.$executeRawUnsafe(`UPDATE "HistoryMigrationPilotRun" SET "nativeAccountId"='other' WHERE id='operational'`));
   await assert.rejects(f.db.$executeRawUnsafe(`DELETE FROM "HistoryMigrationPilotRun" WHERE id='operational'`));
   await assert.rejects(f.db.$executeRawUnsafe(`DELETE FROM "Conversation" WHERE id='foundation-conversation'`));
   await assert.rejects(f.db.$executeRawUnsafe(`UPDATE "HistoryMigrationNativeReview" SET status='DISCARDED' WHERE id=$1`,idHash('review')));
   await f.db.$executeRawUnsafe(`UPDATE "HistoryMigrationNativeReview" SET status='RESOLVED' WHERE id=$1`,idHash('review'));
  });
  assert.deepEqual((await f.db.$queryRawUnsafe(`SELECT * FROM "HistoryMigrationPilotRun" WHERE id='legacy'`))[0],legacyBefore,'Existing WASM history remains unchanged');
 }finally{try{if(f)await f.close();}finally{if(previousKey===undefined)delete process.env.SETTINGS_ENCRYPTION_KEY;else process.env.SETTINGS_ENCRYPTION_KEY=previousKey;}}
});
