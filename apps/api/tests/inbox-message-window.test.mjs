import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {loadTargetModule} from './overview-target-loader.mjs';
const {PGlite}=createRequire(new URL('../../../packages/database/package.json',import.meta.url))('@electric-sql/pglite');
const {latestInboxMessageIds}=loadTargetModule('communications/inbox-message-window.ts');
test('последний отправленный старый черновик входит в окно после 300 новых сообщений',async()=>{
  const db=new PGlite();
  try{
    await db.exec('CREATE TABLE "Conversation" (id text, "clientId" text, "archivedAt" timestamp); CREATE TABLE "Message" (id text,"conversationId" text,direction text,status text,"createdAt" timestamp,"sentAt" timestamp,"receivedAt" timestamp,"messageType" text,metadata jsonb);');
    await db.exec(`INSERT INTO "Conversation" VALUES ('chat','client',NULL);INSERT INTO "Message" SELECT 'incoming-'||i,'chat','INBOUND','RECEIVED','2026-10-14 12:00:00'::timestamp+i*interval '1 second',NULL,NULL,'text',NULL FROM generate_series(1,301) i; INSERT INTO "Message" VALUES ('sent-draft','chat','OUTBOUND','SENT','2026-01-01','2026-10-14 13:00:00',NULL,'text',NULL),('deleted','chat','OUTBOUND','SENT','2026-10-14 14:00:00',NULL,NULL,'text','{"deletion":{"deletedAt":"2026-10-14"}}'),('reaction','chat','INBOUND','RECEIVED','2026-10-14 15:00:00',NULL,NULL,'reaction',NULL);`);
    const rows=await latestInboxMessageIds({$queryRaw:async sql=>(await db.query(sql.text,sql.values)).rows},{clientId:'client'});
    assert.equal(rows.length,300);assert.equal(rows[0].id,'sent-draft');assert.equal(rows[299].id,'incoming-3');
    assert.equal(rows.some(row=>['deleted','reaction'].includes(row.id)),false);
    assert.equal((await latestInboxMessageIds({$queryRaw:async sql=>(await db.query(sql.text,sql.values)).rows},{clientId:'other'})).length,0);
  }finally{await db.close();}
});

test('archive boundary respects large ordinals without inventing equal-ordinal precedence',async()=>{
  const sourceKey=message=>JSON.stringify([message.source,message.account,message.channel,message.dialogueId,message.sourceMessageId]);
  const db=new PGlite();
  try{
    await db.exec('CREATE TABLE "Conversation" (id text, "clientId" text, "archivedAt" timestamp); CREATE TABLE "Message" (id text,"conversationId" text,direction text,status text,"createdAt" timestamp,"sentAt" timestamp,"receivedAt" timestamp,"messageType" text,metadata jsonb); INSERT INTO "Conversation" VALUES (\'chat\',\'client\',NULL);');
    const messages=Array.from({length:297},(_,i)=>({source:'KEYCRM',account:'test',channel:'INSTAGRAM',dialogueId:'thread',sourceMessageId:String(i),ordinal:9999999999,time:{utc:'2024-01-01T10:30:00.000Z'}}));
    for(const id of ['A','a','\uE000','😀'])messages.push({...messages[0],sourceMessageId:id,ordinal:10000000000});
    messages.push({...messages[0],sourceMessageId:'maximum',ordinal:Number.MAX_SAFE_INTEGER});
    for(const [index,message] of messages.entries())await db.query('INSERT INTO "Message" VALUES ($1,\'chat\',\'INBOUND\',\'RECEIVED\',\'2024-01-01 10:30:00\',NULL,NULL,\'text\',$2::jsonb)',['reverse-'+(1000-index),JSON.stringify({historyArchive:{policy:'KEYCRM_SOURCE_ARCHIVE_V1',sourceVariants:[{ordinal:message.ordinal,sourceKey:sourceKey(message)}]}})]);
    const expected=messages.map((message,index)=>({message,id:'reverse-'+(1000-index)})).sort((a,b)=>b.message.ordinal-a.message.ordinal||(a.id<b.id?1:a.id>b.id?-1:0)).slice(0,300).map(item=>item.id);
    const rows=await latestInboxMessageIds({$queryRaw:async sql=>(await db.query(sql.text,sql.values)).rows},{clientId:'client'});
    assert.deepEqual(rows.map(r=>r.id),expected);
  }finally{await db.close();}
});

test('архив: исходный порядок внутри минуты определяется до ограничения окна',async()=>{
  const db=new PGlite();
  try{
    await db.exec('CREATE TABLE "Conversation" (id text, "clientId" text, "archivedAt" timestamp); CREATE TABLE "Message" (id text,"conversationId" text,direction text,status text,"createdAt" timestamp,"sentAt" timestamp,"receivedAt" timestamp,"messageType" text,metadata jsonb);');
    await db.exec(`INSERT INTO "Conversation" VALUES ('chat','client',NULL),('other','other',NULL),('hidden','client',CURRENT_TIMESTAMP);
      INSERT INTO "Message" SELECT 'reverse-'||lpad((400-i)::text,3,'0'),'chat','INBOUND','RECEIVED','2024-01-01 10:30:00',NULL,'2024-01-01 10:30:00','text',jsonb_build_object('historyArchive',jsonb_build_object('policy','KEYCRM_SOURCE_ARCHIVE_V1','sourceVariants',jsonb_build_array(jsonb_build_object('ordinal',i,'sourceKey',jsonb_build_array('KEYCRM','test','INSTAGRAM','thread',i::text)::text)))) FROM generate_series(0,300) i;
      INSERT INTO "Message" VALUES ('bad-ordinal','other','INBOUND','RECEIVED','2024-01-01',NULL,NULL,'text','{"historyArchive":{"policy":"KEYCRM_SOURCE_ARCHIVE_V1","sourceVariants":[{"ordinal":"oops"}]}}'),('hidden','hidden','INBOUND','RECEIVED','2026-01-01',NULL,NULL,'text',NULL);`);
    const port={$queryRaw:async sql=>(await db.query(sql.text,sql.values)).rows};
    const rows=await latestInboxMessageIds(port,{clientId:'client'});
    assert.equal(rows.length,300);assert.equal(rows[0].id,'reverse-100');assert.equal(rows[299].id,'reverse-399');
    assert.deepEqual(await latestInboxMessageIds(port,{conversationId:'chat'}),rows);
    assert.deepEqual(await latestInboxMessageIds(port,{clientId:'client'}),rows,'polling is stable');
    assert.equal((await latestInboxMessageIds(port,{clientId:'other'}))[0].id,'bad-ordinal');
  }finally{await db.close();}
});

test('two dialogues retain A99 before A100=B0 across the 300-message boundary',async()=>{
  const db=new PGlite();
  try{
    await db.exec('CREATE TABLE "Conversation" (id text, "clientId" text, "archivedAt" timestamp); CREATE TABLE "Message" (id text,"conversationId" text,direction text,status text,"createdAt" timestamp,"sentAt" timestamp,"receivedAt" timestamp,"messageType" text,metadata jsonb); INSERT INTO "Conversation" VALUES (\'chat\',\'client\',NULL);');
    const variant=(thread,ordinal)=>({ordinal,sourceKey:JSON.stringify(['KEYCRM','test','INSTAGRAM',thread,String(ordinal)])});
    const messages=Array.from({length:299},(_,i)=>({id:'reverse-'+String(999-i).padStart(3,'0'),sourceVariants:[variant('A',i)]}));
    messages.push({id:'known-X',sourceVariants:[variant('A',299)]},{id:'merged-Y',sourceVariants:[variant('B',0),variant('A',300)]});
    for(const m of messages)await db.query('INSERT INTO "Message" VALUES ($1,\'chat\',\'INBOUND\',\'RECEIVED\',\'2024-01-01 10:30:00\',NULL,NULL,\'text\',$2::jsonb)',[m.id,JSON.stringify({historyArchive:{policy:'KEYCRM_SOURCE_ARCHIVE_V1',sourceVariants:m.sourceVariants}})]);
    const rows=await latestInboxMessageIds({$queryRaw:async sql=>(await db.query(sql.text,sql.values)).rows},{clientId:'client'});
    assert.equal(rows.length,300);assert.equal(rows[0].id,'merged-Y');assert.equal(rows[1].id,'known-X');assert.equal(rows.at(-1).id,'reverse-998');
  }finally{await db.close();}
});
