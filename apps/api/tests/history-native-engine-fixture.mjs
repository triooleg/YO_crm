import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
import {historyFullSchemaSeed,fullSchemaSnapshot} from './history-full-schema-fixture.mjs';

/** No server URL or database assertion is accepted. f is created and owned by
 * historyNativeFixture; its fence validates identity before any job row lock.
 * This subclass is test-only and never registered in Nest. */
export async function nativeHistoryServices(f,{seed=false}={}){
 const {HistoryMigrationTransactionEngine}=loadTargetModule('history-migration/history-transaction-engine.ts');
 const {HistoryMigrationRepository,MigrationTransaction}=loadTargetModule('history-migration/history-migration.repository.ts');
 const {HistoryMigrationService}=loadTargetModule('history-migration/history-migration.service.ts');
 const {HistoryMigrationPlanningService}=loadTargetModule('history-migration/history-planning.service.ts');
 if(seed)for(const sql of historyFullSchemaSeed.split(';').map(s=>s.trim()).filter(Boolean))await f.db.$executeRawUnsafe(sql);
 const backups={reauthenticate:async(actor,password)=>{
  assert.equal(password,'synthetic-password','Invalid fixture password');
  const [row]=await f.db.$queryRaw`SELECT * FROM "User" WHERE id=${actor.id}`;
  assert.ok(row?.active&&!row.archivedAt&&row.role==='OWNER','Owner unavailable');return row;
 }};
 class NativeQualified extends HistoryMigrationTransactionEngine{
  withJob(id,action){return f.fence(async db=>{
   const [job]=await db.$queryRaw`SELECT * FROM "HistoryMigrationJob" WHERE id=${id} FOR UPDATE NOWAIT`;assert.ok(job,'Job not found');
   const [actor]=await db.$queryRaw`SELECT * FROM "User" WHERE id=${job.createdById} FOR SHARE NOWAIT`;
   assert.ok(actor?.active&&!actor.archivedAt&&actor.role==='OWNER','Owner unavailable');
   return action(new MigrationTransaction(db,job,actor));
  });}
 }
 const repository=new HistoryMigrationRepository(f.db);
 return {repository,backups,pilot:new NativeQualified(backups),intake:new HistoryMigrationService(repository,backups),planning:new HistoryMigrationPlanningService(repository,backups),
  snapshot:()=>fullSchemaSnapshot({query:async sql=>({rows:await f.db.$queryRawUnsafe(sql)})}),
 };
}
