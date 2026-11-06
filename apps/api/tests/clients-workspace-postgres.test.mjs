import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,writeFileSync} from 'node:fs';
import {loadTargetModule} from './overview-target-loader.mjs';
const engine=new URL('../../../.local/clients-pg/node_modules/@electric-sql/pglite/dist/index.js',import.meta.url);
test('workspace aggregates, search and duplicate evidence run on isolated PostgreSQL with constant page queries', {skip:!existsSync(engine),timeout:120000},async()=>{
 const {PGlite}=await import(engine.href),pg=new PGlite({parsers:{1114:value=>new Date(value.replace(' ','T')+'Z')}});
 const {ClientsWorkspaceReadService}=loadTargetModule('clients/clients-workspace-read.ts');
 try {
  await pg.exec(`CREATE TABLE "Client"(id text PRIMARY KEY,"displayName" text,email text,phone text,instagram text,"instagramUsername" text,facebook text,whatsapp text,country text,source text,status text,"createdAt" timestamp,"archivedAt" timestamp);
   CREATE TABLE "Order"(id text PRIMARY KEY,"clientId" text,"createdAt" timestamp,"archivedAt" timestamp,number text,"sourceSystem" text,"externalNumber" text,"externalId" text);
   CREATE TABLE "Conversation"(id text,"clientId" text,channel text,"externalId" text,"archivedAt" timestamp,subject text,"unreadCount" integer DEFAULT 0,"lastMessageAt" timestamp);
   CREATE TABLE "Message"(id text,"conversationId" text,content text,direction text,status text,"messageType" text DEFAULT 'text',metadata jsonb,"sentAt" timestamp,"receivedAt" timestamp,"createdAt" timestamp);
   CREATE INDEX "Order_clientId_createdAt_idx" ON "Order"("clientId","createdAt");
   CREATE UNIQUE INDEX "Conversation_clientId_channel_key" ON "Conversation"("clientId",channel);
   INSERT INTO "Client" SELECT 'c'||n,'Client '||n,'person'||n||'@example.test','+380 99 '||lpad(n::text,7,'0'),NULL,NULL,NULL,NULL,'Ukraine','MANUAL','ACTIVE','2026-01-01'::timestamp,NULL FROM generate_series(1,10000) n;
   INSERT INTO "Order"(id,"clientId","createdAt","archivedAt",number) SELECT 'o'||n,'c'||(1+n%10000),'2026-01-01'::timestamp+n*interval '1 minute',CASE WHEN n%7=0 THEN '2026-10-01'::timestamp ELSE NULL END,'26-'||n FROM generate_series(1,50000)n;
   UPDATE "Client" SET email='shared@example.test',phone='+380 99 1234567' WHERE id IN ('c1','c2');
   UPDATE "Client" SET "archivedAt"=CURRENT_TIMESTAMP WHERE id='c3';
   UPDATE "Client" SET status='LEAD' WHERE id='c4';
   UPDATE "Client" SET status='VIP' WHERE id='c5';
   UPDATE "Client" SET status='BLOCKED' WHERE id='c6';
   UPDATE "Order" SET "archivedAt"=CURRENT_TIMESTAMP WHERE "clientId"='c7' OR ("clientId"='c8' AND id<>'o7');
   INSERT INTO "Conversation"(id,"clientId",channel,"externalId") VALUES('chat1','c1','INSTAGRAM','account:provider-555'),('chat2','c1','EMAIL','account:email');
   UPDATE "Order" SET number='legacy',"sourceSystem"='YOLEOTARD_WEBSITE',"externalNumber"='22732',"externalId"='22732' WHERE id='o50000'; ANALYZE;`);
  const calls=[];let lastSql;
  const db={$queryRaw:async sql=>{lastSql=sql;calls.push('query');return (await pg.query(sql.text,sql.values)).rows},client:{findMany:async args=>{calls.push('clients');assert.equal(args.select.orders,undefined);assert.equal(args.select.conversations,undefined);return (await pg.query('SELECT * FROM "Client" WHERE id=ANY($1)',[args.where.id.in])).rows},groupBy:async args=>{calls.push('filters');const field=args.by[0];assert.ok(['country','source','status'].includes(field));return (await pg.query(`SELECT DISTINCT "${field}" FROM "Client" WHERE "archivedAt" IS NULL`)).rows}}};db.$transaction=async fn=>fn(db);
  const service=new ClientsWorkspaceReadService(db),metrics=[];
  for(const pageSize of ['20','50']){
   calls.length=0;const started=performance.now(),result=await service.list({pageSize,sort:'orderCount'});
   metrics.push({pageSize:Number(pageSize),queries:calls.length,milliseconds:Math.round(performance.now()-started)});
   assert.equal(result.total,9999);assert.deepEqual(result.statistics,{active:9997,leads:1,repeat:9997});assert.equal(result.items.length,Number(pageSize));assert.equal(calls.length,5);
   const expected=(await pg.query('SELECT count(*)::int n FROM "Order" WHERE "clientId"=$1 AND "archivedAt" IS NULL',[result.items[0].id])).rows[0].n;
   assert.equal(result.items[0].orderCount,expected);
  }
  const listSql=lastSql;
  const filtered=await service.list({status:'LEAD'});
  assert.equal(filtered.total,1);assert.deepEqual(filtered.statistics,{active:0,leads:1,repeat:1});
  const empty=await service.list({status:'LEAD',country:'Spain'});
  assert.deepEqual(empty.statistics,{active:0,leads:0,repeat:0});
  const plan=(await pg.query('EXPLAIN (ANALYZE,FORMAT JSON) '+listSql.text,listSql.values)).rows;
  const legacyRow=(await service.list({search:'provider-555'})).items[0];assert.equal(legacyRow.id,'c1');assert.equal(legacyRow.latestOrder.externalNumber,'22732');assert.equal(legacyRow.latestOrder.sourceSystem,'YOLEOTARD_WEBSITE');
  assert.equal((await service.list({search:'shared@example.test'})).total,2);
  assert.equal((await service.list({search:'%'})).total,0);
  assert.equal((await service.list({page:'100000'})).total,9999);
  const dup=await service.duplicates({email:'SHARED@example.test'});
  assert.equal(dup.items.length,2);assert.ok(dup.items.every(v=>v.reasons.includes('EMAIL')&&v.related.some(other=>other.reasons.includes('EMAIL')&&other.reasons.includes('PHONE'))));
  await pg.exec(`UPDATE "Client" SET "displayName"='Same name' WHERE id IN ('c4','c5');`);
  const incoming=await service.duplicates({email:'person4@example.test'});
  assert.ok(incoming.items[0].reasons.includes('EMAIL'),'incoming exact email must remain explicit despite weak existing name match');
  const outOfRange=await service.duplicates({email:'SHARED@example.test',page:'2'});assert.equal(outOfRange.total,2);
  await pg.exec(`UPDATE "Client" SET "displayName"='Common name' WHERE id IN(SELECT id FROM "Client" WHERE "archivedAt" IS NULL ORDER BY id LIMIT 2000); ANALYZE;`);
  const duplicateStarted=performance.now(),common=await service.duplicates({pageSize:'20'}),duplicateMilliseconds=Math.round(performance.now()-duplicateStarted);
  assert.ok(common.total>=2000);assert.equal(common.items.length,20);assert.ok(common.items.every(v=>v.duplicateIds.length<=20));assert.ok(JSON.stringify(common).length<100000);
  await pg.exec(`UPDATE "Conversation" SET "lastMessageAt"='2026-01-01';
   INSERT INTO "Message"(id,"conversationId",content,direction,status,metadata,"receivedAt","createdAt") VALUES
   ('historic','chat1','Original historical message','INBOUND','RECEIVED',NULL,'2020-01-01','2026-01-01'),
   ('deleted','chat1','Hidden later message','INBOUND','RECEIVED','{"deletion":{"deletedAt":"2026-01-01"}}','2026-01-01','2026-01-01'),
   ('hidden-only','chat2','Hidden-only conversation','INBOUND','RECEIVED','{"deduplicatedIntoMessageId":"historic"}','2026-01-01','2026-01-01');
   INSERT INTO "Message"(id,"conversationId",content,direction,status,"messageType","receivedAt","createdAt") VALUES ('reaction','chat1','like','INBOUND','RECEIVED','reaction','2026-02-01','2026-02-01'),('draft','chat1','draft','OUTBOUND','DRAFT','text',NULL,'2026-03-01');`);
  db.clientMergeRedirect={findUnique:async()=>null};db.client.findFirst=async args=>(await pg.query('SELECT id FROM "Client" WHERE id=$1 AND "archivedAt" IS NULL',[args.where.id])).rows[0]??null;
  db.conversation={count:async args=>(await pg.query('SELECT count(*)::int n FROM "Conversation" WHERE "clientId"=$1 AND "archivedAt" IS NULL',[args.where.clientId])).rows[0].n};
  const conversations=await service.detail('c1',{tab:'conversations'});
  assert.equal(conversations.total,2);assert.equal(conversations.items[0].id,'chat1');assert.equal(conversations.items[0].lastMessage.content,'Original historical message');
  assert.equal(new Date(conversations.items[0].lastMessageAt).getUTCFullYear(),2020);assert.equal(conversations.items[1].lastMessageAt,null);assert.equal(conversations.items[1].lastMessage,null);
  const count=(await pg.query('SELECT count(*)::int n FROM "Client"')).rows[0].n;assert.equal(count,10000);
  writeFileSync(new URL('../../../.local/clients-performance.json',import.meta.url),JSON.stringify({engine:'isolated PostgreSQL/PGlite',clients:10000,orders:50000,metrics,duplicateCohort:{sameName:2000,milliseconds:duplicateMilliseconds,returned:common.items.length,bytes:JSON.stringify(common).length},plan},null,2));
 } finally {await pg.close()}
});
