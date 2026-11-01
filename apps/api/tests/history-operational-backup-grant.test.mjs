import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir,symlink,link,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadTargetModule} from './overview-target-loader.mjs';

const previousKey=process.env.SETTINGS_ENCRYPTION_KEY;
process.env.SETTINGS_ENCRYPTION_KEY='synthetic-operational-backup-grant-tests-only';
after(()=>{if(previousKey===undefined)delete process.env.SETTINGS_ENCRYPTION_KEY;else process.env.SETTINGS_ENCRYPTION_KEY=previousKey;});
const {validateOperationalBackupGrant,OperationalBackupGrantReader}=loadTargetModule('backups/backup-operational-grant.ts');
const {encryptSecret}=loadTargetModule('secret-box.ts');
const id='72adefd1-0486-4ef7-b550-a1837019e350';
const now=new Date('2026-11-01T12:00:00.000Z');
// A non-root POSIX test runner cannot manufacture the root-owned host files
// required by the production reader. Do not weaken ownership for test fixtures.
const hostFixture={skip:process.platform!=='win32'&&process.getuid?.()!==0?'Requires root-owned POSIX host fixture':false};
const context={jobId:'0bdbec47-6703-4cfb-82a6-ad8cce42da95',actorId:'owner',clientId:'existing-client',
 sourceDigest:'a'.repeat(64),previewDigest:'b'.repeat(64),candidateSnapshot:'c'.repeat(64),
 targetIdentity:{cluster:'1234567890123456789',databaseName:'crm',databaseOid:16384},migrationSetDigest:'d'.repeat(64)};
const payload=()=>({version:1,purpose:'OPERATIONAL_NATIVE_BACKUP_GRANT_V1',grantId:id,...structuredClone(context),
 backupId:'20261101T110000Z-pilot',captureStartedAt:'2026-11-01T11:00:00.000Z',
 manifestSha256:'e'.repeat(64),sha256sumsSha256:'f'.repeat(64),archiveSha256:'1'.repeat(64),archiveBytes:'461463006',
 drillJobId:'api-drill-synthetic',drillReportSha256:'2'.repeat(64),drillFinishedAt:'2026-11-01T11:10:00.000Z',
 issuedAt:'2026-11-01T11:11:00.000Z',expiresAt:'2026-11-01T13:00:00.000Z'});

test('pure validator accepts one exact server context and capture-bound validity',()=>{
 const input=payload(),result=validateOperationalBackupGrant(input,id,context,now);
 assert.deepEqual(result,input);
 assert.notEqual(result,input,'return a detached validated value');
});

test('rejects purpose, grant ID, extra/missing keys, malformed digests/bytes and every context mismatch',()=>{
 const changes=[['purpose','TARGET'],['grantId',context.jobId],['version',2],['sourceDigest','A'.repeat(64)],
  ['archiveBytes','0'],['archiveBytes','01'],['archiveBytes',461463006],['archiveBytes','18446744073709551616'],
  ['manifestSha256','bad'],['backupId','../archive'],['drillJobId','http://example.test'],['approved',true]];
 for(const [key,value] of changes)assert.throws(()=>validateOperationalBackupGrant({...payload(),[key]:value},id,context,now),key);
 for(const key of Object.keys(payload())){const value=payload();delete value[key];assert.throws(()=>validateOperationalBackupGrant(value,id,context,now),key);}
 for(const key of Object.keys(context)){
  const expected=structuredClone(context);
  expected[key]=key==='targetIdentity'?{...context.targetIdentity,databaseOid:16385}:key.endsWith('Digest')||key==='candidateSnapshot'?'9'.repeat(64):'other';
  assert.throws(()=>validateOperationalBackupGrant(payload(),id,expected,now),key);
 }
 for(const target of [{...context.targetIdentity,extra:true},{...context.targetIdentity,databaseOid:0},{...context.targetIdentity,cluster:'0'}]){
  assert.throws(()=>validateOperationalBackupGrant({...payload(),targetIdentity:target},id,context,now));
 }
 assert.throws(()=>validateOperationalBackupGrant(payload(),'../bad',context,now));
});

test('capture age and expiry have exact boundaries, aware strict dates and no future clock claims',()=>{
 const valid=payload();
 assert.doesNotThrow(()=>validateOperationalBackupGrant(valid,id,context,new Date('2026-11-01T11:11:00Z')));
 assert.doesNotThrow(()=>validateOperationalBackupGrant(valid,id,context,new Date('2026-11-01T12:59:59.999Z')));
 // Capture age 7200 is allowed, but a grant expires at its expiry instant.
 assert.throws(()=>validateOperationalBackupGrant(valid,id,context,new Date('2026-11-01T13:00:00Z')));
 for(const [key,value] of [
  ['captureStartedAt','2026-11-01T09:59:59Z'],['captureStartedAt','2026-11-01T12:00:00.000001Z'],
  ['issuedAt','2026-11-01T12:00:00.000001Z'],['drillFinishedAt','2026-11-01T10:59:59Z'],
  ['issuedAt','2026-11-01T11:09:59Z'],['expiresAt','2026-11-01T13:00:00.000001Z'],
  ['expiresAt','2026-11-01T12:00:00Z'],['expiresAt','2026-11-01T11:11:00Z'],
 ])assert.throws(()=>validateOperationalBackupGrant({...valid,[key]:value},id,context,now),`${key}=${value}`);
 for(const key of ['captureStartedAt','drillFinishedAt','issuedAt','expiresAt']){
  for(const value of [null,0,NaN,Infinity,'2026-11-01','2026-11-01T11:00:00','2026-02-30T11:00:00Z','2026-11-01T25:00:00Z','2026-11-01T11:00:00+25:00']){
   assert.throws(()=>validateOperationalBackupGrant({...valid,[key]:value},id,context,now),key);
  }
 }
 assert.throws(()=>validateOperationalBackupGrant(valid,id,context,new Date(NaN)));
 assert.doesNotThrow(()=>validateOperationalBackupGrant({...valid,captureStartedAt:'2026-11-01T13:00:00+02:00'},id,context,now));
});

test('reader authenticates only a bounded host file and returns its exact ciphertext digest',hostFixture,async()=>{
 const {createHash}=await import('node:crypto');
 const directory=await mkdtemp(join(tmpdir(),'operational-grant-'));
 try{
  const sealed=encryptSecret(JSON.stringify(payload()));
  await writeFile(join(directory,id+'.grant'),sealed,{mode:0o600});
  const result=await new OperationalBackupGrantReader(directory).read(id,context,now);
  assert.deepEqual(result.grant,payload());
  assert.equal(result.digest,createHash('sha256').update(sealed).digest('hex'));
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('reader refuses altered crypto, unsigned JSON, forged purpose/ID/context and duplicate keys',hostFixture,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'operational-grant-'));
 try{
  const reader=new OperationalBackupGrantReader(directory),file=join(directory,id+'.grant');
  const encrypted=encryptSecret(JSON.stringify(payload())),parts=encrypted.split('.');
  parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
  const duplicate=JSON.stringify(payload()).replace('"version":1','"version":1,"version":1');
  const nestedDuplicate=JSON.stringify(payload()).replace('"databaseOid":16384','"databaseOid":16384,"databaseOid":16384');
  for(const content of [JSON.stringify(payload()),parts.join('.'),encrypted+'.extra',encrypted+'\n',
   encryptSecret(duplicate),encryptSecret(nestedDuplicate),
   encryptSecret(JSON.stringify({...payload(),purpose:'PILOT_SNAPSHOT'})),
   encryptSecret(JSON.stringify({...payload(),grantId:context.jobId})),
   encryptSecret(JSON.stringify({...payload(),clientId:'another-client'})),
   encryptSecret(JSON.stringify({...payload(),passed:true})),
   encryptSecret(JSON.stringify({...payload(),captureStartedAt:'2026-11-01T09:00:00Z'})),
   encryptSecret(JSON.stringify({...payload(),issuedAt:'2026-11-01T12:00:01Z'})),
  ]){
   await writeFile(file,content,{mode:0o600});
   await assert.rejects(reader.read(id,context,now),/^Error: OPERATIONAL_BACKUP_GRANT_INVALID$/);
  }
  process.env.SETTINGS_ENCRYPTION_KEY='different-synthetic-key-with-at-least-32-characters';
  const otherKey=encryptSecret(JSON.stringify(payload()));
  process.env.SETTINGS_ENCRYPTION_KEY='synthetic-operational-backup-grant-tests-only';
  await writeFile(file,otherKey,{mode:0o600});
  await assert.rejects(reader.read(id,context,now));
 }finally{process.env.SETTINGS_ENCRYPTION_KEY='synthetic-operational-backup-grant-tests-only';await rm(directory,{recursive:true,force:true});}
});

test('reader never accepts caller paths, missing/empty/oversized files or a directory as a grant',hostFixture,async()=>{
 for(const directory of ['', '.', 'https://example.test/grants','//remote/grants'])assert.throws(()=>new OperationalBackupGrantReader(directory));
 const directory=await mkdtemp(join(tmpdir(),'operational-grant-'));
 try{
  const reader=new OperationalBackupGrantReader(directory),file=join(directory,id+'.grant');
  for(const grantId of ['../outside','file:///etc/passwd',id+'/../other','a'.repeat(1000)])await assert.rejects(reader.read(grantId,context,now));
  await assert.rejects(reader.read(id,context,now));
  for(const content of ['',Buffer.alloc(65537,65)]){
   await writeFile(file,content,{mode:0o600});await assert.rejects(reader.read(id,context,now));
  }
  await rm(file);await mkdir(file);await assert.rejects(reader.read(id,context,now));
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('reader rejects linked roots, linked ancestors, linked grant leaves and hard-linked files',hostFixture,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'operational-grant-links-'));
 try{
  const real=join(directory,'real'),alias=join(directory,'alias');await mkdir(real);
  await writeFile(join(real,id+'.grant'),encryptSecret(JSON.stringify(payload())),{mode:0o600});
  await symlink(real,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(new OperationalBackupGrantReader(alias).read(id,context,now));
  await mkdir(join(real,'child'));
  await assert.rejects(new OperationalBackupGrantReader(join(alias,'child')).read(id,context,now));
  const leaf=join(directory,id+'.grant');
  await symlink(real,leaf,process.platform==='win32'?'junction':'dir');
  await assert.rejects(new OperationalBackupGrantReader(directory).read(id,context,now));
  await rm(leaf,{recursive:true});
  await link(join(real,id+'.grant'),leaf);
  await assert.rejects(new OperationalBackupGrantReader(directory).read(id,context,now));
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('configured root is captured once and schema validation returns detached identity',hostFixture,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'operational-grant-config-'));
 const previous=process.env.HISTORY_OPERATIONAL_GRANTS_DIR;
 try{
  await writeFile(join(directory,id+'.grant'),encryptSecret(JSON.stringify(payload())),{mode:0o600});
  process.env.HISTORY_OPERATIONAL_GRANTS_DIR=directory;const reader=new OperationalBackupGrantReader();
  process.env.HISTORY_OPERATIONAL_GRANTS_DIR='https://example.test/not-a-path';
  const result=await reader.read(id,context,now);assert.deepEqual(result.grant,payload());
  const input=payload(),validated=validateOperationalBackupGrant(input,id,context,now);
  input.targetIdentity.databaseName='changed';assert.equal(validated.targetIdentity.databaseName,'crm');
 }finally{
  if(previous===undefined)delete process.env.HISTORY_OPERATIONAL_GRANTS_DIR;else process.env.HISTORY_OPERATIONAL_GRANTS_DIR=previous;
  await rm(directory,{recursive:true,force:true});
 }
});

if(process.platform!=='win32')test('POSIX group/world writable directory and file cannot establish host-only issuance',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'operational-grant-mode-')),file=join(directory,id+'.grant');
 try{
  await writeFile(file,encryptSecret(JSON.stringify(payload())),{mode:0o600});const reader=new OperationalBackupGrantReader(directory);
  await chmod(file,0o666);await assert.rejects(reader.read(id,context,now));
  await chmod(file,0o600);await chmod(directory,0o777);await assert.rejects(reader.read(id,context,now));
 }finally{await chmod(directory,0o700);await rm(directory,{recursive:true,force:true});}
});
