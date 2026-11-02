import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {historyFullSchemaSeed,fullSchemaSnapshot} from './history-full-schema-fixture.mjs';

const ownRoot=fileURLToPath(new URL('../../../',import.meta.url));
const sourceRoot=process.env.YO_CRM_SOURCE_ROOT||ownRoot;
assert.ok(isAbsolute(sourceRoot),'Fixture source root must be absolute, never a database target');
const additions=['20261029150000_history_migration_staging','20261029160000_history_migration_planning','20261101010000_history_operational_native'];
// Exact installed reader snapshot's 49 (migration name, raw SHA256) pairs.
// In particular, CRLF rewriting of already shipped SQL is not admitted.
const baselineDigest='2244726f71a0714c24b966b5de77c3cb58b134672f3b20ea15ccb88553c90721';
const hash=value=>createHash('sha256').update(value).digest('hex');
const historyTables=['HistoryMigrationJob','HistoryMigrationBatch','HistoryMigrationTarget','HistoryMigrationPilotRun','HistoryMigrationOrigin','HistoryMigrationIdentity','HistoryMigrationNativeWindow','HistoryMigrationNativeReview'];

// Execute each statement separately, preserving explicit BEGIN/COMMIT. A single
// PostgreSQL simple-query batch can implicitly roll back even UNWRAPPED SQL and
// falsely prove this regression fixed. Dollar bodies/quoted strings/comments
// must never be split at their internal semicolons.
function statements(sql){
 const result=[];let start=0,quote=null,dollar=null,comment=0,line=false;
 for(let i=0;i<sql.length;i++){
  const c=sql[i],next=sql[i+1];
  if(line){if(c==='\n')line=false;continue;}
  if(comment){if(c==='/'&&next==='*'){comment++;i++;}else if(c==='*'&&next==='/'){comment--;i++;}continue;}
  if(dollar){if(sql.startsWith(dollar,i)){i+=dollar.length-1;dollar=null;}continue;}
  if(quote){if(c===quote){if(next===quote)i++;else quote=null;}continue;}
  if(c==='-'&&next==='-'){line=true;i++;continue;}
  if(c==='/'&&next==='*'){comment=1;i++;continue;}
  if(c==='\''||c==='"'){quote=c;continue;}
  if(c==='$'){const marker=/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(sql.slice(i));if(marker){dollar=marker[0];i+=dollar.length-1;continue;}}
  if(c===';'){result.push(sql.slice(start,i+1).trim());start=i+1;}
 }
 assert.equal(quote,null);assert.equal(dollar,null);assert.equal(comment,0);
 assert.equal(sql.slice(start).trim(),'','Every actual migration statement must terminate');
 return result.filter(Boolean);
}

async function catalog(db){
 const relations=(await db.query(`SELECT c.relname,c.relkind,c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,c.relkind`)).rows;
 const columns=(await db.query(`SELECT c.relname,a.attname,a.attnum,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`)).rows;
 const constraints=(await db.query(`SELECT r.relname,c.conname,c.contype,c.convalidated,pg_get_constraintdef(c.oid,true) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' ORDER BY r.relname,c.conname`)).rows;
 const indexes=(await db.query(`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY indexname`)).rows;
 const functions=(await db.query(`SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS args,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.proname,args`)).rows;
 const triggers=(await db.query(`SELECT r.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY r.relname,t.tgname`)).rows;
 const enums=(await db.query(`SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder`)).rows;
 return {relations,columns,constraints,indexes,functions,triggers,enums,rows:await fullSchemaSnapshot(db)};
}

test('actual history SQL atomically preserves ABSENT/INTAKE2/PLANNING6 prefixes on pre-COMMIT failure and admits a clean retry',{
 skip:process.env.YO_HISTORY_PGLITE!=='1',timeout:120000,
},async t=>{
 const {PGlite}=createRequire(resolve(sourceRoot,'packages/database/package.json'))('@electric-sql/pglite');
 const db=new PGlite();
 try{
  assert.ok(db.dataDir===undefined||db.dataDir==='memory://','Fresh memory-only fixture required');
  assert.match((await db.query('SELECT pg_catalog.version() AS version')).rows[0].version,/PGlite.*wasm32/u);
  const folder=resolve(sourceRoot,'packages/database/prisma/migrations');
  const names=(await readdir(folder,{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name).sort();
  assert.equal(names.length,53);assert.deepEqual(names.slice(49,52),additions);
  const files=await Promise.all(names.map(async name=>({name,bytes:await readFile(resolve(folder,name,'migration.sql'))})));
  assert.equal(hash(JSON.stringify(files.slice(0,49).map(f=>[f.name,hash(f.bytes)]))),baselineDigest,'Existing 49 migration BYTES changed');
  for(const f of files.slice(0,49))await db.exec(f.bytes.toString('utf8'));
  await db.exec(historyFullSchemaSeed);
  const business=(await catalog(db)).rows,businessTables=Object.keys(business);
  const tableNames=async()=>(await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'HistoryMigration%' ORDER BY tablename`)).rows.map(r=>r.tablename);
  assert.deepEqual(await tableNames(),[]);
  for(const [index,f] of files.slice(49,52).entries())await t.test(f.name,async()=>{
   const parts=statements(f.bytes.toString('utf8'));
   assert.match(parts[0],/^BEGIN\s*;$/iu);assert.match(parts.at(-1),/^COMMIT\s*;$/iu);
   const before=await catalog(db);
   // Fault is AFTER every DDL statement and BEFORE the migration's own COMMIT.
   // No db.transaction callback or externally supplied client wraps this proof.
   for(const sql of parts.slice(0,-1))await db.exec(sql);
   await assert.rejects(db.exec('SELECT 1/0;'),error=>error.code==='22012');
   await db.exec('ROLLBACK;');
   assert.deepEqual(await catalog(db),before,'Failed SQL must retain the complete previous prefix and business rows');
   for(const sql of parts)await db.exec(sql);
   assert.deepEqual(await tableNames(),historyTables.slice(0,[2,6,8][index]).sort());
   const after=(await catalog(db)).rows;
   assert.deepEqual(Object.fromEntries(businessTables.map(table=>[table,after[table]])),business);
   // Keep prior-prefix history rows nonempty for subsequent failure/rollback.
   if(index===0)await db.exec(`INSERT INTO "HistoryMigrationJob" (id,"createdById",source,account,channel,"updatedAt") VALUES ('atomic-job','owner','KEYCRM','synthetic','INSTAGRAM',CURRENT_TIMESTAMP)`);
   if(index===1)await db.query(`INSERT INTO "HistoryMigrationPilotRun" (id,"jobId","actorId","sourceDigest","previewDigest",result,"snapshotEncrypted") VALUES ('atomic-run','atomic-job','owner',$1,$2,'{"added":0}'::jsonb,'synthetic-evidence')`,['a'.repeat(64),'b'.repeat(64)]);
   if(index===2)assert.equal((await db.query(`SELECT environment FROM "HistoryMigrationPilotRun" WHERE id='atomic-run'`)).rows[0].environment,'ISOLATED_WASM');
  });
  // Negative control: without the outer transaction, actual staging DDL commits
  // before the fault. This catches a test harness that silently auto-wraps SQL.
  const control=new PGlite();
  try{
   for(const f of files.slice(0,49))await control.exec(f.bytes.toString('utf8'));
   const before=await catalog(control),body=statements(files[49].bytes.toString('utf8')).slice(1,-1);
   for(const sql of body)await control.exec(sql);
   await assert.rejects(control.exec('SELECT 1/0;'),error=>error.code==='22012');
   await control.exec('ROLLBACK;');
   assert.notDeepEqual(await catalog(control),before,'Unwrapped negative control must expose a partial prefix');
  }finally{await control.close();}
  for(const f of files)assert.equal(hash(await readFile(resolve(folder,f.name,'migration.sql'))),hash(f.bytes),'Migration input changed during proof');
 }finally{await db.close();}
});
