import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const root=new URL('../prisma/migrations/',import.meta.url);
const target='20261015160000_design_composition';
const newFields={OrderItem:['archivedAt','discipline'],OrderItemInstance:['standardHeight'],Measurement:['archivedAt']};
const tables=['User','Client','Athlete','Measurement','Order','OrderItem','OrderItemInstance','Payment','ProductionSlot','Shipment','OrderShipment'];
async function snapshot(db,strip=false){
 const result={};
 for(const name of tables){
  const expression=(strip?newFields[name]??[]:[]).reduce((sql,key)=>`${sql} - '${key}'`,'to_jsonb(t)');
  result[name]=(await db.query(`SELECT ${expression} AS row FROM "${name}" t ORDER BY t.id`)).rows.map(row=>row.row);
 }
 return result;
}
const sqlCode=code=>error=>{assert.equal(error.code,code);return true;};
const operation=(db,id,order='order',actor='staff',key='same-key')=>db.query(`INSERT INTO "OrderCompositionOperation" (id,"orderId","actorId","operationKey","requestHash",result) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,[id,order,actor,key,'request-v1',JSON.stringify({itemId:'design',instanceIds:['piece-1','piece-2']})]);
const seed=`
INSERT INTO "User" (id,email,"passwordHash","displayName","updatedAt") VALUES ('staff','fixture@example.invalid','fixture','Staff','2026-10-01'),('staff2','fixture2@example.invalid','fixture','Staff2','2026-10-01');
INSERT INTO "Client" (id,"firstName","displayName","updatedAt") VALUES ('client','Fixture','Synthetic client','2026-10-01');
INSERT INTO "Athlete" (id,"clientId","firstName","updatedAt") VALUES ('athlete','client','Fixture','2026-10-01');
INSERT INTO "Measurement" (id,"athleteId","measuredAt",height,"values") VALUES ('snapshot-old','athlete','2026-08-01',165,'{"chest":80}'),('snapshot-new','athlete','2026-09-01',168,'{"chest":82}');
INSERT INTO "Order" (id,number,"clientId","athleteId","measurementId",type,"priceMinor","depositRequiredMinor","updatedAt") VALUES ('order','QA-MIGRATION-1','client','athlete','snapshot-old','CUSTOM_ORDER',30000,15000,'2026-10-01'),('order2','QA-MIGRATION-2','client','athlete','snapshot-new','CUSTOM_ORDER',10000,5000,'2026-10-01');
INSERT INTO "OrderItem" (id,"orderId",name,quantity,"priceMinor","athleteId","measurementId","updatedAt") VALUES ('design','order','Synthetic design',3,10000,'athlete','snapshot-old','2026-10-01');
INSERT INTO "Shipment" (id,"orderId",carrier,"trackingNumber",currency,"updatedAt") VALUES ('shipment','order','DHL','QA-LEGACY','EUR','2026-10-01');
INSERT INTO "OrderShipment" (id,"orderId",carrier,"trackingNumber",currency,"updatedAt") VALUES ('parcel','order','DHL','QA-PARCEL','EUR','2026-10-01');
INSERT INTO "OrderItemInstance" (id,"orderItemId",ordinal,"athleteId","measurementId","orderShipmentId","productionStatus","archivedAt","updatedAt") VALUES ('piece-1','design',1,'athlete','snapshot-old','parcel','READY',NULL,'2026-10-01'),('piece-2','design',2,'athlete','snapshot-new',NULL,'NOT_SCHEDULED',NULL,'2026-10-01'),('piece-3','design',3,'athlete','snapshot-old',NULL,'CANCELLED','2026-09-20','2026-10-01');
INSERT INTO "Payment" (id,"orderId","amountMinor",currency,method,"receivedAt","appliedAmountMinor","appliedCurrency") VALUES ('payment','order',15000,'EUR','BANK_TRANSFER','2026-09-15',15000,'EUR');
INSERT INTO "ProductionSlot" (id,"orderId","startsAt","endsAt",tentative,"updatedAt") VALUES ('slot','order','2026-10-05','2026-10-12',true,'2026-10-01');
`;

test('design composition migration preserves a historical multi-piece order in isolated PGlite',{timeout:120000},async t=>{
 const db=new PGlite();
 try{
  const names=(await readdir(root,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
  assert.ok(names.includes(target),'migration already exists; no pre-existence RED claimed');
  const historical=names.filter(name=>name<target);assert.ok(historical.length>=35);
  for(const name of historical){try{await db.exec(await readFile(new URL(`${name}/migration.sql`,root),'utf8'));}catch(cause){throw new Error(`Historical migration failed: ${name}`,{cause});}}
  await db.exec(seed);const before=await snapshot(db);
  const migration=await readFile(new URL(`${target}/migration.sql`,root),'utf8');
  const added=async()=> (await db.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND (table_name,column_name) IN (('OrderItem','archivedAt'),('OrderItem','discipline'),('OrderItemInstance','standardHeight'),('Measurement','archivedAt'))`)).rows;
  await t.test('DDL transaction failure leaves no partial schema and every legacy row unchanged',async()=>{
   assert.deepEqual(await added(),[]);
   await assert.rejects(db.transaction(async tx=>{await tx.exec(migration);assert.equal((await tx.query(`SELECT count(*)::int AS n FROM "OrderCompositionOperation"`)).rows[0].n,0);throw new Error('intentional-ddl-rehearsal-abort');}),/intentional-ddl-rehearsal-abort/);
   assert.deepEqual(await added(),[]);assert.equal((await db.query(`SELECT to_regclass('public."OrderCompositionOperation"') AS name`)).rows[0].name,null);assert.deepEqual(await snapshot(db),before);
  });
  await t.test('apply once retains quantity, snapshots, payments, slot, parcel links and archived piece without backfill',async()=>{
   await db.exec(migration);assert.deepEqual(await snapshot(db,true),before);
   assert.deepEqual((await db.query(`SELECT "archivedAt",discipline FROM "OrderItem"`)).rows,[{archivedAt:null,discipline:null}]);
   assert.deepEqual((await db.query(`SELECT "standardHeight" FROM "OrderItemInstance" ORDER BY id`)).rows,[{standardHeight:null},{standardHeight:null},{standardHeight:null}]);
   assert.deepEqual((await db.query(`SELECT "archivedAt" FROM "Measurement" ORDER BY id`)).rows,[{archivedAt:null},{archivedAt:null}]);
   assert.equal((await db.query(`SELECT count(*)::int AS n FROM "OrderCompositionOperation"`)).rows[0].n,0);
   const indexes=(await db.query(`SELECT indexname FROM pg_indexes WHERE tablename IN ('OrderItem','Measurement','OrderCompositionOperation')`)).rows.map(row=>row.indexname);
   for(const name of ['OrderItem_orderId_archivedAt_idx','Measurement_athleteId_archivedAt_measuredAt_idx','OrderCompositionOperation_orderId_operationKey_key'])assert.ok(indexes.includes(name),name);
  });
  await t.test('ordinary duplicate DDL fails rather than pretending migration application is idempotent',async()=>{
   await assert.rejects(db.transaction(tx=>tx.exec(migration)),sqlCode('42701'));assert.equal((await added()).length,4);assert.deepEqual(await snapshot(db,true),before);
  });
  await t.test('operation keys are per-order across actors; result, foreign keys and deletion restrictions are retained',async()=>{
   await operation(db,'op');await assert.rejects(operation(db,'duplicate','order','staff2'),sqlCode('23505'));await operation(db,'other-order','order2');
   assert.deepEqual((await db.query(`SELECT "requestHash",result FROM "OrderCompositionOperation" WHERE id='op'`)).rows,[{requestHash:'request-v1',result:{itemId:'design',instanceIds:['piece-1','piece-2']}}]);
   await assert.rejects(operation(db,'bad-order','absent'),sqlCode('23503'));await assert.rejects(operation(db,'bad-actor','order','absent','different-key'),sqlCode('23503'));
   await assert.rejects(db.exec(`DELETE FROM "User" WHERE id='staff'`),sqlCode('23001'));await assert.rejects(db.exec(`DELETE FROM "Order" WHERE id='order2'`),sqlCode('23001'));
   assert.equal((await db.query(`SELECT count(*)::int AS n FROM "OrderCompositionOperation"`)).rows[0].n,2);
  });
  await t.test('archive metadata keeps measurement versions and history links without changing money or production slot',async()=>{
   await db.exec(`UPDATE "OrderItem" SET "archivedAt"='2026-10-15',discipline='RHYTHMIC_GYMNASTICS' WHERE id='design';UPDATE "Measurement" SET "archivedAt"='2026-10-15' WHERE id='snapshot-old';UPDATE "OrderItemInstance" SET "standardHeight"=165 WHERE id='piece-1';`);
   const rows=(await db.query(`SELECT i.id,i."measurementId",i."orderShipmentId",i."archivedAt",m."values" FROM "OrderItemInstance" i JOIN "Measurement" m ON m.id=i."measurementId" ORDER BY i.id`)).rows;
   assert.equal(rows.length,3);assert.equal(rows[0].measurementId,'snapshot-old');assert.equal(rows[0].orderShipmentId,'parcel');assert.deepEqual(rows[0].values,{chest:80});assert.equal(rows[1].measurementId,'snapshot-new');assert.deepEqual(rows[1].values,{chest:82});assert.ok(rows[2].archivedAt);
   await assert.rejects(db.exec(`DELETE FROM "Measurement" WHERE id='snapshot-old'`),sqlCode('23001'));
   const after=await snapshot(db);for(const table of ['Payment','ProductionSlot','Shipment','OrderShipment','Order'])assert.deepEqual(after[table],before[table],table);
  });
  await t.test('real FK failure rolls back composition changes and operation evidence together',async()=>{
   const frozen=await snapshot(db);
   await assert.rejects(db.transaction(async tx=>{await tx.exec(`UPDATE "OrderItem" SET quantity=2,"priceMinor"=12345 WHERE id='design';UPDATE "OrderItemInstance" SET "archivedAt"='2026-10-16',"standardHeight"=168 WHERE id='piece-2';`);await operation(tx,'rollback-op','order','staff','rollback-key');await operation(tx,'invalid-fk','absent','staff','bad-key');}),sqlCode('23503'));
   assert.deepEqual(await snapshot(db),frozen);assert.equal((await db.query(`SELECT count(*)::int AS n FROM "OrderCompositionOperation" WHERE id IN ('rollback-op','invalid-fk')`)).rows[0].n,0);
  });
 }finally{await db.close();}
});
