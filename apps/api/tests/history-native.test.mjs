import test from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {historyNativeFixture} from './history-native-fixture.mjs';
import {loadTargetModule} from './overview-target-loader.mjs';
const barrier=()=>{let release;const ready=new Promise(resolve=>{release=resolve;});return {ready,release};};

test('native PostgreSQL16 ownership, schema, isolated refusal and multi-session fence',{skip:process.env.YO_HISTORY_NATIVE!=='1',timeout:180000},async t=>{
 const f=await historyNativeFixture();
 try{
  const writer=await f.connect(),reader=await f.connect();
  t.diagnostic(JSON.stringify({version:f.version,migrations:f.migrations,fencedTables:f.locked.length,productionWrites:0}));
  await f.db.$executeRaw`INSERT INTO "Client" (id,"firstName","displayName","updatedAt") VALUES ('native-protected','Synthetic','Synthetic native',CURRENT_TIMESTAMP)`;
  await t.test('all 53 real migrations; original WASM-only guard still rejects native',async()=>{
   assert.equal(f.migrations,53);assert.ok(f.locked.includes('Order'));assert.ok(f.locked.includes('MessageAttachment'));
   const {assertIsolatedHistoryDatabase}=loadTargetModule('history-migration/isolated-history-state.ts');
   await assert.rejects(assertIsolatedHistoryDatabase(f.db),/WASM/);
  });
  await t.test('existing writer causes import-only abort and releases earlier locks',async()=>{
   const entered=barrier(),finish=barrier();
   const work=writer.$transaction(async tx=>{await tx.$executeRaw`UPDATE "Client" SET notes='live writer' WHERE id='native-protected'`;entered.release();await finish.ready;},{timeout:10000});
   let admitted=false;await entered.ready;try{await assert.rejects(f.fence(async()=>{admitted=true;}),e=>e.meta?.code==='55P03');assert.equal(admitted,false);}finally{finish.release();await work;}
   assert.equal((await reader.$queryRaw`SELECT notes FROM "Client" WHERE id='native-protected'`)[0].notes,'live writer');
   await f.fence(async()=>{});
  });
  await t.test('ordinary SELECT works during fence; second import rejected',async()=>{
   await f.fence(async()=>{
    assert.equal((await reader.$queryRaw`SELECT count(*)::int AS n FROM "Client"`)[0].n,1);
    let admitted=false;await assert.rejects(f.fence(async()=>{admitted=true;}),/Import is active/);assert.equal(admitted,false);
   });
  });
  await t.test('later writer waits on actual PostgreSQL lock and resumes after release',async()=>{
   const entered=barrier(),release=barrier();let update;
   const locked=f.fence(async()=>{entered.release();await release.ready;});await entered.ready;
   try{
    update=Promise.resolve(writer.$executeRaw`UPDATE "Client" SET notes='after fence' WHERE id='native-protected'`);update.catch(()=>{});
    // Poll the server's lock state rather than inferring blocking from elapsed time.
    let waiting=false;for(let i=0;i<100&&!waiting;i++){
     waiting=(await reader.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE NOT granted AND relation='public."Client"'::regclass) AS waiting`)[0].waiting;
     if(!waiting)await new Promise(r=>setTimeout(r,10));
    }assert.ok(waiting,'Writer must be waiting on a real relation lock');
   }finally{release.release();await locked;if(update)await update;}
   assert.equal((await reader.$queryRaw`SELECT notes FROM "Client" WHERE id='native-protected'`)[0].notes,'after fence');
  });
  await t.test('dependent-row writer causes abort; thrown apply rolls back atomically',async()=>{
   const entered=barrier(),release=barrier();
   const held=writer.$transaction(async tx=>{await tx.$executeRaw`LOCK TABLE "MessageAttachment" IN ROW EXCLUSIVE MODE`;entered.release();await release.ready;},{timeout:10000});await entered.ready;
   let admitted=false;try{await assert.rejects(f.fence(async()=>{admitted=true;}),e=>e.meta?.code==='55P03');assert.equal(admitted,false);}finally{release.release();await held;}
   await assert.rejects(f.fence(async tx=>{await tx.$executeRaw`UPDATE "Client" SET notes='must rollback' WHERE id='native-protected'`;throw Error('fixture abort');}),/fixture abort/);
   assert.equal((await reader.$queryRaw`SELECT notes FROM "Client" WHERE id='native-protected'`)[0].notes,'after fence');
  });
  await t.test('active merge rejects import before its action',async()=>{
   const entered=barrier(),release=barrier();let admitted=false;
   const merge=writer.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('client-merge-global',0))`;entered.release();await release.ready;},{timeout:10000});await entered.ready;
   try{await assert.rejects(f.fence(async()=>{admitted=true;}),/Merge is active/);assert.equal(admitted,false);}finally{release.release();await merge;}
  });
  await t.test('unknown dependency fails closed; statement timeout rolls back and unlocks',async()=>{
   await writer.$executeRaw`CREATE TABLE "UnexpectedHistoryDependency" (id text PRIMARY KEY,"clientId" text REFERENCES "Client"(id))`;
   let admitted=false;try{await assert.rejects(f.fence(async()=>{admitted=true;}),/Fixture schema changed/);assert.equal(admitted,false);}finally{await writer.$executeRaw`DROP TABLE "UnexpectedHistoryDependency"`;}
   await assert.rejects(f.fence(async tx=>{await tx.$executeRaw`UPDATE "Client" SET notes='timeout rollback' WHERE id='native-protected'`;await tx.$executeRaw`SET LOCAL statement_timeout='100ms'`;await tx.$executeRaw`SELECT pg_sleep(2)`;}),e=>e.meta?.code==='57014');
   assert.equal((await reader.$queryRaw`SELECT notes FROM "Client" WHERE id='native-protected'`)[0].notes,'after fence');
   await f.fence(async()=>{});
  });
 }finally{await f.close();}
 await t.test('port-allocation failure removes generated init-password',async()=>{
  let home;await assert.rejects(historyNativeFixture('BEFORE_PORT'),error=>{home=error.fixtureHome;return /Synthetic port allocation failure/.test(error.message);});assert.ok(home);
  await assert.rejects(access(join(home,'init-password')),{code:'ENOENT'});
 });
 await t.test('unconfirmed startup stops the owned cluster and removes password',async()=>{
  let home;await assert.rejects(historyNativeFixture('AFTER_START'),error=>{home=error.fixtureHome;return /Synthetic unconfirmed startup/.test(error.message);});assert.ok(home);
  await assert.rejects(access(join(home,'init-password')),{code:'ENOENT'});
  await assert.rejects(access(join(home,'data','postmaster.pid')),{code:'ENOENT'});
  assert.match(await readFile(join(home,'postgres.log'),'utf8'),/database system is shut down/);
 });
});
