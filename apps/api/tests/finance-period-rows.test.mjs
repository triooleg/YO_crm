import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(process.env.FINANCE_TEST_API_PACKAGE || import.meta.url);
const ts = require('typescript');
const modules = new Map();
function load(path) {
  const filename = resolve(fileURLToPath(new URL('../src/', import.meta.url)), path);
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} }; modules.set(filename, module);
  // Expose the existing private pure table projection only in this test loader.
  const extra = filename.endsWith('finance-fiscal-model.ts') ? '\nexport { buildFiscalExpenseTable };' : '';
  const source = ts.transpileModule(readFileSync(filename, 'utf8') + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  const localRequire = name => name.startsWith('.') && existsSync(resolve(dirname(filename), name + '.ts'))
    ? load(resolve(dirname(filename), name + '.ts')) : require(name);
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(localRequire, module, module.exports);
  return module.exports;
}

test('prepared ranks preserve numeric Russian ordering and both null-last directions without mutating rows', () => {
  const { prepareCacheRows } = load('finance/finance-period-rows.ts');
  const rows = [{id:'b',number:'Заказ 10',amountMinor:null}, {id:'a',number:'Заказ 2',amountMinor:2}, {id:'c',number:'Ёж',amountMinor:1}];
  const before = structuredClone(rows), saved = prepareCacheRows('payments', rows, 'legacy');
  assert.deepEqual(rows, before);
  const ids = rank => [...saved].sort((a,b)=>a.payload.ranks[rank]-b.payload.ranks[rank]).map(r=>r.id);
  assert.deepEqual(ids('number:asc'), ['c','a','b']);
  assert.deepEqual(ids('amount:asc'), ['c','a','b']);
  assert.deepEqual(ids('amount:desc'), ['a','c','b']);
  assert.deepEqual(saved.map(r=>r.payload.value), rows);
  saved[0].payload.value.number='changed';
  assert.deepEqual(rows,before,'stored payloads do not alias the original rows');
  assert.throws(()=>prepareCacheRows('payments',[{id:'duplicate'},{id:'duplicate'}],'legacy'));
  assert.throws(()=>prepareCacheRows('payments',[{id:''}],'legacy'));
});

const now = new Date('2026-10-15T12:00:00Z');
const baseQuery = { month:'2026-10', currency:'EUR', range:6, page:1, pageSize:10, sort:'date', direction:'desc' };
function legacyFixture() {
  const orders = Array.from({length:36}, (_,i)=>({id:`o${i}`,number:`ЗАКАЗ ${i}`,clientId:`c${i%3}`,
    client:{displayName:['Ёж 10','Ёж 2','İрина 😀'][i%3]},priceMinor:10000+i,currency:'EUR',
    salesStatus:i%7===0?'COMPLETED':'NEW_LEAD', paymentStatus:'PARTIAL', shippingStatus:'NOT_READY',
    requiredDeliveryAt:i%2?'2026-10-25T12:00:00Z':null}));
  return { orders, payments:orders.filter((_,i)=>i%4!==0).map((o,i)=>({id:`p${i}`,orderId:o.id,
      amountMinor:i%5===0?20000:100+i,currency:'EUR',receivedAt:i%3?'2026-10-10T12:00:00Z':'2026-09-10T12:00:00Z',method:null,notes:'100%_банк'})),
    expenses:orders.map((o,i)=>({id:`РАСХОД-${i}`,categoryId:`cat${i%2}`,category:{name:i%2?'Ткань 2':'Ткань 10'},
      amountMinor:10+i,currency:'EUR',incurredAt:`2026-10-${String(i%28+1).padStart(2,'0')}T12:00:00Z`,orderId:o.id,order:{number:o.number},notes:i%2?'100%_банк':"O'Reilly"})),
    invoices:orders.map((o,i)=>({id:`inv${i}`,number:`СЧЁТ ${i}`,orderId:o.id,order:{number:o.number,clientId:o.clientId,client:o.client},
      issueDate:'2026-10-10T12:00:00Z',dueDate:null,totalMinor:100+i,currency:'EUR',status:i%2?'ISSUED':'PAID'})),
    categories:[{id:'cat0',name:'Ткань 10'},{id:'cat1',name:'Ткань 2'}],
    orderSources:Object.fromEntries(orders.map((o,i)=>[o.id,i%3===0?'WEBSITE':i%3===1?'MANUAL':'UNKNOWN'])),
  };
}
const variants = [
  ...['date','number','client','amount','paid','balance','category','status'].flatMap(sort=>['asc','desc'].map(direction=>({sort,direction}))),
  {page:99999}, {page:2,pageSize:25}, {source:'ALL'}, {source:'NON_WEBSITE'}, {source:'WEBSITE'},
  {source:'UNKNOWN'}, {clientId:'c1'}, {orderId:'o2'}, {categoryId:'cat1'}, {status:'PAID'},
  {from:'2026-10-10',to:'2026-10-20'}, {search:' ёЖ '}, {search:'İРИНА'}, {search:'😀'},
  {search:'100%_'}, {search:"O'Reilly"}, {search:"%' OR 1=1 --"}, {search:'РАСХОД-12'},
  {search:'РАСХОД-1'}, {search:'c1'}, {scope:'forecast'}, {taxComponent:'ESV'},
];

test('isolated PostgreSQL pagination matches existing projections across filters, Unicode, numeric ranks and reversals', {timeout:120000}, async t => {
  let PGlite;
  try {
    ({PGlite} = createRequire(process.env.FINANCE_TEST_DATABASE_PACKAGE || new URL('../../../packages/database/package.json',import.meta.url))('@electric-sql/pglite'));
  } catch (error) {
    if(error.code!=='MODULE_NOT_FOUND')throw error;
    t.skip('Optional isolated PGlite dependency unavailable; resolve packages/database dependencies or FINANCE_TEST_DATABASE_PACKAGE');return;
  }
  const {prepareCacheRows,readFinanceCacheRows} = load('finance/finance-period-rows.ts');
  const {buildFinanceReport} = load('finance/finance-report-model.ts');
  const {buildFiscalExpenseTable,fiscalTaxTable} = load('finance/finance-fiscal-model.ts');
  const pg = new PGlite(); t.after(()=>pg.close());
  await pg.exec('CREATE TABLE "FinanceReportCacheRow" ("snapshotKey" text,kind text,id text,payload jsonb,ordinal int,PRIMARY KEY("snapshotKey",kind,id))');
  const sqlCalls=[];
  const tx = {$queryRawUnsafe:async(sql,...args)=>{sqlCalls.push({sql,args});return (await pg.query(sql,args)).rows}};
  const data=legacyFixture();
  const build=(query,all=false)=>buildFinanceReport(data,{...baseQuery,...query},{provider:'NBU',cache:null},now,all).table;
  const save=async(kind,rows,mode,key='ready')=>{
    const prepared=prepareCacheRows(kind,rows,mode);
    await pg.query('INSERT INTO "FinanceReportCacheRow" SELECT $1,x.kind,x.id,x.payload,x.ordinal FROM jsonb_to_recordset($2::jsonb) AS x(kind text,id text,payload jsonb,ordinal int)',[key,JSON.stringify(prepared)]);
    return prepared;
  };
  let comparisons=0;
  for(const tab of ['payments','expenses','invoices']) {
    await save(tab,build({tab},true).rows,'legacy');
    for(const variant of variants.filter(v=>!v.status||tab!=='expenses')) {
      const q={...baseQuery,tab,...variant};
      assert.deepEqual(await readFinanceCacheRows(tx,'ready',tab,q,'legacy'),JSON.parse(JSON.stringify(build(q))),`${tab}: ${JSON.stringify(variant)}`);
      comparisons++;
    }
    const q={...baseQuery,tab,source:'NON_WEBSITE',page:99999,search:'2',sort:'number',direction:'asc'};
    assert.deepEqual(await readFinanceCacheRows(tx,'ready',tab,q,'legacy',true),JSON.parse(JSON.stringify(build(q,true))));
  }
  const expenseRows=build({tab:'expenses'},true).rows.map((r,i)=>({...r,clientId:`c${i%3}`,clientName:['Ёж 10','Ёж 2','İрина 😀'][i%3],
    originalTimestamp:i%7===0?null:`2026-10-${String(i%28+1).padStart(2,'0')}T12:00:00Z`,amountMinor:i%6===0?null:r.amountMinor}));
  // Missing date differs from explicit null in JS; neither passes date bounds.
  delete expenseRows[0].date; expenseRows[1].date=null; delete expenseRows[2].originalTimestamp;
  delete expenseRows[0].orderSource;expenseRows[1].orderSource=null;
  await save('fiscalExpenses',expenseRows,'fiscalExpense');
  for(const variant of variants) {
    const q={...baseQuery,...variant};
    assert.deepEqual(await readFinanceCacheRows(tx,'ready','fiscalExpenses',q,'fiscalExpense'),JSON.parse(JSON.stringify(buildFiscalExpenseTable(expenseRows,q,false))),`fiscal expense: ${JSON.stringify(variant)}`);
    comparisons++;
  }
  const taxRows=Array.from({length:36},(_,i)=>({id:`t${i}`,rootId:`root${i}`,source:'RECEIPT',orderId:i%5?`o${i}`:null,
    orderSource:i%3?'MANUAL':'WEBSITE',number:`ЗАКАЗ ${i}`,clientId:`c${i%3}`,clientName:i%2?'Ёж 2':'İрина 😀',
    paymentId:`p${i}`,component:i%2?'ESV':'UNIFIED',status:i%2?'CALCULATED':'VALUATION_PENDING',
    date:i%7===0?null:'2026-10-10',amountMinor:i%6===0?null:10+i,uahAmountMinor:10+i,evidence:{}}));
  delete taxRows[2].date;
  delete taxRows[1].orderId;delete taxRows[1].orderSource;taxRows[2].orderSource=null;
  taxRows.push(
    {...taxRows[3],id:'é',rootId:'unicode-a',date:'2026-10-01',amountMinor:77},
    {...taxRows[3],id:'e\u0301',rootId:'unicode-b',date:'2026-10-20',amountMinor:77},
    {...taxRows[0],id:'rev-a',rootId:'voided',uahAmountMinor:100,evidence:{}},
    {...taxRows[0],id:'rev-b',rootId:'voided',uahAmountMinor:-100,evidence:{originalPayment:{voidedAt:now.toISOString()}}},
    {...taxRows[0],id:'rev-pending',rootId:'voided',source:'PENDING'},
    {...taxRows[0],id:'not-voided',rootId:'zero',uahAmountMinor:0},
    {...taxRows[0],id:'unknown-amount',rootId:'unknown',uahAmountMinor:null,evidence:{originalPayment:{voidedAt:now.toISOString()}}},
  );
  const prepared=await save('tax',taxRows,'tax');
  assert.ok(!prepared.some(r=>r.id.startsWith('rev-')));
  assert.ok(prepared.some(r=>r.id==='not-voided'));
  assert.ok(prepared.some(r=>r.id==='unknown-amount'));
  for(const variant of [...variants.filter(v=>!v.status),{status:'CALCULATED'},{status:'VALUATION_PENDING'},{search:'p12'},{search:'ESV'},{search:'t12'}]) {
    const q={...baseQuery,...variant};
    assert.deepEqual(await readFinanceCacheRows(tx,'ready','tax',q,'tax'),JSON.parse(JSON.stringify(fiscalTaxTable({rows:taxRows},q))),`tax: ${JSON.stringify(variant)}`);
    comparisons++;
  }
  const taxQuery={...baseQuery,taxComponent:'ESV',page:99999};
  assert.deepEqual(await readFinanceCacheRows(tx,'ready','tax',taxQuery,'tax',true),JSON.parse(JSON.stringify(fiscalTaxTable({rows:taxRows},taxQuery,true))));
  assert.deepEqual(await readFinanceCacheRows(tx,'ready','fiscalExpenses',baseQuery,'fiscalExpense',true),JSON.parse(JSON.stringify(buildFiscalExpenseTable(expenseRows,baseQuery,true))));
  const rawCohort=[
    {id:'received',receivedInMonth:true,activeDebt:false,originalBalanceMinor:0,forecastDate:null},
    {id:'debt',receivedInMonth:false,activeDebt:true,originalBalanceMinor:100,forecastDate:'2026-10-25'},
    {id:'excluded',receivedInMonth:false,activeDebt:false,originalBalanceMinor:100,forecastDate:null},
    {id:'settled',receivedInMonth:false,activeDebt:true,originalBalanceMinor:0,forecastDate:null},
  ];
  await save('rawCohort',rawCohort,'legacy');
  const cohortQuery={...baseQuery,tab:'payments',sort:'number',direction:'asc'};
  assert.deepEqual((await readFinanceCacheRows(tx,'ready','rawCohort',cohortQuery,'legacy')).rows.map(r=>r.id),['debt','received']);
  assert.deepEqual((await readFinanceCacheRows(tx,'ready','rawCohort',{...cohortQuery,scope:'forecast'},'legacy')).rows.map(r=>r.id),['debt']);
  await save('expenses',[{id:'literal',notes:'a\\b',orderSource:null}],'legacy','literals');
  assert.equal((await readFinanceCacheRows(tx,'literals','expenses',{...baseQuery,tab:'expenses',search:'a\\b',source:'NON_WEBSITE'},'legacy')).total,1);
  assert.equal((await readFinanceCacheRows(tx,'literals','expenses',{...baseQuery,tab:'expenses',search:'a%b'},'legacy')).total,0);
  await save('expenses',[{id:'private',number:'secret'}],'legacy',"other' OR 1=1 --");
  assert.equal((await readFinanceCacheRows(tx,"ready' OR 1=1 --",'expenses',baseQuery,'legacy')).total,0);
  assert.equal((await readFinanceCacheRows(tx,'ready',"expenses' OR 1=1 --",baseQuery,'legacy')).total,0);
  assert.ok(sqlCalls.every(call=>!call.sql.includes("O'Reilly")&&!call.sql.includes("OR 1=1 --")));
  assert.ok(sqlCalls.filter(call=>call.sql.startsWith('SELECT payload')).every(call=>call.sql.includes('LIMIT $')&&call.sql.includes('OFFSET $')));
  await assert.rejects(readFinanceCacheRows(tx,'ready','tax',{...baseQuery,sort:'date);DROP TABLE x;--'},'tax'));
  await assert.rejects(readFinanceCacheRows(tx,'ready','tax',{...baseQuery,direction:'desc NULLS FIRST'},'tax'));
  // Large synthetic stored rows prove the export count guard, without expensive
  // ranking generation or reading all rows into application memory.
  await pg.exec(`INSERT INTO "FinanceReportCacheRow" SELECT 'large','tax',n::text,jsonb_build_object('value',jsonb_build_object('id',n::text),'ranks',jsonb_build_object('date:desc',n)),n FROM generate_series(1,50001) n`);
  const before=sqlCalls.length;
  await assert.rejects(readFinanceCacheRows(tx,'large','tax',baseQuery,'tax',true),/50 000/);
  assert.equal(sqlCalls.length,before+1,'oversized export is rejected after count, before loading rows');
  const page=await readFinanceCacheRows(tx,'large','tax',{...baseQuery,page:100000},'tax');
  assert.equal(page.total,50001);assert.equal(page.page,5001);assert.equal(page.rows.length,1);
  await pg.exec(`DELETE FROM "FinanceReportCacheRow" WHERE "snapshotKey"='large' AND id='50001'`);
  const atLimit=await readFinanceCacheRows(tx,'large','tax',baseQuery,'tax',true);
  assert.equal(atLimit.rows.length,50000);assert.equal(atLimit.total,50000);
  assert.equal(atLimit.rows[0].id,'1');assert.equal(atLimit.rows.at(-1).id,'50000');
  const empty=await readFinanceCacheRows(tx,'missing','tax',{...baseQuery,page:100000},'tax');
  assert.deepEqual(empty,{tab:'taxes',rows:[],total:0,page:1,pageSize:10});
  t.diagnostic(`${comparisons} SQL/authoritative-JS page comparisons plus full CSV row parity; no provider or persistent DB access`);
});
