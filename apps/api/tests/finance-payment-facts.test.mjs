import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url),modules=new Map();
function load(path){const filename=resolve(fileURLToPath(new URL('../src/',import.meta.url)),path);if(modules.has(filename))return modules.get(filename).exports;const module={exports:{}};modules.set(filename,module);const source=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;const local=name=>name.startsWith('.')&&existsSync(resolve(dirname(filename),name+'.ts'))?load(resolve(dirname(filename),name+'.ts')):require(name);vm.runInThisContext(`(function(require,module,exports){${source}\n})`,{filename})(local,module,module.exports);return module.exports;}
const {buildFinanceReport}=load('finance/finance-report-model.ts');
const {readFinancePaymentFacts}=load('finance/finance-payment-facts.ts');
const now=new Date('2026-10-15T10:00:00Z'),valuation={provider:'NBU',cache:null},query={month:'2026-10',currency:'EUR',range:3};
const order={id:'o',number:'26-1',clientId:'c',client:{displayName:'Synthetic'},priceMinor:10000,currency:'EUR',salesStatus:'NEW_LEAD',paymentStatus:'PARTIAL',shippingStatus:'NOT_READY',requiredDeliveryAt:'2026-10-20'};
const payment=(id,date,amount)=>({id,orderId:'o',amountMinor:amount,currency:'EUR',receivedAt:date,method:'BANK_TRANSFER',notes:id});
const base={orders:[order],payments:[payment('old','2024-01-10',3000),payment('now','2026-10-01',2000),payment('later','2026-11-01',1000)],expenses:[],invoices:[],categories:[]};
test('bounded receipt rows plus SQL lifetime facts preserve current table, debts, forecast and cash exactly',()=>{
 const full=buildFinanceReport(base,query,valuation,now);
 const bounded=buildFinanceReport({...base,payments:[base.payments[1]],paymentFacts:{o:{paidMinor:6000,latest:base.payments[2]}}},query,valuation,now);
 assert.deepEqual(bounded,full);
 assert.equal(bounded.debtMinor,4000);
 assert.equal(bounded.table.rows[0].date,'2026-11-01T00:00:00.000Z');
});
test('facts with invalid applied currency must fail rather than turn unknown lifetime amount into zero',()=>{
 assert.throws(()=>buildFinanceReport({...base,payments:[],paymentFacts:{o:{paidMinor:null,latest:null}}},query,valuation,now));
});

test('latest timestamp ties preserve JS receipt ordering rather than database collation',async()=>{
 const tied=['zeta','ZETA'].map(id=>payment(id,'2026-10-01',100));
 const expected=[...tied].sort((a,b)=>b.id.localeCompare(a.id))[0];
 const facts=await readFinancePaymentFacts({$queryRawUnsafe:async(sql)=>{
  assert.match(sql,/max\(recent\."receivedAt"\)/);assert.doesNotMatch(sql,/p\.id DESC LIMIT 1/);
  return [{orderId:'o',paid:'200',invalid:false,latest:tied}];
 }});
 assert.equal(facts.o.latest.id,expected.id);
 assert.equal(buildFinanceReport({...base,payments:tied,paymentFacts:facts},query,valuation,now).table.rows[0].notes,expected.notes);
});

test('canonically equivalent Unicode IDs keep legacy stable tie order despite reverse insertion',async()=>{
 const {PGlite}=createRequire(new URL('../../../packages/database/package.json',import.meta.url))('@electric-sql/pglite');
 const pg=new PGlite({parsers:{1114:value=>new Date(value.replace(' ','T')+'Z')}});
 try{
  await pg.exec(`CREATE TABLE "Order" (id text,currency text,"archivedAt" timestamp);
   CREATE TABLE "Payment" (id text,"orderId" text,"amountMinor" int,currency text,"appliedAmountMinor" int,"appliedCurrency" text,"receivedAt" timestamp,method text,notes text,"voidedAt" timestamp);
   INSERT INTO "Order" VALUES ('o','EUR',NULL);`);
  for(const [id,method] of [['é','CASH'],['e\u0301','BANK_TRANSFER']])await pg.query(`INSERT INTO "Payment" (id,"orderId","amountMinor",currency,"receivedAt",method,notes) VALUES ($1,'o',100,'EUR','2026-10-12',$2,$1)`,[id,method]);
  const payments=(await pg.query(`SELECT * FROM "Payment" ORDER BY id ASC`)).rows;
  assert.equal(payments[0].id.localeCompare(payments[1].id),0);
  const full=buildFinanceReport({...base,payments},query,valuation,now);
  const facts=await readFinancePaymentFacts({$queryRawUnsafe:async sql=>(await pg.query(sql)).rows});
  assert.equal(facts.o.latest.id,payments[0].id);
  assert.deepEqual(buildFinanceReport({...base,payments,paymentFacts:facts},query,valuation,now),full);
 }finally{await pg.close();}
});
