import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ownRoot=fileURLToPath(new URL('../../../',import.meta.url));
const grantedDumps=new WeakSet();
export const fullSchemaDigest=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
function root(){
 if(process.env.YO_HISTORY_PGLITE!=='1')throw Error('Full-schema history fixture requires YO_HISTORY_PGLITE=1');
 const supplied=process.env.YO_CRM_SOURCE_ROOT;
 if(supplied&&!isAbsolute(supplied))throw Error('YO_CRM_SOURCE_ROOT must be absolute');
 return resolve(supplied||ownRoot);
}
const at=(base,path)=>pathToFileURL(resolve(base,path)).href;
async function dependencies(){
 const base=root();
 const [{PGlite},fixture,{loadTargetModule}]=await Promise.all([
  import(at(base,'.local/tracking-notifications/pg-test/node_modules/@electric-sql/pglite/dist/index.js')),
  import(at(base,'apps/api/tests/history-migration-fixture.mjs')),
  import(at(base,'apps/api/tests/overview-target-loader.mjs')),
 ]);
 return {base,PGlite,fixture,loadTargetModule};
}
async function assertMemory(db,PGlite){
 assert.ok(db instanceof PGlite,'Only the actual embedded PGlite instance is admitted');
 assert.ok(db.dataDir===undefined||db.dataDir==='memory://','Disk/server targets are not admitted');
 const [{version}]=(await db.query('SELECT pg_catalog.version() AS version')).rows;
 assert.match(version,/\(PGlite [^)]+\) on wasm32-unknown-emscripten\b/);
 return version;
}
const identifier=name=>{assert.match(name,/^[A-Za-z_][A-Za-z0-9_]*$/);return '"'+name+'"';};
async function schemaState(db){
 const tables=(await db.query(`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).rows.map(row=>row.name);
 const constraints=(await db.query(`SELECT r.relname AS "table",c.conname AS name,c.contype AS type,c.convalidated AS validated,pg_get_constraintdef(c.oid,true) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' ORDER BY r.relname,c.conname`)).rows;
 const triggers=(await db.query(`SELECT r.relname AS "table",t.tgname AS name,t.tgenabled AS enabled,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY r.relname,t.tgname`)).rows;
 const functions=(await db.query(`SELECT p.proname AS name,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.proname,p.oid`)).rows;
 return {tables,constraints,triggers,functions};
}
export async function fullSchemaSnapshot(db){
 const tables=(await schemaState(db)).tables,result={};
 for(const table of tables)result[table]=(await db.query(`SELECT to_jsonb(t) AS value FROM public.${identifier(table)} t ORDER BY to_jsonb(t)::text`)).rows.map(row=>row.value);
 return result;
}
function withDump(f,PGlite){
 return {...f,
  async dump(){await assertMemory(f.db,PGlite);const data=await f.db.dumpDataDir();assert.ok(data instanceof Blob&&data.size>0);grantedDumps.add(data);return data;},
  snapshot:()=>fullSchemaSnapshot(f.db),
 };
}
const seed=`
INSERT INTO "User" (id,email,"passwordHash","displayName",role,"createdAt","updatedAt") VALUES
 ('owner','owner@example.test','synthetic-password-hash','Synthetic owner','OWNER','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
 ('other-owner','other@example.test','synthetic-password-hash','Other synthetic owner','OWNER','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
INSERT INTO "Client" (id,"firstName","lastName","displayName",email,phone,whatsapp,instagram,country,city,address,"postalCode",source,status,notes,language,timezone,"preferredChannel","responsibleManagerId","firstContactAt","lastContactAt","nextActionAt","createdAt","updatedAt") VALUES
 ('existing','Existing','Protected','Existing Protected','business@example.test','+380991234567','+380991234567','synthetic_handle','UA','Synthetic city','Synthetic address','00000','MANUAL','ACTIVE','Protected résumé 🧵','uk','Europe/Kyiv','EMAIL','owner','2025-01-01T11:00:00Z','2026-01-02T12:00:00Z','2026-02-01T13:00:00Z','2025-01-01T11:00:00Z','2026-01-02T12:00:00Z');
INSERT INTO "Athlete" (id,"clientId","firstName",discipline,"createdAt","updatedAt") VALUES ('protected-athlete','existing','Synthetic athlete','RHYTHMIC_GYMNASTICS','2025-01-01T11:00:00Z','2025-01-01T11:00:00Z');
INSERT INTO "Order" (id,number,"clientId","athleteId",type,"priceMinor",currency,"depositRequiredMinor","salesStatus","productionStatus","paymentStatus","shippingStatus",notes,"createdAt","updatedAt") VALUES
 ('protected-order','YO-900001','existing','protected-athlete','CUSTOM_ORDER',39000,'EUR',19500,'DEPOSIT_RECEIVED','TENTATIVE','DEPOSIT_PAID','NOT_READY','Protected order','2025-01-01T11:00:00Z','2026-01-01T12:00:00Z');
INSERT INTO "OrderItem" (id,"orderId",name,quantity,"priceMinor","createdAt","updatedAt") VALUES ('protected-item','protected-order','Synthetic item',1,39000,'2025-01-01T11:00:00Z','2025-01-01T11:00:00Z');
INSERT INTO "Payment" (id,"orderId","amountMinor",currency,method,"receivedAt",reference,notes,"createdAt","appliedAmountMinor","appliedCurrency") VALUES
 ('protected-payment','protected-order',19500,'EUR','BANK_TRANSFER','2025-01-02T09:00:00Z','synthetic-payment','Protected payment','2025-01-02T09:00:00Z',19500,'EUR');
INSERT INTO "Conversation" (id,"clientId",channel,"externalId",subject,"lastMessageAt","unreadCount","unreadVersion","createdAt","updatedAt") VALUES
 ('protected-ig','existing','INSTAGRAM','synthetic-native-thread','Protected Instagram subject','2026-01-01T12:00:00Z',7,9,'2025-01-01T11:00:00Z','2026-01-01T12:00:00Z'),
 ('protected-email','existing','EMAIL','synthetic-mail-thread','Protected email subject','2026-01-02T12:00:00Z',3,5,'2025-01-01T11:00:00Z','2026-01-02T12:00:00Z');
INSERT INTO "Message" (id,"conversationId",direction,status,content,"normalizedText",metadata,"rawPayload","aiProcessedAt","aiAnalysisVersion","receivedAt","createdAt") VALUES
 ('protected-message','protected-email','INBOUND','RECEIVED','Protected existing mail','Protected existing mail','{"provider":"synthetic-native"}','{"protected":true}','2026-01-02T12:01:00Z','protected-v7','2026-01-02T12:00:00Z','2026-01-02T12:00:00Z');
INSERT INTO "MessageAnalysis" (id,"messageId",extractor,"analysisVersion",intent,"updatedAt") VALUES ('protected-analysis','protected-message','synthetic','protected-v7','protected-intent','2026-01-02T12:01:00Z');
INSERT INTO "AiJob" (id,type,"messageId",payload,status,attempts,"updatedAt") VALUES ('protected-ai-job','synthetic-protected','protected-message','{"sentinel":true}','PENDING',2,'2026-01-02T12:01:00Z');
INSERT INTO "AiJobAttempt" (id,"jobId","createdAt") VALUES ('protected-ai-attempt','protected-ai-job','2026-01-02T12:01:00Z');
INSERT INTO "AiRuntimeSetting" (id,key,value,"valueType",scope,"scopeId","updatedById","updatedAt") VALUES ('protected-ai-setting','mode','"OFF"','string','GLOBAL','','owner','2026-01-02T12:01:00Z');
`;

/** Resets only the freshly allocated historyFixture's asserted in-memory WASM
 * shell, then executes every migration file as-is. No URL/client/server/Docker.
 */
export async function historyFullSchemaFixture(){
 const {base,PGlite,fixture,loadTargetModule}=await dependencies();
 const coreFolder=resolve(base,'apps/api/src/history-migration');
 const coreNames=(await readdir(coreFolder)).filter(name=>name.endsWith('.ts')).sort();
 const coreManifest=await Promise.all(coreNames.map(async name=>({name,sha256:fullSchemaDigest(await readFile(resolve(coreFolder,name)))})));
 const f=await fixture.historyFixture();
 try{
  const version=await assertMemory(f.db,PGlite);
  const folder=resolve(base,'packages/database/prisma/migrations');
  const names=(await readdir(folder,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
  assert.equal(names.length,53,'Expected the complete canonical 53-migration chain');
  const files=await Promise.all(names.map(async name=>({name,bytes:await readFile(resolve(folder,name,'migration.sql'))})));
  // The instance above was just created here, never supplied by a caller.
  await f.db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  for(const file of files){
   try{await f.db.exec(file.bytes.toString('utf8'));}
   catch(error){throw new Error(`Full-schema migration failed: ${file.name}; SQLSTATE=${error.code??'UNKNOWN'}; ${error.message}`,{cause:error});}
  }
  const migrations=files.map(({name,bytes})=>({name,sha256:fullSchemaDigest(bytes),bytes:bytes.length}));
  for(const migration of migrations)assert.equal(fullSchemaDigest(await readFile(resolve(folder,migration.name,'migration.sql'))),migration.sha256,`Migration changed during proof: ${migration.name}`);
  await f.db.exec(seed);
  const schema=await schemaState(f.db);
  const {IsolatedHistoryMigrationPilot}=loadTargetModule('history-migration/isolated-history-pilot.ts');
  return withDump({...f,version,migrations,schema,coreManifest,
   async verifyInputs(){
    for(const file of coreManifest)assert.equal(fullSchemaDigest(await readFile(resolve(coreFolder,file.name))),file.sha256,`Core source changed during proof: ${file.name}`);
    for(const file of migrations)assert.equal(fullSchemaDigest(await readFile(resolve(folder,file.name,'migration.sql'))),file.sha256,`Migration changed during proof: ${file.name}`);
   },pilot:new IsolatedHistoryMigrationPilot(f.repository,f.backups),pilotOwner:fixture.pilotOwner,pilotMessage:fixture.pilotMessage,pilotScope:fixture.pilotScope},PGlite);
 }catch(error){await f.close();throw error;}
}

/** Restores only a Blob dumped from one of this module's fresh test instances. */
export async function restoreHistoryFullSchemaFixture(data){
 if(!grantedDumps.has(data))throw Error('Only a dump produced by this isolated fixture can be restored');
 const {PGlite,loadTargetModule}=await dependencies();
 const db=new PGlite({loadDataDir:data,parsers:{1114:text=>new Date(text.replace(' ','T')+'Z')}});
 try{
  const version=await assertMemory(db,PGlite);
  const port=query=>({
   $queryRaw:async(parts,...values)=>(await query(typeof parts.text==='string'?parts.text:parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),typeof parts.text==='string'?parts.values:values)).rows,
   $executeRaw:async(parts,...values)=>(await query(typeof parts.text==='string'?parts.text:parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),typeof parts.text==='string'?parts.values:values)).affectedRows,
  });
  const prisma={...port((...args)=>db.query(...args)),$transaction:callback=>db.transaction(pg=>callback(port((...args)=>pg.query(...args))))};
  const backups={reauthenticate:async(actor,password)=>{if(password!=='synthetic-password')throw Error('Invalid password');return(await db.query('SELECT * FROM "User" WHERE id=$1',[actor.id])).rows[0];}};
  const {HistoryMigrationRepository}=loadTargetModule('history-migration/history-migration.repository.ts');
  const {HistoryMigrationPlanningService}=loadTargetModule('history-migration/history-planning.service.ts');
  const {IsolatedHistoryMigrationPilot}=loadTargetModule('history-migration/isolated-history-pilot.ts');
  const repository=new HistoryMigrationRepository(prisma);
  return withDump({db,version,schema:await schemaState(db),repository,backups,planning:new HistoryMigrationPlanningService(repository,backups),pilot:new IsolatedHistoryMigrationPilot(repository,backups),close:()=>db.close()},PGlite);
 }catch(error){await db.close();throw error;}
}

// Shared synthetic sentinels for native and WASM full-schema qualification.
export {seed as historyFullSchemaSeed};
