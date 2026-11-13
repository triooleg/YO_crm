import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {HistoryMigrationRepository}=loadTargetModule('history-migration/history-migration.repository.ts');
test('operational repository pre-lock completes before job/owner lookup within the same application transaction',async()=>{
 const calls=[],db={$queryRaw:async query=>{const sql=query.join('?');calls.push(sql.includes('HistoryMigrationJob')?'JOB':'OWNER');return sql.includes('HistoryMigrationJob')?[{id:'job',createdById:'owner'}]:[{id:'owner',active:true,archivedAt:null,role:'OWNER'}]}};
 const repository=new HistoryMigrationRepository({$transaction:async callback=>callback(db)});
 await repository.withJob('job',async tx=>{assert.equal(tx.db,db);calls.push('ACTION')},async same=>{assert.equal(same,db);calls.push('PRELOCK')});
 assert.deepEqual(calls,['PRELOCK','JOB','OWNER','ACTION']);
});
test('failed pre-lock cannot read the job or execute migration action',async()=>{
 let reads=0,actions=0;const repository=new HistoryMigrationRepository({$transaction:async callback=>callback({$queryRaw:async()=>{reads++;return []}})});
 await assert.rejects(repository.withJob('job',async()=>actions++,async()=>{throw Error('LOCK_REFUSED')}),/LOCK_REFUSED/);
 assert.equal(reads,0);assert.equal(actions,0);
});
test('ordinary staging and planning hold the global merge read lock before the job row too',async()=>{
 const calls=[],db={$executeRaw:async query=>{assert.ok(query.join('?').includes('pg_advisory_xact_lock_shared'));calls.push('GLOBAL')},$queryRaw:async query=>{const job=query.join('?').includes('HistoryMigrationJob');calls.push(job?'JOB':'OWNER');return job?[{id:'job',createdById:'owner'}]:[{id:'owner',active:true,archivedAt:null,role:'OWNER'}]}};
 const repository=new HistoryMigrationRepository({$transaction:async callback=>callback(db)});
 await repository.withJob('job',async()=>calls.push('ACTION'));
 assert.deepEqual(calls,['GLOBAL','JOB','OWNER','ACTION']);
});
