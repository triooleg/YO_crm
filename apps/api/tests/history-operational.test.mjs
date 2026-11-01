import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {loadTargetModule} from './overview-target-loader.mjs';

const owner={id:'owner',role:'OWNER',active:true,archivedAt:null};
const approval={policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[]};
const jobId='01000000-0000-4000-8000-000000000001';
const grantId='02000000-0000-4000-8000-000000000001';

test('operational service refuses every entry before database or backup access when disabled',async()=>{
 const previous=process.env.HISTORY_MIGRATION_OPERATIONAL_ENABLED;
 delete process.env.HISTORY_MIGRATION_OPERATIONAL_ENABLED;
 try{
  const {HistoryOperationalService}=loadTargetModule('history-migration/history-operational.service.ts');
  const forbidden=()=>{throw Error('DISABLED_OPERATION_TOUCHED_DEPENDENCY');};
  const service=new HistoryOperationalService({withJob:forbidden},{reauthenticate:forbidden,verifyOperationalGrant:forbidden});
  await assert.rejects(service.previewArchive(jobId,approval,owner),/не включён/);
  await assert.rejects(service.prepareContext(jobId,approval,owner),/не включён/);
  await assert.rejects(service.prepare(jobId,approval,'synthetic-password',owner),/не включён/);
  await assert.rejects(service.preparedContext(jobId),/не включён/);
  await assert.rejects(service.applyArchive(jobId,'a'.repeat(64),approval,'synthetic-password',owner,grantId),/не включён/);
  await assert.rejects(service.rollback(jobId,grantId,'synthetic-password',owner),/не включён/);
 }finally{if(previous===undefined)delete process.env.HISTORY_MIGRATION_OPERATIONAL_ENABLED;else process.env.HISTORY_MIGRATION_OPERATIONAL_ENABLED=previous;}
});

test('runtime candidate identity requires an exact 64-hex CRM_COMMIT before database access',async()=>{
 const keys=['HISTORY_MIGRATION_OPERATIONAL_ENABLED','CRM_COMMIT'],prior=keys.map(k=>process.env[k]);process.env.HISTORY_MIGRATION_OPERATIONAL_ENABLED='true';
 try{
  const {HistoryOperationalService}=loadTargetModule('history-migration/history-operational.service.ts');
  const forbidden=()=>{throw Error('INVALID_CANDIDATE_TOUCHED_DEPENDENCY');},service=new HistoryOperationalService({withJob:forbidden},{});
  for(const value of ['', 'a'.repeat(40), 'G'.repeat(64)]){process.env.CRM_COMMIT=value;await assert.rejects(service.prepareContext(jobId,approval,owner),/сборка CRM/);}
 }finally{keys.forEach((k,i)=>prior[i]===undefined?delete process.env[k]:process.env[k]=prior[i]);}
});

const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');

test('owned native operational lifecycle uses exact locked context, atomic grant/window and selective custody',
 {skip:process.env.YO_HISTORY_NATIVE!=='1',timeout:240000},async t=>{
 const keys=['HISTORY_MIGRATION_OPERATIONAL_ENABLED','HISTORY_MIGRATION_ENABLED','HISTORY_MIGRATION_PLANNING_ENABLED','SETTINGS_ENCRYPTION_KEY','CRM_COMMIT'];
 const prior=keys.map(k=>process.env[k]),oldFetch=globalThis.fetch;let f;
 for(const key of keys.slice(0,3))process.env[key]='true';
 process.env.SETTINGS_ENCRYPTION_KEY='synthetic-operational-coordinator-not-production';process.env.CRM_COMMIT='a'.repeat(64);
 globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN_IN_OWNED_OPERATIONAL_TEST');};
 try{
  const {historyNativeFixture}=await import('./history-native-fixture.mjs');f=await historyNativeFixture();
  const {historyFullSchemaSeed,fullSchemaSnapshot}=await import('./history-full-schema-fixture.mjs');
  for(const sql of historyFullSchemaSeed.split(';').map(s=>s.trim()).filter(Boolean))await f.db.$executeRawUnsafe(sql);
  await f.db.$executeRaw`UPDATE "Client" SET instagram='222',"instagramUsername"='synthetic_handle' WHERE id='existing'`;
  await f.db.$executeRaw`UPDATE "Conversation" SET "externalId"='111:222' WHERE id='protected-ig'`;
  await f.db.$executeRaw`INSERT INTO "AppSetting" (id,section,key,value,"updatedAt") VALUES ('synthetic-receiver','integration.meta','instagramAccountId','"111"'::jsonb,CURRENT_TIMESTAMP)`;
  await f.db.$executeRawUnsafe(`CREATE TABLE "_prisma_migrations" (id text PRIMARY KEY DEFAULT gen_random_uuid()::text,migration_name text NOT NULL,checksum text NOT NULL,finished_at timestamptz,rolled_back_at timestamptz,started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  const folder=new URL('../../../packages/database/prisma/migrations/',import.meta.url);
  const migrations=(await readdir(folder,{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name).sort();
  const migrationPairs=[];
  for(const name of migrations){const checksum=createHash('sha256').update(await readFile(new URL(name+'/migration.sql',folder))).digest('hex');migrationPairs.push([name,checksum]);await f.db.$executeRaw`INSERT INTO "_prisma_migrations" (migration_name,checksum,finished_at,rolled_back_at) VALUES (${name},${checksum},CURRENT_TIMESTAMP,NULL)`;}
  async function nativeMessage(id,content='Synthetic live native'){
   const at='2026-11-01T10:00:00.000Z',metadata={messageType:'text'},payload={provider:'META',channel:'INSTAGRAM',receiverId:'111',externalSenderId:'222',externalMessageId:id,content,receivedAt:at,originalTimestamp:at,metadata};
   await f.db.$executeRaw`INSERT INTO "WebhookEnvelope" (id,provider,payload,"payloadHash","receivedAt") VALUES (${id+'-envelope'},'META',${JSON.stringify(payload)}::jsonb,${hash(payload)},${at}::timestamp)`;
   await f.db.$executeRaw`INSERT INTO "Message" (id,"conversationId",direction,status,content,"normalizedText","externalId",metadata,"rawPayload","webhookEnvelopeId","receivedAt","createdAt")
    VALUES (${id},'protected-ig','INBOUND','RECEIVED',${content},${content},${id},${JSON.stringify({source:'META',provider:'META',receiverId:'111',messageType:'text'})}::jsonb,${JSON.stringify(payload)}::jsonb,${id+'-envelope'},${at}::timestamp,${at}::timestamp)`;
  }
  await nativeMessage('synthetic-native-one');
  const trace=[];
  const traced={$transaction:(action,options)=>f.db.$transaction(db=>action(new Proxy(db,{get(target,key){
   if(key==='$queryRaw'||key==='$executeRaw')return(...args)=>{const parts=args[0],sql=typeof parts.text==='string'?parts.text:Array.from(parts).join('?'),values=typeof parts.text==='string'?parts.values:args.slice(1);trace.push({sql,locks:values.filter(v=>typeof v==='string'&&/^(history-runtime-deployment|client-merge|history-conversation)/.test(v))});return target[key](...args);};
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }})),options)};
  const {HistoryMigrationRepository}=loadTargetModule('history-migration/history-migration.repository.ts');
  const {HistoryMigrationService}=loadTargetModule('history-migration/history-migration.service.ts');
  const {HistoryMigrationPlanningService}=loadTargetModule('history-migration/history-planning.service.ts');
  const {HistoryOperationalService}=loadTargetModule('history-migration/history-operational.service.ts');
  const {validateOperationalBackupGrant}=loadTargetModule('backups/backup-operational-grant.ts');
  const grants=new Map(),gateCalls=[];let rotateDuringReauth=false;
  // Synthetic boundary ONLY: no host grant files, physical artifacts or operational authorization proof.
  const backups={reauthenticate:async(actor,password)=>{
   assert.equal(password,'synthetic-password');const [user]=await f.db.$queryRaw`SELECT * FROM "User" WHERE id=${actor.id}`;assert.ok(user?.active&&!user.archivedAt&&user.role==='OWNER');
   if(rotateDuringReauth)await f.db.$executeRaw`UPDATE "User" SET "passwordHash"='synthetic-rotated-password' WHERE id=${actor.id}`;
   return user;
  },verifyOperationalGrant:async(id,expected,db)=>{
   gateCalls.push(id);const saved=grants.get(id);assert.ok(saved,'SYNTHETIC_GRANT_NOT_FOUND');
   const [used]=await db.$queryRaw`SELECT id FROM "AuditLog" WHERE action='HISTORY_OPERATIONAL_BACKUP_GRANT_USED' AND "after"->>'grantId'=${id}`;
   assert.ok(!used,'SYNTHETIC_GRANT_ALREADY_USED');
   return {grant:validateOperationalBackupGrant(saved,id,expected),digest:'b'.repeat(64)};
  }};
  const repository=new HistoryMigrationRepository(traced),intake=new HistoryMigrationService(repository,backups),planning=new HistoryMigrationPlanningService(repository,backups),service=new HistoryOperationalService(repository,backups);
  const job=await intake.create({source:'KEYCRM',account:'synthetic-business',channel:'INSTAGRAM'},'synthetic-password',owner),pair=await intake.pair(job.jobId,'synthetic-password',owner);
  const archive=[0,1].map(ordinal=>({source:'KEYCRM',account:'synthetic-business',channel:'INSTAGRAM',dialogueId:'synthetic-source',sourceMessageId:'archive-'+ordinal,sender:'contact:synthetic-source',direction:'INBOUND',timestamp:'2024-01-01',sourceTimeText:'2024-01-01 12:30',sourceTimezone:'Europe/Kyiv',text:'Synthetic archive '+ordinal,ordinal,attachments:[]}));
  const payloadJson=JSON.stringify({version:1,source:'KEYCRM',messages:archive,completeness:{status:'PARTIAL'}});
  await intake.stage(job.jobId,`Bearer ${pair.token}`,{batchId:randomUUID(),payloadJson,checksum:hash(payloadJson)});
  await planning.bind(job.jobId,{mode:'EXISTING',clientId:'existing',dialogueId:'synthetic-source'},'synthetic-password',owner);
  const snapshot=()=>fullSchemaSnapshot({query:async sql=>({rows:await f.db.$queryRawUnsafe(sql)})});
  const base=await snapshot();let context,applied;
  function grantFor(prepared,id=randomUUID()){
   const {preview,...expected}=prepared,now=Date.now();
   grants.set(id,{...expected,version:1,purpose:'OPERATIONAL_NATIVE_BACKUP_GRANT_V1',grantId:id,backupId:'synthetic-backup',captureStartedAt:new Date(now-60000).toISOString(),manifestSha256:'c'.repeat(64),sha256sumsSha256:'d'.repeat(64),archiveSha256:'e'.repeat(64),archiveBytes:'1000',drillJobId:'synthetic-drill',drillReportSha256:'f'.repeat(64),drillFinishedAt:new Date(now-30000).toISOString(),issuedAt:new Date(now-10000).toISOString(),expiresAt:new Date(now+300000).toISOString()});return id;
  }
  await t.test('prepareContext is readonly, sanitized and takes all scope locks before the job row',async()=>{
   trace.length=0;context=await service.prepareContext(job.jobId,approval,owner);
   assert.equal(context.clientId,'existing');assert.equal(context.actorId,'owner');assert.equal(context.jobId,job.jobId);assert.equal(context.candidateSnapshot,'a'.repeat(64));assert.equal(context.migrationSetDigest,hash(migrationPairs));
   assert.equal(context.preview.newCandidates,2);assert.equal(context.preview.review,0);assert.equal(context.preview.conflicts,0);assert.ok(!JSON.stringify(context).includes('Synthetic archive'));
   const [identity]=await f.db.$queryRaw`SELECT system_identifier::text AS cluster,current_database() AS "databaseName",(SELECT oid::bigint FROM pg_database WHERE datname=current_database())::text AS "databaseOid" FROM pg_control_system()`;
   assert.deepEqual(context.targetIdentity,{...identity,databaseOid:Number(identity.databaseOid)});
   const runtime=trace.findIndex(r=>r.locks.includes('history-runtime-deployment'));
   const global=trace.findIndex(r=>r.locks.includes('client-merge-global')),client=trace.findIndex(r=>r.locks.includes('client-merge:existing')),conversation=trace.findIndex(r=>r.locks.includes('history-conversation:protected-ig')),jobLock=trace.findIndex(r=>r.sql.includes('FROM "HistoryMigrationJob"')&&r.sql.includes('FOR UPDATE'));
   assert.ok(runtime>=0&&runtime<global&&global<client&&client<conversation&&conversation<jobLock,'runtime shared lock must precede every scope/job lock');
   assert.match(trace[runtime].sql,/pg_advisory_xact_lock_shared\(hashtextextended/);
   assert.equal(trace.findIndex(r=>r.sql.includes('pg_advisory')),runtime);
   const clientRow=trace.findIndex(r=>r.sql.includes('FROM \"Client\"')&&r.sql.includes('FOR SHARE NOWAIT')),conversationRow=trace.findIndex(r=>r.sql.includes('FROM \"Conversation\"')&&r.sql.includes('FOR SHARE NOWAIT'));
   assert.ok(conversation<clientRow&&clientRow<conversationRow&&conversationRow<jobLock,'scope row locks must precede job and plan in Client then Conversation order');
   assert.deepEqual(await snapshot(),base);
  });
  assert.ok(context,'Initial context qualification must pass before dependent native cases');
  await t.test('blocked counts remain previewable but cannot save preparation or obtain host context',async()=>{
   const blockedJob=await intake.create({source:'KEYCRM',account:'synthetic-business',channel:'INSTAGRAM'},'synthetic-password',owner);
   const pairing=await intake.pair(blockedJob.jobId,'synthetic-password',owner);
   const rows=archive.map((row,i)=>({...row,dialogueId:'blocked-'+i,text:'Same ambiguous archive message'}));
   const packet=JSON.stringify({version:1,source:'KEYCRM',messages:rows,completeness:{status:'PARTIAL'}});
   await intake.stage(blockedJob.jobId,`Bearer ${pairing.token}`,{batchId:randomUUID(),payloadJson:packet,checksum:hash(packet)});
   for(const row of rows)await planning.bind(blockedJob.jobId,{mode:'EXISTING',clientId:'existing',dialogueId:row.dialogueId},'synthetic-password',owner);
   const blocked=await service.prepareContext(blockedJob.jobId,approval,owner);
   assert.ok(blocked.preview.review>0);assert.ok(blocked.preview.blockers.length>0);
   const before=await snapshot();await assert.rejects(service.prepare(blockedJob.jobId,approval,'synthetic-password',owner),/HISTORY_OPERATIONAL_PLAN_NOT_READY/);
   assert.deepEqual(await snapshot(),before,'blocked preparation must not write AppSetting or audit');
   // Simulate a valid sealed preparation issued by the previous unguarded implementation.
   const {saveOperationalPreparation}=loadTargetModule('history-migration/history-operational-preparation.ts');
   const {preview,...bare}=blocked;
   await repository.withJob(blockedJob.jobId,tx=>saveOperationalPreparation(tx,approval,bare,'synthetic-password-hash'));
   const sealed=await snapshot();await assert.rejects(service.preparedContext(blockedJob.jobId),/HISTORY_OPERATIONAL_PLAN_NOT_READY/);
   assert.deepEqual(await snapshot(),sealed,'host refusal must not repair an old preparation');
  });
  await t.test('prepare saves the canonical sealed helper in its plan transaction without authorizing messages',async()=>{
   const before=await snapshot(),prepared=await service.prepare(job.jobId,approval,'synthetic-password',owner);
   assert.deepEqual(prepared,context);assert.deepEqual(await service.preparedContext(job.jobId),context);
   const after=await snapshot();for(const table of Object.keys(before))if(!['AppSetting','AuditLog'].includes(table))assert.deepEqual(after[table],before[table]);
   const rows=await f.db.$queryRaw`SELECT value FROM "AppSetting" WHERE section='history.operational.preparation' AND key=${job.jobId}`;
   assert.equal(rows.length,1);assert.equal(rows[0].value.version,1);assert.equal(typeof rows[0].value.payloadEncrypted,'string');
   assert.ok(!JSON.stringify(rows).includes('synthetic-password-hash'));assert.ok(!JSON.stringify(rows).includes('Synthetic archive'));
  });
  await t.test('resolved failed Prisma attempts coexist with successful active deployment without changing context or history',async()=>{
   const [migration]=await f.db.$queryRaw`SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 1`;
   await f.db.$executeRaw`INSERT INTO "_prisma_migrations" (id,migration_name,checksum,finished_at,rolled_back_at,started_at)
    VALUES ('synthetic-resolved-failure',${migration.migration_name},${migration.checksum},NULL,CURRENT_TIMESTAMP-INTERVAL '1 hour',CURRENT_TIMESTAMP-INTERVAL '2 hours')`;
   try{
    const before=await snapshot(),calls=gateCalls.length;
    assert.deepEqual(await service.prepareContext(job.jobId,approval,owner),context);
    assert.deepEqual(await service.preparedContext(job.jobId),context);
    assert.equal(gateCalls.length,calls);assert.deepEqual(await snapshot(),before);
   }finally{await f.db.$executeRaw`DELETE FROM "_prisma_migrations" WHERE id='synthetic-resolved-failure'`;}
  });
  for(const kind of ['both timestamps','wrong checksum','unknown name','malformed name','malformed checksum'])await t.test('historical Prisma rollback '+kind+' cannot authorize context, preparation or apply',async()=>{
   const [migration]=await f.db.$queryRaw`SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 1`;
   const name=kind==='unknown name'?'synthetic_unknown_migration':kind==='malformed name'?'invalid migration name':migration.migration_name;
   const checksum=kind==='wrong checksum'?'9'.repeat(64):kind==='malformed checksum'?'invalid-checksum':migration.checksum;
   await f.db.$executeRaw`INSERT INTO "_prisma_migrations" (id,migration_name,checksum,finished_at,rolled_back_at)
    VALUES ('synthetic-invalid-rollback',${name},${checksum},${kind==='both timestamps'?new Date():null},CURRENT_TIMESTAMP)`;
   try{
    const before=await snapshot(),calls=gateCalls.length,id=grantFor(context),rejected=error=>error.getStatus?.()===409;
    await assert.rejects(service.prepareContext(job.jobId,approval,owner),rejected);
    await assert.rejects(service.preparedContext(job.jobId),rejected);
    await assert.rejects(service.prepare(job.jobId,approval,'synthetic-password',owner),rejected);
    await assert.rejects(service.applyArchive(job.jobId,context.previewDigest,approval,'synthetic-password',owner,id),rejected);
    assert.equal(gateCalls.length,calls);assert.deepEqual(await snapshot(),before);
   }finally{await f.db.$executeRaw`DELETE FROM "_prisma_migrations" WHERE id='synthetic-invalid-rollback'`;}
  });
  await t.test('historical Prisma attempts count toward the bounded complete inventory',async()=>{
   const [migration]=await f.db.$queryRaw`SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 1`;
   await f.db.$executeRaw`INSERT INTO "_prisma_migrations" (id,migration_name,checksum,finished_at,rolled_back_at)
    SELECT 'synthetic-many-rollback-'||n::text,${migration.migration_name},${migration.checksum},NULL,CURRENT_TIMESTAMP FROM generate_series(1,1001) n`;
   try{const before=await snapshot(),calls=gateCalls.length;await assert.rejects(service.prepareContext(job.jobId,approval,owner),error=>error.getStatus?.()===409);assert.equal(gateCalls.length,calls);assert.deepEqual(await snapshot(),before);}
   finally{await f.db.$executeRaw`DELETE FROM "_prisma_migrations" WHERE id LIKE 'synthetic-many-rollback-%'`;}
  });
  await t.test('unfinished, duplicate or malformed active Prisma attempts still block before preparation and grant/history writes',async()=>{
   const [migration]=await f.db.$queryRaw`SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 1`;
   const cases=[{name:'synthetic_new_migration',finished:null,checksum:migration.checksum},{name:migration.migration_name,finished:new Date(),checksum:migration.checksum},{name:'synthetic_new_migration',finished:new Date(),checksum:'invalid-checksum'}];
   for(const entry of cases){
    await f.db.$executeRaw`INSERT INTO "_prisma_migrations" (id,migration_name,checksum,finished_at,rolled_back_at)
     VALUES ('synthetic-active-attempt',${entry.name},${entry.checksum},${entry.finished},NULL)`;
    try{
     const before=await snapshot(),calls=gateCalls.length,id=grantFor(context);
     const rejected=error=>error.getStatus?.()===409;
     await assert.rejects(service.prepareContext(job.jobId,approval,owner),rejected);
     await assert.rejects(service.preparedContext(job.jobId),rejected);
     await assert.rejects(service.prepare(job.jobId,approval,'synthetic-password',owner),rejected);
     await assert.rejects(service.applyArchive(job.jobId,context.previewDigest,approval,'synthetic-password',owner,id),rejected);
     assert.equal(gateCalls.length,calls);assert.deepEqual(await snapshot(),before);
    }finally{await f.db.$executeRaw`DELETE FROM "_prisma_migrations" WHERE id='synthetic-active-attempt'`;}
   }
  });
  await t.test('preparedContext fails on candidate, migration, expiry or password drift and never repairs preparation',async()=>{
   const original=(await f.db.$queryRaw`SELECT value FROM "AppSetting" WHERE section='history.operational.preparation' AND key=${job.jobId}`)[0].value;
   process.env.CRM_COMMIT='b'.repeat(64);await assert.rejects(service.preparedContext(job.jobId),/Контекст подготовки/);process.env.CRM_COMMIT='a'.repeat(64);
   const [migration]=await f.db.$queryRaw`SELECT migration_name,checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 1`;
   await f.db.$executeRaw`UPDATE "_prisma_migrations" SET checksum=${'9'.repeat(64)} WHERE migration_name=${migration.migration_name}`;
   await assert.rejects(service.preparedContext(job.jobId),/Контекст подготовки/);
   await f.db.$executeRaw`UPDATE "_prisma_migrations" SET checksum=${migration.checksum} WHERE migration_name=${migration.migration_name}`;
   await f.db.$executeRaw`UPDATE "User" SET "passwordHash"='synthetic-rotated-password' WHERE id='owner'`;
   await assert.rejects(service.preparedContext(job.jobId),/подготовки импорта изменилось/);
   await f.db.$executeRaw`UPDATE "User" SET "passwordHash"='synthetic-password-hash' WHERE id='owner'`;
   const {openHistoryEvidence,sealHistoryEvidence}=loadTargetModule('history-migration/history-evidence.ts');
   const expired=openHistoryEvidence('OPERATIONAL_PREPARATION',job.jobId,original.payloadEncrypted);
   expired.preparedAt=new Date(Date.now()-10800000).toISOString();expired.expiresAt=new Date(Date.parse(expired.preparedAt)+7200000).toISOString();
   await f.db.appSetting.update({where:{section_key:{section:'history.operational.preparation',key:job.jobId}},data:{value:{version:1,payloadEncrypted:sealHistoryEvidence('OPERATIONAL_PREPARATION',job.jobId,expired)}}});
   const before=await snapshot();await assert.rejects(service.preparedContext(job.jobId),/истекла/);assert.deepEqual(await snapshot(),before);
   await f.db.appSetting.update({where:{section_key:{section:'history.operational.preparation',key:job.jobId}},data:{value:original}});
  });
  await t.test('password rotation between reauthentication and job lock cannot replace preparation',async()=>{
   const before=await snapshot();rotateDuringReauth=true;
   try{await assert.rejects(service.prepare(job.jobId,approval,'synthetic-password',owner),/подтверждение владельца/);}
   finally{rotateDuringReauth=false;await f.db.$executeRaw`UPDATE "User" SET "passwordHash"='synthetic-password-hash' WHERE id='owner'`;}
   assert.deepEqual(await snapshot(),before);
  });
  await t.test('wrong mapping, native participants, account, archived client and changed payload fail closed',async()=>{
   const cases=[
    [`UPDATE "HistoryMigrationTarget" SET mode='CREATE_PROPOSAL',"clientId"=NULL WHERE "jobId"='${job.jobId}'`,`UPDATE "HistoryMigrationTarget" SET mode='EXISTING',"clientId"='existing' WHERE "jobId"='${job.jobId}'`],
    [`UPDATE "Client" SET instagram='999' WHERE id='existing'`,`UPDATE "Client" SET instagram='222' WHERE id='existing'`],
    [`UPDATE "Client" SET "archivedAt"=CURRENT_TIMESTAMP WHERE id='existing'`,`UPDATE "Client" SET "archivedAt"=NULL WHERE id='existing'`],
    [`UPDATE "Conversation" SET "externalId"='999:222' WHERE id='protected-ig'`,`UPDATE "Conversation" SET "externalId"='111:222' WHERE id='protected-ig'`],
    [`UPDATE "Message" SET content='Synthetic tampered native' WHERE id='synthetic-native-one'`,`UPDATE "Message" SET content='Synthetic live native' WHERE id='synthetic-native-one'`],
   ];
   for(const [change,restore] of cases){await f.db.$executeRawUnsafe(change);try{const before=await snapshot();await assert.rejects(service.prepareContext(job.jobId,approval,owner));assert.deepEqual(await snapshot(),before);}finally{await f.db.$executeRawUnsafe(restore);}}
   const before=await snapshot();await assert.rejects(service.prepareContext(job.jobId,approval,{...owner,id:'other-owner'}),/владельца/);assert.deepEqual(await snapshot(),before);
  });
  await t.test('target change while waiting for the job lock cannot cross the pre-lock scope',async()=>{
   const entered=Promise.withResolvers(),release=Promise.withResolvers(),writer=await f.connect();
   const holding=writer.$transaction(async db=>{await db.$queryRaw`SELECT id FROM "HistoryMigrationJob" WHERE id=${job.jobId} FOR UPDATE`;entered.resolve();await release.promise;await db.$executeRaw`UPDATE "HistoryMigrationTarget" SET revision=revision+1 WHERE "jobId"=${job.jobId}`;},{timeout:15000});
   await entered.promise;trace.length=0;const request=service.prepareContext(job.jobId,approval,owner).then(value=>({value}),error=>({error}));
   try{
    const deadline=Date.now()+5000;while(!trace.some(r=>r.sql.includes('FROM "HistoryMigrationJob"')&&r.sql.includes('FOR UPDATE'))){assert.ok(Date.now()<deadline,'Service did not reach job lock');await new Promise(resolve=>setTimeout(resolve,20));}
    release.resolve();await holding;const result=await request;assert.match(result.error?.message??'',/изменились во время блокировки/);
   }finally{release.resolve();await holding;await f.db.$executeRaw`UPDATE "HistoryMigrationTarget" SET revision=revision-1 WHERE "jobId"=${job.jobId}`;}
  });
  await t.test('missing or wrong-context grant cannot create a run or consume a grant',async()=>{
   const before=await snapshot();await assert.rejects(service.applyArchive(job.jobId,context.previewDigest,approval,'synthetic-password',owner));
   const id=grantFor(context);grants.get(id).clientId='different-client';await assert.rejects(service.applyArchive(job.jobId,context.previewDigest,approval,'synthetic-password',owner,id));
   assert.deepEqual(await snapshot(),before);
  });
  await t.test('native arrival invalidates the prepared context before applying its grant',async()=>{
   const id=grantFor(context);await nativeMessage('synthetic-native-two');const before=await snapshot(),calls=gateCalls.length;
   await assert.rejects(service.applyArchive(job.jobId,context.previewDigest,approval,'synthetic-password',owner,id),/Предпросмотр/);
   assert.equal(gateCalls.length,calls);assert.deepEqual(await snapshot(),before);
   context=await service.prepareContext(job.jobId,approval,owner);
  });
  await t.test('a message write failure rolls back grant consumption, run, window, origins and all business rows',async()=>{
   const id=grantFor(context);
   await f.db.$executeRawUnsafe(`CREATE FUNCTION synthetic_operational_write_refusal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.metadata ? 'historyMigration' THEN RAISE EXCEPTION 'SYNTHETIC_HISTORY_WRITE_REFUSAL'; END IF; RETURN NEW; END $$`);
   await f.db.$executeRawUnsafe(`CREATE TRIGGER synthetic_operational_write_refusal BEFORE INSERT ON "Message" FOR EACH ROW EXECUTE FUNCTION synthetic_operational_write_refusal()`);
   try{
    const before=await snapshot();await assert.rejects(service.applyArchive(job.jobId,context.previewDigest,approval,'synthetic-password',owner,id),/SYNTHETIC_HISTORY_WRITE_REFUSAL/);
    assert.deepEqual(await snapshot(),before);assert.equal((await f.db.$queryRaw`SELECT id FROM "AuditLog" WHERE action='HISTORY_OPERATIONAL_BACKUP_GRANT_USED'`).length,0);
   }finally{await f.db.$executeRawUnsafe('DROP TRIGGER synthetic_operational_write_refusal ON "Message"');await f.db.$executeRawUnsafe('DROP FUNCTION synthetic_operational_write_refusal()');}
  });
  await t.test('concurrent calls keep grant context private and create run, window and audit atomically',async()=>{
   const ids=[grantFor(context),grantFor(context)],calls=gateCalls.length;
   const results=await Promise.all([
    service.applyArchive(job.jobId,context.previewDigest,approval,'synthetic-password',owner,ids[0]),
    service.applyArchive(job.jobId,context.previewDigest,approval,'synthetic-password',owner,ids[1]),
   ]);
   const writer=results.findIndex(result=>!result.replayed),id=ids[writer];assert.ok(writer>=0);applied=results[writer];
   const replay=results[1-writer];assert.equal(replay.replayed,true);assert.equal(replay.added,0);assert.equal(replay.runId,applied.runId);
   assert.deepEqual(gateCalls.slice(calls),[id],'the winning request must consume its own grant; the other request must replay without consuming another grant');
   assert.equal(applied.added,2);assert.equal(applied.productionImport,true);assert.equal(applied.createdClients,0);
   const [run]=await f.db.$queryRaw`SELECT * FROM "HistoryMigrationPilotRun" WHERE id=${applied.runId}`;
   assert.equal(run.environment,'OPERATIONAL_NATIVE');assert.equal(run.nativeConversationId,'protected-ig');assert.equal(run.nativeAccountId,'111');assert.equal(run.nativeCustomerId,'222');
   const [window]=await f.db.$queryRaw`SELECT * FROM "HistoryMigrationNativeWindow" WHERE "runId"=${applied.runId}`;
   const {openHistoryEvidence}=loadTargetModule('history-migration/history-evidence.ts');const evidence=openHistoryEvidence('NATIVE_WINDOW',applied.runId+':protected-ig',window.payloadEncrypted);
   assert.equal(evidence.archiveStartAt,'2024-01-01T10:30:00.000Z');assert.equal(evidence.cutoffAt,'2024-01-01T10:31:00.000Z');
   const uses=await f.db.$queryRaw`SELECT "after" FROM "AuditLog" WHERE action='HISTORY_OPERATIONAL_BACKUP_GRANT_USED'`;
   assert.equal(uses.length,1);assert.equal(uses[0].after.grantId,id);assert.equal(uses[0].after.digest,'b'.repeat(64));assert.equal(uses[0].after.runId,applied.runId);
   const after=await snapshot();for(const table of ['Client','Order','Payment','OrderItem','Athlete','MessageDeliveryAttempt','AiJob','AiJobAttempt'])assert.deepEqual(after[table],base[table]);
  });
  assert.ok(applied,'Initial native apply must pass before dependent custody cases');
  await t.test('zero-add replay cannot prepare a backup or yield host context, while exact apply replay stays allowed',async()=>{
   const zero=await service.prepareContext(job.jobId,approval,owner);assert.equal(zero.preview.newCandidates,0);assert.equal(zero.preview.discovered,2);
   const before=await snapshot();await assert.rejects(service.prepare(job.jobId,approval,'synthetic-password',owner),/HISTORY_OPERATIONAL_PLAN_NOT_READY/);assert.deepEqual(await snapshot(),before);
   const {saveOperationalPreparation}=loadTargetModule('history-migration/history-operational-preparation.ts');const {preview,...bare}=zero;
   await repository.withJob(job.jobId,tx=>saveOperationalPreparation(tx,approval,bare,'synthetic-password-hash'));
   const saved=await snapshot(),calls=gateCalls.length;await assert.rejects(service.preparedContext(job.jobId),/HISTORY_OPERATIONAL_PLAN_NOT_READY/);assert.deepEqual(await snapshot(),saved);
   const replay=await service.applyArchive(job.jobId,context.previewDigest,approval,'synthetic-password',owner);assert.equal(replay.replayed,true);assert.equal(replay.added,0);assert.equal(gateCalls.length,calls);
  });

  await t.test('tampered sealed window blocks both replay and rollback without repairing or consuming a grant',async()=>{
   const [original]=await f.db.$queryRaw`SELECT "payloadEncrypted" FROM "HistoryMigrationNativeWindow" WHERE "runId"=${applied.runId}`;
   await f.db.$executeRaw`UPDATE "HistoryMigrationNativeWindow" SET "payloadEncrypted"='synthetic-corrupt-window' WHERE "runId"=${applied.runId}`;
   try{
    const before=await snapshot(),calls=gateCalls.length;
    await assert.rejects(service.applyArchive(job.jobId,context.previewDigest,approval,'synthetic-password',owner),/доказательств/);
    await assert.rejects(service.rollback(job.jobId,applied.runId,'synthetic-password',owner),/доказательств/);
    assert.equal(gateCalls.length,calls);assert.deepEqual(await snapshot(),before);
   }finally{await f.db.$executeRaw`UPDATE "HistoryMigrationNativeWindow" SET "payloadEncrypted"=${original.payloadEncrypted} WHERE "runId"=${applied.runId}`;}
  });
  await t.test('new native traffic permits zero-write replay without a new grant',async()=>{
   await nativeMessage('synthetic-native-three');await f.db.$executeRaw`UPDATE "Conversation" SET "unreadCount"=9,"unreadVersion"=11,"lastMessageAt"='2026-11-01' WHERE id='protected-ig'`;
   const before=await snapshot(),calls=gateCalls.length;const repeated=await service.applyArchive(job.jobId,context.previewDigest,approval,'synthetic-password',owner);
   assert.equal(repeated.added,0);assert.equal(repeated.replayed,true);assert.equal(gateCalls.length,calls);assert.deepEqual(await snapshot(),before);
  });
  await t.test('selective rollback and its retry retain native rows, identities and the protected window',async()=>{
   const before=await snapshot();await service.rollback(job.jobId,applied.runId,'synthetic-password',owner);const after=await snapshot();
   for(const table of ['Client','Conversation','Order','Payment','MessageDeliveryAttempt','HistoryMigrationOrigin','HistoryMigrationNativeWindow'])assert.deepEqual(after[table],before[table]);
   assert.equal(after.Message.length,before.Message.length);assert.equal(after.Message.filter(m=>m.metadata?.deletion?.deletedAt).length,2);
   assert.deepEqual(after.Message.filter(m=>m.externalId),before.Message.filter(m=>m.externalId));
   assert.equal((await service.rollback(job.jobId,applied.runId,'synthetic-password',owner)).replayed,true);
   await assert.rejects(service.applyArchive(job.jobId,context.previewDigest,approval,'synthetic-password',owner),/отозван/);
  });
 }finally{try{if(f)await f.close();}finally{globalThis.fetch=oldFetch;keys.forEach((k,i)=>prior[i]===undefined?delete process.env[k]:process.env[k]=prior[i]);}}
});

test('actual WASM database is rejected before operational preview, apply or rollback writes',
 {skip:process.env.YO_HISTORY_PGLITE!=='1',timeout:120000},async()=>{
 const keys=['HISTORY_MIGRATION_OPERATIONAL_ENABLED','CRM_COMMIT'],prior=keys.map(k=>process.env[k]);
 process.env.HISTORY_MIGRATION_OPERATIONAL_ENABLED='true';process.env.CRM_COMMIT='a'.repeat(64);
 const {historyFixture}=await import('./history-migration-fixture.mjs');const f=await historyFixture();
 try{
  const {HistoryOperationalService}=loadTargetModule('history-migration/history-operational.service.ts');
  const service=new HistoryOperationalService(f.repository,f.backups);
  const before=(await f.db.query('SELECT * FROM "AuditLog" ORDER BY id')).rows;
  await assert.rejects(service.previewArchive(jobId,approval,owner),/нативном PostgreSQL/);
  await assert.rejects(service.applyArchive(jobId,'a'.repeat(64),approval,'synthetic-password',owner,grantId),/нативном PostgreSQL/);
  await assert.rejects(service.rollback(jobId,grantId,'synthetic-password',owner),/нативном PostgreSQL/);
  assert.deepEqual((await f.db.query('SELECT * FROM "AuditLog" ORDER BY id')).rows,before);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM "Message"')).rows[0].n,0);
 }finally{await f.close();keys.forEach((k,i)=>prior[i]===undefined?delete process.env[k]:process.env[k]=prior[i]);}
});
