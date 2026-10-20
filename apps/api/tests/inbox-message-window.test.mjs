import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {PGlite}=createRequire(new URL('../../../packages/database/package.json',import.meta.url))('@electric-sql/pglite');
const {latestInboxMessageIds}=await import('../src/communications/inbox-message-window.ts');
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
