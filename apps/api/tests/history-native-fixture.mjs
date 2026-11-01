import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, writeFile, readFile, stat, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { PrismaClient, Prisma } from '@prisma/client';
import {ProtectedJobStore} from '../../../tools/migrator-agent/src/checkpoint.ts';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const ident=name=>{assert.match(name,/^[A-Za-z_][A-Za-z0-9_]*$/);return '"'+name+'"';};
async function dumpDigest(path){const info=await stat(path);assert.ok(info.isFile()&&info.size>0&&info.size<=33554432,'Fixture dump exceeds its bound');return createHash('sha256').update(await readFile(path)).digest('hex');}
function command(bin,args,options={}){
 return new Promise((accept,reject)=>{
  const child=spawn(bin,args,{windowsHide:true,timeout:60000,...options});let output='';
  child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});
  child.once('error',reject);child.once('exit',code=>{if(code===0)return accept(output);const error=Error(`Native fixture command failed (${code}): ${output.slice(-1800)}`);error.exitCode=code;reject(error);});
 });
}
async function freePort(){const server=createServer();await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});const port=server.address().port;await new Promise(yes=>server.close(yes));return port;}

/** Test-only owned cluster. No connection URL, existing data directory or server
 * credential is accepted. No service installation, production writer or sends. */
export async function historyNativeFixture(failurePoint){
 assert.ok(failurePoint===undefined||failurePoint==='BEFORE_PORT'||failurePoint==='AFTER_START','Unknown synthetic failure point');
 assert.equal(process.env.YO_HISTORY_NATIVE,'1','Native fixture must be explicitly selected');
 assert.equal(process.platform,'win32','This fixture is Windows-local only');
 const bin=resolve(root,'.local/chat-history-migrator/phase-c12/deps/postgresql16/pgsql/bin');
 assert.match(await command(join(bin,'postgres.exe'),['--version']),/^postgres \(PostgreSQL\) 16\./);
 const parent=await mkdtemp(resolve(root,'.local/chat-history-migrator/phase-c12/native-'));
 const home=join(parent,'private'),privacy=new ProtectedJobStore(home);
 const dumps=new WeakMap();
 const data=join(home,'data'),password=randomBytes(32).toString('hex'),pwfile=join(home,'init-password');
 // These are randomly generated fixture-only credentials, never CRM credentials.
 let started=false,startAttempted=false;const clients=[];
 const close=async()=>{
  await Promise.allSettled(clients.map(c=>c.$disconnect()));
  if(startAttempted){
   let running=true;try{await command(join(bin,'pg_ctl.exe'),['-D',data,'status']);}catch(error){if(error.exitCode!==3)throw error;running=false;}
   if(running)await command(join(bin,'pg_ctl.exe'),['-D',data,'-m','fast','-w','stop']);
   started=false;startAttempted=false;
  }
  await privacy.close();
 };
 try{
  await privacy.initialize();
  await writeFile(pwfile,password,{mode:0o600});
  if(failurePoint==='BEFORE_PORT')throw Error('Synthetic port allocation failure');
  const port=await freePort(),role='history_fixture',dbName='history_'+randomBytes(12).toString('hex');
  const env={...process.env,PGPASSWORD:password,PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:role,PGDATABASE:'postgres'};
  await command(join(bin,'initdb.exe'),['-D',data,'-U',role,'--pwfile',pwfile,'-A','scram-sha-256','--encoding=UTF8','--locale=C']);
  await unlink(pwfile);
  startAttempted=true;
  await command(join(bin,'pg_ctl.exe'),['-D',data,'-l',join(home,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c max_connections=16`,'-w','start']);
  if(failurePoint==='AFTER_START')throw Error('Synthetic unconfirmed startup');
  started=true;
  await command(join(bin,'psql.exe'),['-X','-v','ON_ERROR_STOP=1','-c',`CREATE DATABASE ${ident(dbName)}`],{env});
  const migrations=resolve(root,'packages/database/prisma/migrations');
  const names=(await readdir(migrations,{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name).sort();assert.equal(names.length,52);
  for(const name of names)await command(join(bin,'psql.exe'),['-X','-q','-v','ON_ERROR_STOP=1','-f',join(migrations,name,'migration.sql')],{env:{...env,PGDATABASE:dbName}});
  async function bind(databaseName){
  const url=`postgresql://${role}:${password}@127.0.0.1:${port}/${databaseName}?connection_limit=1`;
  const connect=async()=>{assert.ok(started,'Fixture closed');const c=new PrismaClient({datasources:{db:{url}},log:[]});await c.$connect();clients.push(c);return c;};
  const db=await connect();
  const identity=async tx=>(await tx.$queryRaw`SELECT current_database() AS name,current_user AS role,(SELECT oid::int FROM pg_database WHERE datname=current_database()) AS oid,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::int AS version,(SELECT system_identifier::text FROM pg_control_system()) AS cluster`)[0];
  const owned=await identity(db);assert.equal(owned.name,databaseName);assert.equal(owned.role,role);assert.equal(owned.host,'127.0.0.1');assert.equal(owned.port,port);assert.equal(Math.floor(owned.version/10000),16);
  const tables=(await db.$queryRaw`SELECT DISTINCT r.relname AS name FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE c.contype='f' AND c.confrelid IN ('public."Client"'::regclass,'public."Conversation"'::regclass,'public."Message"'::regclass) AND n.nspname='public'`).map(r=>r.name);
  const locked=[...new Set([...tables,'Client','Conversation','Message','HistoryMigrationOrigin','HistoryMigrationIdentity','HistoryMigrationPilotRun'])].sort();
  const schemaFingerprint=await db.$queryRaw`SELECT c.oid::int AS oid,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' ORDER BY c.oid`;
  async function fence(action){
   assert.ok(started,'Fixture closed');const c=await connect();
   try{return await c.$transaction(async tx=>{
    assert.deepEqual(await identity(tx),owned,'Not the owned fixture database');
    await tx.$executeRaw`SET LOCAL lock_timeout='500ms'`;await tx.$executeRaw`SET LOCAL statement_timeout='4s'`;
    const [merge]=await tx.$queryRaw`SELECT pg_try_advisory_xact_lock_shared(hashtextextended('client-merge-global',0)) AS ok`;assert.ok(merge.ok,'Merge is active');
    const [pilot]=await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtextextended('history-isolated-pilot',0)) AS ok`;assert.ok(pilot.ok,'Import is active');
    for(const table of locked)await tx.$executeRaw(Prisma.raw(`LOCK TABLE public.${ident(table)} IN EXCLUSIVE MODE NOWAIT`));
    assert.deepEqual(await tx.$queryRaw`SELECT c.oid::int AS oid,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' ORDER BY c.oid`,schemaFingerprint,'Fixture schema changed');
    return action(tx);
   },{maxWait:1000,timeout:7000});}finally{await c.$disconnect();}
  }
  async function dump(){
   assert.ok(started,'Fixture closed');assert.deepEqual(await identity(db),owned);
   const path=join(home,'dump-'+randomBytes(12).toString('hex')+'.pgdump');
   await command(join(bin,'pg_dump.exe'),['-Fc','--no-owner','--no-privileges','-f',path],{env:{...env,PGDATABASE:databaseName}});
   const grant=Object.freeze({});dumps.set(grant,{path,digest:await dumpDigest(path)});return grant;
  }
  async function restore(grant){
   assert.ok(started,'Fixture closed');const record=dumps.get(grant);assert.ok(record,'Only this owned cluster grants restore input');const {path,digest}=record;
   assert.equal(await dumpDigest(path),digest,'Fixture dump checksum changed');
   assert.deepEqual(await identity(db),owned);
   const target='history_restore_'+randomBytes(12).toString('hex');
   await command(join(bin,'psql.exe'),['-X','-v','ON_ERROR_STOP=1','-c',`CREATE DATABASE ${ident(target)}`],{env});
   await command(join(bin,'pg_restore.exe'),['--exit-on-error','--no-owner','--no-privileges','-d',target,path],{env});
   return bind(target);
  }
  return {db,connect,fence,dump,restore,locked,migrations:names.length,version:owned.version,close,home};
  }
  return await bind(dbName);
 }catch(error){await close();error.fixtureHome=home;throw error;}finally{await unlink(pwfile).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
