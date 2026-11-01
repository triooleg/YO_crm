import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,readdir,mkdir} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProtectedJobStore} from '../../../tools/migrator-agent/src/checkpoint.ts';
import {historyNativeFixture} from './history-native-fixture.mjs';
import {nativeHistoryServices} from './history-native-engine-fixture.mjs';
import {loadTargetModule} from './overview-target-loader.mjs';
import {pilotOwner} from './history-migration-fixture.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const argon2=createRequire(import.meta.url)('argon2');

test('fresh source on existing native client with real BackupService Argon2id auth, replay, restore and rollback',{
 skip:process.env.YO_HISTORY_NATIVE!=='1'||process.env.YO_HISTORY_ACTUAL_ARCHIVE!=='1',timeout:240000,
},async t=>{
 const names=['HISTORY_MIGRATION_ENABLED','HISTORY_MIGRATION_PLANNING_ENABLED','SETTINGS_ENCRYPTION_KEY','AI_ENABLED','AI_MESSAGE_ANALYSIS_ENABLED'];
 const prior=names.map(k=>process.env[k]),oldFetch=globalThis.fetch,sources=[];let f,phase='SOURCE';
 process.env.HISTORY_MIGRATION_ENABLED='true';process.env.HISTORY_MIGRATION_PLANNING_ENABLED='true';
 process.env.SETTINGS_ENCRYPTION_KEY='synthetic-native-real-auth-history-not-production';process.env.AI_ENABLED='true';process.env.AI_MESSAGE_ANALYSIS_ENABLED='true';
 globalThis.fetch=()=>{throw Error('Provider/network requests forbidden');};
 const base=resolve(root,'.local/chat-history-migrator/phase-c16');
 async function saved(folder){
  folder=resolve(folder);assert.ok(folder.startsWith(resolve(root,'.local/chat-history-migrator')+sep),'Only retained migration evidence is admitted');
  const bytes=await readFile(join(folder,'checkpoint.bin')),entries=(await readdir(folder)).sort();sources.push({folder,digest:hash(bytes),entries});
  const parent=await mkdtemp(join(base,'source-copy-')),copy=join(parent,'private'),store=new ProtectedJobStore(copy);
  try{await store.initialize();await writeFile(join(copy,'checkpoint.bin'),bytes,{flag:'wx',mode:0o600});return await store.load();}finally{await store.close();}
 }
 try{
  await mkdir(base,{recursive:true});
  const pointer=JSON.parse(await readFile(resolve(root,'.local/chat-history-migrator/phase-c15/source-recheck.json'),'utf8'));
  const fresh=(await saved(join(pointer.folder,'private'))).messages,approved=await saved(resolve(root,'.local/chat-history-migrator/phase-c11/archive-input'));
  const overlap=await saved(resolve(root,'.local/chat-history-migrator/phase-c11/overlap-evidence'));
  const {normalizeMessage,sourceKey}=loadTargetModule('history-migration/history.ts');
  const fields=['text','direction','timestamp','sourceTimeText','attachments','sender','ordinal'];
  const facts=rows=>JSON.stringify(rows.map(raw=>[sourceKey(normalizeMessage(raw)),fields.map(key=>raw[key])]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0));
  assert.equal(fresh.length,349);assert.equal(hash(facts(fresh)),'250865e11e0861b0947b863c013cb97e61a13c0a93aecfdc3b59954234d28024');assert.equal(facts(fresh),facts(approved.messages));
  assert.ok(fresh.every(m=>m.account==='yoleotard.keycrm.app'&&m.channel==='INSTAGRAM'&&normalizeMessage(m).time.precision==='MINUTE'));
  const deferred=new Set(overlap.deferredSourceKeys),ready=fresh.filter(m=>!deferred.has(sourceKey(normalizeMessage(m))));assert.equal(ready.length,342);
  phase='SCHEMA';f=await historyNativeFixture();const s=await nativeHistoryServices(f,{seed:true});
  const password='Synthetic owner qualification only',rotatedPassword='Synthetic rotated owner qualification only';
  const digest=await argon2.hash(password,{type:argon2.argon2id}),rotatedDigest=await argon2.hash(rotatedPassword,{type:argon2.argon2id});
  await f.db.$executeRaw`UPDATE "User" SET "passwordHash"=${digest} WHERE id IN ('owner','other-owner')`;
  const {BackupService}=loadTargetModule('backups/backup.service.ts'),{BackupRepository}=loadTargetModule('backups/backup.repository.ts');
  const inertStorage=new Proxy({},{get(){throw Error('Backup storage I/O is outside authentication qualification');}});
  const realBackups=db=>new BackupService(new BackupRepository(db),inertStorage);
  const actual=realBackups(f.db);s.backups.reauthenticate=actual.reauthenticate.bind(actual);
  await f.db.client.create({data:{id:'preexisting-pilot',firstName:'Synthetic existing pilot',displayName:'Synthetic existing pilot',source:'INSTAGRAM',preferredChannel:'INSTAGRAM',status:'ACTIVE',notes:'Preserve existing identity and profile',firstContactAt:new Date('2024-01-01T10:00:00Z'),lastContactAt:new Date('2026-10-01T10:00:00Z')}});
  const baseline=await s.snapshot(),targetBefore=baseline.Client.find(c=>c.id==='preexisting-pilot'),scope={source:'KEYCRM',account:'yoleotard.keycrm.app',channel:'INSTAGRAM'};
  phase='AUTH';assert.equal((await actual.reauthenticate(pilotOwner,password)).id,'owner');
  await assert.rejects(s.intake.create(scope,'wrong-password',pilotOwner),e=>e.getStatus?.()===401);assert.deepEqual(await s.snapshot(),baseline);
  const job=await s.intake.create(scope,password,pilotOwner),pair=await s.intake.pair(job.jobId,password,pilotOwner);
  for(let start=0;start<ready.length;start+=100){const payloadJson=JSON.stringify({version:1,source:'KEYCRM',messages:ready.slice(start,start+100),completeness:{status:'PARTIAL'}});await s.intake.stage(job.jobId,`Bearer ${pair.token}`,{batchId:randomUUID(),payloadJson,checksum:hash(payloadJson)});}
  for(const dialogueId of [...new Set(ready.map(m=>m.dialogueId))])await s.planning.bind(job.jobId,{dialogueId,mode:'EXISTING',clientId:'preexisting-pilot'},password,pilotOwner);
  const preview=await s.pilot.previewArchive(job.jobId,approved.approval,pilotOwner),staged=await s.snapshot();assert.deepEqual(preview.blockers,[]);assert.equal(preview.newCandidates,230);
  phase='AUTH_REFUSALS';
  await assert.rejects(s.pilot.applyArchive(job.jobId,preview.previewDigest,approved.approval,'wrong-password',pilotOwner),e=>e.getStatus?.()===401);
  await assert.rejects(s.pilot.applyArchive(job.jobId,preview.previewDigest,approved.approval,password,{...pilotOwner,id:'other-owner'}),e=>e.getStatus?.()===403);
  await assert.rejects(s.pilot.applyArchive(job.jobId,preview.previewDigest,approved.approval,password,{...pilotOwner,role:'ADMIN'}),e=>e.getStatus?.()===403);
  assert.deepEqual(await s.snapshot(),staged);
  for(const field of ['inactive','archived']){
   if(field==='inactive')await f.db.$executeRaw`UPDATE "User" SET active=false WHERE id='owner'`;else await f.db.$executeRaw`UPDATE "User" SET "archivedAt"=CURRENT_TIMESTAMP WHERE id='owner'`;
   const denied=await s.snapshot();try{await assert.rejects(s.pilot.applyArchive(job.jobId,preview.previewDigest,approved.approval,password,pilotOwner),e=>e.getStatus?.()===403);assert.deepEqual(await s.snapshot(),denied);}
   finally{await f.db.$executeRaw`UPDATE "User" SET active=true,"archivedAt"=NULL WHERE id='owner'`;}
  }
  phase='ROTATION';s.backups.reauthenticate=async(...args)=>{const verified=await actual.reauthenticate(...args);await f.db.$executeRaw`UPDATE "User" SET "passwordHash"=${rotatedDigest} WHERE id='owner'`;return verified;};
  try{await assert.rejects(s.pilot.applyArchive(job.jobId,preview.previewDigest,approved.approval,password,pilotOwner),e=>e.getStatus?.()===403);}
  finally{await f.db.$executeRaw`UPDATE "User" SET "passwordHash"=${digest} WHERE id='owner'`;s.backups.reauthenticate=actual.reauthenticate.bind(actual);}
  assert.deepEqual(await s.snapshot(),staged);
  phase='WASM_REFUSAL';const {IsolatedHistoryMigrationPilot}=loadTargetModule('history-migration/isolated-history-pilot.ts');
  await assert.rejects(new IsolatedHistoryMigrationPilot(s.repository,s.backups).applyArchive(job.jobId,preview.previewDigest,approved.approval,password,pilotOwner),/WASM/);assert.deepEqual(await s.snapshot(),staged);
  phase='APPLY';const run=await s.pilot.applyArchive(job.jobId,preview.previewDigest,approved.approval,password,pilotOwner);assert.equal(run.added,230);assert.equal(run.createdClients,0);assert.equal(run.productionImport,false);
  const applied=await s.snapshot();assert.deepEqual(applied.Client,baseline.Client);assert.equal(applied.Message.length-baseline.Message.length,230);assert.equal(applied.HistoryMigrationOrigin.length,342);
  for(const table of ['Order','Payment','OrderItem','Athlete','MessageAttachment','MessageAnalysis','AiJob','AiJobAttempt'])assert.deepEqual(applied[table],baseline[table]);
  const {CommunicationsService}=loadTargetModule('communications/communications.service.ts');
  assert.equal((await new CommunicationsService(f.db,{}).detail('preexisting-pilot','INSTAGRAM')).messages.length,230);
  phase='REPLAY';assert.equal((await s.pilot.applyArchive(job.jobId,preview.previewDigest,approved.approval,password,pilotOwner)).added,0);assert.deepEqual(await s.snapshot(),applied);
  phase='RESTORE';const restored=await f.restore(await f.dump()),r=await nativeHistoryServices(restored),restoredBackups=realBackups(restored.db);r.backups.reauthenticate=restoredBackups.reauthenticate.bind(restoredBackups);
  assert.deepEqual(await r.snapshot(),applied);assert.equal((await r.pilot.applyArchive(job.jobId,preview.previewDigest,approved.approval,password,pilotOwner)).added,0);assert.deepEqual(await r.snapshot(),applied);
  phase='ROLLBACK';await r.pilot.rollback(job.jobId,run.runId,password,pilotOwner);const rolled=await r.snapshot();assert.deepEqual(rolled.Client,baseline.Client);assert.deepEqual(rolled.Client.find(c=>c.id==='preexisting-pilot'),targetBefore);
  assert.equal(rolled.Message.length,applied.Message.length);assert.equal(rolled.HistoryMigrationOrigin.length,342);assert.equal((await new CommunicationsService(restored.db,{}).detail('preexisting-pilot','INSTAGRAM')).messages.length,0);
  const {isSoftDeletedMessage}=loadTargetModule('communications/message-deletion.ts');
  const imported=applied.Message.filter(message=>!baseline.Message.some(old=>old.id===message.id));assert.equal(imported.length,230);
  for(const message of imported){const after=rolled.Message.find(row=>row.id===message.id);assert.ok(after);assert.equal(isSoftDeletedMessage(after.metadata),true);assert.equal(after.content,message.content);assert.equal(after.createdAt,message.createdAt);}
  assert.deepEqual(rolled.HistoryMigrationOrigin,applied.HistoryMigrationOrigin);
  const rolledRun=rolled.HistoryMigrationPilotRun.find(row=>row.id===run.runId);assert.equal(rolledRun?.status,'ROLLED_BACK');assert.ok(Number.isFinite(Date.parse(rolledRun.rolledBackAt)));
  const rollbackMutable=new Set(['Conversation','Message','HistoryMigrationPilotRun','AuditLog']);
  for(const table of Object.keys(applied))if(!rollbackMutable.has(table))assert.deepEqual(rolled[table],applied[table],`Rollback must preserve ${table}`);
  for(const table of ['Order','Payment','OrderItem','Athlete','MessageAttachment','MessageAnalysis','AiJob','AiJobAttempt'])assert.deepEqual(rolled[table],baseline[table]);
  for(const message of baseline.Message)assert.deepEqual(rolled.Message.find(row=>row.id===message.id),message);
  for(const conversation of baseline.Conversation)assert.deepEqual(rolled.Conversation.find(row=>row.id===conversation.id),conversation);
  assert.deepEqual(await s.snapshot(),applied,'restore and rollback must preserve the source database');
  phase='CUSTODY';for(const source of sources){assert.equal(hash(await readFile(join(source.folder,'checkpoint.bin'))),source.digest);assert.deepEqual((await readdir(source.folder)).sort(),source.entries);}
  t.diagnostic(JSON.stringify({sourceRecords:349,ready:342,added:230,origins:342,createdClients:0,existingClientUnchanged:true,realPasswordVerification:true,replayAdded:0,restoreReplayAdded:0,rollbackHidden:230,sourceCompleteness:'UNVERIFIED',productionWrites:0}));
 }catch(error){throw Error(`Native owner/existing-client qualification failed at ${phase} (${error.name}, ${error.meta?.code??error.code??'NO_CODE'}); source content omitted`);}
 finally{try{if(f)await f.close();}finally{globalThis.fetch=oldFetch;names.forEach((key,i)=>prior[i]===undefined?delete process.env[key]:process.env[key]=prior[i]);}}
});
