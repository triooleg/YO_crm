import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {loadTargetModule} from './overview-target-loader.mjs';
import {historyNativeFixture} from './history-native-fixture.mjs';
import {historyFullSchemaSeed, fullSchemaSnapshot} from './history-full-schema-fixture.mjs';

const owner={id:'owner',role:'OWNER',active:true,archivedAt:null};
const approval={policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[]};
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const old='2024-01-01T10:30:59.999Z',current='2026-11-01T12:00:00.000Z';
const deferred=()=>Promise.withResolvers();
const snapshot=db=>fullSchemaSnapshot({query:async sql=>({rows:await db.$queryRawUnsafe(sql)})});
const payload=(mid,direction='INBOUND',at=old)=>({object:'instagram',entry:[{id:'111',messaging:[{
 sender:{id:direction==='INBOUND'?'222':'111'},recipient:{id:direction==='INBOUND'?'111':'222'},
 ...(at===null?{}:{timestamp:Date.parse(at)}),message:{mid,text:'Synthetic ingress '+mid,...(direction==='OUTBOUND'?{is_echo:true}:{})},
}]}]});

// Calls the real private ingestion methods from JS, as the signed webhook's
// persistence boundary does. No public prototype endpoint, provider or network.
function communications(db){
 const {CommunicationsService}=loadTargetModule('communications/communications.service.ts');
 const service=Object.create(CommunicationsService.prototype);service.p=db;service.logger={log(){},warn(){},error(){}};
 const {normalizeMetaWebhook,normalizeMetaEchoMessages}=loadTargetModule('communications/meta-webhook.ts');
 return {service,async inbound(raw){
  const [event]=normalizeMetaWebhook(raw);assert.ok(event);
  const fragment=JSON.parse(JSON.stringify({provider:'META',...event,receivedAt:event.receivedAt.toISOString()}));
  return service.persistInbound(event,'META',fragment,raw);
 },async echo(raw){const [event]=normalizeMetaEchoMessages(raw);assert.ok(event);return service.persistMetaEcho(event,raw);}};
}

test('actual native operational import serializes real ingress before, during and after its durable window',
 {skip:process.env.YO_HISTORY_NATIVE!=='1',timeout:240000},async t=>{
 const env=['HISTORY_MIGRATION_ENABLED','HISTORY_MIGRATION_PLANNING_ENABLED','HISTORY_MIGRATION_OPERATIONAL_ENABLED','SETTINGS_ENCRYPTION_KEY','CRM_COMMIT','AI_ENABLED','AI_MESSAGE_ANALYSIS_ENABLED'];
 const prior=env.map(key=>process.env[key]),savedFetch=globalThis.fetch;let f,release;
 for(const key of env.slice(0,3))process.env[key]='true';
 process.env.SETTINGS_ENCRYPTION_KEY='synthetic-operational-ingress-race-not-production';process.env.CRM_COMMIT='a'.repeat(64);
 process.env.AI_ENABLED='true';process.env.AI_MESSAGE_ANALYSIS_ENABLED='true';
 globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN_IN_OPERATIONAL_INGRESS_FIXTURE');};
 try{
  f=await historyNativeFixture();assert.equal(f.migrations,53);
  for(const sql of historyFullSchemaSeed.split(';').map(s=>s.trim()).filter(Boolean))await f.db.$executeRawUnsafe(sql);
  await f.db.$executeRaw`UPDATE "Client" SET instagram='222',"instagramUsername"='synthetic_handle' WHERE id='existing'`;
  await f.db.$executeRaw`UPDATE "Conversation" SET "externalId"='111:222' WHERE id='protected-ig'`;
  await f.db.$executeRaw`INSERT INTO "AppSetting" (id,section,key,value,"updatedAt") VALUES ('synthetic-receiver','integration.meta','instagramAccountId','"111"'::jsonb,CURRENT_TIMESTAMP)`;
  await f.db.$executeRawUnsafe('CREATE TABLE "_prisma_migrations" (migration_name text PRIMARY KEY,checksum text NOT NULL,finished_at timestamptz,rolled_back_at timestamptz)');
  const folder=new URL('../../../packages/database/prisma/migrations/',import.meta.url);
  for(const item of await readdir(folder,{withFileTypes:true}))if(item.isDirectory()){
   const checksum=createHash('sha256').update(await readFile(new URL(item.name+'/migration.sql',folder))).digest('hex');
   await f.db.$executeRaw`INSERT INTO "_prisma_migrations" VALUES (${item.name},${checksum},CURRENT_TIMESTAMP,NULL)`;
  }
  const {HistoryMigrationRepository}=loadTargetModule('history-migration/history-migration.repository.ts');
  const {HistoryMigrationService}=loadTargetModule('history-migration/history-migration.service.ts');
  const {HistoryMigrationPlanningService}=loadTargetModule('history-migration/history-planning.service.ts');
  const {HistoryOperationalService}=loadTargetModule('history-migration/history-operational.service.ts');
  const {validateOperationalBackupGrant}=loadTargetModule('backups/backup-operational-grant.ts');
  const {openHistoryEvidence}=loadTargetModule('history-migration/history-evidence.ts');
  const grants=new Map(),uses=[];let pause;
  function services(db){
   // Synthetic AUTH/physical-backup boundary only. DB transactions, repository,
   // plan, native-time proof, windows, real ingress writes and custody are real.
   const backups={reauthenticate:async(actor,password)=>{
    assert.equal(password,'synthetic-password');const [user]=await db.$queryRaw`SELECT * FROM "User" WHERE id=${actor.id}`;
    assert.ok(user?.active&&user.role==='OWNER'&&!user.archivedAt);return user;
   },verifyOperationalGrant:async(id,expected,tx)=>{
    const checked=validateOperationalBackupGrant(grants.get(id),id,expected);uses.push(id);
    if(pause){const hold=pause;pause=undefined;const [row]=await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;hold.entered.resolve(row.pid);await hold.release.promise;}
    return {grant:checked,digest:'b'.repeat(64)};
   }};
   const repository=new HistoryMigrationRepository(db);
   return {db,repository,intake:new HistoryMigrationService(repository,backups),planning:new HistoryMigrationPlanningService(repository,backups),core:new HistoryOperationalService(repository,backups)};
  }
  const s=services(f.db),job=await s.intake.create({source:'KEYCRM',account:'synthetic-business',channel:'INSTAGRAM'},'synthetic-password',owner);
  const pairing=await s.intake.pair(job.jobId,'synthetic-password',owner);
  const archive=[0,1].map(ordinal=>({source:'KEYCRM',account:'synthetic-business',channel:'INSTAGRAM',dialogueId:'race-source',sourceMessageId:'archive-'+ordinal,sender:'contact:race-source',direction:'INBOUND',timestamp:'2024-01-01',sourceTimeText:'2024-01-01 12:30',sourceTimezone:'Europe/Kyiv',text:'Synthetic archive '+ordinal,ordinal,attachments:[]}));
  const packet=JSON.stringify({version:1,source:'KEYCRM',messages:archive,completeness:{status:'PARTIAL'}});
  await s.intake.stage(job.jobId,`Bearer ${pairing.token}`,{batchId:randomUUID(),payloadJson:packet,checksum:hash(packet)});
  await s.planning.bind(job.jobId,{mode:'EXISTING',clientId:'existing',dialogueId:'race-source'},'synthetic-password',owner);
  const context=await s.core.prepareContext(job.jobId,approval,owner);assert.equal(context.preview.newCandidates,2);
  function grantFor(prepared){
   const {preview,...expected}=prepared,id=randomUUID(),now=Date.now();
   grants.set(id,{...expected,version:1,purpose:'OPERATIONAL_NATIVE_BACKUP_GRANT_V1',grantId:id,backupId:'synthetic-backup',captureStartedAt:new Date(now-60000).toISOString(),manifestSha256:'c'.repeat(64),sha256sumsSha256:'d'.repeat(64),archiveSha256:'e'.repeat(64),archiveBytes:'1000',drillJobId:'synthetic-drill',drillReportSha256:'f'.repeat(64),drillFinishedAt:new Date(now-30000).toISOString(),issuedAt:new Date(now-10000).toISOString(),expiresAt:new Date(now+300000).toISOString()});return id;
  }
  const {ClientsService}=loadTargetModule('clients/clients.service.ts');
  const outcome=promise=>promise.then(value=>({value}),error=>({error}));
  async function waitsFor(db,pid){
   const deadline=Date.now()+2500;
   do{const rows=await db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND ${pid}::int=ANY(pg_blocking_pids(pid))`;
    if(rows.length)return;await new Promise(resolve=>setTimeout(resolve,15));}while(Date.now()<deadline);
   assert.fail('Expected actual writer to wait on importing backend');
  }
  // Transparent transaction instrumentation pauses only AFTER the real write;
  // every Prisma call, row lock, trigger and commit still runs in owned PG.
  function pausedModelWriter(db,modelName,methodName,entered,resume){
   return new Proxy(db,{get(target,key){
    if(key==='$transaction')return(action,options)=>target.$transaction(tx=>action(new Proxy(tx,{get(inner,model){
     if(model===modelName)return new Proxy(inner[model],{get(delegate,method){
      if(method===methodName)return async(...args)=>{const result=await delegate[method](...args);entered.resolve();await resume.promise;return result;};
      const value=Reflect.get(delegate,method);return typeof value==='function'?value.bind(delegate):value;
     }});
     const value=Reflect.get(inner,model);return typeof value==='function'?value.bind(inner):value;
    }})),options);
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
   }});
  }
  for(const kind of ['native-contact promotion','conversation archive','harmless notes'])await t.test('row locks serialize '+kind+' during actual backup verification without overwriting the writer',async sub=>{
   const clone=await f.restore(await f.dump()),writer=await clone.connect(),watch=await clone.connect();
   sub.after(()=>Promise.all([clone.db,writer,watch].map(db=>db.$disconnect())));
   if(kind==='native-contact promotion')await clone.db.$executeRaw`UPDATE "Client" SET status='LEAD',source='MANUAL' WHERE id='existing'`;
   const branch=services(clone.db),prepared=await branch.core.prepareContext(job.jobId,approval,owner);
   const hold={entered:deferred(),release:deferred()};pause=hold;release=hold.release;
   const importing=outcome(branch.core.applyArchive(job.jobId,prepared.previewDigest,approval,'synthetic-password',owner,grantFor(prepared)));
   const pid=await Promise.race([hold.entered.promise,importing.then(result=>{throw result.error??Error('No grant gate');})]);
   let finished=false;
   const write=kind==='native-contact promotion'
    ?new ClientsService(writer).promoteFromInbox('existing',{firstName:'Synthetic promoted',instagram:'999'},owner)
    :kind==='harmless notes'?new ClientsService(writer).updateNotes('existing','Synthetic note retained after import',owner)
    :writer.conversation.update({where:{id:'protected-ig'},data:{archivedAt:new Date('2026-11-01T13:00:00Z')}});
   const writing=outcome(write.finally(()=>{finished=true;}));
   try{await waitsFor(watch,pid);assert.equal(finished,false);}finally{hold.release.resolve();}
   const imported=await importing,changed=await writing;if(imported.error)throw imported.error;if(changed.error)throw changed.error;
   assert.equal(imported.value.added,2);const [client]=await watch.$queryRaw`SELECT * FROM "Client" WHERE id='existing'`;
   if(kind==='native-contact promotion')assert.equal(client.instagram,'999');
   if(kind==='conversation archive')assert.ok((await watch.conversation.findUnique({where:{id:'protected-ig'}})).archivedAt);
   if(kind==='harmless notes'){
    assert.equal(client.notes,'Synthetic note retained after import');const before=await snapshot(watch),calls=uses.length;
    assert.equal((await branch.core.applyArchive(job.jobId,prepared.previewDigest,approval,'synthetic-password',owner)).replayed,true);
    assert.deepEqual(await snapshot(watch),before);assert.equal(uses.length,calls);
    await branch.core.rollback(job.jobId,imported.value.runId,'synthetic-password',owner);
    assert.equal((await watch.client.findUnique({where:{id:'existing'}})).notes,'Synthetic note retained after import');
   }
  });
  await t.test('a real promotion holding Client first refuses import before job/grant without partial writes',async sub=>{
   const clone=await f.restore(await f.dump()),writer=await clone.connect(),watch=await clone.connect(),branch=services(clone.db);
   sub.after(()=>Promise.all([clone.db,writer,watch].map(db=>db.$disconnect())));
   await clone.db.$executeRaw`UPDATE "Client" SET status='LEAD',source='MANUAL' WHERE id='existing'`;
   const prepared=await branch.core.prepareContext(job.jobId,approval,owner),before=await snapshot(watch);
   const entered=deferred(),resume=deferred();release=resume;
   const changing=outcome(new ClientsService(pausedModelWriter(writer,'client','update',entered,resume)).promoteFromInbox('existing',{firstName:'Synthetic promoted',instagram:'999'},owner));
   await Promise.race([entered.promise,changing.then(result=>{throw result.error??Error('Promotion did not reach Client');})]);
   const calls=uses.length,importing=outcome(branch.core.applyArchive(job.jobId,prepared.previewDigest,approval,'synthetic-password',owner,grantFor(prepared)));
   let timer;
   try{
    const result=await Promise.race([importing,new Promise(resolve=>{timer=setTimeout(()=>resolve({error:Error('ROW_LOCK_ACQUISITION_WAITED_ON_CLIENT_WRITER')}),2500);})]);
    assert.equal(result.error?.getStatus?.(),409);assert.match(result.error.message,/HISTORY_OPERATIONAL_SCOPE_BUSY/);
    assert.equal(uses.length,calls);assert.deepEqual(await snapshot(watch),before);
   }finally{clearTimeout(timer);resume.resolve();await importing;const result=await changing;if(result.error)throw result.error;}
   assert.equal((await watch.client.findUnique({where:{id:'existing'}})).instagram,'999');
   assert.equal((await watch.historyMigrationPilotRun.findMany()).length,0);
  });
  await t.test('actual deletion holding Conversation first cannot deadlock native Client-then-Conversation acquisition',async sub=>{
   const clone=await f.restore(await f.dump()),writer=await clone.connect(),watch=await clone.connect(),branch=services(clone.db);
   sub.after(()=>Promise.all([clone.db,writer,watch].map(db=>db.$disconnect())));
   const prepared=await branch.core.prepareContext(job.jobId,approval,owner),code='d'.repeat(32);
   await clone.db.appSetting.create({data:{section:'integration.meta.data-deletion',key:code,value:{status:'PENDING',matchedClientId:'existing'}}});
   const entered=deferred(),resume=deferred();release=resume;
   const deletion=outcome(communications(pausedModelWriter(writer,'conversation','updateMany',entered,resume)).service.completeMetaDataDeletion(code,'existing','Synthetic fixture retention',owner));
   await Promise.race([entered.promise,deletion.then(result=>{throw result.error??Error('Deletion did not reach Conversation');})]);
   const calls=uses.length,importing=outcome(branch.core.applyArchive(job.jobId,prepared.previewDigest,approval,'synthetic-password',owner,grantFor(prepared)));
   let timer;
   try{
    const result=await Promise.race([importing,new Promise(resolve=>{timer=setTimeout(()=>resolve({error:Error('ROW_LOCK_ACQUISITION_WAITED_ON_REVERSE_WRITER')}),2500);})]);
    assert.equal(result.error?.getStatus?.(),409,'busy row must reject immediately without entering the opposing lock cycle');
    assert.match(result.error.message,/HISTORY_OPERATIONAL_SCOPE_BUSY/);assert.equal(uses.length,calls);
    assert.equal((await watch.historyMigrationPilotRun.findMany()).length,0);
    assert.equal((await watch.$queryRaw`SELECT * FROM "HistoryMigrationNativeWindow"`).length,0);
    assert.equal((await watch.auditLog.findMany({where:{action:'HISTORY_OPERATIONAL_BACKUP_GRANT_USED'}})).length,0);
   }finally{clearTimeout(timer);resume.resolve();await importing;const result=await deletion;if(result.error)throw result.error;}
   const client=await watch.client.findUnique({where:{id:'existing'}});assert.ok(client.archivedAt);assert.equal(client.instagram,null);
   assert.equal((await watch.appSetting.findUnique({where:{section_key:{section:'integration.meta.data-deletion',key:code}}})).value.status,'COMPLETED');
  });
  await t.test('before import an actual old inbound persists normally but refuses the native baseline before grant use',async sub=>{
   const clone=await f.restore(await f.dump()),branch=services(clone.db),ingress=communications(clone.db);
   sub.after(()=>clone.db.$disconnect());
   assert.equal(await ingress.inbound(payload('before-import')),true);
   const before=await snapshot(clone.db),calls=uses.length;
   await assert.rejects(branch.core.prepareContext(job.jobId,approval,owner));
   await assert.rejects(branch.core.applyArchive(job.jobId,context.previewDigest,approval,'synthetic-password',owner,grantFor(context)));
   assert.equal(uses.length,calls);assert.deepEqual(await snapshot(clone.db),before);
   assert.equal(before.Message.filter(row=>row.externalId==='before-import').length,1);
   assert.equal(before.HistoryMigrationPilotRun.length,0);assert.equal(before.HistoryMigrationNativeReview.length,0);
  });
  await t.test('queued global merge cannot invert concurrent native import, target bind and ordinary planning locks',async sub=>{
   const clone=await f.restore(await f.dump()),branch=services(clone.db),watch=await clone.connect(),mergeDb=await clone.connect();
   const binder=services(await clone.connect()),planner=services(await clone.connect());
   sub.after(()=>Promise.all([clone.db,watch,mergeDb,binder.db,planner.db].map(db=>db.$disconnect())));
   const branchContext=await branch.core.prepareContext(job.jobId,approval,owner);
   const before=await snapshot(watch);
   const hold={entered:deferred(),release:deferred()};pause=hold;release=hold.release;
   const importing=branch.core.applyArchive(job.jobId,branchContext.previewDigest,approval,'synthetic-password',owner,grantFor(branchContext)).then(value=>({value}),error=>({error}));
   const pid=await Promise.race([hold.entered.promise,importing.then(result=>{throw result.error??Error('Import finished without reaching its test gate');})]);
   const merging=mergeDb.$transaction(tx=>tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'client-merge-global'},0))`,{timeout:10000}).then(value=>({value}),error=>({error}));
   async function waits(count){
    const deadline=Date.now()+4000;
    do{const rows=await watch.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>${pid}::int`;
     if(rows.length>=count)return;await new Promise(resolve=>setTimeout(resolve,15));}while(Date.now()<deadline);
    assert.fail('Expected real queued service transactions');
   }
   let binding,planning;
   try{
    await waits(1); // The exclusive merge is queued behind the native importer.
    binding=binder.planning.bind(job.jobId,{mode:'EXISTING',clientId:'existing',dialogueId:'race-source'},'synthetic-password',owner).then(value=>({value}),error=>({error}));
    planning=planner.planning.dryRun(job.jobId,owner).then(value=>({value}),error=>({error}));
    await waits(3);
   }finally{hold.release.resolve();}
   const results=await Promise.all([importing,merging,binding,planning]);
   for(const index of [0,1,3]){assert.ok(results[index]);if(results[index].error)throw results[index].error;}
   // The bind queued before commit must recheck the now-frozen job after its lock.
   assert.equal(results[2].error?.getStatus(),409);assert.equal(results[2].value,undefined);
   assert.equal(results[2].error.message,'Источники и сопоставления операционного импорта зафиксированы');
   assert.equal(results[0].value.added,2);assert.equal(results[3].value.discovered,2);
   const after=await snapshot(watch);assert.equal(after.HistoryMigrationPilotRun.length,1);assert.equal(after.HistoryMigrationNativeWindow.length,1);
   for(const table of ['HistoryMigrationJob','HistoryMigrationBatch','HistoryMigrationTarget','Client'])assert.deepEqual(after[table],before[table],table+' must remain unchanged');
   assert.deepEqual(after.AuditLog.filter(row=>row.action==='HISTORY_TARGET_BOUND'),before.AuditLog.filter(row=>row.action==='HISTORY_TARGET_BOUND'));
   assert.equal(after.Message.filter(row=>row.metadata?.historyMigration).length,2);
   assert.equal(after.HistoryMigrationNativeReview.length,0);
  });
  const ingressDb=await f.connect(),observer=await f.connect(),ingress=communications(ingressDb);
  const base=await snapshot(observer);let applied;
  await t.test('during import real inbound waits on the importing backend then commits only durable review',async()=>{
   const hold={entered:deferred(),release:deferred()};pause=hold;release=hold.release;
   const importing=s.core.applyArchive(job.jobId,context.previewDigest,approval,'synthetic-password',owner,grantFor(context));
   // Attach handlers immediately: all resources are released also on assertion failure.
   const importResult=importing.then(value=>({value}),error=>({error}));
   const pid=await Promise.race([hold.entered.promise,importResult.then(result=>{throw result.error??Error('Import finished without reaching its test gate');})]);let settled=false;
   const arrival=ingress.inbound(payload('during-import')).then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
   try{
    const deadline=Date.now()+4000;let waiting=[];
    do{waiting=await observer.$queryRaw`SELECT pid,wait_event_type FROM pg_stat_activity WHERE datname=current_database() AND ${pid}::int=ANY(pg_blocking_pids(pid))`;if(waiting.length)break;await new Promise(resolve=>setTimeout(resolve,15));}while(Date.now()<deadline);
    assert.ok(waiting.some(row=>row.wait_event_type==='Lock'),'real ingress must wait on the import transaction, not a mocked lock');assert.equal(settled,false);
    assert.equal((await observer.$queryRaw`SELECT * FROM "HistoryMigrationNativeWindow"`).length,0,'uncommitted window is invisible');
    assert.equal((await observer.$queryRaw`SELECT * FROM "HistoryMigrationNativeReview"`).length,0);
   }finally{hold.release.resolve();}
   const result=await importResult;if(result.error)throw result.error;applied=result.value;assert.equal(applied.added,2);
   const incoming=await arrival;if(incoming.error)throw incoming.error;assert.equal(incoming.value,false);
   const after=await snapshot(observer);assert.equal(after.HistoryMigrationNativeReview.length,1);
   assert.equal(after.Message.filter(row=>row.externalId==='during-import').length,0);
   for(const table of ['Client','Conversation','Activity','AiJob','AiJobAttempt','Payment','Order'])assert.deepEqual(after[table],base[table]);
   const row=after.HistoryMigrationNativeReview[0],evidence=openHistoryEvidence('NATIVE_REVIEW',row.id,row.payloadEncrypted);
   assert.equal(evidence.reason,'BEFORE_CUTOFF');assert.equal(row.runId,applied.runId);
   assert.deepEqual(JSON.parse(evidence.eventJson).rawPayload,payload('during-import'));
   assert.ok(after.WebhookEnvelope.some(envelope=>envelope.id===row.webhookEnvelopeId));
   assert.equal(after.HistoryMigrationNativeWindow.length,1);
  });
  assert.ok(applied,'Import race must finish before after-commit cases');
  async function reviewed(action,reason){
   const before=await snapshot(observer);assert.equal(await action(),false);const after=await snapshot(observer);
   assert.equal(after.HistoryMigrationNativeReview.length,before.HistoryMigrationNativeReview.length+1);
   for(const table of Object.keys(before))if(!['HistoryMigrationNativeReview','WebhookEnvelope'].includes(table))assert.deepEqual(after[table],before[table],table+' must not change on review');
   const row=after.HistoryMigrationNativeReview.find(row=>!before.HistoryMigrationNativeReview.some(old=>old.id===row.id));
   assert.equal(openHistoryEvidence('NATIVE_REVIEW',row.id,row.payloadEncrypted).reason,reason);return row;
  }
  await t.test('after commit old echo is durable review and its exact MID retry adds nothing',async()=>{
   const raw=payload('after-echo','OUTBOUND');await reviewed(()=>ingress.echo(raw),'BEFORE_CUTOFF');
   const before=await snapshot(observer);assert.equal(await ingress.echo(raw),false);assert.deepEqual(await snapshot(observer),before);
   const first=payload('during-import');assert.equal(await ingress.inbound(first),false);assert.deepEqual(await snapshot(observer),before);
  });
  await t.test('missing original time uses normalizer arrival fallback but cannot bypass protected review',async()=>{
   const raw=payload('missing-original','INBOUND',null),{normalizeMetaWebhook}=loadTargetModule('communications/meta-webhook.ts');
   const [event]=normalizeMetaWebhook(raw);assert.ok(event.receivedAt.getTime()>Date.parse(old));assert.equal(event.originalTimestamp,null);
   await reviewed(()=>ingress.inbound(raw),'UNKNOWN_ORIGINAL_TIME');
  });
  await t.test('Instagram mirror in both directions cannot change scoped conversation or attention',async()=>{
   const inbound={channel:'INSTAGRAM',externalSenderId:'222',externalMessageId:'chatwoot:7:in',accountId:'7',inboxId:'8',content:'Synthetic mirror',receivedAt:new Date(current),metadata:{messageType:'text'}};
   await reviewed(()=>ingress.service.persistInbound(inbound,'CHATWOOT',{synthetic:'inbound-mirror'}),'INVALID_EVENT');
   // Existing scoped identity reaches the outbound private boundary directly.
   // It has no original Meta time/account authority and must stay reviewable.
   const outbound={...inbound,externalSenderId:'111:222',externalMessageId:'chatwoot:7:out'};
   await reviewed(()=>ingress.service.persistChatwootOutbound(outbound,{synthetic:'outbound-mirror'}),'INVALID_EVENT');
  });
  await t.test('current real inbound passes once and survives exact replay and selective rollback',async()=>{
   const raw=payload('current-inbound','INBOUND',current),before=await snapshot(observer);assert.equal(await ingress.inbound(raw),true);
   const written=await snapshot(observer),row=written.Message.find(row=>row.externalId==='current-inbound');assert.ok(row);
   assert.equal(row.rawPayload.originalTimestamp,current);assert.equal(row.receivedAt,'2026-11-01T12:00:00');assert.equal(row.createdAt,'2026-11-01T12:00:00');
   const conversation=written.Conversation.find(row=>row.id==='protected-ig'),previous=before.Conversation.find(row=>row.id==='protected-ig');
   assert.equal(conversation.unreadCount,previous.unreadCount+1);assert.equal(conversation.unreadVersion,previous.unreadVersion+1);
   assert.equal(written.AiJob.filter(job=>job.messageId===row.id).length,1);
   assert.equal(await ingress.inbound(raw),false);assert.deepEqual(await snapshot(observer),written);
   const calls=uses.length,replay=await s.core.applyArchive(job.jobId,context.previewDigest,approval,'synthetic-password',owner);
   assert.equal(replay.replayed,true);assert.equal(replay.added,0);assert.equal(uses.length,calls);assert.deepEqual(await snapshot(observer),written);
   await s.core.rollback(job.jobId,applied.runId,'synthetic-password',owner);const rolled=await snapshot(observer);
   assert.deepEqual(rolled.Message.find(message=>message.id===row.id),row);
   for(const table of ['Client','Conversation','AiJob','AiJobAttempt','Activity','HistoryMigrationNativeReview','HistoryMigrationNativeWindow','WebhookEnvelope'])assert.deepEqual(rolled[table],written[table]);
   assert.equal(rolled.Message.filter(message=>message.metadata?.deletion?.deletedAt).length,2);
   assert.equal((await s.core.rollback(job.jobId,applied.runId,'synthetic-password',owner)).replayed,true);
   const stable=await snapshot(observer);assert.equal(await ingress.inbound(raw),false);assert.deepEqual(await snapshot(observer),stable);
   await reviewed(()=>ingress.echo(payload('after-rollback','OUTBOUND')),'BEFORE_CUTOFF');
  });
 }finally{release?.resolve();try{if(f)await f.close();}finally{globalThis.fetch=savedFetch;env.forEach((key,i)=>prior[i]===undefined?delete process.env[key]:process.env[key]=prior[i]);}}
});
