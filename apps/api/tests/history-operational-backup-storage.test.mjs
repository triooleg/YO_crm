import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,link,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {loadTargetModule} from './overview-target-loader.mjs';

const {LocalBackupStorage}=loadTargetModule('backups/backup.storage.ts');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const id='operational-source';
async function fixture(run){
 const root=await mkdtemp(join(tmpdir(),'history-operational-storage-'));
 const previous=process.env.BACKUP_STORAGE_PATH;process.env.BACKUP_STORAGE_PATH=root;
 try{await run(new LocalBackupStorage(),root);}
 finally{
  if(previous===undefined)delete process.env.BACKUP_STORAGE_PATH;else process.env.BACKUP_STORAGE_PATH=previous;
  assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.ok(basename(root).startsWith('history-operational-storage-'));
  await rm(root,{recursive:true,force:true});
 }
}
async function artifacts(root){
 const directory=join(root,id);await mkdir(directory);
 const files={'postgres.dump':'synthetic database bytes','uploads.tar.gz':'synthetic upload bytes','inventory.json':'[]','table-counts.json':'{}','table-fingerprints.json':'{}','file-references.json':'{"status":"PASS"}'};
 const manifest={format_version:3,backup_id:id,type:'data',app_version:'synthetic',git_commit:'synthetic',schema_version:'synthetic',database_version:'16',storage_provider:'local',consistency:{verified:true,method:'stopped-writers',services:['api']},files:Object.keys(files)};
 files['manifest.json']=JSON.stringify(manifest);
 const sums=Object.entries(files).map(([name,bytes])=>digest(bytes)+'  '+name).join('\n')+'\n';
 const archive=Buffer.from('synthetic opaque downloadable archive');
 const report={status:'PASS',cleanup:'PASS',project:'yo-recovery-synthetic-storage',outboundDisabled:true,workersStarted:false,measurement:'ISOLATED_DRILL',productionRtoVerified:false,sourceFormat:3,sourceConsistent:true,executionMode:'offline-artifact-isolated',references:{sourceBackupId:id,sourceStoragePath:id,sourceChecksum:digest(files['manifest.json']),sourceManifestChecksum:digest(files['manifest.json']),sourceArtifactChecksum:digest(sums),archiveChecksum:digest(archive)}};
 for(const [name,bytes] of Object.entries({...files,SHA256SUMS:sums,'archive.tar.gz':archive,'drill-report.json':JSON.stringify(report)}))await writeFile(join(directory,name),bytes);
 return {directory,files,manifest,sums,archive,report,expected:{archiveChecksum:digest(archive),archiveBytes:String(archive.length)}};
}

test('operational storage computes exact local artifact hashes for one consistent DATA v3 and its successful isolated drill',async()=>fixture(async(storage,root)=>{
 const data=await artifacts(root),result=await storage.verifyOperationalArtifacts(id,data.expected);
 assert.deepEqual(result,{manifestSha256:digest(data.files['manifest.json']),sha256sumsSha256:digest(data.sums),drillReportSha256:digest(JSON.stringify(data.report)),archiveSha256:digest(data.archive),archiveBytes:String(data.archive.length),type:'data'});
 assert.equal(await readFile(join(data.directory,'archive.tar.gz'),'utf8'),data.archive.toString());
}));

test('complete source integrity is reverified, not inferred from a matching archive receipt',async()=>fixture(async(storage,root)=>{
 const data=await artifacts(root);await writeFile(join(data.directory,'postgres.dump'),'corrupted source bytes');
 await assert.rejects(storage.verifyOperationalArtifacts(id,{...data.expected,verified:true}),/Checksum/);
}));

test('report scope, safe execution and source hashes must all match the actual local bundle',async()=>fixture(async(storage,root)=>{
 const data=await artifacts(root);
 const mutations=[
  ['status','FAILED'],['cleanup','FAILED'],['cleanup',undefined],['outboundDisabled',false],['outboundDisabled','true'],['workersStarted',true],
  ['productionRtoVerified',true],['measurement','PRODUCTION_RESTORE'],['sourceFormat',2],['sourceConsistent',false],['executionMode','production'],
  ['project','yoleotard-crm'],['targetMode','QUARANTINED_VOLATILE'],['postgresStopped',false],['productionRestoreAllowed',true],
 ];
 for(const [key,value] of mutations){
  await writeFile(join(data.directory,'drill-report.json'),JSON.stringify({...data.report,[key]:value}));
  await assert.rejects(storage.verifyOperationalArtifacts(id,data.expected),key);
 }
 for(const key of ['sourceBackupId','sourceStoragePath','sourceChecksum','sourceManifestChecksum','sourceArtifactChecksum','archiveChecksum']){
  await writeFile(join(data.directory,'drill-report.json'),JSON.stringify({...data.report,references:{...data.report.references,[key]:'other-source'}}));
  await assert.rejects(storage.verifyOperationalArtifacts(id,data.expected),key);
 }
}));

test('expected archive metadata is strictly bounded decimal text and never substitutes for actual archive bytes',async()=>fixture(async(storage,root)=>{
 const data=await artifacts(root);
 for(const archiveBytes of ['0','-1','+1','01',' 12','1.0','1e3','Infinity','9'.repeat(21),12,12n,null]){
  await assert.rejects(storage.verifyOperationalArtifacts(id,{...data.expected,archiveBytes}));
 }
 for(const expected of [{...data.expected,archiveChecksum:'0'.repeat(64)},{...data.expected,archiveBytes:String(data.archive.length+1)}])await assert.rejects(storage.verifyOperationalArtifacts(id,expected));
 await writeFile(join(data.directory,'archive.tar.gz'),'different archive');await assert.rejects(storage.verifyOperationalArtifacts(id,data.expected));
}));

test('invalid, duplicate-key and oversized drill reports fail without echoing their private contents',async()=>fixture(async(storage,root)=>{
 const data=await artifacts(root);
 for(const bytes of ['PRIVATE_ARTIFACT_MARKER','{"status":"FAILED","status":"PASS"}',JSON.stringify({...data.report,padding:'x'.repeat(1024*1024)})]){
  await writeFile(join(data.directory,'drill-report.json'),bytes);
  await assert.rejects(storage.verifyOperationalArtifacts(id,data.expected),error=>{assert.ok(!String(error.message).includes('PRIVATE_'));return true;});
 }
}));

test('hardlinked operational reports are unsafe even when all bytes and success labels match',async()=>fixture(async(storage,root)=>{
 const data=await artifacts(root);await link(join(data.directory,'drill-report.json'),join(root,'report-hardlink.json'));
 await assert.rejects(storage.verifyOperationalArtifacts(id,data.expected));
}));

test('source or report changes after initial verification cannot produce an operational artifact receipt',async()=>{
 for(const name of ['postgres.dump','drill-report.json','archive.tar.gz'])await fixture(async(storage,root)=>{
  const data=await artifacts(root),openArchive=storage.openArchive.bind(storage);
  storage.openArchive=async(...args)=>{
   const stream=await openArchive(...args);
   if(name==='archive.tar.gz')await rename(join(data.directory,name),join(root,'replaced-archive'));
   await writeFile(join(data.directory,name),'changed during verification');return stream;
  };
  await assert.rejects(storage.verifyOperationalArtifacts(id,data.expected),name);
 });
});

test('ordinary FULL and v2 verification remains supported but cannot qualify operational DATA v3',async()=>fixture(async(storage,root)=>{
 const data=await artifacts(root);
 for(const variant of ['full','v2']){
  const files=variant==='full'?{...data.files,'application.tar.gz':'synthetic app'}:{'postgres.dump':data.files['postgres.dump'],'uploads.tar.gz':data.files['uploads.tar.gz']};
  const manifest={...data.manifest,type:variant==='full'?'full':'data',format_version:variant==='v2'?2:3,files:Object.keys(files).filter(name=>name!=='manifest.json')};
  files['manifest.json']=JSON.stringify(manifest);
  if(variant==='v2')for(const name of ['inventory.json','table-counts.json','table-fingerprints.json','file-references.json','application.tar.gz'])await rm(join(data.directory,name),{force:true});
  for(const [name,bytes] of Object.entries(files))await writeFile(join(data.directory,name),bytes);
  await writeFile(join(data.directory,'SHA256SUMS'),Object.entries(files).map(([name,bytes])=>digest(bytes)+'  '+name).join('\n')+'\n');
  assert.equal((await storage.verify(id)).manifest.type,manifest.type);
  await assert.rejects(storage.verifyOperationalArtifacts(id,data.expected));
 }
}));

test('legacy DATA remains readable by the ordinary verifier but never qualifies operationally',async()=>fixture(async(storage,root)=>{
 const data=await artifacts(root),manifest='format_version=1\ncompose_project=yoleotard-crm\n';
 for(const name of ['manifest.json','inventory.json','table-counts.json','table-fingerprints.json','file-references.json'])await rm(join(data.directory,name));
 await writeFile(join(data.directory,'manifest.txt'),manifest);
 await writeFile(join(data.directory,'SHA256SUMS'),Object.entries({'postgres.dump':data.files['postgres.dump'],'uploads.tar.gz':data.files['uploads.tar.gz'],'manifest.txt':manifest}).map(([name,bytes])=>digest(bytes)+'  '+name).join('\n')+'\n');
 assert.equal((await storage.verify(id)).manifest.format_version,1);await assert.rejects(storage.verifyOperationalArtifacts(id,data.expected));
}));

test('existing archive byte limits and source quiescence rules cannot be bypassed by caller metadata',async()=>fixture(async(storage,root)=>{
 const data=await artifacts(root),previous=process.env.BACKUP_DOWNLOAD_MAX_BYTES;
 try{process.env.BACKUP_DOWNLOAD_MAX_BYTES=String(data.archive.length-1);await assert.rejects(storage.verifyOperationalArtifacts(id,data.expected));}
 finally{if(previous===undefined)delete process.env.BACKUP_DOWNLOAD_MAX_BYTES;else process.env.BACKUP_DOWNLOAD_MAX_BYTES=previous;}
 for(const consistency of [{verified:true,method:'online-sequential',services:['api']},{verified:true,method:'stopped-writers',services:['postgres']},{verified:true,method:'stopped-writers',services:['api','api']}]){
  const manifest=JSON.stringify({...data.manifest,consistency}),files={...data.files,'manifest.json':manifest};
  await writeFile(join(data.directory,'manifest.json'),manifest);
  await writeFile(join(data.directory,'SHA256SUMS'),Object.entries(files).map(([name,bytes])=>digest(bytes)+'  '+name).join('\n')+'\n');
  assert.equal((await storage.verify(id)).manifest.format_version,3);
  await assert.rejects(storage.verifyOperationalArtifacts(id,{...data.expected,consistent:true}));
 }
}));
