import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {loadTargetModule} from './overview-target-loader.mjs';
const require=createRequire(new URL('../../../packages/database/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
const {TaxesService}=loadTargetModule('taxes/taxes.service.ts');
const normalize=value=>JSON.parse(JSON.stringify(value));

async function fixture(){
  const db=new PGlite({parsers:{1114:value=>new Date(value.replace(' ','T')+'Z')}});
  try {
    const folder=process.env.FINANCE_TAX_TEST_MIGRATIONS
      ? pathToFileURL(process.env.FINANCE_TAX_TEST_MIGRATIONS.replace(/[\\/]?$/,'/'))
      : new URL('../../../packages/database/prisma/migrations/',import.meta.url);
    for(const name of (await readdir(folder)).filter(name=>/^\d/.test(name)).sort())
      await db.exec(await readFile(new URL(name+'/migration.sql',folder),'utf8'));
    await db.exec(`INSERT INTO "Client" (id,"firstName","displayName","updatedAt") VALUES ('client','Synthetic','Synthetic',CURRENT_TIMESTAMP);
      INSERT INTO "Order" (id,number,"clientId",type,"priceMinor","depositRequiredMinor",currency,"updatedAt") VALUES ('order','Synthetic','client','CUSTOM_ORDER',10000,5000,'UAH',CURRENT_TIMESTAMP);
      INSERT INTO "ExpenseCategory" (id,name,"updatedAt") VALUES ('category','Synthetic',CURRENT_TIMESTAMP);
      INSERT INTO "TaxPolicy" (id,"effectiveFrom","group","unifiedMode","unifiedRateBps","militaryRateBps","esvRateBps",snapshot)
      VALUES ('policy','2026-05-01',3,'PERCENT',500,100,2200,'{}')`);
    for(const month of ['09','10','11'])await db.exec(`
      INSERT INTO "TaxPeriod" (id,month,"policyId",snapshot) VALUES ('${month}','2026-${month}','policy','{"policy":{"id":"policy","group":3,"unifiedMode":"PERCENT","unifiedRateBps":500,"militaryRateBps":100,"esvRateBps":2200}}');
      INSERT INTO "TaxEntry" (id,"periodId","policyId",component,kind,"sourceKey","operationKey","payloadHash",snapshot)
      VALUES ('root-${month}','${month}','policy','ESV','ROOT','month:2026-${month}:ESV','root-${month}','hash','{}');
      INSERT INTO "TaxEntry" (id,"periodId","policyId",component,kind,"rootId","operationKey","payloadHash","amountMinor",snapshot)
      VALUES ('final-${month}','${month}','policy','ESV','FINALIZE','root-${month}','final-${month}','hash',100,'{}');`);
    await db.exec(`INSERT INTO "TaxEntry" (id,"periodId","policyId",component,kind,"rootId","operationKey","payloadHash","amountMinor",snapshot)
      VALUES ('draft','09','policy','ESV','DRAFT','root-09','draft','hash',50,'{}');
      INSERT INTO "TaxEntry" (id,"periodId","originalPeriodId","policyId",component,kind,"rootId","reversesEntryId","operationKey","payloadHash","amountMinor",snapshot)
      VALUES ('adjust','10','09','policy','ESV','ADJUST','root-09','draft','adjust','hash',50,'{}');
      INSERT INTO "Expense" (id,"categoryId","amountMinor",currency,"incurredAt","updatedAt") VALUES ('tax-cash','category',250,'UAH','2026-11-02',CURRENT_TIMESTAMP),('boundary','category',20,'UAH','2026-09-30 22:30:00',CURRENT_TIMESTAMP);
      INSERT INTO "TaxExpenseAllocation" (id,kind,"expenseId",component,"amountMinor","incurredAt",snapshot,"operationKey","payloadHash")
      VALUES ('link','PAYMENT_LINK','tax-cash','ESV',250,'2026-11-02','{}','link','hash');
      INSERT INTO "TaxExpenseAllocation" (id,kind,"expenseId","linkId","rootId",component,"amountMinor","incurredAt",snapshot,"operationKey","payloadHash")
      VALUES ('allocation-sep','ALLOCATE','tax-cash','link','root-09','ESV',100,'2026-11-02','{}','allocation-sep','hash'),
             ('allocation-oct','ALLOCATE','tax-cash','link','root-10','ESV',75,'2026-11-02','{}','allocation-oct','hash');`);
    await db.exec(`INSERT INTO "Payment" (id,"orderId","amountMinor",currency,method,"receivedAt")
      VALUES ('boundary-payment','order',1000,'UAH','BANK_TRANSFER','2026-09-30 22:30:00')`);
    for(const [component,amount] of [['UNIFIED',50],['MILITARY',10]]) await db.exec(`
      INSERT INTO "TaxEntry" (id,"periodId","policyId","paymentId","orderId",component,kind,"sourceKey","operationKey","payloadHash",snapshot)
      VALUES ('receipt-${component}','10','policy','boundary-payment','order','${component}','ROOT','payment:boundary-payment:${component}','receipt-${component}','hash','{}');
      INSERT INTO "TaxEntry" (id,"periodId","policyId","paymentId","orderId",component,kind,"rootId","operationKey","payloadHash",snapshot)
      VALUES ('source-${component}','10','policy','boundary-payment','order','${component}','SOURCE','receipt-${component}','source-${component}','hash','{"incomeDate":"2026-10-01","state":{}}');
      INSERT INTO "TaxEntry" (id,"periodId","policyId","paymentId","orderId",component,kind,"rootId","operationKey","payloadHash","amountMinor",snapshot)
      VALUES ('done-${component}','10','policy','boundary-payment','order','${component}','FINALIZE','receipt-${component}','done-${component}','hash',${amount},'{"sourceId":"source-${component}","lifecycle":true,"receiptConfirmed":${component==='UNIFIED'}}');`);
    await db.exec(`INSERT INTO "TaxEntry" (id,"periodId","policyId","paymentId","orderId",component,kind,"rootId","operationKey","payloadHash",snapshot)
      VALUES ('retry','10','policy','boundary-payment','order','MILITARY','RESOLVE','receipt-MILITARY','retry','hash','{"retryFor":"source-MILITARY","attempt":1,"nextRetryAt":"2026-12-01T00:00:00Z"}')`);
    const reads=[];
    let capturing=false;
    const port=pg=>({
      $queryRawUnsafe:async(sql,...args)=>{reads.push({sql,args});return (await pg.query(sql,args)).rows;},
      expense:{findMany:async q=>{
        reads.push({kind:'expense',q});
        const where=q.where,params=[];let filter='e."archivedAt" IS NULL AND (e."orderId" IS NULL OR o."archivedAt" IS NULL)';
        if(where.id){params.push(where.id.in);filter+=' AND e.id=ANY($1::text[])';}
        if(where.incurredAt){params.push(where.incurredAt.gte,where.incurredAt.lt);filter+=' AND e."incurredAt">=$1 AND e."incurredAt"<$2';}
        return (await pg.query(`SELECT e.* FROM "Expense" e LEFT JOIN "Order" o ON o.id=e."orderId" WHERE ${filter} ORDER BY e.id`,params)).rows;
      }},
      payment:{findMany:async q=>{
        reads.push({kind:'payment',q});
        const range=q.where.receivedAt;
        return (await pg.query(`SELECT p.* FROM "Payment" p JOIN "Order" o ON o.id=p."orderId" WHERE p."voidedAt" IS NULL AND o."archivedAt" IS NULL AND p."receivedAt">=$1 AND p."receivedAt"<$2 ORDER BY p.id`,[range.gte,range.lt])).rows;
      }},
    });
    const prisma={...port(db),$transaction:async run=>db.transaction(async pg=>{assert.equal(capturing,false,'no nested source transactions');capturing=true;try{return await run(port(pg));}finally{capturing=false;}})};
    const nbu={rate:async(currency,date)=>({provider:'NBU',currency,incomeDate:date,effectiveDate:date,numerator:'1',denominator:'1',url:'UAH',fetchedAt:'2026-11-02T00:00:00.000Z',raw:'UAH=1'})};
    const service=new TaxesService(prisma,nbu);
    return {db,prisma,service,reads,isCapturing:()=>capturing,close:()=>db.close()};
  } catch(error){await db.close();throw error;}
}

test('monthly raw inputs reproduce genuine cross-period lot and credit math without cash reads in command reports',async()=>{
  const f=await fixture();
  try {
    const range=await f.prisma.$transaction(tx=>f.service.reportIn(tx,'2026-09','2026-11'));
    assert.equal(range.totals.creditMinor,75);
    const monthly=[];
    for(const month of ['09','10','11'])monthly.push(await f.prisma.$transaction(tx=>f.service.readReportInputs(tx,'2026-'+month,'2026-'+month)));
    const inputs=f.service.combineReportInputs(monthly);
    assert.equal(inputs.lookups.sourceByRoot.length,2);
    assert.equal(inputs.lookups.finalBySource.length,2);
    assert.equal(inputs.lookups.retryByRoot.length,1);
    assert.deepEqual(inputs.lookups.adjustedDraftIds,['draft']);
    const supplied=await f.service.reportIn(new Proxy({},{get(){assert.fail('provided inputs must not query a database');}}),'2026-09','2026-11',inputs);
    assert.deepEqual(normalize(supplied),normalize(range));
    assert.deepEqual(range.totals,{accruedMinor:410,paidMinor:250,allocatedMinor:175,debtMinor:235,creditMinor:75});
    const separate=[];
    for(const month of ['09','10','11'])separate.push(await f.prisma.$transaction(tx=>f.service.reportIn(tx,'2026-'+month,'2026-'+month)));
    assert.equal(separate.reduce((n,r)=>n+r.totals.creditMinor,0),250,'summing monthly credit would be wrong');
    assert.equal(f.reads.some(r=>r.kind==='expense'&&r.q.where.incurredAt),false,'reportIn command path does not read cashData');
    assert.equal(f.reads.some(r=>r.kind==='payment'&&r.q.select.amountMinor),false);
  } finally {await f.close();}
});

// Only the cache API contract is doubled: reads, revisions, immutable ledger
// guards and cross-period calculation use real PostgreSQL (embedded PGlite).
// The integrator separately exercises the supplied peekIn engine on native PG.
function cacheBoundary(f){
  const saved=new Map(),published=[];
  const revision=async(request,tx)=>{
    const keys=[...new Set(request.dependencies)].sort();
    const sql=`SELECT key,revision::text AS revision FROM "FinanceReportRevision" WHERE key=ANY($1::text[]) ORDER BY key`;
    const rows=tx?await tx.$queryRawUnsafe(sql,keys):(await f.db.query(sql,[keys])).rows;
    assert.equal(rows.length,keys.length,'Use the integrated cache migration via FINANCE_TAX_TEST_MIGRATIONS in an isolated worker checkout');
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  };
  const key=(r,v)=>JSON.stringify([r.period,r.scope,r.calculationVersion,r.taxPolicyVersion,r.fxVersion,v]);
  return {saved,published,
    async peekIn(tx,request){
      assert.equal(f.isCapturing(),true,'peek shares the caller source transaction');
      const value=await revision(request,tx);return {revision:value,result:saved.get(key(request,value))??null};
    },
    async read(request,read,project){
      assert.equal(f.isCapturing(),false,'cache claim/publication may not nest inside source capture');
      const value=await revision(request);
      if(request.expectedSourceRevision!==undefined&&value!==request.expectedSourceRevision)return null;
      const id=key(request,value);if(saved.has(id))return saved.get(id);
      const input=await f.prisma.$transaction(read);
      assert.equal(f.isCapturing(),false,'projection happens after releasing the connection');
      const result=await project(input);
      if(await revision(request)!==value)return null;
      const record={key:result.cacheable===false?null:id,payload:normalize(result.payload),sourceRevision:value,calculatedAt:'2026-11-02T00:00:00Z',hit:false};
      if(record.key){saved.set(id,record);published.push(request);}
      return record;
    },
  };
}

test('standalone range report reuses September/October inputs after a November receipt and preserves full JSON/CSV',async()=>{
  const f=await fixture(),actor={id:'owner',role:'OWNER'},query={from:'2026-09',to:'2026-11'};
  try {
    const cache=cacheBoundary(f);f.service.reportCache=cache;
    const original=()=>new TaxesService({$transaction:run=>f.prisma.$transaction(run)},f.service.nbu);
    const first=await f.service.report(query,actor);
    assert.deepEqual(normalize(first),normalize(await original().report(query,actor)));
    assert.equal(first.results.nonTaxExpensesMinor,20,'Kyiv edge duplicated across month inputs counts once');
    assert.equal(first.results.receivedMinor,1000,'Kyiv boundary payment is deduplicated across adjacent month inputs');
    const old=[...cache.saved].filter(([,r])=>r.key.includes('tax-inputs')&&!r.key.includes('2026-11'));
    assert.equal(old.length,2,'September and October raw derivative artifacts published');
    const previous=JSON.stringify(old),published=cache.published.length;
    const restarted=new TaxesService(f.prisma,f.service.nbu);restarted.reportCache=cache;
    assert.deepEqual(normalize(await restarted.report(query,actor)),normalize(first));
    assert.equal(cache.published.length,published,'warm report does not republish inputs');
    await f.db.exec(`INSERT INTO "Payment" (id,"orderId","amountMinor",currency,method,"receivedAt") VALUES ('november','order',1000,'UAH','BANK_TRANSFER','2026-11-02')`);
    f.reads.length=0;
    const changed=await restarted.report(query,actor);
    const bounded=f.reads.filter(r=>r.kind==='payment'||r.kind==='expense'&&r.q.where.incurredAt);
    assert.ok(bounded.length>0);
    assert.ok(bounded.every(r=>(r.q.where.receivedAt??r.q.where.incurredAt).lt.toISOString()==='2026-12-01T00:00:00.000Z'),'only November cash/uncaptured reads');
    assert.equal(JSON.stringify([...cache.saved].filter(([,r])=>r.key.includes('tax-inputs')&&!r.key.includes('2026-11'))),previous);
    assert.deepEqual(normalize(changed),normalize(await original().report(query,actor)));
    assert.equal(await restarted.reportCsv(query,actor),await original().reportCsv(query,actor));
    assert.equal(changed.totals.creditMinor,75,'root-wide credit is recomposed, not added per month');
    await assert.rejects(restarted.report(query,{id:'manager',role:'MANAGER'}),/прав/);
  } finally {await f.close();}
});

test('overlapping preceding-day reads cannot replace a corrected or voided receipt with a stale adjacent-month copy',async()=>{
 const f=await fixture(),actor={id:'owner',role:'OWNER'},query={from:'2026-09',to:'2026-11'};
 try{
  await f.db.exec(`INSERT INTO "Payment" (id,"orderId","amountMinor",currency,method,"receivedAt") VALUES ('september-edge','order',111,'UAH','BANK_TRANSFER','2026-09-30T12:00:00Z');
   INSERT INTO "Expense" (id,"categoryId","amountMinor",currency,"incurredAt","updatedAt") VALUES ('expense-edge','category',22,'UAH','2026-09-30T12:00:00Z',CURRENT_TIMESTAMP)`);
  const cache=cacheBoundary(f);f.service.reportCache=cache;
  const original=()=>new TaxesService({$transaction:run=>f.prisma.$transaction(run)},f.service.nbu);
  assert.deepEqual(normalize(await f.service.report(query,actor)),normalize(await original().report(query,actor)));
  const october=[...cache.saved].filter(([,r])=>r.key.includes('tax-inputs')&&r.key.includes('2026-10'));
  await f.db.exec(`UPDATE "Payment" SET "amountMinor"=999 WHERE id='september-edge'; UPDATE "Expense" SET "amountMinor"=99 WHERE id='expense-edge'`);
  const changed=await f.service.report(query,actor);
  assert.equal(changed.results.receivedMinor,1999);
  assert.deepEqual(normalize(changed),normalize(await original().report(query,actor)));
  assert.equal(await f.service.reportCsv(query,actor),await original().reportCsv(query,actor));
  assert.deepEqual([...cache.saved].filter(([,r])=>r.key.includes('tax-inputs')&&r.key.includes('2026-10')),october,'unchanged October stays reusable');
  await f.db.exec(`UPDATE "Payment" SET "voidedAt"=CURRENT_TIMESTAMP WHERE id='september-edge'; UPDATE "Expense" SET "archivedAt"=CURRENT_TIMESTAMP WHERE id='expense-edge'`);
  const voided=await f.service.report(query,actor);
  assert.equal(voided.results.receivedMinor,1000);
  assert.deepEqual(normalize(voided),normalize(await original().report(query,actor)));
 }finally{await f.close();}
});
