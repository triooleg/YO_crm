import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {loadTargetModule} from './overview-target-loader.mjs';
const require=createRequire(import.meta.url),{PrismaClient}=require('@prisma/client');
const url=process.env.TAX_TEST_DATABASE_URL;
if(url){const u=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(u.hostname)&&u.pathname==='/tax_accounting_http_test','Only isolated HTTP test database accepted');}
test('actual PostgreSQL: tax audit failure rolls back payment, deposit, production, pending roots and history together',{skip:!url,timeout:30000},async()=>{
 const db=new PrismaClient({datasourceUrl:url}),marker='tax_atomic_'+randomUUID().replaceAll('-','');assert.match(marker,/^tax_atomic_[a-f0-9]+$/);
 const {OrdersService}=loadTargetModule('orders/orders.service.ts'),{TaxesService}=loadTargetModule('taxes/taxes.service.ts');
 let triggerCreated=false;
 try{
  const actor=await db.user.create({data:{email:marker+'@example.invalid',displayName:'Synthetic atomicity test',passwordHash:'not-a-login-hash',role:'OWNER'}});
  const client=await db.client.create({data:{firstName:'Synthetic',displayName:marker}});
  const order=await db.order.create({data:{number:marker,clientId:client.id,type:'CUSTOM_ORDER',currency:'UAH',priceMinor:2000000,depositRequiredMinor:1000000}});
  await db.productionSlot.create({data:{orderId:order.id,startsAt:new Date('2026-05-02T00:00:00Z'),endsAt:new Date('2026-05-10T00:00:00Z'),tentative:true}});
  const before=await db.order.findUnique({where:{id:order.id}}),taxes=new TaxesService(db,{rate:async(currency,incomeDate)=>({numerator:'1',denominator:'1',provider:'NBU',currency,incomeDate,effectiveDate:incomeDate,url:'UAH',fetchedAt:new Date().toISOString(),raw:'UAH=1'})});
  assert.equal((await taxes.settings(actor)).enabled,true,'Fixture requires explicit enabled local test policy');
  await db.$executeRawUnsafe(`CREATE FUNCTION "${marker}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityType"='TaxLedger' AND NEW.action='TAX_CAPTURE' AND EXISTS(SELECT 1 FROM "Payment" p WHERE p.id=NEW.after->>'paymentId' AND p.reference='${marker}') THEN RAISE EXCEPTION 'Synthetic tax audit rejected'; END IF;RETURN NEW;END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER "${marker}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${marker}"()`);triggerCreated=true;
  const service=new OrdersService(db,{}, {capturePayment:(...args)=>taxes.capturePayment(...args),reconcilePayment:async()=>({examined:0,finalized:0,retried:0,deferred:0})});
  await assert.rejects(service.addPayment(order.id,{amountMinor:1000000,currency:'UAH',method:'BANK_TRANSFER',receivedAt:'2026-05-01T10:00:00Z',reference:marker},actor),/Synthetic tax audit rejected/);
  assert.equal(await db.payment.count({where:{orderId:order.id}}),0);
  const roots=await db.$queryRawUnsafe('SELECT id FROM "TaxEntry" WHERE "orderId"=$1',order.id);assert.equal(roots.length,0);
  const after=await db.order.findUnique({where:{id:order.id}});assert.equal(after.paymentStatus,before.paymentStatus);assert.equal(after.productionStatus,before.productionStatus);assert.equal(after.updatedAt.toISOString(),before.updatedAt.toISOString());
  assert.equal((await db.productionSlot.findUnique({where:{orderId:order.id}})).tentative,true);
  assert.equal(await db.activity.count({where:{orderId:order.id}}),0);
  assert.equal(await db.auditLog.count({where:{actorId:actor.id}}),0);
  const valid=await service.addPayment(order.id,{amountMinor:1000000,currency:'UAH',method:'BANK_TRANSFER',receivedAt:'2026-05-01T10:00:00Z',reference:marker+'-valid'},actor);
  assert.equal(valid.amountMinor,1000000);assert.equal(valid.currency,'UAH');assert.equal(await db.payment.count({where:{orderId:order.id}}),1);
  const committed=await db.order.findUnique({where:{id:order.id}});assert.equal(committed.paymentStatus,'DEPOSIT_PAID');assert.equal(committed.productionStatus,'SCHEDULED');assert.equal((await db.productionSlot.findUnique({where:{orderId:order.id}})).tentative,false);
  const captured=await db.$queryRawUnsafe(`SELECT id FROM "TaxEntry" WHERE "orderId"=$1 AND kind='ROOT'`,order.id);assert.equal(captured.length,2);
  const sources=await db.$queryRawUnsafe(`SELECT s.*,r.component FROM "TaxEntry" s JOIN "TaxEntry" r ON r.id=s."rootId" WHERE s."orderId"=$1 AND s.kind='SOURCE' ORDER BY s.id`,order.id);assert.equal(sources.length,2);
  for(const source of sources){
   const amountMinor=source.component==='UNIFIED'?50000:10000,rate={numerator:'1',denominator:'1',provider:'NBU',currency:'UAH',incomeDate:'2026-05-01',effectiveDate:'2026-05-01',url:'UAH',fetchedAt:new Date().toISOString(),raw:'UAH=1'};
   const snapshot={lifecycle:true,sourceId:source.id,stateHash:source.snapshot.stateHash,rate,grossMinor:1000000,incomeDate:'2026-05-01',postingPeriod:'2026-05',receiptConfirmed:false,evidence:null,originalPayment:source.snapshot.state,rounding:'half-up kopecks',targetMinor:amountMinor};
   await db.$executeRawUnsafe(`INSERT INTO "TaxEntry"(id,"periodId","policyId","paymentId","orderId",component,kind,"rootId","operationKey","payloadHash","amountMinor","baseMinor",snapshot) VALUES($1,$2,$3,$4,$5,$6,'FINALIZE',$7,$8,$9,$10,$11,$12::jsonb)`,randomUUID(),source.periodId,source.policyId,source.paymentId,source.orderId,source.component,source.rootId,'reconcile:'+source.id,'0'.repeat(64),amountMinor,1000000,JSON.stringify(snapshot));
  }
  const legacyFinals=await db.$queryRawUnsafe(`SELECT id,"operationKey","amountMinor",snapshot FROM "TaxEntry" WHERE "orderId"=$1 AND snapshot->>'lifecycle'='true' ORDER BY id`,order.id);assert.equal(legacyFinals.length,2);
  const liabilityBefore=legacyFinals.reduce((sum,row)=>sum+BigInt(row.amountMinor),0n);
  const firstRepair=await taxes.reconcilePayment(valid.id);assert.equal(firstRepair.finalized,2);
  const repaired=await db.$queryRawUnsafe(`SELECT id,"operationKey","amountMinor",snapshot FROM "TaxEntry" WHERE "orderId"=$1 AND snapshot->>'lifecycle'='true' ORDER BY id`,order.id);
  assert.equal(repaired.length,4);assert.equal(repaired.reduce((sum,row)=>sum+BigInt(row.amountMinor),0n),liabilityBefore);
  for(const original of legacyFinals){const unchanged=repaired.find(row=>row.id===original.id);assert.deepEqual(unchanged,original);}
  const confirmations=repaired.filter(row=>row.operationKey.startsWith('reconcile-confirmed:'));
  assert.equal(confirmations.length,2);assert.ok(confirmations.every(row=>BigInt(row.amountMinor)===0n&&row.snapshot.receiptConfirmed===true));
  const repeated=await taxes.reconcilePayment(valid.id);assert.equal(repeated.finalized,0);
  assert.equal((await db.$queryRawUnsafe(`SELECT id FROM "TaxEntry" WHERE "orderId"=$1 AND snapshot->>'lifecycle'='true'`,order.id)).length,4);

 }finally{
  if(triggerCreated)await db.$executeRawUnsafe(`DROP TRIGGER "${marker}" ON "AuditLog"`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${marker}"()`);await db.$disconnect();
 }
});
