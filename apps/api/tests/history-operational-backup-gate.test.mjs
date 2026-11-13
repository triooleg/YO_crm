import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadTargetModule} from './overview-target-loader.mjs';
const {BackupService}=loadTargetModule('backups/backup.service.ts');
const {encryptSecret}=loadTargetModule('secret-box.ts');
const hash='a'.repeat(64);
test('operational backup gate pins and rechecks a host-issued DATA grant, refusing incomplete or consumed custody',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'yo-history-gate-')),old=process.env.HISTORY_OPERATIONAL_GRANTS_DIR,key=process.env.SETTINGS_ENCRYPTION_KEY;
 process.env.HISTORY_OPERATIONAL_GRANTS_DIR=directory;process.env.SETTINGS_ENCRYPTION_KEY='synthetic-backup-gate-not-a-production-key';
 const now=Date.now(),context={jobId:randomUUID(),actorId:'owner',clientId:'client',sourceDigest:hash,previewDigest:hash,candidateSnapshot:hash,targetIdentity:{cluster:'123',databaseName:'synthetic',databaseOid:1},migrationSetDigest:hash};
 const grant={...context,version:1,purpose:'OPERATIONAL_NATIVE_BACKUP_GRANT_V1',grantId:randomUUID(),backupId:'synthetic-backup',captureStartedAt:new Date(now-3000).toISOString(),manifestSha256:hash,sha256sumsSha256:hash,archiveSha256:hash,archiveBytes:'100',drillJobId:'synthetic-drill',drillReportSha256:hash,drillFinishedAt:new Date(now-2000).toISOString(),issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString()};
 await writeFile(join(directory,grant.grantId+'.grant'),encryptSecret(JSON.stringify(grant)),{mode:0o600});
 let artifactCalls=0,consumed=false,deleting=false;const queries=[];
 const backup={id:grant.backupId,status:'COMPLETED',type:'DATA',storageProvider:'LOCAL',storagePath:grant.backupId,archivedAt:null,metadata:{job:{kind:'BACKUP'}}};
 const db={$executeRaw:async q=>{queries.push(q.join('?'));return 1},$queryRaw:async()=>consumed?[{id:'used'}]:[],backup:{findUnique:async()=>backup,findFirst:async()=>deleting?{id:'alias'}:null}};
 const artifacts={manifestSha256:hash,sha256sumsSha256:hash,archiveSha256:hash,archiveBytes:'100',drillReportSha256:hash,type:'data'};
 const storage={verifyOperationalArtifacts:async()=>{artifactCalls++;return artifacts}},service=new BackupService({},storage);
 try{
  const accepted=await service.verifyOperationalGrant(grant.grantId,context,db);assert.equal(accepted.grant.grantId,grant.grantId);assert.equal(artifactCalls,1);assert.ok(queries.some(q=>q.includes('pg_advisory_xact_lock(hashtext(')));
  consumed=true;await assert.rejects(service.verifyOperationalGrant(grant.grantId,context,db));consumed=false;
  for(const patch of [{status:'FAILED'},{type:'FULL'},{storageProvider:'S3'},{archivedAt:new Date()},{metadata:{job:{kind:'IMPORT_VERIFY'}}},{metadata:{job:{kind:'BACKUP'},retentionClaim:{state:'DELETING'}}}]){
   const saved={...backup};Object.assign(backup,patch);await assert.rejects(service.verifyOperationalGrant(grant.grantId,context,db));Object.assign(backup,saved);
  }
  deleting=true;await assert.rejects(service.verifyOperationalGrant(grant.grantId,context,db));deleting=false;
  artifacts.archiveSha256='b'.repeat(64);await assert.rejects(service.verifyOperationalGrant(grant.grantId,context,db));
 }finally{await rm(directory,{recursive:true,force:true});for(const [name,value]of[['HISTORY_OPERATIONAL_GRANTS_DIR',old],['SETTINGS_ENCRYPTION_KEY',key]])value===undefined?delete process.env[name]:process.env[name]=value}
});
