import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,readdir,mkdtemp,lstat} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProtectedJobStore} from '../../../tools/migrator-agent/src/checkpoint.ts';
import {historyNativeFixture} from './history-native-fixture.mjs';
import {historyFullSchemaSeed,fullSchemaSnapshot} from './history-full-schema-fixture.mjs';
import {loadTargetModule} from './overview-target-loader.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const sha=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const owner={id:'owner',role:'OWNER',active:true,archivedAt:null};
const password='synthetic-owned-rehearsal-password';

/** Explicit opt-in only. Input is an absolute DPAPI checkpoint directory or a
 * small JSON pointer containing its absolute `folder`. Never initialize, lock,
 * save, normalize in place or clean the retained original directory. Decrypt
 * only a ciphertext copy inside a new ProtectedJobStore owned by this test.
 */
test('retained text archive operational rehearsal: server pairs95, adds213, origins308, Inbox218 and selective rollback',{
 skip:process.env.YO_HISTORY_NATIVE!=='1'||!process.env.YO_HISTORY_OPERATIONAL_ACTUAL_INPUT,
 timeout:240000,
},async t=>{
 const names=['HISTORY_MIGRATION_ENABLED','HISTORY_MIGRATION_PLANNING_ENABLED','HISTORY_MIGRATION_OPERATIONAL_ENABLED','SETTINGS_ENCRYPTION_KEY','CRM_COMMIT','AI_ENABLED','AI_MESSAGE_ANALYSIS_ENABLED'];
 const previous=names.map(name=>process.env[name]),oldFetch=globalThis.fetch;
 let f,copyStore,inputFile,inputSha,inputEntries,inputFolder,pointer,pointerSha,phase='INPUT';
 try{
  for(const name of names.slice(0,3))process.env[name]='true';
  process.env.SETTINGS_ENCRYPTION_KEY='synthetic-operational-retained-rehearsal-not-production';
  process.env.CRM_COMMIT='a'.repeat(64);process.env.AI_ENABLED='false';process.env.AI_MESSAGE_ANALYSIS_ENABLED='false';
  globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN_IN_RETAINED_OPERATIONAL_REHEARSAL');};
  const requested=process.env.YO_HISTORY_OPERATIONAL_ACTUAL_INPUT;
  assert.ok(isAbsolute(requested),'Opt-in input must be absolute');
  const inputInfo=await lstat(requested);assert.ok(!inputInfo.isSymbolicLink());
  if(inputInfo.isFile()){
   assert.ok(inputInfo.size>0&&inputInfo.size<=65536);pointer=requested;
   const bytes=await readFile(pointer);pointerSha=sha(bytes);const metadata=JSON.parse(bytes.toString('utf8'));
   assert.equal(typeof metadata.folder,'string');assert.ok(isAbsolute(metadata.folder));inputFolder=metadata.folder;
  }else{assert.ok(inputInfo.isDirectory());inputFolder=requested;}
  const folderInfo=await lstat(inputFolder);assert.ok(folderInfo.isDirectory()&&!folderInfo.isSymbolicLink());
  inputFile=join(inputFolder,'checkpoint.bin');const info=await lstat(inputFile);
  assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.size>0&&info.size<=64*1024*1024);
  const ciphertext=await readFile(inputFile);inputSha=sha(ciphertext);inputEntries=(await readdir(inputFolder)).sort();
  const copyParent=await mkdtemp(resolve(root,'.local/chat-history-migrator/phase-c12/operational-actual-'));
  const copyFolder=join(copyParent,'private');copyStore=new ProtectedJobStore(copyFolder);
  await copyStore.initialize();await writeFile(join(copyFolder,'checkpoint.bin'),ciphertext,{flag:'wx',mode:0o600});
  const data=await copyStore.load();assert.ok(data&&Array.isArray(data.messages));
  assert.equal(data.messages.length,308);assert.equal(data.deferredSourceKeys.length,41);
  const immutableMessages=sha(data.messages),deferred=new Set(data.deferredSourceKeys);assert.equal(deferred.size,41);
  // Standard test tooling may select another checkout's runtime. It is source
  // selection only, never a DB URL, runtime capability or provider transport.
  const suppliedRoot=process.env.YO_CRM_SOURCE_ROOT;if(suppliedRoot)assert.ok(isAbsolute(suppliedRoot));
  const sourceRoot=resolve(suppliedRoot||root),load=name=>loadTargetModule(resolve(sourceRoot,'apps/api/src',name));
  const {normalizeMessage,sourceKey}=load('history-migration/history.ts');
  const normalized=data.messages.map(normalizeMessage),keys=normalized.map(sourceKey);
  assert.equal(new Set(keys).size,308);assert.ok(keys.every(key=>!deferred.has(key)));
  assert.ok(normalized.every(row=>row.source==='KEYCRM'&&row.channel==='INSTAGRAM'&&row.account===normalized[0].account));
  const {archiveCutoffExclusive}=load('history-migration/history-native-evidence.ts');
  const cutoff=Date.parse(archiveCutoffExclusive(data.messages));
  phase='FIXTURE';
  // The native fixture applies this checkout's SQL directly. Require exact
  // schema/migrations correspondence with the runtime selected above.
  assert.equal(sha(await readFile(join(root,'packages/database/prisma/schema.prisma'))),sha(await readFile(join(sourceRoot,'packages/database/prisma/schema.prisma'))));
  const migrations=join(root,'packages/database/prisma/migrations');
  const migrationNames=(await readdir(migrations,{withFileTypes:true})).filter(row=>row.isDirectory()).map(row=>row.name).sort();assert.equal(migrationNames.length,52);
  for(const name of migrationNames)assert.equal(sha(await readFile(join(migrations,name,'migration.sql'))),sha(await readFile(join(sourceRoot,'packages/database/prisma/migrations',name,'migration.sql'))));
  f=await historyNativeFixture();assert.equal(f.migrations,52);
  for(const sql of historyFullSchemaSeed.split(';').map(row=>row.trim()).filter(Boolean))await f.db.$executeRawUnsafe(sql);
  await f.db.$executeRaw`UPDATE "Client" SET instagram='222',"instagramUsername"='synthetic_handle' WHERE id='existing'`;
  await f.db.$executeRaw`UPDATE "Conversation" SET "externalId"='111:222' WHERE id='protected-ig'`;
  await f.db.$executeRaw`INSERT INTO "AppSetting" (id,section,key,value,"updatedAt") VALUES ('synthetic-receiver','integration.meta','instagramAccountId','"111"'::jsonb,CURRENT_TIMESTAMP)`;
  await f.db.$executeRawUnsafe('CREATE TABLE "_prisma_migrations" (migration_name text PRIMARY KEY,checksum text NOT NULL,finished_at timestamptz,rolled_back_at timestamptz)');
  for(const name of migrationNames){const checksum=sha(await readFile(join(migrations,name,'migration.sql')));await f.db.$executeRaw`INSERT INTO "_prisma_migrations" VALUES (${name},${checksum},CURRENT_TIMESTAMP,NULL)`;}
  const snapshot=()=>fullSchemaSnapshot({query:async sql=>({rows:await f.db.$queryRawUnsafe(sql)})});
  const {HistoryMigrationRepository}=load('history-migration/history-migration.repository.ts');
  const {HistoryMigrationService}=load('history-migration/history-migration.service.ts');
  const {HistoryMigrationPlanningService}=load('history-migration/history-planning.service.ts');
  const {HistoryOperationalService}=load('history-migration/history-operational.service.ts');
  const {HistoryOperationalActionsService}=load('history-migration/history-operational-actions.service.ts');
  const {validateOperationalBackupGrant}=load('backups/backup-operational-grant.ts');
  const grants=new Map(),gateCalls=[];
  // SYNTHETIC BOUNDARIES ONLY: password crypto and host-file/physical backup
  // evidence are not proved by this rehearsal. Use real DB owner reload and
  // real grant-shape/context validation, never report operational acceptance.
  const backups={reauthenticate:async(actor,value)=>{
   assert.equal(value,password);const [user]=await f.db.$queryRaw`SELECT * FROM "User" WHERE id=${actor.id}`;
   assert.ok(user?.active&&!user.archivedAt&&user.role==='OWNER');return user;
  },verifyOperationalGrant:async(id,expected,db)=>{
   const [used]=await db.$queryRaw`SELECT id FROM "AuditLog" WHERE action='HISTORY_OPERATIONAL_BACKUP_GRANT_USED' AND "after"->>'grantId'=${id}`;
   assert.ok(!used);gateCalls.push(id);return {grant:validateOperationalBackupGrant(grants.get(id),id,expected),digest:'b'.repeat(64)};
  }};
  const repository=new HistoryMigrationRepository(f.db),intake=new HistoryMigrationService(repository,backups),planning=new HistoryMigrationPlanningService(repository,backups);
  const core=new HistoryOperationalService(repository,backups),actions=new HistoryOperationalActionsService(repository,core);
  const {CommunicationsService}=load('communications/communications.service.ts'),reader=new CommunicationsService(f.db,{});
  // Suppress service logging even for synthetic IDs. No retained source body,
  // customer identity, provider credential or plaintext payload may enter logs.
  reader.logger={log(){},warn(){},error(){}};
  const {normalizeMetaWebhook}=load('communications/meta-webhook.ts');
  phase='NATIVE_BASELINE';
  for(let i=0;i<5;i++){
   const at=cutoff+3600000+i*1000,raw={object:'instagram',entry:[{id:'111',messaging:[{sender:{id:'222'},recipient:{id:'111'},timestamp:at,message:{mid:'synthetic-native-'+i,text:'Synthetic native '+i}}]}]};
   const [event]=normalizeMetaWebhook(raw),fragment=JSON.parse(JSON.stringify({provider:'META',...event,receivedAt:event.receivedAt.toISOString()}));
   assert.equal(await reader.persistInbound(event,'META',fragment,raw),true);
  }
  const native=(await reader.detail('existing','INSTAGRAM')).messages;assert.equal(native.length,5);
  phase='INTAKE';
  const job=await intake.create({source:'KEYCRM',account:normalized[0].account,channel:'INSTAGRAM'},password,owner),pair=await intake.pair(job.jobId,password,owner);
  for(let start=0;start<data.messages.length;start+=50){
   const payloadJson=JSON.stringify({version:1,source:'KEYCRM',messages:data.messages.slice(start,start+50),completeness:{status:'PARTIAL'}});
   await intake.stage(job.jobId,`Bearer ${pair.token}`,{batchId:randomUUID(),payloadJson,checksum:sha(payloadJson)});
  }
  for(const dialogueId of new Set(normalized.map(row=>row.dialogueId)))await planning.bind(job.jobId,{mode:'EXISTING',clientId:'existing',dialogueId},password,owner);
  phase='SERVER_PROPOSAL';
  // data.approval is deliberately unused. Both preview and prepare derive all
  // equivalences from immutable staged records and canonical targets server-side.
  const preview=await actions.preview(job.jobId,owner);assert.equal(preview.equivalenceCount,95);assert.equal(preview.preview.discovered,308);
  assert.equal(preview.preview.newCandidates,213);assert.equal(preview.preview.review,0);assert.equal(preview.preview.conflicts,0);assert.equal(preview.preview.blockers.length,0);
  assert.equal(preview.preview.sourceCompleteness,'UNVERIFIED');
  phase='PREPARE';
  const prepared=await actions.prepare(job.jobId,password,owner);assert.equal(prepared.equivalenceCount,95);assert.equal(prepared.previewDigest,preview.previewDigest);
  const {preview:counts,...context}=await core.preparedContext(job.jobId);assert.equal(counts.newCandidates,213);
  const id=randomUUID(),now=Date.now();
  grants.set(id,{...context,version:1,purpose:'OPERATIONAL_NATIVE_BACKUP_GRANT_V1',grantId:id,backupId:'synthetic-backup',captureStartedAt:new Date(now-60000).toISOString(),manifestSha256:'c'.repeat(64),sha256sumsSha256:'d'.repeat(64),archiveSha256:'e'.repeat(64),archiveBytes:'1000',drillJobId:'synthetic-drill',drillReportSha256:'f'.repeat(64),drillFinishedAt:new Date(now-30000).toISOString(),issuedAt:new Date(now-10000).toISOString(),expiresAt:new Date(now+300000).toISOString()});
  await f.db.appSetting.create({data:{section:'history.operational.grant',key:job.jobId,value:{version:1,grantId:id,sourceDigest:context.sourceDigest,previewDigest:context.previewDigest,ciphertextDigest:'b'.repeat(64),expiresAt:new Date(now+300000).toISOString()}}});
  const before=await snapshot();assert.equal((await actions.status(job.jobId,owner)).grantReady,true);
  phase='APPLY';
  const run=await actions.apply(job.jobId,preview.previewDigest,password,owner);assert.equal(run.added,213);assert.equal(run.createdClients,0);assert.equal(run.replayed,false);
  assert.equal(run.productionImport,true,'Execution mode only; this is not operational authorization proof');assert.equal(gateCalls.length,1);
  const applied=await snapshot();assert.equal(applied.HistoryMigrationOrigin.length,308);assert.equal(applied.Message.length-before.Message.length,213);
  const imported=applied.Message.filter(row=>row.metadata?.historyArchive);assert.equal(imported.length,213);assert.ok(imported.every(row=>row.externalId===null));
  for(const table of ['Client','Conversation','Order','OrderItem','Payment','Athlete','MessageAttachment','AiJob','AiJobAttempt','MessageAnalysis'])assert.deepEqual(applied[table],before[table]);
  phase='INBOX';
  const inbox=(await reader.detail('existing','INSTAGRAM')).messages;assert.equal(inbox.length,218);
  assert.equal(inbox.filter(row=>row.metadata?.historyArchive).length,213);
  assert.deepEqual(inbox.filter(row=>!row.metadata?.historyArchive),native);
  const positions=new Map(),seen=new Set();
  for(let i=0;i<inbox.length;i++){
   const row=inbox[i];if(i)assert.ok(inbox[i-1].createdAt.getTime()<=row.createdAt.getTime());
   if(!row.metadata?.historyArchive)continue;
   assert.equal(row.metadata.historyArchive.time.precision,'MINUTE');assert.equal(row.metadata.historyArchive.nativeIdentityVerified,false);
   for(const variant of row.metadata.historyArchive.sourceVariants){
    const scope=JSON.stringify([row.createdAt.toISOString(),JSON.parse(variant.sourceKey).slice(0,4)]),last=positions.get(scope);
    if(last!==undefined)assert.ok(variant.ordinal>=last,'Actual Inbox must preserve retained source precedence');
    positions.set(scope,variant.ordinal);assert.ok(!seen.has(variant.sourceKey));seen.add(variant.sourceKey);
   }
  }
  assert.equal(seen.size,308);assert.ok(keys.every(key=>seen.has(key)));
  phase='REPLAY';
  const replay=await actions.apply(job.jobId,preview.previewDigest,password,owner);assert.equal(replay.added,0);assert.equal(replay.replayed,true);assert.equal(gateCalls.length,1);
  assert.deepEqual(await snapshot(),applied);
  phase='ROLLBACK';
  await actions.rollback(job.jobId,run.runId,password,owner);
  const rolled=await snapshot();assert.equal(rolled.Message.length,applied.Message.length);assert.equal(rolled.HistoryMigrationOrigin.length,308);
  const {isSoftDeletedMessage}=load('communications/message-deletion.ts');assert.equal(rolled.Message.filter(row=>row.metadata?.historyArchive&&isSoftDeletedMessage(row.metadata)).length,213);
  assert.deepEqual((await reader.detail('existing','INSTAGRAM')).messages,native);
  for(const table of ['Client','Conversation','Order','OrderItem','Payment','Athlete','MessageAttachment','AiJob','AiJobAttempt','MessageAnalysis','HistoryMigrationNativeWindow'])assert.deepEqual(rolled[table],applied[table]);
  assert.equal((await actions.rollback(job.jobId,run.runId,password,owner)).replayed,true);assert.deepEqual(await snapshot(),rolled);
  let refused=false;try{await actions.apply(job.jobId,preview.previewDigest,password,owner);}catch{refused=true;}assert.ok(refused);assert.deepEqual(await snapshot(),rolled);
  phase='SOURCE_UNCHANGED';
  assert.equal(sha(data.messages),immutableMessages);assert.equal(sha(await readFile(join(copyFolder,'checkpoint.bin'))),inputSha);
  assert.equal(sha(await readFile(inputFile)),inputSha);assert.deepEqual((await readdir(inputFolder)).sort(),inputEntries);
  if(pointer)assert.equal(sha(await readFile(pointer)),pointerSha);
  t.diagnostic(JSON.stringify({readyRecords:308,deferredKeys:41,serverPairs:95,added:213,origins:308,nativePreserved:5,inbox:218,replayAdded:0,rollbackHidden:213,sourceCompleteness:'UNVERIFIED',syntheticAuthAndBackupGates:true,operationalAcceptance:false,productionWrites:0}));
 }catch{
  // Assertions may contain raw message arrays. Never attach the original error,
  // cause, actual/expected values or a source-derived label to test output.
  throw Error('Owned operational archive rehearsal failed at '+phase+'; source content and underlying error omitted');
 }finally{
  let cleanupFailed=false;
  try{if(f)await f.close();}catch{cleanupFailed=true;}
  try{if(copyStore)await copyStore.close();}catch{cleanupFailed=true;}
  try{if(inputFile&&inputSha&&sha(await readFile(inputFile))!==inputSha)cleanupFailed=true;if(pointer&&pointerSha&&sha(await readFile(pointer))!==pointerSha)cleanupFailed=true;}catch{cleanupFailed=true;}
  globalThis.fetch=oldFetch;names.forEach((name,i)=>previous[i]===undefined?delete process.env[name]:process.env[name]=previous[i]);
  if(cleanupFailed)throw Error('Owned operational archive rehearsal cleanup/input-integrity verification failed; details omitted');
 }
});
