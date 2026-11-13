import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {historyNativeFixture} from './history-native-fixture.mjs';
import {loadTargetModule} from './overview-target-loader.mjs';

// Actual persistent psql process/PG16 session; only a generated new fixture login
// reaches Python over private stdin. No existing credentials or URL are read.
// Docker is synthetic. This proves fencing/schema compatibility, not an import,
// installed image, production authorization, backup or full service lifecycle.
const python = String.raw`
import json, sys
sys.path.insert(0, sys.argv[1] + '/scripts')
from history_runtime_guard import ManagedRuntimeGate, RuntimeArtifact, SchemaContract, RuntimeGuardError
from history_runtime_connection import _connect_owned_test

def rpc(op, **args):
    print(json.dumps(dict(op=op, **args)), flush=True)
    result=json.loads(sys.stdin.readline())
    if not result['ok']: raise RuntimeError(result['error'])
    return result.get('value')

config=rpc('psqlConfig')
def connect(restricted=False):
    conn=_connect_owned_test(config['argv'],config['env'])
    if restricted: rpc('restrict',enabled=True)
    return conn

OLD='sha256:'+'a'*64
NEW='sha256:'+'b'*64
CONTAINER='c'*64
old=RuntimeArtifact(OLD,'d'*64,None)
new=RuntimeArtifact(NEW,'e'*64,'f'*64)
schema=SchemaContract(rpc('inventory'), 'NATIVE_V1')
installed_image=NEW
def docker(argv):
    if argv[1]=='inspect':
        return json.dumps(dict(id=CONTAINER,image=installed_image,running=True,mounts=[]))
    if OLD in argv: return '{"present":false}'
    return json.dumps(dict(present=True,moduleSha256='f'*64,capability=dict(historicalIngressGuard=1)))
def gate(artifact=new, contract=schema, restricted=False):
    return ManagedRuntimeGate(lambda:connect(restricted),artifact,(contract,),docker=docker)
def refused(attempt):
    try: attempt()
    except RuntimeGuardError: return
    raise AssertionError('Unsafe host admission')
def enter_exit(g):
    with g: pass
def passed(name): rpc('passed', name=name)

# Correct inventory comes from source migration bytes, not the queried database.
with gate(old): pass
passed('53 real migrations, zero native runs admit legacy image')
refused(lambda:enter_exit(gate(contract=SchemaContract('0'*64,'NATIVE_V1'))))
rpc('migrationFault', kind='checksum')
refused(lambda:enter_exit(gate()))
rpc('migrationFault', kind='incomplete')
refused(lambda:enter_exit(gate()))
rpc('migrationFault', kind='restore')
refused(lambda:enter_exit(gate(restricted=True)))
rpc('restrict',enabled=False)
passed('wrong fingerprint, tampered/incomplete inventory and actual SQL permission denied refuse')

# Actual operational service beforeJobLock + actual repository/owner/job locking;
# only its downstream planning action is replaced with a paused fixture commit.
rpc('startCore')
rpc('coreEntered')
refused(lambda:enter_exit(gate(old)))
rpc('finishCore')
refused(lambda:enter_exit(gate(old)))
passed('shared core transaction blocks exclusive preflight; committed native custody refuses legacy')

with gate() as host:
    rpc('startCore')
    rpc('coreBlocked')
    host.run(lambda:(rpc('coreBlocked'),CONTAINER)[1])
    rpc('coreBlocked')
    # Successful installed-image verification has not released the session fence.
rpc('coreEntered')
rpc('finishCore')
passed('exclusive session blocks actual core through callback and installed verification until exit')

rpc('rollbackRuns')
refused(lambda:enter_exit(gate(old)))
with gate() as host:
    receipt=host.run(lambda:CONTAINER)
    assert receipt.operational_runs==2 and receipt.historical_ingress_guard==1
passed('two durable ROLLED_BACK native runs still require guarded runtime')

rpc('rls', enabled=True)
refused(lambda:enter_exit(gate()))
rpc('rls', enabled=False)
passed('actual row security is rejected despite fixture superuser visibility')

# Separate empty owned database: apply the unchanged first 49 SQL files, then
# fail each new migration inside a transaction. No production or fixture source
# is modified. Metadata resolution below models Prisma's resolved-row state;
# the real resolver command remains the parent host helper's responsibility.
config=rpc('prefixInit')
allowed=tuple(tuple(pair) for pair in rpc('prefixPairs'))
installed_image=OLD
for shape in ('ABSENT','INTAKE_V1','PLANNING_V1'):
    contract=SchemaContract(rpc('prefixInventory'),shape,allowed_rolled_back_migrations=allowed)
    with gate(old,contract) as host:
        def fail_migration():
            rpc('prefixFail')
            raise RuntimeError('Synthetic atomic migration failure')
        refused(lambda:host.run(fail_migration))
        refused(lambda:host.run(lambda:CONTAINER)) # unresolved row never admits recovery
        rpc('prefixResolve') # exact failed name/hash + unchanged atomic schema checked by test controller
        if shape=='PLANNING_V1':
            rpc('prefixConstraint',enabled=False)
            refused(lambda:host.run(lambda:CONTAINER))
            rpc('prefixConstraint',enabled=True)
        receipt=host.run(lambda:CONTAINER)
        assert receipt.operational_runs==0 and receipt.historical_ingress_guard is None
    passed('atomic failed migration resolved under retained fence allows exact '+shape+' legacy recovery')
    rpc('prefixApply')
retried=SchemaContract(rpc('prefixInventory'),'NATIVE_V1',allowed_rolled_back_migrations=allowed)
with gate(old,retried): pass # successful retries retain the three rolled-back attempts
for fault in ('old-rollback','duplicate-complete','duplicate-rollback','unknown-checksum','unfinished'):
    rpc('prefixFault',kind=fault)
    refused(lambda:enter_exit(gate(old,retried)))
    rpc('prefixFault',kind='clear')
passed('retained retry history accepted; old/unknown/duplicate/unfinished attempts refuse on real PostgreSQL')
rpc('done')
`;

test('owned PostgreSQL host gate fences actual operational core and exact schema inventory',
 {skip:process.env.YO_HISTORY_NATIVE!=='1',timeout:240000},async()=>{
 const envKeys=['HISTORY_MIGRATION_OPERATIONAL_ENABLED','CRM_COMMIT'];
 const previous=envKeys.map(key=>process.env[key]);
 process.env.HISTORY_MIGRATION_OPERATIONAL_ENABLED='true';process.env.CRM_COMMIT='1'.repeat(64);
 let f,child,core;
 const checks=[];
 try{
  f=await historyNativeFixture();
  const folder=new URL('../../../packages/database/prisma/migrations/',import.meta.url);
  const names=(await readdir(folder,{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name).sort();
  const sources=await Promise.all(names.map(name=>readFile(new URL(name+'/migration.sql',folder))));
  const pairs=names.map((name,i)=>[name,createHash('sha256').update(sources[i]).digest('hex')]);
  assert.equal(pairs.length,53);
  const inventory=createHash('sha256').update(JSON.stringify(pairs)).digest('hex');
  await f.db.$executeRawUnsafe('CREATE TABLE "_prisma_migrations" (migration_name text PRIMARY KEY,checksum text NOT NULL,finished_at timestamptz,rolled_back_at timestamptz)');
  for(const [name,checksum] of pairs)await f.db.$executeRaw`INSERT INTO "_prisma_migrations" VALUES (${name},${checksum},CURRENT_TIMESTAMP,NULL)`;
  const password=randomBytes(32).toString('hex');
  await f.db.$executeRawUnsafe(`CREATE ROLE runtime_psql_fixture LOGIN PASSWORD '${password}'`);
  await f.db.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO runtime_psql_fixture');
  await f.db.$executeRawUnsafe('GRANT SELECT ON ALL TABLES IN SCHEMA public TO runtime_psql_fixture');
  const [identity]=await f.db.$queryRawUnsafe('SELECT current_database() AS name,current_user AS role,inet_server_port() AS port,host(inet_server_addr()) AS host');
  assert.match(identity.name,/^history_[a-f0-9]{24}$/);assert.equal(identity.role,'history_fixture');assert.equal(identity.host,'127.0.0.1');
  const psql=fileURLToPath(new URL('../../../.local/chat-history-migrator/phase-c12/deps/postgresql16/pgsql/bin/psql.exe',import.meta.url));
  const psqlConfig={argv:[psql,'-h','127.0.0.1','-p',String(identity.port),'-U','runtime_psql_fixture','-d',identity.name,'-XqAtw','-v','ON_ERROR_STOP=1'],env:{PGPASSWORD:password}};
  let prefix;
  async function prefixSql(sql,expectFailure=false){
   const argv=[...psqlConfig.argv.slice(1)];
   argv[5]='runtime_prefix_fixture';argv[7]=prefix.name;
   const env=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
   Object.assign(env,{PGPASSWORD:prefix.password,PGCLIENTENCODING:'UTF8'});
   const command=spawn(psql,argv,{windowsHide:true,env,timeout:30000,stdio:['pipe','pipe','pipe']});
   let output='',size=0;
   command.stdout.on('data',b=>{size+=b.length;if(size>2097152)command.kill();else output+=b.toString('utf8');});
   command.stderr.on('data',()=>{}); // Never expose connection arguments or DDL in failure output.
   const result=new Promise((yes,no)=>{command.once('error',no);command.once('exit',(code,signal)=>yes({code,signal}));});
   command.stdin.on('error',()=>{});command.stdin.end(sql+'\n');
   const {code,signal}=await result;assert.equal(signal,null,'Owned prefix psql timed out');
   assert.equal(code===0,!expectFailure,'Owned prefix SQL result differs from expected outcome');return output.trim();
  }
  const prefixSnapshot=()=>prefixSql(`SELECT json_build_object('tables',(SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public'),'columns',(SELECT json_agg(row_to_json(c) ORDER BY table_name,ordinal_position) FROM information_schema.columns c WHERE table_schema='public'),'constraints',(SELECT json_agg(pg_get_constraintdef(c.oid) ORDER BY r.relname,c.conname) FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public'))::text;`);
  const atomicBody=index=>sources[index].toString('utf8').replace(/^\s*(?:BEGIN|COMMIT);\s*$/gm,'');
  await f.db.$executeRawUnsafe(`INSERT INTO "User" (id,email,"passwordHash",role,"displayName","updatedAt") VALUES ('guard-owner','guard@example.invalid','synthetic','OWNER','Synthetic',CURRENT_TIMESTAMP)`);
  await f.db.$executeRawUnsafe(`INSERT INTO "Client" (id,"firstName","displayName",source,instagram,"updatedAt") VALUES ('guard-client','Synthetic','Synthetic','MANUAL','222',CURRENT_TIMESTAMP)`);
  await f.db.$executeRawUnsafe(`INSERT INTO "Conversation" (id,"clientId",channel,"externalId","updatedAt") VALUES ('guard-conversation','guard-client','INSTAGRAM','111:222',CURRENT_TIMESTAMP)`);
  await f.db.$executeRawUnsafe(`INSERT INTO "AppSetting" (id,section,key,value,"updatedAt") VALUES ('guard-setting','integration.meta','instagramAccountId','"111"',CURRENT_TIMESTAMP)`);
  await f.db.$executeRawUnsafe(`INSERT INTO "HistoryMigrationJob" (id,"createdById",source,account,channel,"updatedAt") VALUES ('11111111-1111-4111-8111-111111111111','guard-owner','KEYCRM','synthetic','INSTAGRAM',CURRENT_TIMESTAMP)`);
  await f.db.$executeRawUnsafe(`INSERT INTO "HistoryMigrationTarget" (id,"jobId","dialogueId",mode,"clientId","evidenceEncrypted","updatedAt") VALUES ('guard-target','11111111-1111-4111-8111-111111111111','synthetic','EXISTING','guard-client','synthetic',CURRENT_TIMESTAMP)`);
  const {HistoryMigrationRepository}=loadTargetModule('history-migration/history-migration.repository.ts');
  const {HistoryOperationalService}=loadTargetModule('history-migration/history-operational.service.ts');
  let sequence=0;
  class PausedRepository extends HistoryMigrationRepository{
   withJob(id,_downstreamPlanningAction,beforeJobLock){
    // Preserve the real executor's callback and the real repository transaction,
    // scope locks, job lock and owner reload. This test does not run a migration.
    return super.withJob(id,async tx=>{
     const [row]=await tx.db.$queryRaw`SELECT pg_backend_pid() AS pid`;
     core.pid=row.pid;core.enter();await core.barrier;
     const run='guard-run-'+(++sequence),digest=sequence.toString(16).padStart(64,'0');
     await tx.db.$executeRaw`INSERT INTO "HistoryMigrationPilotRun" (id,"jobId","actorId",environment,"nativeConversationId","nativeAccountId","nativeCustomerId","sourceDigest","previewDigest",result,"snapshotEncrypted") VALUES (${run},'11111111-1111-4111-8111-111111111111','guard-owner','OPERATIONAL_NATIVE','guard-conversation','111','222',${digest},${'a'.repeat(64)},'{}','fixture-sealed')`;
     await tx.db.$executeRaw`INSERT INTO "HistoryMigrationNativeWindow" ("runId","payloadEncrypted") VALUES (${run},'fixture-sealed')`;
     return {syntheticFenceCommit:true};
    },beforeJobLock);
   }
  }
  const coreClient=await f.connect();
  const service=new HistoryOperationalService(new PausedRepository(coreClient),{});
  const lockPredicate=`locktype='advisory' AND classid=((hashtextextended('history-runtime-deployment',0)>>32)&4294967295)::oid AND objid=(hashtextextended('history-runtime-deployment',0)&4294967295)::oid AND objsubid=1`;
  const bounded=async(check,label)=>{
   const deadline=Date.now()+4000;
   while(Date.now()<deadline){if(await check())return;await delay(20);}
   throw Error('Timed out waiting for '+label);
  };
  async function request(message){
   switch(message.op){
    case 'prefixInit':{
     prefix={name:'history_'+randomBytes(12).toString('hex'),password:randomBytes(32).toString('hex'),completed:49};
     await f.db.$executeRawUnsafe(`CREATE ROLE runtime_prefix_fixture LOGIN SUPERUSER PASSWORD '${prefix.password}'`);
     await f.db.$executeRawUnsafe(`CREATE DATABASE "${prefix.name}"`);
     await prefixSql(sources.slice(0,49).map(b=>b.toString('utf8')).join('\n'));
     await prefixSql('CREATE TABLE "_prisma_migrations" (id text PRIMARY KEY,migration_name text NOT NULL,checksum text NOT NULL,finished_at timestamptz,rolled_back_at timestamptz);'+pairs.slice(0,49).map(([name,checksum])=>`INSERT INTO "_prisma_migrations" VALUES ('${name}','${name}','${checksum}',CURRENT_TIMESTAMP,NULL);`).join('\n')+'GRANT USAGE ON SCHEMA public TO runtime_psql_fixture;GRANT SELECT ON ALL TABLES IN SCHEMA public TO runtime_psql_fixture;');
     const argv=[...psqlConfig.argv];argv[8]=prefix.name;return {argv,env:psqlConfig.env};
    }
    case 'prefixPairs':return pairs.slice(49);
    case 'prefixInventory':return createHash('sha256').update(JSON.stringify(pairs.slice(0,prefix.completed))).digest('hex');
    case 'prefixFail':{
     prefix.before=await prefixSnapshot();
     await prefixSql('BEGIN;\n'+atomicBody(prefix.completed)+'\nSELECT 1/0;\nCOMMIT;',true);
     assert.equal(await prefixSnapshot(),prefix.before,'Failed migration must leave the entire known schema unchanged');
     const [name,checksum]=pairs[prefix.completed];
     await prefixSql(`INSERT INTO "_prisma_migrations" VALUES ('failed-${prefix.completed}','${name}','${checksum}',NULL,NULL);`);return;
    }
    case 'prefixResolve':{
     const [name,checksum]=pairs[prefix.completed];
     assert.equal(await prefixSnapshot(),prefix.before,'Resolve requires the proven atomic prefix');
     const row=JSON.parse(await prefixSql(`SELECT json_build_array(migration_name,checksum,finished_at IS NULL,rolled_back_at IS NULL)::text FROM "_prisma_migrations" WHERE id='failed-${prefix.completed}';`));
     assert.deepEqual(row,[name,checksum,true,true]);
     await prefixSql(`UPDATE "_prisma_migrations" SET rolled_back_at=CURRENT_TIMESTAMP WHERE id='failed-${prefix.completed}';`);return;
    }
    case 'prefixApply':{
     const [name,checksum]=pairs[prefix.completed];
     await prefixSql('BEGIN;\n'+atomicBody(prefix.completed)+`\nINSERT INTO "_prisma_migrations" VALUES ('complete-${prefix.completed}','${name}','${checksum}',CURRENT_TIMESTAMP,NULL);\nCOMMIT;\nGRANT SELECT ON ALL TABLES IN SCHEMA public TO runtime_psql_fixture;`);
     prefix.completed++;return;
    }
    case 'prefixConstraint':await prefixSql(message.enabled?`ALTER TABLE "HistoryMigrationPilotRun" ADD CONSTRAINT "HistoryMigrationPilotRun_environment_check" CHECK (environment='ISOLATED_WASM');`:`ALTER TABLE "HistoryMigrationPilotRun" DROP CONSTRAINT "HistoryMigrationPilotRun_environment_check";`);return;
    case 'prefixFault':{
     if(message.kind==='clear'){await prefixSql(`DELETE FROM "_prisma_migrations" WHERE id='tamper';`);return;}
     const [name,checksum]=pairs[message.kind==='old-rollback'?0:51];
     await prefixSql(`INSERT INTO "_prisma_migrations" VALUES ('tamper','${name}','${message.kind==='unknown-checksum'?'0'.repeat(64):checksum}',${message.kind==='duplicate-complete'?'CURRENT_TIMESTAMP':'NULL'},${['old-rollback','duplicate-rollback','unknown-checksum'].includes(message.kind)?'CURRENT_TIMESTAMP':'NULL'});`);return;
    }
    case 'inventory':return inventory;
    case 'psqlConfig':return psqlConfig;
    case 'restrict':await f.db.$executeRawUnsafe(`${message.enabled?'REVOKE SELECT ON':'GRANT SELECT ON'} "_prisma_migrations" ${message.enabled?'FROM':'TO'} runtime_psql_fixture`);return;
    case 'migrationFault':{
     const [name,checksum]=pairs[0];
     if(message.kind==='checksum')await f.db.$executeRaw`UPDATE "_prisma_migrations" SET checksum=${'0'.repeat(64)} WHERE migration_name=${name}`;
     else if(message.kind==='incomplete')await f.db.$executeRaw`UPDATE "_prisma_migrations" SET checksum=${checksum},finished_at=NULL WHERE migration_name=${name}`;
     else await f.db.$executeRaw`UPDATE "_prisma_migrations" SET checksum=${checksum},finished_at=CURRENT_TIMESTAMP WHERE migration_name=${name}`;
     return;
    }
    case 'startCore':{
     assert.ok(!core||core.finished,'Previous core transaction is still active');
     core={};core.entered=new Promise(resolve=>{core.enter=resolve;});core.barrier=new Promise(resolve=>{core.release=resolve;});
     // preparedContext executes the real shared-fence and scope/job lock path.
     core.result=service.preparedContext('11111111-1111-4111-8111-111111111111').then(value=>{core.finished=true;return {value};},error=>{core.finished=true;return {error};});
     return;
    }
    case 'coreEntered':{
     await Promise.race([core.entered,core.result.then(({error})=>{throw error||Error('Core finished before lock observation');}),delay(5000,undefined,{ref:false}).then(()=>{throw Error('Core did not enter');})]);
     const rows=await f.db.$queryRawUnsafe(`SELECT pid FROM pg_locks WHERE ${lockPredicate} AND mode='ShareLock' AND granted AND pid=${core.pid}`);
     assert.equal(rows.length,1,'Real core transaction must hold matching shared lock');return;
    }
    case 'coreBlocked':{
     await bounded(async()=>{
      const rows=await f.db.$queryRawUnsafe(`SELECT s.pid FROM pg_locks s JOIN pg_locks x ON x.classid=s.classid AND x.objid=s.objid AND x.objsubid=s.objsubid AND x.locktype=s.locktype WHERE s.locktype='advisory' AND s.classid=((hashtextextended('history-runtime-deployment',0)>>32)&4294967295)::oid AND s.objid=(hashtextextended('history-runtime-deployment',0)&4294967295)::oid AND s.objsubid=1 AND s.mode='ShareLock' AND NOT s.granted AND x.mode='ExclusiveLock' AND x.granted AND x.pid=ANY(pg_blocking_pids(s.pid))`);
      return rows.length===1;
     },'actual core shared lock blocked by host session');
     assert.equal(core.pid,undefined,'Core must not reach job action while host holds fence');
     await f.db.$transaction(async tx=>{
      const jobs=await tx.$queryRawUnsafe(`SELECT id FROM "HistoryMigrationJob" WHERE id='11111111-1111-4111-8111-111111111111' FOR UPDATE NOWAIT`);
      assert.equal(jobs.length,1,'Runtime fence must precede the native job row lock');
     });return;
    }
    case 'finishCore':core.release();{const result=await core.result;if(result.error)throw result.error;assert.deepEqual(result.value,{syntheticFenceCommit:true});return;}
    case 'rollbackRuns':await f.db.$executeRawUnsafe(`UPDATE "HistoryMigrationPilotRun" SET status='ROLLED_BACK',"rolledBackAt"=CURRENT_TIMESTAMP`);return;
    case 'rls':await f.db.$executeRawUnsafe(`ALTER TABLE "HistoryMigrationPilotRun" ${message.enabled?'ENABLE':'DISABLE'} ROW LEVEL SECURITY`);return;
    case 'passed':checks.push(message.name);return;
    case 'done':return;
    default:throw Error('Unknown test protocol operation');
   }
  }
  const root=fileURLToPath(new URL('../../../',import.meta.url));
  // Minimal child environment; no inherited database/provider credential variables.
  const childEnv=Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  child=spawn('python',['-u','-c',python,root],{windowsHide:true,env:childEnv,timeout:120000,stdio:['pipe','pipe','pipe']});
  let errors='',protocolError;
  child.stderr.on('data',data=>{errors=(errors+data).slice(-12000);});
  const lines=createInterface({input:child.stdout});
  const handle=(async()=>{
   for await(const line of lines){
    let result;
    try{result={ok:true,value:await request(JSON.parse(line))};}
    catch(error){result={ok:false,error:'Owned PostgreSQL test request failed'};protocolError=error;}
    child.stdin.write(JSON.stringify(result)+'\n');
   }
  })();
  const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  await handle;
  if(exit.code!==0)throw new Error('Python host gate failed: '+errors,{cause:protocolError});
  assert.equal(exit.signal,null);assert.equal(checks.length,10);
  assert.equal((await f.db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "HistoryMigrationPilotRun" WHERE environment=\'OPERATIONAL_NATIVE\' AND status=\'ROLLED_BACK\''))[0].n,2);
 }finally{
  if(child?.pid&&child.exitCode===null&&child.signalCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}
  if(core){core.release();await core.result;}
  try{if(f)await f.close();}finally{envKeys.forEach((key,i)=>previous[i]===undefined?delete process.env[key]:process.env[key]=previous[i]);}
 }
});
