import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const api=loadTargetModule('history-migration/history-host-cli.ts');
const id='11111111-1111-4111-8111-111111111111';
test('strict host wire accepts fixed operation and rejects duplicate keys, exports and oversized input',()=>{
 assert.deepEqual(api.parseHistoryHostInput(Buffer.from(JSON.stringify({operation:'CAPTURE_STATUS',jobId:id}))),{operation:'CAPTURE_STATUS',jobId:id});
 for(const input of [JSON.stringify({operation:'CAPTURE_STATUS',jobId:id,currentPassword:'private'}),`{"operation":"QUEUE_DATA","jobId":"${id}","jobId":"${id}"}`,JSON.stringify({operation:'QUEUE_DATA',jobId:id,payload:{}}),' '.repeat(65537)]) assert.throws(()=>api.parseHistoryHostInput(Buffer.from(input)));
});
const {sealHistoryEvidence}=loadTargetModule('history-migration/history-evidence.ts');
const {decryptSecret}=loadTargetModule('secret-box.ts');
const {createHash}=await import('node:crypto');
process.env.SETTINGS_ENCRYPTION_KEY='synthetic-test-key-not-production-0123456789';
const sha=char=>char.repeat(64);
function fixture(){
 const now=Date.now(),settings=new Map(),rows=new Map(),requests=[],audits=[];
 const actor={id:'owner',role:'OWNER',active:true,archivedAt:null,passwordHash:'hash'};
 const context={jobId:id,actorId:'owner',clientId:'client',sourceDigest:sha('a'),previewDigest:sha('b'),candidateSnapshot:sha('c'),migrationSetDigest:sha('d'),targetIdentity:{cluster:'1',databaseName:'crm',databaseOid:1}};
 const prep={version:1,approval:{policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[]},context,verifiedPasswordHash:'hash',preparedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now-1000+7200000).toISOString()};
 const sealPrep=()=>settings.set('history.operational.preparation',{version:1,payloadEncrypted:sealHistoryEvidence('OPERATIONAL_PREPARATION',id,prep)}); sealPrep();
 let providerCalls=0;
 const tx={job:{id,status:'STAGING',createdById:actor.id},actor,audit:async(action,after)=>audits.push({action,after}),db:{
  appSetting:{findUnique:async q=>settings.has(q.where.section_key.section)?{value:settings.get(q.where.section_key.section)}:null,upsert:async q=>settings.set(q.where.section_key.section,q.create.value)},
  user:{findUnique:async()=>actor},backup:{findUnique:async q=>rows.get(q.where.id)??null,findFirst:async()=>null},$executeRaw:async()=>0
 }};
 const backups={request:async (jobId,type,user,options={})=>{ requests.push(jobId); if(!rows.has(jobId))rows.set(jobId,{id:jobId,type,createdById:user.id,status:'PENDING',storageProvider:'LOCAL',archivedAt:null,metadata:{job:{kind:options.kind??'BACKUP',phase:'QUEUED',...(options.sourceBackupId?{sourceBackupId:options.sourceBackupId}:{})},...(options.sourceBackupId?{sourceBackupId:options.sourceBackupId}:{})}}); return rows.get(jobId); }};
 const storage={verifyOperationalArtifacts:async (key,expected)=>{assert.deepEqual(expected,{archiveChecksum:sha('f'),archiveBytes:'123'}); return {type:'data',manifestSha256:sha('e'),sha256sumsSha256:sha('1'),archiveSha256:sha('f'),archiveBytes:'123',drillReportSha256:sha('2')};}};
 const operational={preparedContext:async()=>{providerCalls++;return {...context,preview:{discovered:1,blockers:[]}};}};
 const repository={withJob:async(_,fn)=>fn(tx)};
 const grants={verifyOperationalGrant:async()=>{throw new Error('grant missing');}};
 const handler=new api.HistoryHostHandler(repository,backups,storage,operational,grants);
 const run=(operation,payload)=>handler.handle({operation,jobId:id,...(operation==='RECORD_GRANT'?{grantId:id}:payload?{payload}:{})});
 return {run,rows,requests,settings,actor,context,prep,sealPrep,repository,backups,storage,operational,grants,handler,audits,db:tx.db,providerCalls:()=>providerCalls};
}
async function completed(){
 const f=fixture(),data=await f.run('QUEUE_DATA');
 const row=f.rows.get(data.backupId);
 Object.assign(row,{status:'COMPLETED',completedAt:new Date(),storagePath:row.id,checksum:sha('e'),sizeBytes:999n,metadata:{job:{kind:'BACKUP',phase:'COMPLETED'},sourceBackupId:row.id,archive:{checksum:sha('f'),bytes:'123'},consistencyTrust:'VERIFIED_LOCAL_QUIESCENCE'}});
 const queued=await f.run('QUEUE_DRILL'),drill=f.rows.get(queued.drillJobId);
 Object.assign(drill,{status:'COMPLETED',completedAt:new Date(Date.now()+1),checksum:sha('e'),sizeBytes:999n,metadata:{job:{kind:'DRILL',phase:'COMPLETED',sourceBackupId:row.id},sourceBackupId:row.id,drill:{status:'PASS',cleanup:'PASS',sourceBackupId:row.id,finishedAt:new Date().toISOString(),references:{sourceBackupId:row.id,sourceStoragePath:row.id,sourceChecksum:sha('e'),sourceManifestChecksum:sha('e'),sourceArtifactChecksum:sha('1'),archiveChecksum:sha('f')}}}});
 return {...f,data,drill,row};
}
test('queue intent resumes exact IDs; status does not reread provider and context never includes preview',async()=>{
 const f=fixture(),first=await f.run('QUEUE_DATA'),second=await f.run('QUEUE_DATA');
 assert.deepEqual(second,first); assert.equal(f.rows.size,1); assert.equal(Object.keys(first.context).length,8); assert.ok(!('preview' in first.context));
 const calls=f.providerCalls(); assert.deepEqual(await f.run('CAPTURE_STATUS'),{backupId:first.backupId,backupStatus:'PENDING',drillJobId:null,drillStatus:null});assert.equal(f.providerCalls(),calls);
});
test('actual metadata separates manifest checksum from archive checksum when verifying and sealing',async()=>{
 const f=await completed(),verified=await f.run('VERIFY_EVIDENCE');
 assert.equal(verified.evidence.manifestSha256,sha('e')); assert.equal(verified.evidence.archiveSha256,sha('f'));
 const grant={...verified.context,...verified.evidence,version:1,purpose:'OPERATIONAL_NATIVE_BACKUP_GRANT_V1',grantId:'22222222-2222-4222-8222-222222222222',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};
 const sealed=await f.run('SEAL_GRANT',grant);assert.deepEqual(JSON.parse(decryptSecret(sealed.ciphertext)),grant);assert.equal(sealed.digest,createHash('sha256').update(sealed.ciphertext).digest('hex'));
 await assert.rejects(f.run('SEAL_GRANT',{...grant,archiveSha256:sha('3')}));
});
test('all operations reject absent, expired, password-rotated and inactive OWNER preparation',async()=>{
 for(const operation of ['PREPARED_CONTEXT','QUEUE_DATA','QUEUE_DRILL','CAPTURE_STATUS','VERIFY_EVIDENCE','SEAL_GRANT','RECORD_GRANT']){
  for(const mutation of [f=>f.settings.clear(),f=>{f.prep.preparedAt=new Date(Date.now()-7201000).toISOString();f.prep.expiresAt=new Date(Date.parse(f.prep.preparedAt)+7200000).toISOString();f.sealPrep();},f=>f.actor.passwordHash='rotated',f=>f.actor.active=false,f=>f.actor.role='ADMIN']){
   const f=fixture();mutation(f);await assert.rejects(f.run(operation,operation==='SEAL_GRANT'?{}:undefined));assert.equal(f.requests.length,0);
  }
 }
});
test('source context and preparation replacement cannot adopt an older capture',async()=>{
 const f=fixture(); await f.run('QUEUE_DATA');f.prep.context={...f.context,sourceDigest:sha('9')};f.context.sourceDigest=sha('9');f.sealPrep();
 await assert.rejects(f.run('CAPTURE_STATUS'));
 const fresh=await f.run('QUEUE_DATA');assert.equal(f.rows.size,2);assert.equal(fresh.context.sourceDigest,sha('9'));
 assert.notEqual(fresh.backupId,[...f.rows.keys()][0]);
});
test('drill requires own completed LOCAL DATA and resumes only its exact source job',async()=>{
 const f=fixture(),data=await f.run('QUEUE_DATA');await assert.rejects(f.run('QUEUE_DRILL'));
 const g=await completed();const first=await g.run('QUEUE_DRILL');assert.equal(first.drillJobId,g.drill.id);
 for(const change of [{createdById:'other'},{storageProvider:'S3'},{type:'FULL'},{archivedAt:new Date()},{status:'FAILED'}]){
  const good={...g.row};Object.assign(g.row,change);await assert.rejects(g.run('QUEUE_DRILL'));Object.assign(g.row,good);
 }
});
test('verification refuses failed cleanup, wrong report references, ownership or drill source',async()=>{
 for(const mutate of [f=>f.drill.metadata.drill.cleanup='FAILED',f=>f.drill.metadata.drill.references.sourceStoragePath='another',f=>f.drill.metadata.job.sourceBackupId='another',f=>f.drill.createdById='another',f=>f.drill.status='FAILED',f=>f.row.metadata.sourceBackupId='another',f=>f.row.metadata.retentionClaim={state:'DELETING'},f=>f.drill.metadata.drill.finishedAt=new Date(Date.now()+60000).toISOString()]){
  const f=await completed();mutate(f);await assert.rejects(f.run('VERIFY_EVIDENCE'));
 }
});
test('capture purpose/key binding rejects swapped ciphertext and status exports only four safe fields',async()=>{
 const f=fixture();await f.run('QUEUE_DATA');
 const wrapper=f.settings.get('history.operational.capture');
 const {openHistoryEvidence}=loadTargetModule('history-migration/history-evidence.ts');
 const capture=openHistoryEvidence('OPERATIONAL_CAPTURE',id,wrapper.payloadEncrypted);
 wrapper.payloadEncrypted=sealHistoryEvidence('OPERATIONAL_CAPTURE','other-job',capture);await assert.rejects(f.run('CAPTURE_STATUS'));
});
test('wire rejects malformed UTF8, extra payload fields, unknown operations, trailing JSON and invalid UUID',()=>{
 for(const bytes of [Buffer.from([0xff]),Buffer.from('{} {}'),Buffer.from(JSON.stringify({operation:'IMPORT',jobId:id})),Buffer.from(JSON.stringify({operation:'CAPTURE_STATUS',jobId:'../job'})),Buffer.from(JSON.stringify({operation:'SEAL_GRANT',jobId:id,payload:{},databaseUrl:'postgres://private'}))])assert.throws(()=>api.parseHistoryHostInput(bytes));
});
test('executable guard fails with one generic stderr line before bootstrap on non-root/disabled hosts',async()=>{
 const {readFileSync}=await import('node:fs'),{createRequire}=await import('node:module'),vm=await import('node:vm');
 const ts=(await import('typescript')).default,realRequire=createRequire(import.meta.url);
 const source=ts.transpileModule(readFileSync(new URL('../src/history-migration/history-host-cli.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 for(const gate of [{platform:'win32',uid:0,enabled:'true'},{platform:'linux',uid:1000,enabled:'true'},{platform:'linux',uid:0,enabled:'false'}]){
  let stdout='',stderr='',bootstraps=0; const module={exports:{}};
  const fakeRequire=name=>{
   if(name==='../prisma.service'){bootstraps++;throw new Error('private database credential');}
   if(name.startsWith('.'))return loadTargetModule(new URL(name+'.ts',new URL('../src/history-migration/history-host-cli.ts',import.meta.url)).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
   return realRequire(name);
  };fakeRequire.main=module;
  const process={platform:gate.platform,getuid:()=>gate.uid,env:{HISTORY_OPERATIONAL_HOST_ENABLED:gate.enabled},argv:['node','cli'],stdout:{write:x=>stdout+=x},stderr:{write:x=>stderr+=x}};
  vm.runInNewContext(`(function(require,module,exports,process,Buffer){${source}\n})`,{})(fakeRequire,module,module.exports,process,Buffer);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(process.exitCode,1);assert.equal(stdout,'');assert.equal(stderr,'HISTORY_HOST_OPERATION_FAILED\n');assert.equal(bootstraps,0);
 }
});

test('manual bootstrap emits exactly one success JSON, bounds stdin and redacts private bootstrap failures',async()=>{
 const {readFileSync}=await import('node:fs'),{createRequire}=await import('node:module'),vm=await import('node:vm');
 const ts=(await import('typescript')).default,realRequire=createRequire(import.meta.url);
 const source=ts.transpileModule(readFileSync(new URL('../src/history-migration/history-host-cli.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 for(const mode of ['success','private-failure','disconnect-failure','oversized','duplicate']){
  const f=fixture();let stdout='',stderr='',connections=0,disconnections=0;const module={exports:{}};
  const mocks={
   '../prisma.service':{PrismaService:class {async $connect(){connections++;if(mode==='private-failure')throw new Error('PRIVATE_PASSWORD_AND_MESSAGE');}async $disconnect(){disconnections++;if(mode==='disconnect-failure')throw new Error('PRIVATE_DISCONNECT');}}},
   './history-migration.repository':{HistoryMigrationRepository:class {constructor(){return f.repository;}}},
   '../backups/backup.repository':{BackupRepository:class {constructor(){return f.backups;}}},
   '../backups/backup.storage':{LocalBackupStorage:class {constructor(){return f.storage;}}},
   '../backups/backup.service':{BackupService:class {}},
   './history-operational.service':{HistoryOperationalService:class {constructor(){return f.operational;}}}
  };
  const fakeRequire=name=>{
   if(mocks[name])return mocks[name];
   if(name.startsWith('.'))return loadTargetModule(new URL(name+'.ts',new URL('../src/history-migration/history-host-cli.ts',import.meta.url)).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
   return realRequire(name);
  };fakeRequire.main=module;
  const input=mode==='oversized'?' '.repeat(65537):mode==='duplicate'?`{"operation":"PREPARED_CONTEXT","jobId":"${id}","jobId":"${id}"}`:JSON.stringify({operation:'PREPARED_CONTEXT',jobId:id});
  const process={platform:'linux',getuid:()=>0,env:{HISTORY_OPERATIONAL_HOST_ENABLED:'true'},argv:['node','cli'],stdin:(async function*(){yield Buffer.from(input);})(),stdout:{write:x=>stdout+=x},stderr:{write:x=>stderr+=x}};
  vm.runInNewContext(`(function(require,module,exports,process,Buffer){${source}\n})`,{})(fakeRequire,module,module.exports,process,Buffer);
  for(let step=0;step<10;step++)await new Promise(resolve=>setImmediate(resolve));
  if(mode==='success'){
   assert.equal(stderr,'');const response=JSON.parse(stdout);assert.deepEqual(Object.keys(response),['ok','result']);assert.equal(response.ok,true);assert.deepEqual(response.result.context,f.context);assert.equal(stdout.trim().split('\n').length,1);assert.equal(disconnections,1);
  }else{assert.equal(stdout,'');assert.equal(stderr,'HISTORY_HOST_OPERATION_FAILED\n');assert.equal(process.exitCode,1);assert.equal(connections,['private-failure','disconnect-failure'].includes(mode)?1:0);}
 }
});


test('RECORD_GRANT verifies the published file in the locked current context before saving sanitized readiness',async()=>{
 const f=fixture(),grantId='33333333-3333-4333-8333-333333333333';
 let checked=0;f.grants.verifyOperationalGrant=async(received,context,db)=>{assert.equal(received,grantId);assert.deepEqual(context,f.context);assert.equal(db,f.db);checked++;return {digest:sha('7'),grant:{expiresAt:'2026-11-01T01:00:00.000Z'}};};
 const result=await f.handler.handle({operation:'RECORD_GRANT',jobId:id,grantId});
 assert.deepEqual(result,{grantId,expiresAt:'2026-11-01T01:00:00.000Z'});assert.equal(checked,1);
 assert.deepEqual(f.settings.get('history.operational.grant'),{version:1,grantId,previewDigest:f.context.previewDigest,sourceDigest:f.context.sourceDigest,ciphertextDigest:sha('7'),expiresAt:result.expiresAt});
 assert.equal(f.audits.at(-1).action,'HISTORY_OPERATIONAL_GRANT_PUBLISHED');
 assert.ok(!JSON.stringify(f.settings.get('history.operational.grant')).includes('ciphertext"'));
 f.grants.verifyOperationalGrant=async()=>{throw new Error('unreadable readonly mount PRIVATE');};
 f.settings.delete('history.operational.grant');await assert.rejects(f.handler.handle({operation:'RECORD_GRANT',jobId:id,grantId}));assert.ok(!f.settings.has('history.operational.grant'));
});




test('queue interruption retains sealed intent and retry queues the original ID',async()=>{
 const f=fixture(),request=f.backups.request;let attempted;
 f.backups.request=async jobId=>{attempted=jobId;throw new Error('synthetic interruption');};
 await assert.rejects(f.run('QUEUE_DATA'));assert.ok(f.settings.has('history.operational.capture'));assert.equal(f.rows.size,0);
 f.backups.request=request;const resumed=await f.run('QUEUE_DATA');assert.equal(resumed.backupId,attempted);assert.equal(f.rows.size,1);
});
test('RECORD_GRANT wire admits only UUID grantId and never payload or caller targets',()=>{
 assert.deepEqual(api.parseHistoryHostInput(Buffer.from(JSON.stringify({operation:'RECORD_GRANT',jobId:id,grantId:id}))),{operation:'RECORD_GRANT',jobId:id,grantId:id});
 for(const input of [{operation:'RECORD_GRANT',jobId:id},{operation:'RECORD_GRANT',jobId:id,grantId:'../grant'},{operation:'RECORD_GRANT',jobId:id,grantId:id,payload:{}},{operation:'QUEUE_DATA',jobId:id,grantId:id}])assert.throws(()=>api.parseHistoryHostInput(Buffer.from(JSON.stringify(input))));
});
