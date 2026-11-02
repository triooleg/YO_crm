import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrationName = '20261102160000_finance_report_snapshots';
const migrations = new URL('../prisma/migrations/', import.meta.url);

// Always a fresh embedded database: no connection URL, persisted data or network.
async function fixture() {
  const db = new PGlite();
  try {
    const names = (await readdir(migrations)).filter(name => /^\d/.test(name)).sort();
    for (const name of names.filter(name => name !== migrationName)) {
      await db.exec(await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'));
    }
    await db.exec(await readFile(new URL(`${migrationName}/migration.sql`, migrations), 'utf8'));
    return db;
  } catch (error) { await db.close(); throw error; }
}

test('finance snapshots store versioned derivatives, enforce status and cascade only cache rows', async () => {
  const db = await fixture();
  try {
    const sourceBefore=await revisions(db);
    await db.exec(`INSERT INTO "FinancePeriodSnapshot"
      (key,period,scope,"sourceRevision","calculationVersion","taxPolicyVersion","fxVersion","calculatedAt",status)
      VALUES ('v1:2026-05','2026-05','finance','1','v1','tax1','fx1',CURRENT_TIMESTAMP,'CALCULATING');
      INSERT INTO "FinanceReportCacheRow" ("snapshotKey",kind,id,payload,ordinal)
      VALUES ('v1:2026-05','payment','p','{"amountMinor":100}',0);`);
    await assert.rejects(db.exec(`UPDATE "FinancePeriodSnapshot" SET status='UNKNOWN'`), /check constraint/i);
    await db.exec(`UPDATE "FinancePeriodSnapshot" SET status='READY',payload='{}',checksum='abc' WHERE key='v1:2026-05';
      DELETE FROM "FinancePeriodSnapshot" WHERE key='v1:2026-05';`);
    assert.equal((await db.query(`SELECT * FROM "FinanceReportCacheRow"`)).rows.length, 0);
    assert.deepEqual(await revisions(db),sourceBefore,'derivative writes do not dirty business dependencies');
  } finally { await db.close(); }
});

test('every supported monthly and global dependency exists at revision zero; order keys remain dynamic', async () => {
  const db=await fixture();
  try {
    const expected=['epoch','orders','metadata','settings','tax-global','fx-global'];
    for(let year=1900;year<=2199;year++) for(let month=1;month<=12;month++) {
      const period=`${year}-${String(month).padStart(2,'0')}`;
      for(const scope of ['month','tax','fx']) expected.push(`${scope}:${period}`);
    }
    const rows=(await db.query(`SELECT key,revision::text AS revision FROM "FinanceReportRevision" ORDER BY key`)).rows;
    assert.equal(rows.length,10806);
    assert.deepEqual(rows.map(row=>row.key),expected.sort());
    assert.ok(rows.every(row=>row.revision==='0'));
    assert.equal(rows.some(row=>row.key.startsWith('order:')),false);
    assert.equal((await db.query('SELECT public.yo_finance_cache_coverage() AS covered')).rows[0].covered,true);
    // Read-only coverage must not repair a missing revision: the parent's
    // dependency-existence check can then bypass instead of assuming zero.
    await db.exec(`DELETE FROM "FinanceReportRevision" WHERE key='month:1900-01'`);
    assert.equal((await db.query('SELECT public.yo_finance_cache_coverage() AS covered')).rows[0].covered,true);
    assert.equal((await db.query(`SELECT key FROM "FinanceReportRevision" WHERE key='month:1900-01'`)).rows.length,0);
  } finally {await db.close();}
});

const revision = async (db, key) => Number((await db.query(
  `SELECT revision::text AS revision FROM "FinanceReportRevision" WHERE key=$1`, [key]
)).rows[0]?.revision ?? 0);
// Mutation comparisons omit the zero baseline, whose full presence is tested above.
const revisions = async db => (await db.query(`SELECT key,revision::text FROM "FinanceReportRevision" WHERE revision<>0 ORDER BY key`)).rows;
const expectAdvanced = async (db, keys, run) => {
  const before = await Promise.all(keys.map(key => revision(db, key)));
  await run();
  for (const [index, key] of keys.entries()) assert.ok(await revision(db, key) > before[index], key);
};

test('direct source SQL invalidates committed dependencies while no-ops and rollbacks do not', async t => {
  const db = await fixture();
  try {
    await db.exec(`SET TIME ZONE 'America/New_York';
      INSERT INTO "Client" (id,"firstName","displayName","updatedAt") VALUES ('c','Synthetic','Synthetic',CURRENT_TIMESTAMP);
      INSERT INTO "ExpenseCategory" (id,name,"updatedAt") VALUES ('cat','Synthetic',CURRENT_TIMESTAMP);`);
    await t.test('Order INSERT/UPDATE/DELETE track lifetime facts without cash dates', async () => {
      await expectAdvanced(db, ['orders','order:o'], () => db.exec(`
        INSERT INTO "Order" (id,number,"clientId",type,"priceMinor","depositRequiredMinor","createdAt","updatedAt")
        VALUES ('o','Synthetic','c','CUSTOM_ORDER',10000,5000,'2026-04-30 22:30:00',CURRENT_TIMESTAMP)`));
      await expectAdvanced(db, ['orders','order:o'], () => db.exec(`
        UPDATE "Order" SET "createdAt"='2026-06-30 22:30:00' WHERE id='o'`));
      assert.equal((await revisions(db)).some(row=>row.key.startsWith('month:')),false);
      const before = await revisions(db);
      await db.exec(`UPDATE "Order" SET "priceMinor"="priceMinor", "updatedAt"=CURRENT_TIMESTAMP WHERE id='o'`);
      assert.deepEqual(await revisions(db), before);
      await db.exec(`BEGIN; UPDATE "Order" SET "priceMinor"=12345 WHERE id='o'; ROLLBACK;`);
      assert.deepEqual(await revisions(db), before);
    });
    await t.test('Payment, Expense and Invoice direct INSERT/UPDATE/DELETE track both date sides', async () => {
      for (const [table, date, extraColumns, extraValues] of [
        ['Payment','receivedAt',',method',",'BANK_TRANSFER'"],
        ['Expense','incurredAt',',"categoryId"',",'cat'"],
        ['Invoice','issueDate',',number,seller,customer,items',",'INV-synthetic','{}','{}','[]'"],
      ]) {
        const amount = table === 'Invoice' ? 'totalMinor' : 'amountMinor';
        const updated = table === 'Payment' ? '' : ',"updatedAt"';
        const updatedValue = table === 'Payment' ? '' : ',CURRENT_TIMESTAMP';
        await expectAdvanced(db, ['month:2026-04','month:2026-05','orders','order:o'], () => db.exec(`
          INSERT INTO "${table}" (id,"orderId","${amount}",currency,"${date}"${updated}${extraColumns})
          VALUES ('${table}','o',100,'UAH','2026-04-30 22:30:00'${updatedValue}${extraValues})`));
        await expectAdvanced(db, ['month:2026-04','month:2026-05','month:2026-08','month:2026-09'], () => db.exec(`
          UPDATE "${table}" SET "${date}"='2026-08-31 22:30:00' WHERE id='${table}'`));
        await expectAdvanced(db, ['month:2026-08','month:2026-09','orders','order:o'], () => db.exec(`DELETE FROM "${table}" WHERE id='${table}'`));
      }
    });
    await t.test('Client/category labels and source-classification activities', async () => {
      await expectAdvanced(db, ['metadata'], () => db.exec(`UPDATE "Client" SET "displayName"='Renamed' WHERE id='c'`));
      await expectAdvanced(db, ['metadata'], () => db.exec(`UPDATE "ExpenseCategory" SET name='Renamed' WHERE id='cat'`));
      const before = await revisions(db);
      await db.exec(`INSERT INTO "Activity" (id,"orderId",type,summary) VALUES ('irrelevant','o','NOTE_CREATED','A');
        UPDATE "Activity" SET summary='B' WHERE id='irrelevant'; DELETE FROM "Activity" WHERE id='irrelevant'`);
      assert.deepEqual(await revisions(db), before);
      await expectAdvanced(db, ['order:o','orders'], () => db.exec(`INSERT INTO "Activity" (id,"orderId",type,summary,metadata)
        VALUES ('origin','o','ORDER_SOURCE_OVERRIDDEN','Source','{"source":"MANUAL"}')`));
      const sourceBefore = await revisions(db);
      await db.exec(`UPDATE "Activity" SET summary='Cosmetic',metadata=metadata||'{"unrelated":1}' WHERE id='origin'`);
      assert.deepEqual(await revisions(db), sourceBefore);
      await expectAdvanced(db, ['order:o','orders'], () => db.exec(`UPDATE "Activity" SET metadata='{"source":"WEBSITE"}' WHERE id='origin'`));
      await expectAdvanced(db, ['order:o','orders'], () => db.exec(`DELETE FROM "Activity" WHERE id='origin'`));
    });
    await t.test('AppSetting filters old and new scope without reacting to timestamps', async () => {
      const before = await revisions(db);
      await db.exec(`INSERT INTO "AppSetting" (id,section,key,value,"updatedAt") VALUES ('unrelated','inbox','x','{}',CURRENT_TIMESTAMP);
        UPDATE "AppSetting" SET value='{"x":1}' WHERE id='unrelated'; DELETE FROM "AppSetting" WHERE id='unrelated'`);
      assert.deepEqual(await revisions(db), before);
      await expectAdvanced(db, ['settings'], () => db.exec(`INSERT INTO "AppSetting" (id,section,key,value,"updatedAt") VALUES ('s','finance','exchangeRateCache','{}',CURRENT_TIMESTAMP)`));
      await expectAdvanced(db, ['settings','tax-global'], () => db.exec(`UPDATE "AppSetting" SET section='taxes',key='config' WHERE id='s'`));
      await expectAdvanced(db, ['tax-global'], () => db.exec(`DELETE FROM "AppSetting" WHERE id='s'`));
      await db.exec(`INSERT INTO "FinanceReportRevision" (key,revision) VALUES ('settings',9007199254740993)
        ON CONFLICT (key) DO UPDATE SET revision=EXCLUDED.revision`);
      await db.exec(`INSERT INTO "AppSetting" (id,section,key,value,"updatedAt") VALUES ('provider','finance','exchangeRateProvider','"NBU"',CURRENT_TIMESTAMP)`);
      assert.equal((await db.query(`SELECT revision::text FROM "FinanceReportRevision" WHERE key='settings'`)).rows[0].revision,'9007199254740994');
      const stable=await revisions(db);
      await db.exec(`UPDATE "AppSetting" SET value=value,"updatedAt"=CURRENT_TIMESTAMP WHERE id='provider'`);
      assert.deepEqual(await revisions(db),stable);
    });
    await t.test('ProductionSlot and OrderShipment invalidate lifetime order facts', async () => {
      for (const [table, columns, values] of [
        ['ProductionSlot',',"startsAt","endsAt"',",'2026-05-01','2026-05-02'"],
        ['OrderShipment',',carrier,currency',",'DHL','UAH'"],
      ]) {
        await expectAdvanced(db, ['orders','order:o'], () => db.exec(`INSERT INTO "${table}" (id,"orderId","updatedAt"${columns}) VALUES ('${table}','o',CURRENT_TIMESTAMP${values})`));
        await expectAdvanced(db, ['orders','order:o'], () => db.exec(table === 'ProductionSlot'
          ? `UPDATE "ProductionSlot" SET tentative=false WHERE id='ProductionSlot'`
          : `UPDATE "OrderShipment" SET "customerChargeMinor"=100 WHERE id='OrderShipment'`));
        await expectAdvanced(db, ['orders','order:o'], () => db.exec(`DELETE FROM "${table}" WHERE id='${table}'`));
      }
      await expectAdvanced(db, ['orders','order:o'], () => db.exec(`DELETE FROM "Order" WHERE id='o'`));
    });
    await t.test('TRUNCATE advances epoch transactionally', async () => {
      const before = await revisions(db);
      await db.exec(`BEGIN; TRUNCATE "Activity"; ROLLBACK;`);
      assert.deepEqual(await revisions(db), before);
      await expectAdvanced(db, ['epoch'], () => db.exec(`TRUNCATE "Activity"`));
    });
    await t.test('replica-mode source writes still invalidate',async()=>{
      await db.exec(`SET session_replication_role=replica`);
      try {
        const metadata=await revision(db,'metadata');
        await expectAdvanced(db,['orders'],()=>db.exec(`UPDATE "Client" SET "displayName"='Replica import' WHERE id='c'`));
        assert.equal(await revision(db,'metadata'),metadata,'this client has no remaining orders');
      } finally {await db.exec(`SET session_replication_role=origin`);}
    });
  } finally { await db.close(); }
});

test('new-month payment plus order status update preserves old monthly components; provenance and membership still invalidate them', async () => {
  const db=await fixture();
  const monthly=async()=> (await revisions(db)).filter(row=>/^(month:|tax:)/.test(row.key));
  try {
    await db.exec(`INSERT INTO "Client" (id,"firstName","displayName","updatedAt") VALUES ('c','Synthetic','Synthetic',CURRENT_TIMESTAMP),('c2','Other','Other',CURRENT_TIMESTAMP);
      INSERT INTO "Order" (id,number,"clientId",type,"priceMinor","depositRequiredMinor","createdAt","updatedAt")
      VALUES ('o','Targeted','c','CUSTOM_ORDER',10000,5000,'2026-05-01',CURRENT_TIMESTAMP);
      INSERT INTO "Payment" (id,"orderId","amountMinor",currency,method,"receivedAt") VALUES ('old','o',100,'UAH','BANK_TRANSFER','2026-05-10');
      INSERT INTO "TaxPolicy" (id,"effectiveFrom","group","unifiedMode","unifiedRateBps","militaryRateBps","esvRateBps",snapshot)
      VALUES ('policy','2026-05-01',3,'PERCENT',500,100,2200,'{}');
      INSERT INTO "TaxPeriod" (id,month,"policyId",snapshot) VALUES ('may','2026-05','policy','{}');
      INSERT INTO "TaxEntry" (id,"periodId","policyId","paymentId","orderId",component,kind,"sourceKey","operationKey","payloadHash",snapshot)
      VALUES ('root','may','policy','old','o','UNIFIED','ROOT','payment:old:UNIFIED','root','hash','{}')`);
    for (const sql of [
      `UPDATE "Order" SET "paymentStatus"='PARTIALLY_PAID' WHERE id='o'`,
      `UPDATE "Order" SET "priceMinor"=20000 WHERE id='o'`,
      `UPDATE "Order" SET "requiredDeliveryAt"='2026-12-01' WHERE id='o'`,
      `UPDATE "Order" SET "productionStatus"='SEWING' WHERE id='o'`,
      `UPDATE "Order" SET "createdAt"='2026-09-01' WHERE id='o'`,
      `INSERT INTO "ProductionSlot" (id,"orderId","startsAt","endsAt","updatedAt") VALUES ('slot','o','2026-11-01','2026-11-15',CURRENT_TIMESTAMP)`,
      `UPDATE "ProductionSlot" SET "endsAt"='2026-12-01' WHERE id='slot'`,
    ]) {
      const before=await monthly();
      await expectAdvanced(db,['orders','order:o'],()=>db.exec(sql));
      assert.deepEqual(await monthly(),before,sql);
    }
    const historical=await monthly();
    await expectAdvanced(db,['month:2026-11','tax:2026-11','orders','order:o'],()=>db.exec(`BEGIN;
      INSERT INTO "Payment" (id,"orderId","amountMinor",currency,method,"receivedAt") VALUES ('new','o',200,'UAH','BANK_TRANSFER','2026-11-02');
      UPDATE "Order" SET "paymentStatus"='DEPOSIT_PAID' WHERE id='o'; COMMIT;`));
    assert.deepEqual((await monthly()).filter(row=>row.key.endsWith('2026-05')),historical,'old cash and tax stay reusable');
    for (const sql of [
      `UPDATE "Order" SET number='Renumbered' WHERE id='o'`,
      `UPDATE "Order" SET "clientId"='c2' WHERE id='o'`,
      `UPDATE "Order" SET "sourceSystem"='KEYCRM' WHERE id='o'`,
      `UPDATE "Order" SET "archivedAt"=CURRENT_TIMESTAMP WHERE id='o'`,
      `UPDATE "Order" SET "archivedAt"=NULL WHERE id='o'`,
      `INSERT INTO "Activity" (id,"orderId",type,summary,metadata) VALUES ('source','o','ORDER_SOURCE_OVERRIDDEN','Source','{"source":"WEBSITE"}')`,
    ]) await expectAdvanced(db,['orders','order:o','month:2026-05','month:2026-11','tax:2026-05'],()=>db.exec(sql));
  } finally {await db.close();}
});

test('unrelated client creation changes order options without invalidating historical metadata or months', async () => {
  const db=await fixture();
  try {
    await db.exec(`INSERT INTO "Client" (id,"firstName","displayName","updatedAt") VALUES ('linked','Linked','Linked',CURRENT_TIMESTAMP);
      INSERT INTO "Order" (id,number,"clientId",type,"priceMinor","depositRequiredMinor","updatedAt") VALUES ('old','Old','linked','CUSTOM_ORDER',10000,5000,CURRENT_TIMESTAMP);
      INSERT INTO "Payment" (id,"orderId","amountMinor",currency,method,"receivedAt") VALUES ('receipt','old',100,'UAH','BANK_TRANSFER','2026-06-01')`);
    let metadata=await revision(db,'metadata');
    const months=(await revisions(db)).filter(row=>/^(month:|tax:|fx:)/.test(row.key));
    await expectAdvanced(db,['orders'],()=>db.exec(`INSERT INTO "Client" (id,"firstName","displayName","updatedAt") VALUES ('new','New','New',CURRENT_TIMESTAMP)`));
    assert.equal(await revision(db,'metadata'),metadata,'new unrelated client does not dirty old row labels');
    await expectAdvanced(db,['orders'],()=>db.exec(`UPDATE "Client" SET "displayName"='Unlinked renamed' WHERE id='new'`));
    assert.equal(await revision(db,'metadata'),metadata,'unlinked rename changes options only');
    await expectAdvanced(db,['orders'],()=>db.exec(`UPDATE "Client" SET source='INSTAGRAM' WHERE id='linked'`));
    const contactRevisions=await revisions(db);
    await db.exec(`UPDATE "Client" SET "lastContactAt"=CURRENT_TIMESTAMP,phone='+380991234567' WHERE id='linked'`);
    assert.deepEqual(await revisions(db),contactRevisions,'Inbox/contact updates are not financial inputs');
    assert.equal(await revision(db,'metadata'),metadata,'contact source is an order/statistics fact');
    await expectAdvanced(db,['orders','metadata'],()=>db.exec(`UPDATE "Client" SET "displayName"='Linked renamed' WHERE id='linked'`));
    metadata=await revision(db,'metadata');
    await db.exec(`INSERT INTO "ExpenseCategory" (id,name,"updatedAt") VALUES ('cat','Original',CURRENT_TIMESTAMP)`);
    await expectAdvanced(db,['metadata'],()=>db.exec(`UPDATE "ExpenseCategory" SET name='Renamed' WHERE id='cat'`));
    assert.equal(await revision(db,'metadata'),metadata+2,'category creation and rename retain option/label invalidation');
    assert.deepEqual((await revisions(db)).filter(row=>/^(month:|tax:|fx:)/.test(row.key)),months,'metadata never bumps cash/tax/fx month counters');
  } finally {await db.close();}
});

test('sales-statistics item, merge, contact-source and label mutations advance exact global counters', async () => {
  const db=await fixture();
  const once=async(keys,sql)=>{
    const before=await Promise.all(keys.map(key=>revision(db,key)));
    await db.exec(sql);
    for(const [index,key] of keys.entries()) assert.equal(await revision(db,key),before[index]+1,key);
  };
  try {
    await db.exec(`INSERT INTO "Client" (id,"firstName","displayName","updatedAt")
      VALUES ('c1','One','One',CURRENT_TIMESTAMP),('c2','Two','Two',CURRENT_TIMESTAMP),('c3','Three','Three',CURRENT_TIMESTAMP);
      INSERT INTO "Order" (id,number,"clientId",type,"priceMinor","depositRequiredMinor","updatedAt")
      VALUES ('o1','Stats-1','c1','CUSTOM_ORDER',10000,5000,CURRENT_TIMESTAMP),('o2','Stats-2','c2','CUSTOM_ORDER',10000,5000,CURRENT_TIMESTAMP)`);
    const metadata=await revision(db,'metadata');
    await once(['orders','order:o1'],`INSERT INTO "OrderItem" (id,"orderId",name,"priceMinor","updatedAt") VALUES ('item','o1','Synthetic',10000,CURRENT_TIMESTAMP)`);
    for(const change of [
      'quantity=2','"designNumber"=42',`"productionStatus"='SEWING'`,
      '"archivedAt"=CURRENT_TIMESTAMP','"archivedAt"=NULL',
    ]) await once(['orders','order:o1'],`UPDATE "OrderItem" SET ${change} WHERE id='item'`);
    await once(['orders','order:o1','order:o2'],`UPDATE "OrderItem" SET "orderId"='o2' WHERE id='item'`);
    let before=await revisions(db);
    await db.exec(`UPDATE "OrderItem" SET quantity=quantity,"updatedAt"=CURRENT_TIMESTAMP WHERE id='item'`);
    assert.deepEqual(await revisions(db),before);
    await once(['orders'],`INSERT INTO "OrderItemInstance" (id,"orderItemId",ordinal,"updatedAt") VALUES ('instance','item',1,CURRENT_TIMESTAMP)`);
    await once(['orders'],`UPDATE "OrderItemInstance" SET "archivedAt"=CURRENT_TIMESTAMP WHERE id='instance'`);
    await once(['orders'],`DELETE FROM "OrderItemInstance" WHERE id='instance'`);
    await once(['orders','order:o2'],`DELETE FROM "OrderItem" WHERE id='item'`);
    assert.equal(await revision(db,'metadata'),metadata,'item facts do not invalidate unrelated monthly cash via metadata');
    await once(['orders','metadata'],`INSERT INTO "ClientMergeRedirect" ("sourceClientId","targetClientId") VALUES ('c1','c2')`);
    await once(['orders','metadata'],`UPDATE "ClientMergeRedirect" SET "targetClientId"='c3' WHERE "sourceClientId"='c1'`);
    before=await revisions(db);
    await db.exec(`UPDATE "ClientMergeRedirect" SET "targetClientId"="targetClientId" WHERE "sourceClientId"='c1'`);
    assert.deepEqual(await revisions(db),before);
    await once(['orders','metadata'],`DELETE FROM "ClientMergeRedirect" WHERE "sourceClientId"='c1'`);
    await once(['orders'],`UPDATE "Client" SET source='INSTAGRAM' WHERE id='c1'`);
    await once(['orders','metadata'],`UPDATE "Client" SET "displayName"='Renamed' WHERE id='c1'`);
    await once(['orders','order:o1'],`UPDATE "Order" SET "sourceAccount"='synthetic-account' WHERE id='o1'`);
    before=await revisions(db);
    await db.exec(`BEGIN; INSERT INTO "OrderItem" (id,"orderId",name,"priceMinor","updatedAt") VALUES ('rollback','o1','Rollback',100,CURRENT_TIMESTAMP);
      INSERT INTO "ClientMergeRedirect" ("sourceClientId","targetClientId") VALUES ('c1','c2'); ROLLBACK;`);
    assert.deepEqual(await revisions(db),before,'both new source counters roll back with their rows');
    await expectAdvanced(db,['epoch'],()=>db.exec(`TRUNCATE "OrderItem" CASCADE`));
    await once(['epoch'],`TRUNCATE "ClientMergeRedirect"`);
    assert.equal((await revisions(db)).some(row=>/^(month:|tax:|fx:)/.test(row.key)),false);
  } finally {await db.close();}
});

test('tax root graph includes cross-month postings and originals, including closed-period RESOLVE', async () => {
  const db = await fixture();
  try {
    await expectAdvanced(db, ['tax-global'], () => db.exec(`INSERT INTO "TaxPolicy"
      (id,"effectiveFrom","group","unifiedMode","unifiedRateBps","militaryRateBps","esvRateBps",snapshot)
      VALUES ('policy','2026-05-01',3,'PERCENT',500,100,2200,'{}')`));
    for (const month of ['05','06','07']) await expectAdvanced(db, [`tax:2026-${month}`], () => db.exec(`
      INSERT INTO "TaxPeriod" (id,month,"policyId",snapshot) VALUES ('p${month}','2026-${month}','policy','{}')`));
    await db.exec(`INSERT INTO "TaxEntry" (id,"periodId","policyId",component,kind,"sourceKey","operationKey","payloadHash",snapshot)
      VALUES ('root','p05','policy','ESV','ROOT','month:2026-05:ESV','root','hash','{}');`);
    await expectAdvanced(db, ['tax:2026-05','tax:2026-06'], () => db.exec(`
      INSERT INTO "TaxEntry" (id,"periodId","originalPeriodId","policyId",component,kind,"rootId","operationKey","payloadHash","amountMinor",snapshot)
      VALUES ('final','p06','p05','policy','ESV','FINALIZE','root','final','hash',100,'{}')`));
    await expectAdvanced(db, ['tax:2026-05','tax:2026-06','tax:2026-07'], () => db.exec(`
      INSERT INTO "TaxEntry" (id,"periodId","originalPeriodId","policyId",component,kind,"rootId","operationKey","payloadHash","amountMinor",snapshot)
      VALUES ('adjust','p07','p05','policy','ESV','ADJUST','root','adjust','hash',50,'{}')`));
    await expectAdvanced(db,['tax:2026-05','tax:2026-06','tax:2026-07'],()=>db.exec(`UPDATE "TaxPeriod" SET state='CLOSED',revision=revision+1,"closedAt"=CURRENT_TIMESTAMP,"closedSnapshot"='{}' WHERE id='p05'`));
    await expectAdvanced(db, ['tax:2026-05','tax:2026-06','tax:2026-07'], () => db.exec(`
      INSERT INTO "TaxEntry" (id,"periodId","policyId",component,kind,"rootId","operationKey","payloadHash",snapshot)
      VALUES ('retry','p05','policy','ESV','RESOLVE','root','retry','hash','{"retryFor":"source"}')`));
    const before = await revisions(db);
    await assert.rejects(db.exec(`UPDATE "TaxEntry" SET snapshot='{"changed":true}' WHERE id='retry'`), /append-only/);
    await assert.rejects(db.exec(`DELETE FROM "TaxEntry" WHERE id='retry'`), /append-only/);
    assert.deepEqual(await revisions(db), before);
    await db.exec(`INSERT INTO "ExpenseCategory" (id,name,"updatedAt") VALUES ('taxcat','Tax',CURRENT_TIMESTAMP);
      INSERT INTO "Expense" (id,"categoryId","amountMinor",currency,"incurredAt","updatedAt") VALUES ('taxcash','taxcat',200,'UAH','2026-08-01',CURRENT_TIMESTAMP)`);
    await expectAdvanced(db, ['tax-global','month:2026-08'], () => db.exec(`INSERT INTO "TaxExpenseAllocation"
      (id,kind,"expenseId",component,"amountMinor","incurredAt",snapshot,"operationKey","payloadHash")
      VALUES ('link','PAYMENT_LINK','taxcash','ESV',200,'2026-08-01','{}','link','hash')`));
    await expectAdvanced(db, ['tax-global','tax:2026-05','tax:2026-06','tax:2026-07'], () => db.exec(`INSERT INTO "TaxExpenseAllocation"
      (id,kind,"expenseId","linkId","rootId",component,"amountMinor","incurredAt",snapshot,"operationKey","payloadHash")
      VALUES ('alloc','ALLOCATE','taxcash','link','root','ESV',100,'2026-08-01','{}','alloc','hash')`));
    await assert.rejects(db.exec(`DELETE FROM "TaxExpenseAllocation" WHERE id='alloc'`), /append-only/);
    await expectAdvanced(db,['tax-global','tax:2026-05','tax:2026-06','tax:2026-07'],()=>db.exec(`INSERT INTO "TaxExpenseAllocation"
      (id,kind,"expenseId","linkId","rootId","reversesId",component,"amountMinor","incurredAt",snapshot,"operationKey","payloadHash")
      VALUES ('reverse','REVERSE_ALLOCATION','taxcash','link','root','alloc','ESV',100,'2026-08-01','{}','reverse','hash')`));
    await db.exec(`INSERT INTO "TaxPolicy"
      (id,"effectiveFrom","group","unifiedMode","unifiedRateBps","militaryRateBps","esvRateBps",snapshot)
      VALUES ('future','2027-01-01',3,'PERCENT',500,100,2200,'{}')`);
    await expectAdvanced(db,['tax-global'],()=>db.exec(`UPDATE "TaxPolicy" SET state='CANCELLED' WHERE id='future'`));
    await assert.rejects(db.exec(`UPDATE "TaxPolicy" SET "unifiedRateBps"=600 WHERE id='policy'`),/immutable/);
  } finally { await db.close(); }
});

test('November FX recomposes composite reports without changing June child dependencies or cash flags', async () => {
  const db=await fixture();
  try {
    const keys=['fx-global','fx:2026-11','fx:2026-12'];
    const once=async sql=>{
      const before=await Promise.all(keys.map(key=>revision(db,key)));
      await db.exec(sql);
      for(const [index,key] of keys.entries()) assert.equal(await revision(db,key),before[index]+1,key);
      assert.deepEqual((await revisions(db)).map(row=>row.key),keys,'only global FX and the 31-day forward months change');
      for(const key of ['month:2026-06','tax:2026-06','fx:2026-06']) assert.equal(await revision(db,key),0,key);
    };
    await once(`INSERT INTO "HistoricalNbuRate" (currency,"incomeDate",status,"leaseToken","leaseUntil")
      VALUES ('EUR','2026-11-02','PENDING','synthetic-november-lease',CURRENT_TIMESTAMP+INTERVAL '30 seconds')`);
    let before=await revisions(db);
    await db.exec(`UPDATE "HistoricalNbuRate" SET status=status,"updatedAt"=CURRENT_TIMESTAMP`);
    assert.deepEqual(await revisions(db),before,'no-op and timestamps alone do not invalidate');
    await once(`UPDATE "HistoricalNbuRate" SET status='FAILED',"leaseToken"=NULL,"leaseUntil"=NULL,
      "retryAt"=CURRENT_TIMESTAMP,"lastErrorCode"='NBU_UNAVAILABLE'`);
    before=await revisions(db);
    await db.exec(`BEGIN; DELETE FROM "HistoricalNbuRate"; ROLLBACK;`);
    assert.deepEqual(await revisions(db),before,'FX revision changes roll back atomically');
    await once(`DELETE FROM "HistoricalNbuRate"`);
  } finally {await db.close();}
});

test('historical FX changes cover changed day through 31 days forward and retain immutable READY evidence', async () => {
  const db = await fixture();
  try {
    await expectAdvanced(db, ['fx-global','fx:2026-01','fx:2026-02','fx:2026-03'], () => db.exec(`INSERT INTO "HistoricalNbuRate"
      (currency,"incomeDate",status,"leaseToken","leaseUntil") VALUES ('EUR','2026-01-31','PENDING','synthetic-lease-123',CURRENT_TIMESTAMP+INTERVAL '30 seconds')`));
    assert.equal(await revision(db,'fx:2026-04'), 0);
    await expectAdvanced(db, ['fx-global','fx:2026-01','fx:2026-02','fx:2026-03'], () => db.exec(`UPDATE "HistoricalNbuRate" SET
      status='FAILED',"leaseToken"=NULL,"leaseUntil"=NULL,"retryAt"=CURRENT_TIMESTAMP,"lastErrorCode"='NBU_UNAVAILABLE'`));
    await expectAdvanced(db, ['fx-global','fx:2026-01','fx:2026-02','fx:2026-03'], () => db.exec(`DELETE FROM "HistoricalNbuRate"`));
    await db.exec(`INSERT INTO "HistoricalNbuRate"
      (currency,"incomeDate",status,numerator,denominator,"effectiveDate",url,"fetchedAt",raw)
      VALUES ('EUR','2026-05-01','READY','50','1','2026-05-01','https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?synthetic',CURRENT_TIMESTAMP,'synthetic')`);
    const before=await revisions(db);
    await assert.rejects(db.exec(`UPDATE "HistoricalNbuRate" SET numerator='51'`), /immutable/);
    await assert.rejects(db.exec(`DELETE FROM "HistoricalNbuRate"`), /immutable/);
    assert.deepEqual(await revisions(db),before);
  } finally { await db.close(); }
});

test('runtime coverage fails closed on disabled/missing/replaced/unexpected trigger functions or tables', async t => {
  const db = await fixture();
  const covered = async () => (await db.query('SELECT public.yo_finance_cache_coverage() AS covered')).rows[0].covered;
  try {
    assert.equal(await covered(),true);
    const sources=['Order','Payment','Expense','Invoice','OrderShipment','ProductionSlot','Activity','Client','ExpenseCategory',
      'TaxPolicy','TaxPeriod','TaxEntry','TaxExpenseAllocation','AppSetting','HistoricalNbuRate','OrderItem','OrderItemInstance','ClientMergeRedirect'].sort();
    const triggers=(await db.query(`SELECT c.relname AS source,t.tgname AS name,t.tgenabled AS enabled,t.tgtype::int AS type,
      pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND starts_with(t.tgname,'yo_finance_cache_') ORDER BY c.relname,t.tgname`)).rows;
    assert.equal(triggers.length,36);
    assert.deepEqual([...new Set(triggers.map(row=>row.source))].sort(),sources);
    for(const source of sources) {
      const rows=triggers.filter(row=>row.source===source);
      assert.equal(rows.length,2,source);
      assert.ok(rows.every(row=>row.enabled==='A'),source);
      assert.deepEqual(rows.map(row=>row.type).sort((a,b)=>a-b),[29,32],source);
      assert.ok(rows.every(row=>row.definition.includes('yo_finance_cache_source()')||row.definition.includes('yo_finance_cache_truncate()')),source);
    }
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND starts_with(p.proname,'yo_finance_cache_')`)).rows[0].count,6);
    for (const [name,sql] of [
      ['disabled row trigger', `ALTER TABLE "Payment" DISABLE TRIGGER yo_finance_cache_row`],
      ['disabled truncate trigger', `ALTER TABLE "Activity" DISABLE TRIGGER yo_finance_cache_truncate`],
      ['missing trigger', `DROP TRIGGER yo_finance_cache_row ON "Invoice"`],
      ['replaced function', `CREATE OR REPLACE FUNCTION public.yo_finance_cache_bump(keys TEXT[]) RETURNS VOID LANGUAGE sql AS 'SELECT'`],
      ['unexpected function', `CREATE FUNCTION public.yo_finance_cache_surprise() RETURNS INT LANGUAGE sql AS 'SELECT 1'`],
      ['unexpected overload', `CREATE FUNCTION public.yo_finance_cache_bump(TEXT) RETURNS VOID LANGUAGE sql AS 'SELECT'`],
      ['missing storage table', `DROP TABLE "FinanceReportCacheRow"`],
      ['missing source table', `DROP TABLE "Activity"`],
      ['source column drift', `ALTER TABLE "Payment" DROP COLUMN "receivedAt"`],
      ['wrong marker', `COMMENT ON FUNCTION public.yo_finance_cache_coverage() IS 'other-version'`],
      ['coverage function definition drift', `ALTER FUNCTION public.yo_finance_cache_coverage() VOLATILE`],
      ['disabled item trigger', `ALTER TABLE "OrderItem" DISABLE TRIGGER yo_finance_cache_row`],
      ['disabled merge trigger', `ALTER TABLE "ClientMergeRedirect" DISABLE TRIGGER yo_finance_cache_row`],
      ['missing merge table', `DROP TABLE "ClientMergeRedirect"`],
      ['item column drift', `ALTER TABLE "OrderItem" DROP COLUMN quantity`],
      ...[
        'bump(text[])','months(timestamp without time zone)','tax_keys(text[],text[])','source()','truncate()',
      ].map(signature=>[`function DDL ${signature}`,`ALTER FUNCTION public.yo_finance_cache_${signature} SECURITY DEFINER`]),
    ]) await t.test(name,async()=>{
      await db.exec('BEGIN');
      try {await db.exec(sql);assert.equal(await covered(),false,name);}
      finally {await db.exec('ROLLBACK');}
      assert.equal(await covered(),true);
    });
  } finally { await db.close(); }
});
