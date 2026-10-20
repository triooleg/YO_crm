import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const {setInboxSpam}=await import('../src/communications/inbox-spam.ts');
function fixture(){
  let client={id:'client-spam',archivedAt:null,inboxSpamAt:null};const audit=[],activities=[];
  const tx={client:{findFirst:async()=>client,updateMany:async({where,data})=>{if((client.inboxSpamAt?.toISOString()??null)!==(where.inboxSpamAt?.toISOString()??null))return{count:0};client={...client,...data};return{count:1};}},activity:{create:async({data})=>activities.push(data)},auditLog:{create:async({data})=>audit.push(data)}};
  return{tx,audit,activities,getClient:()=>client};
}
test('спам можно пометить и снять без удаления клиента и сообщений',async()=>{
  const f=fixture();const marked=await setInboxSpam(f.tx,'client-spam',{spam:true,expectedSpamAt:null},'manager-1');
  assert.ok(marked.inboxSpamAt instanceof Date);
  const restored=await setInboxSpam(f.tx,'client-spam',{spam:false,expectedSpamAt:marked.inboxSpamAt.toISOString()},'manager-1');
  assert.equal(restored.inboxSpamAt,null);assert.equal(f.getClient().archivedAt,null);
  assert.deepEqual(f.activities.map(a=>a.type),['INBOX_SPAM_MARKED','INBOX_SPAM_RESTORED']);
  assert.equal(f.audit[0].actorId,'manager-1');
});
test('устаревшая пометка не отменяет более новое решение',async()=>{
  const f=fixture();await setInboxSpam(f.tx,'client-spam',{spam:true,expectedSpamAt:null},'manager-1');
  await assert.rejects(setInboxSpam(f.tx,'client-spam',{spam:false,expectedSpamAt:null},'manager-2'),/уже изменена/);
  assert.equal(f.audit.length,1);
});
test('миграция сохраняет старого клиента, отказ аудита откатывает пометку',async()=>{
  const {PGlite}=createRequire(new URL('../../../packages/database/package.json',import.meta.url))('@electric-sql/pglite');
  const db=new PGlite();
  try{
    await db.exec('CREATE TABLE "Client" (id text,"displayName" text,"archivedAt" timestamp); INSERT INTO "Client" VALUES (\'client-spam\',\'Preserved\',NULL);CREATE TABLE "Activity" (type text);');
    await db.exec(readFileSync(new URL('../../../packages/database/prisma/migrations/20261014140000_client_inbox_spam/migration.sql',import.meta.url),'utf8'));
    const initial=(await db.query('SELECT * FROM "Client"')).rows[0];
    assert.equal(initial.displayName,'Preserved');assert.equal(initial.inboxSpamAt,null);
    await assert.rejects(db.transaction(async sql=>setInboxSpam({
      client:{findFirst:async()=>(await sql.query('SELECT id,"inboxSpamAt" FROM "Client" WHERE id=$1 AND "archivedAt" IS NULL',['client-spam'])).rows[0],updateMany:async({data})=>{const result=await sql.query('UPDATE "Client" SET "inboxSpamAt"=$1 WHERE id=$2 AND "inboxSpamAt" IS NULL RETURNING id',[data.inboxSpamAt,'client-spam']);return{count:result.rows.length};}},
      activity:{create:async({data})=>sql.query('INSERT INTO "Activity" VALUES ($1)',[data.type])},
      auditLog:{create:async()=>{throw new Error('Audit failure');}},
    },'client-spam',{spam:true,expectedSpamAt:null},'manager-1')),/Audit failure/);
    assert.equal((await db.query('SELECT "inboxSpamAt" FROM "Client"')).rows[0].inboxSpamAt,null);
    assert.equal((await db.query('SELECT * FROM "Activity"')).rows.length,0);
  }finally{await db.close();}
});
