import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {loadTargetModule} from './overview-target-loader.mjs';
const {saveOperationalPreparation,loadOperationalPreparation}=loadTargetModule('history-migration/history-operational-preparation.ts');
process.env.SETTINGS_ENCRYPTION_KEY='synthetic-history-preparation-test-only-key';
function fixture(){let stored=null;const audit=[];const id=randomUUID(),actor={id:'owner',role:'OWNER',active:true,archivedAt:null,passwordHash:'current-hash'};
 const tx={job:{id,createdById:actor.id,status:'STAGING'},actor,db:{appSetting:{upsert:async({create,update})=>{stored=stored?{...stored,...update}:create;return stored},findUnique:async()=>stored}},audit:async(...args)=>audit.push(args)};
 const context={jobId:id,actorId:'owner',clientId:'client',sourceDigest:'a'.repeat(64),previewDigest:'b'.repeat(64),candidateSnapshot:'c'.repeat(64),targetIdentity:{cluster:'123',databaseName:'synthetic',databaseOid:1},migrationSetDigest:'d'.repeat(64)};
 return {tx,context,audit,get stored(){return stored},set stored(value){stored=value}}}
test('operational preparation retains sealed exact grouping and owner reauthentication for host-only issuance',async()=>{
 const f=fixture(),now=new Date('2026-11-01T10:00:00Z'),approval={policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[]};
 const saved=await saveOperationalPreparation(f.tx,approval,f.context,'current-hash',now);
 assert.equal('approval' in saved,false);assert.equal('passwordHash' in saved,false);
 assert.ok(f.stored.value.payloadEncrypted);assert.equal(JSON.stringify(f.audit).includes('current-hash'),false);
 const loaded=await loadOperationalPreparation(f.tx,new Date('2026-11-01T10:01:00Z'));
 assert.deepEqual(loaded.approval,approval);assert.deepEqual(loaded.context,f.context);assert.match(loaded.digest,/^[a-f0-9]{64}$/);
 f.tx.actor.passwordHash='rotated';await assert.rejects(loadOperationalPreparation(f.tx,now));
});
test('closed jobs, wrong actor/hash, expired/future or rebound preparation fail without authority',async()=>{
 const now=new Date('2026-11-01T10:00:00Z');
 for(const mutate of [f=>f.tx.job.status='CLOSED',f=>f.tx.actor.active=false,f=>f.tx.actor.role='ADMIN',f=>f.context.actorId='other',f=>f.context.jobId=randomUUID()]){
  const f=fixture();mutate(f);await assert.rejects(saveOperationalPreparation(f.tx,{policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[]},f.context,'current-hash',now));assert.equal(f.stored,null);
 }
 const f=fixture();await assert.rejects(saveOperationalPreparation(f.tx,{policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[]},f.context,'stale-hash',now));
 await saveOperationalPreparation(f.tx,{policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[]},f.context,'current-hash',now);
 for(const value of ['2026-11-01T09:59:59.999Z','2026-11-01T12:00:00Z'])await assert.rejects(loadOperationalPreparation(f.tx,new Date(value)));
 f.stored.value.payloadEncrypted=f.stored.value.payloadEncrypted.slice(0,-2)+'aa';await assert.rejects(loadOperationalPreparation(f.tx,now));
});
