import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
const require = createRequire(import.meta.url);
require('reflect-metadata');
const ts = require('typescript'), cache = new Map();
class PrismaToken {}
class AuthToken {}
class OrdersToken {}
function load(file) {
  const filename = resolve(dirname(fileURLToPath(import.meta.url)), file);
  if (filename.endsWith('prisma.service.ts')) return { PrismaService: PrismaToken };
  if (filename.endsWith('auth.service.ts')) return { AuthService: AuthToken };
  if (filename.endsWith('orders.service.ts')) return { OrdersService: OrdersToken };
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true,
  } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    const local = resolve(dirname(filename), name + '.ts');
    return name.startsWith('.') && existsSync(local) ? load(local) : require(name);
  }, module, module.exports);
  return module.exports;
}
test('workstation settings default to manual, do not export other settings or write a Windows directory', async () => {
  const { ComputerTransferStore } = load('../src/backups/computer-transfer.store.ts');
  const store = new ComputerTransferStore({ appSetting: { findUnique: async ({where}) => {
    assert.deepEqual(where.section_key, {section: 'backups', key: 'computer-transfer'});
    return null;
  } } });
  assert.deepEqual(await store.config(), { mode: 'MANUAL', folder: 'D:\\YO_CRM_Backups', intervalMinutes: 30 });
});

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function matches(row, where = {}) {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') return condition.every(branch => matches(row, branch));
    if (key === 'OR') return condition.some(branch => matches(row, branch));
    if (key === 'NOT') return !matches(row, condition);
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('path' in condition) {
        const actual = condition.path.reduce((v, part) => v?.[part], row[key]);
        const { Prisma } = require('@prisma/client');
        if ('equals' in condition) return condition.equals === Prisma.AnyNull ? actual == null : actual === condition.equals;
        if ('not' in condition) return actual != null && actual !== condition.not;
      }
      if ('gt' in condition) return row[key] > condition.gt;
    }
    return row[key]?.valueOf() === condition?.valueOf();
  });
}
async function httpFixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'yocrm-computer-'));
  const prior = process.env.BACKUP_STORAGE_PATH; process.env.BACKUP_STORAGE_PATH = root;
  let app;
  try {
    const password = 'synthetic-computer-password';
    const passwordHash = await require('argon2').hash(password);
    const users = Object.fromEntries(['OWNER', 'ADMIN', 'MANAGER'].map(role => [role, { id: role, role, active: true, archivedAt: null, passwordHash }]));
    const settings = new Map(), audits = [], backups = [];
    let transactionTail = Promise.resolve(), failAudit = false, onArchiveList, onDownloadAuthorized;
    const db = {
      user: { findUnique: async ({where}) => users[where.id] ?? null },
      appSetting: {
        findUnique: async ({where}) => { const value = settings.get(where.section_key.key); return value === undefined ? null : {value: structuredClone(value)}; },
        upsert: async ({where, create, update}) => { const value = settings.has(where.section_key.key) ? update.value : create.value; settings.set(where.section_key.key, structuredClone(value)); return {value}; },
      },
      backup: {
        findMany: async ({where, take, select}) => { const rows=backups.filter(row => matches(row, where)).sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(0,take).map(row => select ? Object.fromEntries(Object.keys(select).map(k => [k, row[k]])) : row); onArchiveList?.(); return rows; },
        findFirst: async ({where}) => backups.find(row => matches(row, where)) ?? null,
        findUniqueOrThrow: async ({where}) => backups.find(row => row.id === where.id),
        update: async ({where,data}) => Object.assign(backups.find(row => row.id === where.id), data),
      },
      auditLog: { create: async ({data}) => { if (failAudit) throw new Error('audit unavailable'); audits.push(structuredClone(data)); if(data.action==='BACKUP_DOWNLOAD_AUTHORIZED') onDownloadAuthorized?.(); return data; } },
      $executeRaw: async () => 0, $queryRaw: async () => [],
      $transaction: async fn => {
        const previous = transactionTail; let release; transactionTail = new Promise(r => { release = r; }); await previous;
        const before = structuredClone(settings), auditCount = audits.length;
        try { return await fn(db); }
        catch (error) { settings.clear(); for (const [k,v] of before) settings.set(k,v); audits.splice(auditCount); throw error; }
        finally { release(); }
      },
    };
    async function archive(id = 'transfer-archive-001', options = {}) {
      const dir = join(root,id); await mkdir(dir);
      const files = {'postgres.dump': 'synthetic data', 'uploads.tar.gz': 'synthetic uploads'};
      files['manifest.json'] = JSON.stringify({format_version:2,backup_id:id,type:'data',app_version:'test',git_commit:'test',schema_version:'test',database_version:'test',storage_provider:'local',files:Object.keys(files)});
      for (const [name,bytes] of Object.entries(files)) await writeFile(join(dir,name),bytes);
      const sums = Object.entries(files).map(([name,bytes]) => `${digest(bytes)}  ${name}\n`).join('');
      await writeFile(join(dir,'SHA256SUMS'),sums);
      const bytes = gzipSync(Buffer.from(`synthetic portable bytes for ${id}`));
      await writeFile(join(dir,'archive.tar.gz'),bytes);
      const row = {id,type:'DATA',status:'COMPLETED',storageProvider:'LOCAL',createdAt:new Date('2026-10-26T10:00:00.000Z'),completedAt:new Date('2026-10-26T10:01:00.000Z'),archivedAt:null,checksum:digest(files['manifest.json']),sizeBytes:BigInt(Buffer.byteLength(sums)+Object.values(files).reduce((n,s) => n+Buffer.byteLength(s),0)),metadata:{job:{kind:'BACKUP'},archive:{file:'archive.tar.gz',checksum:digest(bytes),bytes:String(bytes.length)}},...options};
      backups.push(row); return {row,bytes,dir};
    }
    const { Module, UnauthorizedException, ValidationPipe } = require('@nestjs/common');
    const { NestFactory } = require('@nestjs/core');
    const { ComputerTransferController, BackupSyncController } = load('../src/backups/computer-transfer.controller.ts');
    const { ComputerTransferService } = load('../src/backups/computer-transfer.service.ts');
    const { ComputerTransferStore } = load('../src/backups/computer-transfer.store.ts');
    const { BackupSyncGuard } = load('../src/backups/backup-sync.guard.ts');
    const { BackupRepository } = load('../src/backups/backup.repository.ts');
    const { BackupService } = load('../src/backups/backup.service.ts');
    const { LocalBackupStorage } = load('../src/backups/backup.storage.ts');
    const { BackupsController } = load('../src/backups/backups.controller.ts');
    const { AuthController } = load('../src/auth/auth.controller.ts');
    const { OrdersController } = load('../src/orders/orders.controller.ts');
    const { RestoreService } = load('../src/backups/restore.service.ts');
    const { SessionGuard } = load('../src/auth/session.guard.ts');
    const { RolesGuard } = load('../src/auth/roles.guard.ts');
    const backupService = new BackupService(new BackupRepository(db),new LocalBackupStorage());
    const store = new ComputerTransferStore(db), service = new ComputerTransferService(store,backupService);
    class Fixture {}
    Module({controllers:[ComputerTransferController,BackupSyncController,BackupsController,AuthController,OrdersController],providers:[SessionGuard,RolesGuard,BackupSyncGuard,
      {provide:AuthToken,useValue:{userForToken:async token => { if (!users[token]) throw new UnauthorizedException(); return users[token]; },publicUser:user=>({id:user.id,role:user.role})}},
      {provide:OrdersToken,useValue:{list:async()=>[],addPayment:()=>{throw new Error('must not reach payment service');}}},
      {provide:ComputerTransferService,useValue:service}, {provide:BackupService,useValue:backupService}, {provide:RestoreService,useValue:new RestoreService({},backupService)},
    ]})(Fixture);
    app = await NestFactory.create(Fixture,{logger:false}); app.use(require('cookie-parser')()); app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));
    await app.listen(0,'127.0.0.1'); const url = await app.getUrl();
    const request = (path, {role,token,body,method='GET',headers={}} = {}) => fetch(url+'/api'+path,{method,headers:{...(role?{Cookie:`yoleotard_crm_session=${role}`} : {}),...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
    const pair = async (role='OWNER') => {const response=await request('/admin/backups/computers',{role,method:'POST',body:{name:'Рабочий компьютер',currentPassword:password}}); assert.equal(response.status,201,await response.clone().text()); return response.json();};
    await fn({request,pair,password,settings,audits,users,archive,backups,service,db,setFailAudit:value=>{failAudit=value;},setOnArchiveList:fn=>{onArchiveList=fn;},setOnDownloadAuthorized:fn=>{onDownloadAuthorized=fn;}});
  } finally {if(app) await app.close(); if(prior===undefined) delete process.env.BACKUP_STORAGE_PATH; else process.env.BACKUP_STORAGE_PATH=prior; await rm(root,{recursive:true,force:true});}
}
test('computer management requires staff session and fresh password, issues a secret once and audits no secrets', async () => httpFixture(async ({request,pair,password,settings,audits}) => {
  const path='/admin/backups/computer-transfer';
  assert.equal((await request(path)).status,401);
  assert.equal((await request(path,{role:'MANAGER'})).status,403);
  assert.deepEqual(await (await request(path,{role:'ADMIN'})).json(),{mode:'MANUAL',folder:'D:\\YO_CRM_Backups',intervalMinutes:30});
  const config={mode:'AUTOMATIC',folder:'D:\\YO_CRM_Backups',intervalMinutes:30};
  assert.equal((await request(path,{role:'OWNER',method:'PUT',body:config})).status,400);
  assert.equal((await request(path,{role:'OWNER',method:'PUT',body:{...config,currentPassword:'wrong'}})).status,401);
  assert.equal(settings.size,0);
  assert.equal((await request(path,{role:'ADMIN',method:'PUT',body:{...config,currentPassword:password}})).status,200);
  assert.deepEqual(settings.get('computer-transfer'),config);
  const device=await pair(); assert.match(device.token,/^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(Object.keys(device).sort(),['expiresAt','id','token']);
  assert.ok(Date.parse(device.expiresAt)>Date.now()); assert.ok(Date.parse(device.expiresAt)<=Date.now()+90*86400000);
  const stored=JSON.stringify([...settings]); assert.ok(!stored.includes(device.token)); assert.ok(!stored.includes(password)); assert.ok(stored.includes(digest(device.token)));
  const listed=await (await request('/admin/backups/computers',{role:'OWNER'})).json(); assert.equal(listed.length,1); assert.equal(listed[0].id,device.id);
  assert.ok(!JSON.stringify(listed).includes(digest(device.token))); assert.ok(!JSON.stringify(listed).includes(device.token));
  assert.ok(audits.some(row=>row.action==='BACKUP_COMPUTER_PAIRED')); assert.ok(audits.some(row=>row.action==='BACKUP_COMPUTER_TRANSFER_UPDATED'));
  assert.ok(!JSON.stringify(audits).includes(password)); assert.ok(!JSON.stringify(audits).includes(device.token)); assert.ok(!JSON.stringify(audits).includes(digest(device.token)));
}));
test('paired tokens are header-only, manual mode is quiet, and revocation or issuer changes deny every request', async t => httpFixture(async ({request,pair,password,settings,users,audits}) => {
  const device=await pair(), path='/backup-sync/archives';
  await t.test('no session cookie or query token substitutes for Bearer header',async()=>{
    for (const options of [{},{role:'OWNER'},{headers:{Authorization:`bearer ${device.token}`}},{headers:{Authorization:`Bearer  ${device.token}`}}]) assert.equal((await request(path,options)).status,401);
    assert.equal((await request(path+'?token='+device.token)).status,401);
    assert.equal((await request(path,{token:'x'.repeat(43)})).status,401);
  });
  await t.test('manual mode returns an empty page and denies download',async()=>{
    const response=await request(path,{token:device.token}); assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{mode:'MANUAL',folder:'D:\\YO_CRM_Backups',intervalMinutes:30,paired:true,archives:[],nextCursor:null});
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal((await request(path+'/transfer-archive-001/download',{token:device.token})).status,403);
  });
  await t.test('automatic mode does not grant sessions or mutations',async()=>{
    settings.set('computer-transfer',{mode:'AUTOMATIC',folder:'D:\\YO_CRM_Backups',intervalMinutes:30});
    for(const route of ['/admin/backups/computer-transfer','/admin/backups/computers','/admin/backups','/auth/me','/orders']) assert.equal((await request(route,{token:device.token})).status,401);
    assert.equal((await request('/orders',{role:'OWNER'})).status,200);
    assert.equal((await request('/auth/me',{role:'OWNER'})).status,200);
    assert.equal((await request('/orders/synthetic/payments',{token:device.token,method:'POST',body:{amountMinor:100,currency:'EUR'}})).status,401);
    assert.equal((await request('/admin/backups',{token:device.token,method:'POST',body:{type:'FULL'}})).status,401);
    assert.equal((await request(path,{token:device.token,method:'POST',body:{}})).status,404);
  });
  await t.test('issuer role, active state, archive, deletion and token expiry are read on every request',async()=>{
    const before={...users.OWNER};
    for(const change of [{role:'MANAGER'},{active:false},{archivedAt:new Date()}]) {
      Object.assign(users.OWNER,change); assert.equal((await request(path,{token:device.token})).status,401); assert.equal((await request(path+'/transfer-archive-001/download',{token:device.token})).status,401); Object.assign(users.OWNER,before);
    }
    delete users.OWNER; assert.equal((await request(path,{token:device.token})).status,401); users.OWNER=before;
    const registry=settings.get('computer-devices'), saved=registry.devices[0].expiresAt;
    registry.devices[0].createdAt=new Date(Date.now()-2*86400000).toISOString(); registry.devices[0].expiresAt=new Date(Date.now()-86400000).toISOString();
    assert.equal((await request(path,{token:device.token})).status,401); registry.devices[0].expiresAt=saved; registry.devices[0].createdAt=new Date().toISOString();
  });
  await t.test('fresh password revokes persistently without deleting the device or exposing token',async()=>{
    const route='/admin/backups/computers/'+device.id+'/revoke';
    assert.equal((await request(route,{role:'ADMIN',method:'POST',body:{currentPassword:'wrong'}})).status,401);
    assert.equal((await request(path,{token:device.token})).status,200);
    assert.equal((await request(route,{role:'ADMIN',method:'POST',body:{currentPassword:password}})).status,201);
    assert.equal((await request(path,{token:device.token})).status,401);
    assert.equal((await request(path+'/transfer-archive-001/download',{token:device.token})).status,401);
    assert.equal(settings.get('computer-devices').devices.length,1); assert.equal(settings.get('computer-devices').devices[0].revoked,true);
    assert.ok(audits.some(event=>event.action==='BACKUP_COMPUTER_REVOKED' && event.after.deviceId===device.id));
  });
}));
test('lastSeen is recorded only for valid Bearer authentication, including a manual heartbeat; query credentials are rejected', async () => httpFixture(async ({request,pair,settings}) => {
  const device=await pair(), path='/backup-sync/archives';
  assert.equal(settings.get('computer-devices').devices[0].lastSeenAt,undefined);
  assert.equal((await request(path,{token:'x'.repeat(43)})).status,401);
  assert.equal(settings.get('computer-devices').devices[0].lastSeenAt,undefined);
  const response=await request(path,{token:device.token}); assert.equal(response.status,200); assert.equal((await response.json()).paired,true);
  assert.ok(Number.isFinite(Date.parse(settings.get('computer-devices').devices[0].lastSeenAt)));
  for(const query of ['token=','access_token=','Authorization=','bearer=','token%5B%5D=']) {
    for(const route of [path+'?'+query+device.token,path+'/transfer-archive-001/download?'+query+device.token]) assert.equal((await request(route,{token:device.token})).status,401);
  }
}));
test('automatic archive pages have stable createdAt/id cursors, thin metadata and exclude drills and invalid archives', async () => httpFixture(async ({request,pair,settings,archive}) => {
  const device=await pair(); settings.set('computer-transfer',{mode:'AUTOMATIC',folder:'D:\\YO_CRM_Backups',intervalMinutes:30});
  const a=await archive('transfer-archive-001'), b=await archive('transfer-archive-002');
  await archive('transfer-archive-003',{metadata:{job:{kind:'DRILL'},archive:a.row.metadata.archive}});
  await archive('transfer-archive-004',{status:'FAILED'});
  await archive('transfer-archive-005',{metadata:{archive:{file:'archive.tar.gz',checksum:'bad',bytes:'1'}}});
  await archive('transfer-archive-006',{archivedAt:new Date()});
  await archive('transfer-archive-007',{metadata:{archive:{file:'archive.tar.gz',checksum:'0'.repeat(64),bytes:'9007199254740992'}}});
  const path='/backup-sync/archives';
  const response=await request(path+'?limit=1',{token:device.token}); assert.equal(response.status,200);
  const first=await response.json(); assert.deepEqual(first.archives,[{id:a.row.id,type:'DATA',createdAt:a.row.createdAt.toISOString(),archiveChecksum:digest(a.bytes),archiveBytes:a.bytes.length}]);
  assert.equal(first.folder,'D:\\YO_CRM_Backups'); assert.equal(first.intervalMinutes,30); assert.ok(first.nextCursor);
  await archive('transfer-archive-008',{createdAt:new Date('2026-10-26T10:02:00.000Z')});
  const second=await (await request(path+'?limit=1&cursor='+encodeURIComponent(first.nextCursor),{token:device.token})).json();
  assert.deepEqual(second.archives.map(row=>row.id),[b.row.id]);
  let cursor=second.nextCursor, ids=[...first.archives,...second.archives].map(row=>row.id), count=0;
  while(cursor && count++<15) {const page=await (await request(path+'?limit=1&cursor='+encodeURIComponent(cursor),{token:device.token})).json(); ids.push(...page.archives.map(row=>row.id)); cursor=page.nextCursor;}
  assert.deepEqual(ids,['transfer-archive-001','transfer-archive-002','transfer-archive-008']); assert.equal(cursor,null);
  for(const query of ['?limit=101','?limit=0','?limit=1.5','?cursor=garbage','?cursor='+Buffer.from(JSON.stringify({createdAt:'bad',id:a.row.id})).toString('base64url')]) assert.equal((await request(path+query,{token:device.token})).status,400);
}));
test('bounded device registry serializes concurrent pairing and audit failures roll back settings and devices',async()=>httpFixture(async({request,pair,password,settings,audits,setFailAudit})=>{
  const first=await pair(), registry=settings.get('computer-devices');
  const original=registry.devices[0];
  for(let i=0;i<18;i++) registry.devices.push({...original,id:randomUUID(),tokenHash:digest('synthetic-device-'+i)});
  const issue=()=>request('/admin/backups/computers',{role:'OWNER',method:'POST',body:{name:'Конкурентный',currentPassword:password}});
  const responses=await Promise.all([issue(),issue()]); assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]); assert.equal(settings.get('computer-devices').devices.length,20);
  const before=structuredClone(settings), eventCount=audits.length;
  setFailAudit(true);
  assert.equal((await request('/admin/backups/computer-transfer',{role:'OWNER',method:'PUT',body:{mode:'AUTOMATIC',folder:'D:\\YO_CRM_Backups',intervalMinutes:30,currentPassword:password}})).status,500);
  assert.equal((await request('/admin/backups/computers/'+first.id+'/revoke',{role:'OWNER',method:'POST',body:{currentPassword:password}})).status,500);
  assert.deepEqual(settings,before); assert.equal(audits.length,eventCount); setFailAudit(false);
  await request('/admin/backups/computers/'+first.id+'/revoke',{role:'OWNER',method:'POST',body:{currentPassword:password}});
  assert.equal((await issue()).status,201); assert.equal(settings.get('computer-devices').devices.length,21);
  assert.equal((await issue()).status,409);
}));
test('twenty issue/revoke cycles do not exhaust pairing and old revoked tokens stay unauthorized',async()=>httpFixture(async({request,pair,password,settings,audits})=>{
  const retired=[];
  for(let i=0;i<20;i++) {
    const device=await pair(); retired.push(device);
    assert.equal((await request('/admin/backups/computers/'+device.id+'/revoke',{role:'OWNER',method:'POST',body:{currentPassword:password}})).status,201);
  }
  const replacement=await pair();
  assert.equal(settings.get('computer-devices').devices.length,21);
  assert.equal((await request('/backup-sync/archives',{token:replacement.token})).status,200);
  for(const device of retired) assert.equal((await request('/backup-sync/archives',{token:device.token})).status,401);
  assert.equal(audits.filter(event=>event.action==='BACKUP_COMPUTER_PAIRED').length,21);
  assert.equal(audits.filter(event=>event.action==='BACKUP_COMPUTER_REVOKED').length,20);
}));
test('registry prunes only oldest inactive entries at 100, retaining all active devices and immutable audits',async()=>httpFixture(async({request,pair,password,settings,audits,setFailAudit})=>{
  const first=await pair(), registry=settings.get('computer-devices'), original=registry.devices[0], now=Date.now();
  // Keep the oldest device active: pruning by age alone must never remove it.
  original.createdAt=new Date(now-89*86400000).toISOString(); original.expiresAt=new Date(now+86400000).toISOString();
  const activeIds=[first.id];
  for(let i=0;i<18;i++) {const id=randomUUID(); activeIds.push(id); registry.devices.push({...original,id,tokenHash:digest('active-'+i)});}
  const expiredToken='e'.repeat(43), revokedToken='r'.repeat(43);
  const oldCreated=new Date(now-91*86400000).toISOString(), oldExpiry=new Date(now-86400000).toISOString();
  const expiredId=randomUUID(), revokedId=randomUUID();
  registry.devices.push({...original,id:expiredId,tokenHash:digest(expiredToken),createdAt:oldCreated,expiresAt:oldExpiry});
  registry.devices.push({...original,id:revokedId,tokenHash:digest(revokedToken),revoked:true,createdAt:new Date(now-80*86400000).toISOString(),expiresAt:new Date(now+10*86400000).toISOString()});
  for(let i=0;i<79;i++) registry.devices.push({...original,id:randomUUID(),tokenHash:digest('retired-'+i),createdAt:new Date(now-10*86400000).toISOString(),revoked:true});
  assert.equal(registry.devices.length,100);
  for(const token of [expiredToken,revokedToken]) assert.equal((await request('/backup-sync/archives',{token})).status,401);
  const history=structuredClone(audits), before=structuredClone(settings);
  setFailAudit(true);
  assert.equal((await request('/admin/backups/computers',{role:'OWNER',method:'POST',body:{name:'Rollback prune',currentPassword:password}})).status,500);
  assert.deepEqual(settings,before); assert.deepEqual(audits,history); setFailAudit(false);
  const replacement=await pair();
  const saved=settings.get('computer-devices').devices;
  assert.equal(saved.length,100); assert.ok(!saved.some(device=>device.id===expiredId)); assert.ok(saved.some(device=>device.id===revokedId));
  for(const id of activeIds) assert.ok(saved.some(device=>device.id===id));
  assert.deepEqual(audits.slice(0,history.length),history);
  for(const token of [expiredToken,revokedToken]) assert.equal((await request('/backup-sync/archives',{token})).status,401);
  const beforeDenied=structuredClone(settings);
  assert.equal((await request('/admin/backups/computers',{role:'OWNER',method:'POST',body:{name:'Twenty-first active',currentPassword:password}})).status,409);
  assert.deepEqual(settings,beforeDenied);
  assert.deepEqual(audits.at(-1).after.prunedDeviceIds,[expiredId]);
  await request('/admin/backups/computers/'+replacement.id+'/revoke',{role:'OWNER',method:'POST',body:{currentPassword:password}});
  await pair();
  const finalDevices=settings.get('computer-devices').devices;
  assert.equal(finalDevices.length,100); assert.ok(!finalDevices.some(device=>device.id===revokedId));
  for(const id of activeIds) assert.ok(finalDevices.some(device=>device.id===id));
  assert.deepEqual(audits.at(-1).after.prunedDeviceIds,[revokedId]);
  assert.deepEqual(audits.slice(0,history.length),history);
  for(const token of [expiredToken,revokedToken]) assert.equal((await request('/backup-sync/archives',{token})).status,401);
}));
test('computer folder is an inert absolute Windows drive path and mutations cannot persist passwords',async()=>httpFixture(async({request,password,settings})=>{
  const path='/admin/backups/computer-transfer', base={mode:'AUTOMATIC',folder:'D:\\YO_CRM_Backups',intervalMinutes:30,currentPassword:password};
  for(const folder of ['D:\\','\\\\server\\share','D:\\safe\\..\\elsewhere','relative','D:\\unsafe"folder',"D:\\unsafe'folder",'D:\\unsafe\nfolder']) {
    assert.equal((await request(path,{role:'OWNER',method:'PUT',body:{...base,folder}})).status,400); assert.equal(settings.size,0);
  }
  assert.equal((await request(path,{role:'OWNER',method:'PUT',body:{...base,intervalMinutes:4}})).status,400);
  assert.equal((await request('/admin/backups/computers',{role:'OWNER',method:'POST',body:{name:'   ',currentPassword:password}})).status,400);
  assert.equal((await request('/admin/backups/computers',{role:'OWNER',method:'POST',body:{name:'Рабочий',currentPassword:'wrong'}})).status,401);
  assert.equal(settings.size,0);
}));
test('mode switch while listing and revocation while hashing cannot release archives or a stream',async()=>httpFixture(async({request,pair,settings,archive,setOnArchiveList,setOnDownloadAuthorized})=>{
  const device=await pair(), source=await archive();
  const config={mode:'AUTOMATIC',folder:'D:\\YO_CRM_Backups',intervalMinutes:30}; settings.set('computer-transfer',config);
  setOnArchiveList(()=>{config.mode='MANUAL';});
  const response=await request('/backup-sync/archives',{token:device.token}); assert.equal(response.status,200);
  const page=await response.json(); assert.equal(page.mode,'MANUAL'); assert.deepEqual(page.archives,[]); assert.equal(page.nextCursor,null);
  setOnArchiveList(undefined); config.mode='AUTOMATIC';
  setOnDownloadAuthorized(()=>{settings.get('computer-devices').devices[0].revoked=true;});
  assert.equal((await request('/backup-sync/archives/'+source.row.id+'/download',{token:device.token})).status,401);
}));
test('paired download uses verified real disk stream and preserves fresh-password legacy downloads', async t => httpFixture(async ({request,pair,password,settings,archive,audits}) => {
  const device=await pair(); settings.set('computer-transfer',{mode:'AUTOMATIC',folder:'D:\\YO_CRM_Backups',intervalMinutes:5});
  const source=await archive(), path='/backup-sync/archives/'+source.row.id+'/download';
  await t.test('streams exact bytes, safe attachment, no-store and device audit without password',async()=>{
    const response=await request(path,{token:device.token}); assert.equal(response.status,200,await response.clone().text());
    assert.equal(response.headers.get('content-type'),'application/gzip'); assert.equal(response.headers.get('content-length'),String(source.bytes.length));
    assert.equal(response.headers.get('cache-control'),'no-store'); assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.equal(response.headers.get('content-disposition'),`attachment; filename="${source.row.id}-archive.tar.gz"`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),source.bytes);
    assert.ok(audits.some(row=>row.action==='BACKUP_DOWNLOAD_AUTHORIZED' && row.after.deviceId===device.id));
    assert.ok(!JSON.stringify(audits).includes(device.token));
  });
  await t.test('legacy download still requires staff session AND current password',async()=>{
    const route='/admin/backups/'+source.row.id+'/download';
    assert.equal((await request(route,{role:'OWNER',method:'POST',body:{currentPassword:'wrong'}})).status,401);
    assert.equal((await request(route,{token:device.token,method:'POST',body:{currentPassword:password}})).status,401);
    const response=await request(route,{role:'OWNER',method:'POST',body:{currentPassword:password}}); assert.equal(response.status,201);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),source.bytes);
  });
  await t.test('tampered archive or payload and bad row metadata never stream',async()=>{
    await writeFile(join(source.dir,'archive.tar.gz'),Buffer.alloc(source.bytes.length,1)); assert.equal((await request(path,{token:device.token})).status,400);
    await writeFile(join(source.dir,'archive.tar.gz'),source.bytes);
    await writeFile(join(source.dir,'postgres.dump'),'tampered'); assert.equal((await request(path,{token:device.token})).status,400);
    await writeFile(join(source.dir,'postgres.dump'),'synthetic data');
    const metadata=structuredClone(source.row.metadata); source.row.metadata.job.kind='DRILL'; assert.equal((await request(path,{token:device.token})).status,404);
    source.row.metadata=metadata; source.row.status='PENDING'; assert.equal((await request(path,{token:device.token})).status,404);
    source.row.status='COMPLETED'; source.row.metadata.archive.bytes='0'; assert.equal((await request(path,{token:device.token})).status,404);
  });
}));
