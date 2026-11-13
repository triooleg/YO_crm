import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {ServiceUnavailableException} from '@nestjs/common';
import {loadTargetModule} from './website-test-loader.mjs';
const {assertClientMergeFileProtection}=loadTargetModule('clients/client-merge-database-guards.ts');
function approvedMigrationBody(path,name){
 const sql=readFileSync(new URL(path,import.meta.url),'utf8');
 const definition=sql.slice(sql.indexOf(`CREATE FUNCTION "${name}"`));
 const body=/AS\s+\$\$([\s\S]*?)\$\$/.exec(definition)?.[1];
 assert.ok(body,`Missing approved function ${name}`);return body;
}
const windowBody=approvedMigrationBody('../../../packages/database/prisma/migrations/20261103160000_client_file_merge_routing/migration.sql','lock_client_merge_workspace');
const routeBody=approvedMigrationBody('../../../packages/database/prisma/migrations/20260908070000_client_merge_redirect/migration.sql','route_merged_client_owner');
function valid(){
 const base={tableName:'ClientFile',tableSchema:'fixture',schema:'fixture',enabled:'O',internal:false,conditional:false,columnSpecific:false,triggerArguments:0,functionArguments:0,returnsTrigger:true,language:'plpgsql',functionSchema:'fixture'};
 return [{...base,triggerName:'client_file_merge_window',triggerType:30,functionName:'lock_client_merge_workspace',functionBody:windowBody},
 {...base,triggerName:'route_merged_client_owner',triggerType:23,functionName:'route_merged_client_owner',functionBody:routeBody}];
}
function transaction(rows,error){
 const reads=[];
 const tx=new Proxy({$queryRaw:async query=>{reads.push(query);if(error)throw error;return rows;}},{get(target,key){assert.equal(key,'$queryRaw','Guard must never perform a write or acquire its own advisory lock');return target[key];}});
 return {tx,reads};
}
function notReady(error){assert.ok(error instanceof ServiceUnavailableException);assert.equal(error.getStatus(),503);assert.equal(error.message,'CLIENT_MERGE_SCHEMA_NOT_READY');return true;}
async function rejects(rows){const {tx,reads}=transaction(rows);await assert.rejects(()=>assertClientMergeFileProtection(tx),notReady);assert.equal(reads.length,1);}

test('missing ClientFile protection fails closed using only a catalog read',async()=>{
 for(const rows of [[],valid().slice(0,1),valid().slice(1),null,[...valid(),valid()[0]]])await rejects(rows);
});
test('both required triggers accept O and A, with one parameterized catalog SELECT and no writes',async()=>{
 for(const left of ['O','A'])for(const right of ['O','A']){
  const rows=valid();rows[0].enabled=left;rows[1].enabled=right;
  const {tx,reads}=transaction(rows);await assertClientMergeFileProtection(tx);assert.equal(reads.length,1);
  const query=reads[0];assert.match(query.text,/^\s*SELECT\b/);assert.match(query.text,/pg_catalog\.pg_trigger/);
  assert.match(query.text,/current_schema\(\)/);assert.deepEqual(query.values,['ClientFile','client_file_merge_window','route_merged_client_owner']);
  assert.doesNotMatch(query.text,/ClientFile|client_file_merge_window|route_merged_client_owner/,'Object names are SQL bind values, never interpolated SQL');
 }
});
test('disabled, replica-only, wrong timing/events/table/function and conditional triggers fail closed',async()=>{
 const mutations=[['enabled','D'],['enabled','R'],['enabled',''],['triggerType',0],['triggerType',29],['triggerType',31],['triggerType',94],['tableName','Order'],['schema',''],['tableSchema','other'],['functionSchema','other'],['functionName','lookalike'],['internal',true],['conditional',true],['columnSpecific',true],['triggerArguments',1],['functionArguments',1],['returnsTrigger',false],['language','sql']];
 for(const index of [0,1])for(const [field,value] of mutations){const rows=valid();rows[index][field]=value;await rejects(rows);}
 const rows=valid();rows[1].triggerType=30;await rejects(rows);
 const swapped=valid();swapped[0].functionName='route_merged_client_owner';swapped[1].functionName='lock_client_merge_workspace';await rejects(swapped);
});
test('window must use shared transaction global lock and must not contain any exclusive advisory call',async()=>{
 for(const body of [
  windowBody.replace('_lock_shared','_lock'),
  windowBody.replace('RETURN NULL;',"PERFORM pg_advisory_xact_lock(42); RETURN NULL;"),
  windowBody.replace('RETURN NULL;',"PERFORM pg_try_advisory_lock(42); RETURN NULL;"),
  windowBody.replace('client-merge-global','other-window'),
  windowBody.replace(/global',\s*0/,"global',1"),
  `BEGIN /* ${windowBody} */ RETURN NULL; END;`,
  `BEGIN /* outer /* nested */ ${windowBody} */ RETURN NULL; END;`,
  `BEGIN PERFORM '${windowBody.replaceAll("'","''")}'; RETURN NULL; END;`,
  `BEGIN PERFORM $fake$${windowBody}$fake$; RETURN NULL; END;`,
  windowBody.replace('RETURN NULL;',"PERFORM '--'; PERFORM pg_advisory_xact_lock(42); RETURN NULL;"),
  windowBody.replace('RETURN NULL;',"PERFORM \"pg_advisory_xact_lock\"(42); RETURN NULL;"),
 ]){const rows=valid();rows[0].functionBody=body;await rejects(rows);}
});
test('routing function must actually reference redirect and Client FOR SHARE, not comment/string lookalikes',async()=>{
 for(const body of [routeBody.replace('FOR SHARE','FOR KEY SHARE'),routeBody.replace('ClientMergeRedirect','OtherRedirect'),routeBody.replace('FROM "Client"','FROM "Other"'),`BEGIN /* ${routeBody} */ RETURN NEW; END;`,`BEGIN PERFORM '${routeBody.replaceAll("'","''")}'; RETURN NEW; END;`]){const rows=valid();rows[1].functionBody=body;await rejects(rows);}
});
test('only approved complete bodies pass, with platform line endings and boundary whitespace tolerated',async()=>{
 const rows=valid();rows[0].functionBody='\n'+windowBody.replace(/\r?\n/g,'\r\n')+'\n';rows[1].functionBody='  '+routeBody+'  ';
 await assertClientMergeFileProtection(transaction(rows).tx);
 const unapproved=valid();unapproved[0].functionBody=windowBody.replace('pg_advisory_xact_lock_shared','pg_catalog."pg_advisory_xact_lock_shared"')+'\n-- pg_advisory_xact_lock(42);';
 await rejects(unapproved);
});
test('catalog read errors become only the fail-closed schema error',async()=>{
 const {tx}=transaction(undefined,new Error('database private diagnostic'));await assert.rejects(()=>assertClientMergeFileProtection(tx),notReady);
});

test('real PostgreSQL catalog queries validate trigger types, functions and enabled states in isolated PGlite',async()=>{
 const require=createRequire(new URL('../../../packages/database/package.json',import.meta.url));
 const {PGlite}=require('@electric-sql/pglite');const db=new PGlite();
 try{
  await db.exec(`CREATE SCHEMA fixture; SET search_path TO fixture,public;
   CREATE TABLE "Client" (id text PRIMARY KEY);
   CREATE TABLE "ClientMergeRedirect" ("sourceClientId" text,"targetClientId" text);
   CREATE TABLE "ClientFile" (id text PRIMARY KEY,"clientId" text);
   CREATE FUNCTION lock_client_merge_workspace() RETURNS trigger AS $$${windowBody}$$ LANGUAGE plpgsql;
   CREATE FUNCTION route_merged_client_owner() RETURNS trigger AS $$${routeBody}$$ LANGUAGE plpgsql;
   CREATE TRIGGER client_file_merge_window BEFORE INSERT OR UPDATE OR DELETE ON "ClientFile" FOR EACH STATEMENT EXECUTE FUNCTION lock_client_merge_workspace();
   CREATE TRIGGER route_merged_client_owner BEFORE INSERT OR UPDATE ON "ClientFile" FOR EACH ROW EXECUTE FUNCTION route_merged_client_owner();`);
  let calls=0;
  const tx={$queryRaw:async query=>{calls++;assert.match(query.text,/^\s*SELECT\b/);return (await db.query(query.text,query.values)).rows;}};
  await assertClientMergeFileProtection(tx);assert.equal(calls,1);
  await db.exec('ALTER TABLE "ClientFile" DISABLE TRIGGER client_file_merge_window');await assert.rejects(()=>assertClientMergeFileProtection(tx),notReady);
  await db.exec('ALTER TABLE "ClientFile" ENABLE ALWAYS TRIGGER client_file_merge_window');await assertClientMergeFileProtection(tx);
  await db.exec('ALTER TABLE "ClientFile" ENABLE REPLICA TRIGGER route_merged_client_owner');await assert.rejects(()=>assertClientMergeFileProtection(tx),notReady);
  await db.exec('ALTER TABLE "ClientFile" ENABLE TRIGGER route_merged_client_owner');
  await db.exec(`CREATE OR REPLACE FUNCTION lock_client_merge_workspace() RETURNS trigger AS $$${windowBody.replace('_lock_shared','_lock')}$$ LANGUAGE plpgsql;`);
  await assert.rejects(()=>assertClientMergeFileProtection(tx),notReady);
  assert.deepEqual((await db.query('SELECT count(*)::int AS count FROM "ClientFile"')).rows,[{count:0}]);
 }finally{await db.close();}
});

test('early returns and unreachable protection never satisfy the schema gate',async t=>{
 for(const [label,index,body] of [
  ['window returns before its lock',0,windowBody.replace('BEGIN','BEGIN RETURN NULL;')],
  ['routing returns before locking or redirecting',1,routeBody.replace('BEGIN','BEGIN RETURN NEW;')],
  ['window lock exists only in an unreachable branch',0,`BEGIN IF FALSE THEN PERFORM pg_advisory_xact_lock_shared(hashtextextended('client-merge-global',0)); END IF; RETURN NULL; END;`],
  ['routing exists only in an unreachable branch',1,routeBody.replace('BEGIN','BEGIN IF FALSE THEN').replace(/END;\s*$/,'END IF; RETURN NEW; END;')],
 ])await t.test(label,async()=>{const rows=valid();rows[index].functionBody=body;await rejects(rows);});
});
