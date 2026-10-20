/** Dedicated synthetic PostgreSQL only. No provisioning, migration, .env discovery or workers. */
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const requireApi=createRequire(resolve(ROOT,'apps/api/package.json'));
export function guardWebsiteDatabase(value){
 let u;try{u=new URL(value);}catch{throw Error('WEBSITE_TEST_DATABASE_URL_REQUIRED');}
 assert.ok(['postgres:','postgresql:'].includes(u.protocol)&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&u.pathname==='/website_checkout_rc_test'&&/^\d+$/.test(u.port)&&!u.hash,'ISOLATED_WEBSITE_DATABASE_REQUIRED');
 assert.ok([...u.searchParams.keys()].every(k=>['connection_limit','pool_timeout','connect_timeout','schema'].includes(k)),'UNREVIEWED_DATABASE_OPTIONS');
 assert.ok(!u.searchParams.has('schema')||u.searchParams.get('schema')==='public','PUBLIC_TEST_SCHEMA_ONLY');
 return value;
}

const cache=new Map();
export function loadWebsiteRuntime(relative){
 const file=resolve(ROOT,'apps/api/src',relative);
 assert.ok(file.startsWith(resolve(ROOT,'apps/api/src')+'/')||file.startsWith(resolve(ROOT,'apps/api/src')+'\\'),'RUNTIME_SOURCE_SCOPE');
 assert.ok(!['app.module.ts','main.ts'].includes(file.split(/[\\/]/).at(-1)),'NO_PRODUCTION_BOOTSTRAP');
 if(cache.has(file))return cache.get(file).exports;
 const ts=requireApi('typescript'),m={exports:{}};cache.set(file,m);
 const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',js)(name=>{
  const target=resolve(dirname(file),name+'.ts');
  return name.startsWith('.')&&existsSync(target)?loadWebsiteRuntime(target):requireApi(name);
 },m,m.exports);return m.exports;
}

export async function openWebsiteTestDatabase(value){
 guardWebsiteDatabase(value);
 const {PrismaClient}=requireApi('@prisma/client');
 const db=new PrismaClient({datasourceUrl:value,log:[]});
 try{
  const names=await db.$queryRawUnsafe('SELECT current_database() AS name');
  assert.ok(names.length===1&&names[0].name==='website_checkout_rc_test','DATABASE_IDENTITY');
  const migrations=await db.$queryRawUnsafe('SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name');
  assert.equal(migrations.length,43,'SCHEMA43_REQUIRED');
  for(const row of migrations){
   assert.ok(row.finished_at&&!row.rolled_back_at,'FINISHED_MIGRATION_REQUIRED');
   const bytes=readFileSync(resolve(ROOT,'packages/database/prisma/migrations',row.migration_name,'migration.sql'));
   assert.ok(createHash('sha256').update(bytes).digest('hex')===row.checksum,'FRESH_MIGRATION_SOURCE_CHECKSUM');
  }
  const [catalog]=await db.$queryRawUnsafe("SELECT count(*)::text AS n FROM pg_tables WHERE schemaname='public'");
  assert.equal(catalog.n,'71','EXPECTED_SYNTHETIC_SCHEMA_TABLES');
  return db;
 }catch{await db.$disconnect();throw Error('WEBSITE_TEST_DATABASE_PREFLIGHT_FAILED');}
}

// Explicit local runner: read only the supplied synthetic env file, never discover repository .env.
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{
  const args=process.argv.slice(2);assert.ok(args.length===3&&args[0]==='--env-file'&&args[2]==='--run','EXPLICIT_LOCAL_TEST_RUN_REQUIRED');
  const lines=readFileSync(args[1],'utf8').replace(/^\uFEFF/,'').split(/\r?\n/);
  const matches=lines.filter(l=>/^(?:WEBSITE_TEST_DATABASE_URL|DATABASE_URL)=/.test(l));
  assert.ok(matches.length===1,'ONE_SYNTHETIC_DATABASE_URL_REQUIRED');
  const url=guardWebsiteDatabase(matches[0].slice(matches[0].indexOf('=')+1).trim().replace(/^(["'])(.*)\1$/,'$2'));
  const result=spawnSync(process.execPath,['--test','apps/api/tests/website-orders-postgres.test.mjs'],{cwd:ROOT,env:{...process.env,DATABASE_URL:url,YO_WEBSITE_POSTGRES:'1',WEBSITE_TEST_DATABASE_URL:url},stdio:'inherit',timeout:240000});
  process.exitCode=result.status??1;
 }catch{process.stderr.write('WEBSITE_POSTGRES_RUNNER_FAILED\n');process.exitCode=1;}
}
