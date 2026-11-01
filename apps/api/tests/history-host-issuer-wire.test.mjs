import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {loadTargetModule} from './overview-target-loader.mjs';

// Real Node host handler + Python issuer/targeted Agent code. DB, physical
// capture/drill and lease transport are MOCK official boundaries, not PG/Docker
// or disaster-recovery proof. Crypto, file publication and RECORD readback are real.
const {HistoryHostHandler,parseHistoryHostInput}=loadTargetModule('history-migration/history-host-cli.ts');
const {sealHistoryEvidence}=loadTargetModule('history-migration/history-evidence.ts');
const {BackupService}=loadTargetModule('backups/backup.service.ts');
const {BackupRepository}=loadTargetModule('backups/backup.repository.ts');
const {HistoryMigrationRepository}=loadTargetModule('history-migration/history-migration.repository.ts');
const {decryptSecret}=loadTargetModule('secret-box.ts');
const root=fileURLToPath(new URL('../../../',import.meta.url));
const driver=fileURLToPath(new URL('../../../scripts/tests/history_host_wire_driver.py',import.meta.url));
const jobId='11111111-1111-4111-8111-111111111111',sha=c=>c.repeat(64);
const needsRootFixture=process.platform!=='win32'&&process.getuid?.()!==0;
const options={timeout:30000,skip:needsRootFixture?'Requires root-owned POSIX grant fixture':false};

async function rehearsal(scenario){
 const directory=await mkdtemp(join(tmpdir(),'history-host-wire-'));await mkdir(join(directory,'grants'));
 const previousKey=process.env.SETTINGS_ENCRYPTION_KEY,previousDirectory=process.env.HISTORY_OPERATIONAL_GRANTS_DIR,previousFetch=globalThis.fetch;
 process.env.SETTINGS_ENCRYPTION_KEY='synthetic-owned-wire-test-not-production-0123456789';
 process.env.HISTORY_OPERATIONAL_GRANTS_DIR=join(directory,'grants');
 globalThis.fetch=()=>{throw new Error('Network forbidden in owned wire test');};
 let child;
 try{
  const settings=new Map(),rows=new Map(),audits=[],operations=[],claims=[],executions=[],fences=[],hostFailures=[],actorRows=[],transactions=[];
  const actor={id:'wire-owner',role:'OWNER',active:true,archivedAt:null,passwordHash:'synthetic-hash-not-a-credential'};
  const context={jobId,actorId:actor.id,clientId:'wire-existing-client',sourceDigest:sha('a'),previewDigest:sha('b'),
   candidateSnapshot:sha('c'),migrationSetDigest:sha('d'),targetIdentity:{cluster:'1',databaseName:'wire_fixture',databaseOid:1}};
  const now=Date.now();
  const preparation={version:1,approval:{policy:'KEYCRM_SOURCE_ARCHIVE_V1',equivalences:[]},context,
   verifiedPasswordHash:actor.passwordHash,preparedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now-1000+7200000).toISOString()};
  const key=q=>q.where.section_key.section+'|'+q.where.section_key.key;
  settings.set('history.operational.preparation|'+jobId,{version:1,payloadEncrypted:sealHistoryEvidence('OPERATIONAL_PREPARATION',jobId,preparation)});
  const job={id:jobId,status:'STAGING',createdById:actor.id,source:'KEYCRM',account:'synthetic-account',channel:'INSTAGRAM'};
  let nestedFault=false,retentionFault=false;const stack=[];
  // Official Prisma boundary MOCK: distinct transaction overlays commit
  // independently. An outer rollback cannot undo an inner committed request.
  // This is not PostgreSQL locking/connection-pool concurrency proof.
  const prisma={$transaction:async(fn,opts)=>{
   const kind=opts?.isolationLevel==='ReadCommitted'?'backup':'job';
   const trace={kind,parent:stack.at(-1)?.kind??null,committed:false,rolledBack:false};transactions.push(trace);stack.push(trace);
   const pendingSettings=new Map(),pendingRows=new Map(),pendingAudits=[];
   const db={appSetting:{findUnique:async q=>{
    const value=pendingSettings.get(key(q))??settings.get(key(q));return value?{value:structuredClone(value)}:null;
   },upsert:async q=>{pendingSettings.set(key(q),structuredClone(q.create.value));return {value:q.create.value};}},
   user:{findUnique:async q=>{assert.equal(q.where.id,actor.id);return structuredClone(actor);}},
   backup:{findUnique:async q=>structuredClone(pendingRows.get(q.where.id)??rows.get(q.where.id)??null),findFirst:async()=>null,
    create:async q=>{assert.ok(!rows.has(q.data.id)&&!pendingRows.has(q.data.id));
     const row={...structuredClone(q.data),storageProvider:'LOCAL',archivedAt:null,createdAt:new Date()};pendingRows.set(row.id,row);return structuredClone(row);}},
   auditLog:{create:async q=>{pendingAudits.push(structuredClone(q.data));return q.data;}},
   $executeRaw:async(parts,...values)=>{
    const sql=parts.join('?');fences.push({sql,values});
    if(sql.includes('INSERT INTO "AuditLog"'))pendingAudits.push({actorId:values[1],action:values[2],after:JSON.parse(values[4])});
    if(kind==='backup'&&scenario==='retention-race'&&!retentionFault&&values.some(v=>typeof v==='string'&&v.startsWith('backups-source:'))){
     retentionFault=true;const source=rows.get(values.find(v=>typeof v==='string'&&v.startsWith('backups-source:')).slice('backups-source:'.length));
     source.metadata.retentionClaim={state:'DELETING'};
    }
    return 0;
   },
   $queryRaw:async(parts,...values)=>{
    const sql=parts.join('');
    if(sql.includes('FROM "HistoryMigrationJob"')){assert.equal(values[0],jobId);return [structuredClone(job)];}
    if(sql.includes('FROM "User"')){
     assert.equal(values[0],job.createdById);assert.match(sql,/FOR SHARE/);
     const row=Object.fromEntries(['id','role','active','archivedAt','passwordHash'].map(k=>[k,actor[k]]));actorRows.push(Object.keys(row));return [structuredClone(row)];
    }
    assert.match(sql,/HISTORY_OPERATIONAL_BACKUP_GRANT_USED/);return [];
   }};
   try{
    const result=await fn(db);
    if(kind==='job'&&trace.innerCommitted&&scenario==='retry-nested'&&!nestedFault){nestedFault=true;throw new Error('Synthetic outer interruption after independent backup commit');}
    for(const [k,v] of pendingSettings)settings.set(k,v);
    for(const [k,v] of pendingRows){
     rows.set(k,v);
     if(scenario==='backoff')v.metadata.job.nextAttemptAt=new Date(Date.now()+60000).toISOString();
     if(scenario==='completed')complete(k);
    }
    audits.push(...pendingAudits);trace.committed=true;
    if(kind==='backup'&&stack.length>1)stack[stack.length-2].innerCommitted=true;
    return result;
   }catch(error){trace.rolledBack=true;throw error;}finally{assert.equal(stack.pop(),trace);}
  }};
  const repository=new HistoryMigrationRepository(prisma),backups=new BackupRepository(prisma);
  const archiveHash=scenario==='agent-metadata'?createHash('sha256').update('owned-wire-archive').digest('hex'):sha('f');
  const archiveSize=scenario==='agent-metadata'?'18':'123';
  const artifacts={type:'data',manifestSha256:sha('e'),sha256sumsSha256:sha('1'),archiveSha256:archiveHash,archiveBytes:archiveSize,drillReportSha256:sha('2')};
  const storage={verifyOperationalArtifacts:async(id,expected)=>{
   assert.equal(rows.get(id)?.metadata.job.kind,'BACKUP');assert.deepEqual(expected,{archiveChecksum:archiveHash,archiveBytes:archiveSize});return {...artifacts};}};
  const complete=id=>{
   const row=rows.get(id);assert.ok(row);executions.push(id);
   const kind=row.metadata.job.kind;
   if(kind==='DRILL'&&scenario==='execution-failure')throw new Error('Synthetic physical drill failed');
   row.status='COMPLETED';row.completedAt=new Date();row.checksum=sha('e');row.sizeBytes=999n;row.storagePath=id;row.metadata.job.phase='COMPLETED';
   if(kind==='BACKUP')Object.assign(row.metadata,{sourceBackupId:id,archive:{checksum:sha('f'),bytes:'123'},consistencyTrust:'VERIFIED_LOCAL_QUIESCENCE'});
   else{
    const source=row.metadata.job.sourceBackupId;
    row.metadata.drill={status:'PASS',cleanup:scenario==='cleanup-failure'?'FAILED':'PASS',sourceBackupId:source,
     finishedAt:row.completedAt.toISOString(),references:{sourceBackupId:source,sourceStoragePath:source,sourceChecksum:sha('e'),
      sourceManifestChecksum:sha('e'),sourceArtifactChecksum:sha('1'),archiveChecksum:sha('f')}};
   }
  };
  rows.set('unrelated-pending-backup',{id:'unrelated-pending-backup',status:'PENDING',metadata:{job:{kind:'BACKUP',attempts:1}}});
  const actualGrants=new BackupService(backups,storage);
  const handler=new HistoryHostHandler(repository,backups,storage,{preparedContext:async()=>({...context,preview:{discovered:230,blockers:[]}})},actualGrants);
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SystemRoot|SYSTEMROOT|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA)$/i.test(k)));
  child=spawn('python',['-B',driver,directory,jobId,scenario],{cwd:root,env:{...env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['pipe','pipe','pipe']});
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;assert.ok(stderr.length<16384);});
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  const lines=createInterface({input:child.stdout});let done;
  for await(const line of lines){
   assert.ok(Buffer.byteLength(line)<1024*1024);const message=JSON.parse(line);let reply;
   if(message.kind==='done'){done=message;continue;}
   if(message.kind==='host'){
    operations.push(message.input.operation);
    try{
     if(message.input.operation==='RECORD_GRANT'&&scenario==='mount-missing')process.env.HISTORY_OPERATIONAL_GRANTS_DIR=join(directory,'unmounted');
     let result;const SystemDate=globalThis.Date;
     if(message.input.operation==='SEAL_GRANT'){
      const issuedMs=Date.parse(message.input.payload.issuedAt);
      if(scenario==='precision-window'){
       // Python clock supplies .xxx500; freeze Node at the same .xxx000
       // millisecond to verify issuer flooring against the strict future guard.
       globalThis.Date=class extends SystemDate{constructor(...args){super(...(args.length?args:[issuedMs]));}static now(){return issuedMs;}};
      }else{
       // Mock Docker transport includes an async execution boundary. A separate
       // same-ms test below verifies the real sub-ms issuance boundary.
       while(Date.now()<=issuedMs)await new Promise(resolve=>setTimeout(resolve,1));
      }
     }
     try{result=await handler.handle(parseHistoryHostInput(Buffer.from(JSON.stringify(message.input))));}
     finally{globalThis.Date=SystemDate;}
     if(message.input.operation==='VERIFY_EVIDENCE'){
      assert.equal(Object.keys(result.context).length,8);assert.equal(Object.keys(result.evidence).length,9);
      if(scenario==='password-rotation')actor.passwordHash='different-synthetic-hash';
     }
     if(message.input.operation==='PREPARED_CONTEXT'&&scenario==='owner-revoked')actor.active=false;
     reply={code:0,stdout:JSON.stringify({ok:true,result})+'\n'};
    }catch(error){hostFailures.push({operation:message.input.operation,name:error.name,message:error.message});reply={code:1,stdout:''};}
   }else if(message.kind==='claim'){
    const match=/ AND id='([A-Za-z0-9._-]+)'/.exec(message.query);assert.ok(match,'Real agent query must target one exact ID');
    assert.match(message.query,/execution-lease/);assert.match(message.query,/FOR UPDATE SKIP LOCKED/);assert.match(message.query,/nextAttemptAt/);
    const id=match[1];claims.push(id);const row=rows.get(id);assert.ok(row);
    assert.notEqual(id,'unrelated-pending-backup');
    if(row.status==='PENDING'&&!(Date.parse(row.metadata.job.nextAttemptAt)>Date.now())){
     row.status='RUNNING';row.metadata.job.attempts=(row.metadata.job.attempts??0)+1;reply={row};
    }else reply={row:null};
   }else if(message.kind==='source'){
    reply={row:rows.get(message.jobId)};
   }else if(message.kind==='agent-completion'){
    const row=rows.get(message.jobId);assert.equal(row.status,'RUNNING');
    assert.equal(message.payload.phase,'COMPLETED');assert.equal(message.checksum,sha('e'));assert.equal(message.sizeBytes,999);
    Object.assign(row,{status:'COMPLETED',completedAt:new Date(),storagePath:row.id,checksum:message.checksum,sizeBytes:BigInt(message.sizeBytes)});
    Object.assign(row.metadata.job,message.payload);Object.assign(row.metadata,message.metadata);
    executions.push(row.id);reply={id:row.id};
   }else if(message.kind==='execute'){
    try{complete(message.jobId);reply={ok:true};}catch{reply={ok:false};}
   }else if(message.kind==='failed'){
    const row=rows.get(message.jobId);row.status='PENDING';reply={id:row.id};
   }else if(message.kind==='clock'){
    reply={utc:new Date().toISOString()};
   }else assert.fail('Unknown owned driver message');
   child.stdin.write(JSON.stringify(reply,(_,value)=>typeof value==='bigint'?value.toString():value)+'\n');
  }
  const exit=await exited;assert.equal(exit.code,0,stderr);assert.equal(stderr,'');assert.ok(done);
  assert.equal(rows.get('unrelated-pending-backup').status,'PENDING');
  const fileNames=await readdir(join(directory,'grants'));
  const ready=settings.get('history.operational.grant|'+jobId);
  assert.ok(!audits.some(a=>a.action==='HISTORY_OPERATIONAL_BACKUP_GRANT_USED'),'RECORD must not consume the grant');
  if(done.status==='PASS'){
   assert.equal(fileNames.length,1);assert.ok(ready);assert.equal(ready.grantId,done.result.grantId);
   const ciphertext=await readFile(join(directory,'grants',fileNames[0]),'utf8');
   const payload=JSON.parse(decryptSecret(ciphertext));assert.equal(Object.keys(payload).length,22);
   assert.equal(payload.clientId,context.clientId);assert.equal(payload.backupId,claims[0]??payload.backupId);
   assert.ok(fences.some(f=>f.values.includes('backups-source:'+payload.backupId)));
  }
  assert.ok(actorRows.length>0);assert.ok(actorRows.every(keys=>keys.join(',')==='id,role,active,archivedAt,passwordHash'));
  for(const row of rows.values())if(row.id!=='unrelated-pending-backup')assert.equal(row.createdById,job.createdById);
  return {done,operations,claims,executions,fileNames,ready,audits,hostFailures,transactions,actorRows,
   queuedData:[...rows.values()].filter(r=>r.metadata?.job.kind==='BACKUP'&&r.id!=='unrelated-pending-backup').map(r=>r.id),
   queuedDrills:[...rows.values()].filter(r=>r.metadata?.job.kind==='DRILL').map(r=>r.id)};
 }finally{
  child?.stdin.destroy();if(child&&child.exitCode===null)child.kill();
  if(previousKey===undefined)delete process.env.SETTINGS_ENCRYPTION_KEY;else process.env.SETTINGS_ENCRYPTION_KEY=previousKey;
  if(previousDirectory===undefined)delete process.env.HISTORY_OPERATIONAL_GRANTS_DIR;else process.env.HISTORY_OPERATIONAL_GRANTS_DIR=previousDirectory;
  globalThis.fetch=previousFetch;await rm(directory,{recursive:true,force:true});
 }
}

test('owned Node/Python wire: real handler/repositories/crypto/targeted Agent, mock DB/physical/clock boundaries',options,async()=>{
 const result=await rehearsal('success');assert.equal(result.done.status,'PASS',JSON.stringify(result));assert.equal(result.claims.length,2);
 assert.equal(result.done.argv.length,2);assert.equal(result.operations.at(-1),'RECORD_GRANT');
 assert.equal(result.audits.at(-1).action,'HISTORY_OPERATIONAL_GRANT_PUBLISHED');
});
test('completed same-preparation jobs skip the targeted worker without changing wire schemas',options,async()=>{
 const result=await rehearsal('completed');assert.equal(result.done.status,'PASS',JSON.stringify(result));assert.equal(result.claims.length,0);assert.equal(result.done.argv.length,0);
});
for(const scenario of ['lease-denied','backoff','execution-failure','cleanup-failure','password-rotation','owner-revoked','retention-race']){
 test(`owned Node/Python wire refuses ${scenario} without publishing or recording readiness`,options,async()=>{
  const result=await rehearsal(scenario);assert.equal(result.done.status,'REFUSED');assert.deepEqual(result.fileNames,[]);assert.equal(result.ready,undefined);
  assert.ok(!result.operations.includes('RECORD_GRANT'));
  const expectedEnd={'lease-denied':'CAPTURE_STATUS',backoff:'CAPTURE_STATUS','execution-failure':'CAPTURE_STATUS',
   'cleanup-failure':'VERIFY_EVIDENCE','password-rotation':'PREPARED_CONTEXT','owner-revoked':'QUEUE_DATA','retention-race':'QUEUE_DRILL'};
  assert.equal(result.operations.at(-1),expectedEnd[scenario],JSON.stringify(result.hostFailures));
  if(scenario==='retention-race')assert.equal(result.queuedDrills.length,0);
 });
}
test('real repositories retry the same queued ID after nested backup commit and outer job rollback',options,async()=>{
 const result=await rehearsal('retry-nested');assert.equal(result.done.status,'PASS',JSON.stringify(result));
 assert.deepEqual(result.done.attempts.map(a=>a.status),['REFUSED','PASS']);
 assert.equal(result.queuedData.length,1);assert.equal(result.queuedDrills.length,1);
 assert.equal(result.operations.filter(op=>op==='QUEUE_DATA').length,2);
 assert.equal(result.audits.filter(a=>a.action==='BACKUP_REQUESTED').length,1);
 assert.ok(result.transactions.some(t=>t.kind==='backup'&&t.parent==='job'&&t.committed));
 assert.ok(result.transactions.some(t=>t.kind==='job'&&t.innerCommitted&&t.rolledBack));
});
test('Python issuance floors to milliseconds and passes the unchanged same-ms Node future guard',options,async()=>{
 const result=await rehearsal('precision-window');assert.equal(result.done.status,'PASS',JSON.stringify(result));
 assert.equal(result.fileNames.length,1);assert.equal(result.operations.at(-1),'RECORD_GRANT');
});
test('actual Node RECORD readback failure leaves the Python-published grant intact and unconsumed',options,async()=>{
 const result=await rehearsal('mount-missing');assert.equal(result.done.status,'REFUSED');assert.equal(result.fileNames.length,1);assert.equal(result.ready,undefined);
 assert.equal(result.operations.at(-1),'RECORD_GRANT');
});

test('real Agent.execute DATA/drill completion metadata passes real HostCLI verification and grant readback with mock physical boundaries',options,async()=>{
 const result=await rehearsal('agent-metadata');assert.equal(result.done.status,'PASS',JSON.stringify(result));
 assert.equal(result.executions.length,2);assert.equal(result.operations.at(-1),'RECORD_GRANT');
});
