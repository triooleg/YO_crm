import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('number reservations enforce unique sequence and checkout bindings in PostgreSQL', async()=>{
 const db=new PGlite();
 try {
  const url=new URL('../prisma/migrations/20261112190000_website_order_number_reservations/migration.sql',import.meta.url);
  await db.exec(await readFile(url,'utf8'));
  const reserve=(source,cart,number,sequence,checkout=null)=>db.query(
   'INSERT INTO "WebsiteOrderNumberReservation" ("sourceAccount","cartKey","number","sequence","expiresAt","externalId") VALUES ($1,$2,$3,$4,now(),$5)',
   [source,cart,number,sequence,checkout]);
  await reserve('a.example','cart1','26-717',717,'order1');
  await reserve('a.example','cart2','26-718',718);
  await reserve('a.example','cart3','26-719',719);
  await assert.rejects(reserve('b.example','cart1','27-717',717),{code:'23505'});
  await assert.rejects(reserve('a.example','cart4','26-720',720,'order1'),{code:'23505'});
  await reserve('b.example','cart1','26-720',720,'order1');
 } finally {await db.close();}
});
