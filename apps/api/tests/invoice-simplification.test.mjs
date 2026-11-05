import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { websiteDatabase as createDatabase } from './fixtures/website-orders-database.mjs';
const require = createRequire(import.meta.url); require('reflect-metadata');
const cache = new Map();
function load(path) {
 const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../src', path);
 if(cache.has(filename)) return cache.get(filename).exports;
 const module = {exports:{}};cache.set(filename,module);
 const js = ts.transpileModule(readFileSync(filename,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;
 const local = spec => spec.startsWith('.') ? load(resolve(dirname(filename),spec+'.ts')) : require(spec);
 new Function('require','module','exports','__dirname',js)(local,module,module.exports,dirname(filename));return module.exports;
}
const {OrderDocumentsService} = load('finance/order-documents.service.ts');
const {FinanceService} = load('finance/finance.service.ts');
const {invoiceDisplayNumber,presentInvoice} = load('finance/invoice-number.ts');
const user = {id:'staff-1',role:'ADMIN'};
function fixture() {
 const db=createDatabase();
 for(const name of ['appSetting','documentTemplate','invoice']) {
  db.state[name]=[];
  const match=(row,where={})=>Object.entries(where).every(([key,value])=>key==='OR'?value.some(w=>match(row,w)):key==='AND'?value.every(w=>match(row,w)):key==='section_key'?match(row,value):value&&typeof value==='object'&&!(value instanceof Date)?Object.entries(value).every(([op,v])=>op==='startsWith'?row[key]?.startsWith(v):op==='in'?v.includes(row[key]):op==='path'?true:op==='equals'?value.path.reduce((o,k)=>o?.[k],row[key])==null:op==='lt'?value.path.reduce((o,k)=>o?.[k],row[key])<v:false):value===null?row[key]==null:row[key]===value);
  db[name]={
   findFirst:async({where={},orderBy,include}={})=>{const rows=db.state[name].filter(r=>match(r,where));if(orderBy?.number==='desc')rows.sort((a,b)=>b.number.localeCompare(a.number));const row=structuredClone(rows[0]??null);if(row&&include?.order)row.order={...structuredClone(db.state.order.find(o=>o.id===row.orderId)),invoices:structuredClone(db.state.invoice.filter(i=>i.orderId===row.orderId&&i.status==='PAID'))};return row},
   findUnique:async({where})=>structuredClone(db.state[name].find(r=>match(r,where))??null),
   findMany:async({where={}}={})=>structuredClone(db.state[name].filter(r=>match(r,where))),
   deleteMany:async({where})=>{const before=db.state[name].length;db.state[name]=db.state[name].filter(r=>!match(r,where));return {count:before-db.state[name].length}},
   create:async({data})=>{if(db.state[name].some(r=>name==='appSetting'?r.section===data.section&&r.key===data.key:name==='invoice'?r.number===data.number:false))throw Error('unique');const row={id:name+'-'+(db.state[name].length+1),archivedAt:null,status:'DRAFT',active:true,...structuredClone(data)};db.state[name].push(row);return structuredClone(row)},
   update:async({where,data})=>{const row=db.state[name].find(r=>match(r,where));if(!row)throw Error('not found');Object.assign(row,Object.fromEntries(Object.entries(structuredClone(data)).filter(([,v])=>v!==undefined)));return structuredClone(row)},
  };
 }
 db.state.order.push({id:'order-1',clientId:'client-1',number:'YO-1',currency:'EUR',priceMinor:33000,deliveryMinor:3000,discountMinor:0,taxMinor:500,giftWrapMinor:0,createdAt:new Date('2026-10-20'),archivedAt:null,client:{displayName:'Test Buyer',address:'Test address'},items:[{name:'Leotard',quantity:2,priceMinor:15000}],payments:[{amountMinor:35000,currency:'EUR',receivedAt:new Date(),method:'BANK_TRANSFER'}]});
 db.state.appSetting.push({id:'seller',section:'finance',key:'sellerName',value:'Test Seller'});
 db.state.appSetting.push({id:'address',section:'finance',key:'sellerAddress',value:'Test seller address'});
 return {db,documents:new OrderDocumentsService(db)};
}
test('invoice preview freezes final total and signed balance, downloads real PDF without creating Invoice',async()=>{
 const {db,documents}=fixture();
 const preview=await documents.invoicePreview({orderId:'order-1',templateKey:'builtin-invoice-en-sepa'},user);
 assert.equal(preview.totalMinor,33000);assert.equal(preview.currency,'EUR');assert.equal(preview.templateRevision,1);
 assert.equal(db.state.invoice.length,0);
 const pdf=await documents.invoicePreviewDocument(preview.previewToken,user);
 assert.equal(pdf.pdf.subarray(0,5).toString(),'%PDF-');
 assert.equal(db.state.invoice.length,0);
 const invoice=await documents.invoiceFromTemplate({previewToken:preview.previewToken,idempotencyKey:'save-first'},user);
 assert.equal(invoice.status,'ISSUED');
 assert.equal(invoice.dataSnapshot.values['finance.balance'].minor,-2000);
 assert.equal(invoice.totalMinor,33000);assert.equal(invoice.number,preview.number);
 const finance=new FinanceService(db,undefined,documents);
 assert.deepEqual((await finance.document(invoice.id)).pdf,pdf.pdf);
});


const config = (extra={})=>({title:'INVOICE',fieldKeys:['client.name','table.items','finance.total'],seller:{name:'Seller test',address:'Seller address'},...extra});

test('order number is the invoice number in preview, saved copies and PDF filename, frozen independently of registration keys',async()=>{
 const f=fixture();f.db.state.order[0].number='YO-646';
 const a=await f.documents.invoicePreview({orderId:'order-1',templateKey:'builtin-invoice-en-sepa'},user);
 assert.equal(a.number,'YO-646');assert.match(a.html,/>YO-646</);
 const first=await f.documents.invoiceFromTemplate({previewToken:a.previewToken,idempotencyKey:'order-number-a'},user);
 assert.equal(first.number,'YO-646');
 f.db.state.order[0].number='YO-999';
 const b=await f.documents.invoicePreview({orderId:'order-1',templateKey:'builtin-invoice-en-sepa',sourceInvoiceId:first.id},user);
 const second=await f.documents.invoiceFromTemplate({previewToken:b.previewToken,idempotencyKey:'order-number-b'},user);
 assert.equal(second.number,'YO-999');assert.notEqual(first.id,second.id);
 const c=await f.documents.invoicePreview({orderId:'order-1',templateKey:'builtin-invoice-en-sepa'},user);
 const third=await f.documents.invoiceFromTemplate({previewToken:c.previewToken,idempotencyKey:'order-number-c'},user);
 assert.equal(third.number,'YO-999');assert.notEqual(second.id,third.id);
 assert.equal(new Set(f.db.state.invoice.map(row=>row.number)).size,3);
 const pdf=await new FinanceService(f.db,undefined,f.documents).document(first.id);
 assert.equal(pdf.number,'YO-646');assert.equal(pdf.pdf.subarray(0,5).toString(),'%PDF-');
 assert.equal((await new FinanceService(f.db,undefined,f.documents).updateInvoice(second.id,{status:'CANCELLED'},user)).number,'YO-999');
});

test('number projection preserves legacy documents and ignores untrusted or incomplete metadata',()=>{
 const legacy={number:'INV-OLD-123',documentOptions:{immutable:true,displayNumber:'YO-646'}};
 assert.equal(invoiceDisplayNumber(legacy),'INV-OLD-123');
 for(const value of [null,[],{immutable:false,numberSource:'ORDER',displayNumber:'YO-646'},{immutable:true,numberSource:'ORDER',displayNumber:''},{immutable:true,numberSource:'ORDER',displayNumber:'x'.repeat(101)}])assert.equal(invoiceDisplayNumber({number:'OLD',documentOptions:value}),'OLD');
 const raw={id:'saved',number:'REGISTRY-KEY',documentOptions:{immutable:true,numberSource:'ORDER',displayNumber:'YO-646'}};
 assert.equal(presentInvoice(raw).number,'YO-646');assert.equal(raw.number,'REGISTRY-KEY');
 assert.equal(presentInvoice(legacy).number,legacy.number);
});

test('previously saved invoice PDF and filename remain unchanged without ORDER number provenance',async()=>{
 const f=fixture(),bytes=Buffer.from('%PDF-legacy-frozen');
 f.db.state.invoice.push({id:'old',number:'INV-OLD',orderId:'order-1',documentOptions:{immutable:true},archivedAt:null});
 f.db.state.appSetting.push({section:'invoice-documents',key:'old',value:{pdfBase64:bytes.toString('base64')}});
 f.db.state.order[0].number='YO-646';
 const legacy=await new FinanceService(f.db,undefined,f.documents).document('old');
 assert.equal(legacy.number,'INV-OLD');assert.deepEqual(legacy.pdf,bytes);
});

test('CRM graphic logo is frozen in preview and saved PDF; disabling it needs no logo file',async()=>{
 const f=fixture(),p=await f.documents.invoicePreview({orderId:'order-1',templateKey:'builtin-invoice-en-sepa'},user);
 assert.match(p.html,/<img src="data:image\/png;base64,/);
 const original=await f.documents.invoicePreviewDocument(p.previewToken,user);
 const saved=await f.documents.invoiceFromTemplate({previewToken:p.previewToken,idempotencyKey:'logo-frozen'},user);
 f.db.state.appSetting.push({section:'interface',key:'branding',value:{useInHeader:true,logoPath:'00000000-0000-4000-8000-000000000000.webp'}});
 assert.deepEqual((await new FinanceService(f.db,undefined,f.documents).document(saved.id)).pdf,original.pdf);
 const hidden=await custom(f,{showLogo:false});
 const withoutLogo=await f.documents.invoicePreview({orderId:'order-1',templateKey:hidden.id},user);
 assert.doesNotMatch(withoutLogo.html,/<img\b/);
 await assert.rejects(f.documents.invoicePreview({orderId:'order-1',templateKey:'builtin-invoice-en-sepa'},user),error=>{
  assert.equal(error.getResponse().code,'INVOICE_LOGO_UNAVAILABLE');
  assert.equal(error.getResponse().message,'INVOICE_LOGO_UNAVAILABLE');return true;
 });
});
async function custom(f,extra={}) {return f.documents.createTemplate({name:'Custom invoice',kind:'INVOICE',language:'en',config:config(extra)},user)}
test('frozen preview retains order and template values after edits, retries are idempotent even after expiry',async()=>{
 const f=fixture(), template=await custom(f);const p=await f.documents.invoicePreview({orderId:'order-1',templateKey:template.id},user);
 const pdf=await f.documents.invoicePreviewDocument(p.previewToken,user);
 f.db.state.order[0].priceMinor=99999;
 await f.documents.updateTemplate(template.id,{config:config({notes:'Changed note'}),expectedRevision:1},user);
 const [a,b]=await Promise.all([f.documents.invoiceFromTemplate({previewToken:p.previewToken,idempotencyKey:'retry'},user),f.documents.invoiceFromTemplate({previewToken:p.previewToken,idempotencyKey:'retry'},user)]);
 assert.equal(a.id,b.id);assert.equal(a.totalMinor,33000);assert.equal(a.documentOptions.templateRevision,1);
 f.db.state.appSetting.find(s=>s.section==='invoice-previews').value.expiresAt='2000-01-01';
 assert.equal((await f.documents.invoiceFromTemplate({previewToken:p.previewToken,idempotencyKey:'retry'},user)).id,a.id);
 assert.equal(f.db.state.invoice.length,1);assert.equal(f.db.state.activity.filter(a=>a.type==='INVOICE_CREATED').length,1);
 assert.deepEqual((await new FinanceService(f.db,undefined,f.documents).document(a.id)).pdf,pdf.pdf);
 assert.equal(a.documentOptions.pdfBase64,undefined);
});
test('new saved DRAFT is immutable through legacy PATCH; lifecycle remains supported',async()=>{
 const f=fixture(),p=await f.documents.invoicePreview({orderId:'order-1',templateKey:'builtin-invoice-en-sepa'},user);
 const invoice=await f.documents.invoiceFromTemplate({previewToken:p.previewToken,idempotencyKey:'immutable'},user),finance=new FinanceService(f.db,undefined,f.documents);
 assert.equal(invoice.status,'ISSUED');f.db.state.invoice.find(i=>i.id===invoice.id).status='DRAFT';
 for(const change of [{notes:'replace'},{items:[{description:'replace',quantity:1,amountMinor:1}]},{language:'ru'},{seller:{name:'replace'}},{dueDate:null}])await assert.rejects(finance.updateInvoice(invoice.id,change,user),/неизменяем/);
 assert.equal((await finance.updateInvoice(invoice.id,{status:'ISSUED'},user)).status,'ISSUED');
});
test('creator scope, expiry, archived order and archived template reject a save without Invoice',async()=>{
 for(const failure of ['actor','expiry','order','template']) {
  const f=fixture(),t=await custom(f),p=await f.documents.invoicePreview({orderId:'order-1',templateKey:t.id},user);
  let actor=user;
  if(failure==='actor')actor={id:'other'};
  if(failure==='expiry')f.db.state.appSetting.find(s=>s.section==='invoice-previews').value.expiresAt='2000-01-01';
  if(failure==='order')f.db.state.order[0].archivedAt=new Date();
  if(failure==='template')await f.documents.templateAction(t.id,{},user,true);
  await assert.rejects(f.documents.invoiceFromTemplate({previewToken:p.previewToken,idempotencyKey:'fail'},actor));
  assert.equal(f.db.state.invoice.length,0);
 }
});
test('preview token is scoped and PDF download never persists an invoice',async()=>{
 const f=fixture(),p=await f.documents.invoicePreview({orderId:'order-1',templateKey:'builtin-invoice-en-sepa'},user);
 await assert.rejects(f.documents.invoicePreviewDocument(p.previewToken,{id:'other'}),/не найден/);
 assert.equal(f.db.state.appSetting.filter(s=>s.section!=='finance'&&s.section!=='invoice-previews').length,0);
});
test('idempotency key cannot be reused for a different preview',async()=>{
 const f=fixture(),a=await f.documents.invoicePreview({orderId:'order-1',templateKey:'builtin-invoice-en-sepa'},user),b=await f.documents.invoicePreview({orderId:'order-1',templateKey:'builtin-invoice-en-sepa'},user);
 assert.equal(a.number,'YO-1');assert.equal(b.number,'YO-1');assert.notEqual(a.previewToken,b.previewToken);
 await f.documents.invoiceFromTemplate({previewToken:a.previewToken,idempotencyKey:'same'},user);
 await assert.rejects(f.documents.invoiceFromTemplate({previewToken:b.previewToken,idempotencyKey:'same'},user),/другого/);
});
test('save rollback includes PDF and Invoice when audit fails; a retry succeeds once',async()=>{
 const f=fixture(),p=await f.documents.invoicePreview({orderId:'order-1',templateKey:'builtin-invoice-en-sepa'},user),audit=f.db.auditLog.create;
 f.db.auditLog.create=async()=>{throw Error('audit unavailable')};
 await assert.rejects(f.documents.invoiceFromTemplate({previewToken:p.previewToken,idempotencyKey:'rollback'},user),/audit unavailable/);
 assert.equal(f.db.state.invoice.length,0);assert.equal(f.db.state.appSetting.some(s=>s.section==='invoice-documents'),false);
 f.db.auditLog.create=audit;
 assert.ok((await f.documents.invoiceFromTemplate({previewToken:p.previewToken,idempotencyKey:'rollback'},user)).id);
});
test('copy uses explicit current data and retains source lineage; archive preserves PDF/payment/history',async()=>{
 const f=fixture(),p=await f.documents.invoicePreview({orderId:'order-1',templateKey:'builtin-invoice-en-sepa'},user),a=await f.documents.invoiceFromTemplate({previewToken:p.previewToken,idempotencyKey:'source'},user);
 const payments=structuredClone(f.db.state.order[0].payments);
 f.db.state.order[0].priceMinor=45000;
 const copy=await f.documents.invoicePreview({orderId:'order-1',templateKey:'builtin-invoice-en-sepa',sourceInvoiceId:a.id},user),b=await f.documents.invoiceFromTemplate({previewToken:copy.previewToken,idempotencyKey:'copy'},user);
 assert.equal(b.documentOptions.sourceInvoiceId,a.id);assert.equal(b.totalMinor,45000);assert.equal(a.totalMinor,33000);
 await f.documents.archiveInvoice(a.id,user);await f.documents.archiveInvoice(a.id,user);
 assert.equal(f.db.state.invoice.length,2);assert.equal(f.db.state.activity.filter(a=>a.type==='INVOICE_ARCHIVED').length,1);
 assert.deepEqual(f.db.state.order[0].payments,payments);assert.ok(f.db.state.appSetting.find(s=>s.section==='invoice-documents'&&s.key===a.id));
});
test('settings rejects unknown fields; missing seller errors are concrete; configured visibility respected',async()=>{
 const f=fixture();
 assert.throws(()=>f.documents.validateTemplate({language:'en',config:config({fieldKeys:['finance.total','secret.unknown']})}),/secret.unknown/);
 f.db.state.appSetting=f.db.state.appSetting.filter(s=>s.key!=='sellerAddress');
 await assert.rejects(f.documents.invoicePreview({orderId:'order-1',templateKey:'builtin-invoice-en-sepa'},user),/адрес продавца/);
 const t=await custom(f),p=await f.documents.invoicePreview({orderId:'order-1',templateKey:t.id},user),i=await f.documents.invoiceFromTemplate({previewToken:p.previewToken,idempotencyKey:'visible'},user);
 assert.ok(!i.dataSnapshot.fieldKeys.includes('finance.paid'));assert.equal(i.dataSnapshot.values['finance.balance'].minor,-2000);
});
test('template revision checks prevent lost writes and default selection is exclusive',async()=>{
 const f=fixture(),a=await custom(f,{isDefault:true}),b=await custom(f);
 await f.documents.templateAction(b.id,{expectedRevision:1},user);
 const templates=await f.documents.templates();assert.equal(templates.filter(t=>t.isDefault).length,1);assert.equal(templates[0].id,b.id);
 await assert.rejects(f.documents.updateTemplate(a.id,{expectedRevision:1,name:'Stale'},user),/уже изменён/);
 await assert.rejects(f.documents.templateAction('builtin-invoice-en-sepa',{},user),/скопировать/);
});
test('signed corrections and included tax do not change final total or payment policy',async()=>{
 const f=fixture();f.db.state.order[0].discountMinor=2000;f.db.state.order[0].payments.push({amountMinor:-5000,currency:'EUR',receivedAt:new Date(),method:'BANK_TRANSFER'});
 const t=await custom(f,{fieldKeys:['table.items','finance.total','finance.tax','finance.paid','finance.balance','table.payments']}),p=await f.documents.invoicePreview({orderId:'order-1',templateKey:t.id},user),i=await f.documents.invoiceFromTemplate({previewToken:p.previewToken,idempotencyKey:'signed'},user);
 assert.equal(i.totalMinor,33000);assert.equal(i.items.reduce((s,i)=>s+i.quantity*i.amountMinor,0),33000);
 assert.equal(i.dataSnapshot.values['finance.paid'].minor,30000);assert.equal(i.dataSnapshot.values['finance.balance'].minor,3000);
 assert.equal(i.dataSnapshot.payments.at(-1).amountMinor,-5000);assert.equal(i.dataSnapshot.values['finance.tax'].minor,500);
});

test('defaults are scoped by kind and currency and expired cleanup preserves saved evidence',async()=>{
 const f=fixture(),a=await custom(f,{currency:'EUR',isDefault:true}),b=await custom(f,{currency:'USD',isDefault:true});
 assert.equal((await f.documents.templates()).filter(t=>t.isDefault).length,2);
 const stale=await f.documents.invoicePreview({orderId:'order-1',templateKey:a.id},user);
 f.db.state.appSetting.find(s=>s.key===stale.previewToken).value.expiresAt='2000-01-01';
 const good=await f.documents.invoicePreview({orderId:'order-1',templateKey:a.id},user);
 await assert.rejects(f.documents.invoicePreviewDocument(stale.previewToken,user),/не найден/);
 const invoice=await f.documents.invoiceFromTemplate({previewToken:good.previewToken,idempotencyKey:'kept'},user);
 f.db.state.appSetting.find(s=>s.key===good.previewToken).value.expiresAt='2000-01-01';
 await f.documents.invoicePreview({orderId:'order-1',templateKey:a.id},user);
 assert.equal((await f.documents.invoiceFromTemplate({previewToken:good.previewToken,idempotencyKey:'kept'},user)).id,invoice.id);
 await f.documents.archiveInvoice(invoice.id,user);
 assert.equal((await new FinanceService(f.db,undefined,f.documents).document(invoice.id)).pdf.subarray(0,5).toString(),'%PDF-');
});
test('collision rejects save explicitly without changing the PDF or frozen number',async()=>{
 const f=fixture(),a=await f.documents.invoicePreview({orderId:'order-1',templateKey:'builtin-invoice-en-sepa'},user),b=await f.documents.invoicePreview({orderId:'order-1',templateKey:'builtin-invoice-en-sepa'},user);
 assert.equal(a.number,'YO-1');
 const registration=f.db.state.appSetting.find(s=>s.key===a.previewToken).value.invoice.number;
 assert.match(registration,/^INV-YO-\d{4}-[A-F0-9]{12}$/);
 f.db.state.appSetting.find(s=>s.key===b.previewToken).value.invoice.number=registration;
 const results=await Promise.allSettled([f.documents.invoiceFromTemplate({previewToken:a.previewToken,idempotencyKey:'race-a'},user),f.documents.invoiceFromTemplate({previewToken:b.previewToken,idempotencyKey:'race-b'},user)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/новый предпросмотр/);assert.equal(f.db.state.invoice.length,1);
});
test('currency mismatch and disallowed edits fail before preview persistence; metadata allowlist permits dated note',async()=>{
 const f=fixture(),wrong=await custom(f,{currency:'USD'});
 await assert.rejects(f.documents.invoicePreview({orderId:'order-1',templateKey:wrong.id},user),/Валюта/);
 await assert.rejects(f.documents.invoicePreview({orderId:'order-1',templateKey:'builtin-invoice-en-sepa',metadata:{notes:'forbidden'}},user),/запрещает/);
 const t=await custom(f,{editableMetadata:['issueDate','notes'],notes:'Default'}),p=await f.documents.invoicePreview({orderId:'order-1',templateKey:t.id,metadata:{issueDate:'2026-10-22',notes:'Custom note'}},user);
 const i=await f.documents.invoiceFromTemplate({previewToken:p.previewToken,idempotencyKey:'metadata'},user);
 assert.equal(i.issueDate.toISOString(),'2026-10-22T00:00:00.000Z');assert.equal(i.notes,'Custom note');
});

test('HTML is escaped, declarative, frozen with PDF, single effective notes and private settings',async()=>{
 const f=fixture(),t=await custom(f,{seller:{name:'Seller <script>alert(1)</script>',address:'Test address'},notes:'ONE_CONSTANT_NOTE',footer:'Footer <img src="https://external.invalid/x">',fieldKeys:['client.name','table.items','finance.total','finance.tax']}),p=await f.documents.invoicePreview({orderId:'order-1',templateKey:t.id},user);
 assert.match(p.html,/&lt;script&gt;/);assert.doesNotMatch(p.html,/<script|src="https:/);
 assert.match(p.html,/<img src="data:image\/png;base64,/);
 assert.match(p.html,/default-src 'none'/);assert.match(p.html,/@page\{size:A4/);assert.match(p.html,/Tax included in price/);
 assert.equal(p.html.split('ONE_CONSTANT_NOTE').length-1,1);
 assert.doesNotMatch(p.html,/Balance due|>Paid</);
 const i=await f.documents.invoiceFromTemplate({previewToken:p.previewToken,idempotencyKey:'html'},user);
 await f.documents.updateTemplate(t.id,{expectedRevision:1,config:config({notes:'REPLACEMENT_NOTE'})},user);
 assert.equal((await f.documents.invoiceHtml(i.id)).html,p.html);
 await f.documents.archiveInvoice(i.id,user);assert.equal((await f.documents.invoiceHtml(i.id)).html,p.html);
 assert.ok((await new FinanceService(f.db,undefined,f.documents).settings()).every(s=>['finance','orders','production'].includes(s.section)));
});
test('generic template test preview does not invent required invoice seller fields',async()=>{
 const f=fixture(),pdf=await f.documents.previewTemplate({orderId:'order-1',kind:'CUSTOMER_CARD',language:'ru',config:{title:'Карточка клиента',fieldKeys:['client.name']}},user);
 assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
});

test('real HTTP routes enforce RBAC and reject unknown config before legacy whitelist erases it',async()=>{
 const {Module}=require('@nestjs/common'),{NestFactory}=require('@nestjs/core');
 const {FinanceController}=load('finance/finance.controller.ts'),{SessionGuard}=load('auth/session.guard.ts'),{RolesGuard}=load('auth/roles.guard.ts');
 const {ExchangeRatesService}=load('finance/exchange-rates.ts'),{FinanceReportService}=load('finance/finance-report.service.ts');
 const {ParentMeasurementsValidationPipe}=load('parent-measurements/parent-measurements-validation.pipe.ts');
 const {AuthService}=load('auth/auth.service.ts');
 const f=fixture();class HttpTestModule{}
 Module({controllers:[FinanceController],providers:[{provide:FinanceService,useValue:new FinanceService(f.db,undefined,f.documents)},{provide:OrderDocumentsService,useValue:f.documents},{provide:ExchangeRatesService,useValue:{}},{provide:FinanceReportService,useValue:{}},{provide:AuthService,useValue:{userForToken:async role=>({...user,role:role??'ADMIN'})}},SessionGuard,RolesGuard]})(HttpTestModule);
 const app=await NestFactory.create(HttpTestModule,{logger:false,abortOnError:false});app.use((req,res,next)=>{req.cookies={yoleotard_crm_session:req.headers['x-test-role']};next()});app.useGlobalPipes(new ParentMeasurementsValidationPipe());await app.listen(0,'127.0.0.1');
 try {
  const url=await app.getUrl(),call=(path,body,role='ADMIN')=>fetch(url+'/finance/'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-test-role':role},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal((await call('document-templates/validate',{language:'en',config:config()},'MANAGER')).status,403);
  const invalid=await call('document-templates/validate',{language:'en',config:config({unknownOption:'bad'})});assert.equal(invalid.status,400);assert.match((await invalid.json()).message,/unknownOption/);
  assert.equal((await call('document-templates/preview-html',{orderId:'order-1',kind:'CUSTOMER_CARD',language:'ru',config:{title:'Карточка',fieldKeys:['client.name']}})).status,201);
  const response=await call('invoice-previews',{orderId:'order-1',templateKey:'builtin-invoice-en-sepa'},'MANAGER');assert.equal(response.status,201);const p=await response.json();assert.match(p.html,/<!doctype html>/);
  const pdf=await call('invoice-previews/'+p.previewToken+'/document',undefined,'MANAGER');assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
  const saved=await call('invoices/from-template',{previewToken:p.previewToken,idempotencyKey:'http'},'MANAGER');assert.equal(saved.status,201);const invoice=await saved.json();assert.equal(invoice.status,'ISSUED');
  assert.equal((await call('invoices/'+invoice.id+'/preview',undefined,'MANAGER')).status,200);
  assert.equal((await call('invoices/'+invoice.id+'/archive',{},'MANAGER')).status,403);
  assert.equal((await call('invoices/'+invoice.id+'/archive',{})).status,201);
 } finally {await app.close();}
});


test('website NET items keep informational discount out of billed lines and name proven card fee explicitly',async()=>{
 for(const fee of [0,300]) {
  const f=fixture();Object.assign(f.db.state.order[0],{sourceSystem:'YOLEOTARD_WEBSITE',priceMinor:9300+fee,deliveryMinor:300,discountMinor:2000,taxMinor:0,items:[{name:'Net leotard',quantity:1,priceMinor:9000}],externalData:{totals:{cardFeeMinor:fee,chargedMinor:9300+fee}}});
  const t=await custom(f,{fieldKeys:['table.items','finance.discount','finance.total']}),p=await f.documents.invoicePreview({orderId:'order-1',templateKey:t.id},user),i=await f.documents.invoiceFromTemplate({previewToken:p.previewToken,idempotencyKey:'net-'+fee},user);
  assert.deepEqual(i.items.map(row=>[row.description,row.amountMinor]),[['Net leotard',9000],['Shipping',300],...(fee?[['Card payment fee',fee]]:[])]);
  assert.equal(i.totalMinor,9300+fee);assert.match(p.html,/Discount included in item prices/);
  assert.equal(i.dataSnapshot.values['finance.discount'].minor,2000);
 }
});
test('required customer address rejects city-only and snapshots the exact validated real address',async()=>{
 const f=fixture(),t=await custom(f,{requiredFields:['customer.address'],fieldKeys:['client.name','client.address','finance.total']});
 Object.assign(f.db.state.order[0].client,{address:'',city:'Kyiv',postalCode:'01001',country:'Ukraine'});
 await assert.rejects(f.documents.invoicePreview({orderId:'order-1',templateKey:t.id},user),/адрес клиента/);
 f.db.state.order[0].client.address='123 Test Street';
 const p=await f.documents.invoicePreview({orderId:'order-1',templateKey:t.id},user),i=await f.documents.invoiceFromTemplate({previewToken:p.previewToken,idempotencyKey:'address'},user);
 assert.equal(i.customer.address,'123 Test Street');assert.equal(i.dataSnapshot.values['client.address'],'123 Test Street');assert.match(p.html,/123 Test Street/);
});

// Decode actual PDFKit content streams and their embedded ToUnicode map. This
// checks text on PDF pages without adding a PDF parser dependency to the API.
function pdfPages(buffer) {
 const {inflateSync}=require('node:zlib'),objects=new Map(),raw=buffer.toString('latin1');
 for(const match of raw.matchAll(/(\d+) 0 obj\b([\s\S]*?)endobj/g))objects.set(Number(match[1]),match[2]);
 const stream=object=>{const match=/stream\r?\n([\s\S]*?)\r?\nendstream/.exec(object??'');if(!match)return '';const bytes=Buffer.from(match[1],'latin1');return (/FlateDecode/.test(object)?inflateSync(bytes):bytes).toString('utf8')};
 const glyphs=new Map();
 for(const object of objects.values()) {
  const decoded=stream(object);if(!decoded.includes('beginbfrange'))continue;
  for(const range of decoded.matchAll(/<([\da-f]+)>\s*<[\da-f]+>\s*\[([^\]]+)\]/gi)) {
   let glyph=parseInt(range[1],16);for(const unicode of range[2].matchAll(/<([\da-f]+)>/gi)){const points=unicode[1].match(/.{4}/g).map(v=>parseInt(v,16));glyphs.set(glyph++,String.fromCharCode(...points));}
  }
 }
 const pages=[];
 for(const object of objects.values())if(/\/Type\s*\/Page\b/.test(object)) {
  const ref=/\/Contents\s+(\d+) 0 R/.exec(object);assert.ok(ref,'PDF page has a content stream');const content=stream(objects.get(Number(ref[1])));
  pages.push([...content.matchAll(/<([\da-f]+)>/gi)].map(m=>m[1].match(/.{4}/g).map(hex=>glyphs.get(parseInt(hex,16))??'').join('')).join(''));
 }
 return pages;
}
test('a standard invoice fits its payment instructions on the first page', async () => {
 const {renderOrderDocumentPdf, renderSimplifiedInvoiceHtml}=load('finance/order-document-pdf.ts');
 const values={'client.name':'Test buyer','client.email':'buyer@example.test','client.phone':'+1234567890','delivery.address':'Test street 1\nTest city','finance.itemsTotal':{minor:35000,currency:'EUR'},'finance.total':{minor:35000,currency:'EUR'}};
 for(const field of ['finance.discount','finance.delivery','finance.tax']) values[field]={minor:0,currency:'EUR'};
 const source={title:'INVOICE',number:'TEST-713',language:'en',issueDate:new Date('2026-11-05'),
  templateSnapshot:config({seller:{name:'Test Seller',address:'Test street 2\nTest city\nTest region\nTest country'},appearance:{fontSize:10},payment:{receiver:'Test receiver',iban:'TEST-IBAN',bic:'TEST-BIC',instructions:'Please include the invoice number in the payment description.\n\nPayment for custom leotard by invoice {{invoice.number}} from {{invoice.date}}.\n\nIf payment is made in parts, please specify Part 1, Part 2 or Final.'}}),
  dataSnapshot:{immutableInvoice:true,currency:'EUR',orderNumber:'TEST-713',fieldKeys:['order.number','table.items',...Object.keys(values)],values,items:[{description:'Custom leotard',quantity:1,amountMinor:35000}]}};
 const pages=pdfPages(await renderOrderDocumentPdf(source));
 assert.equal(pages.length,1);
 assert.match(pages[0],/Payment Instructions/);
 assert.match(pages[0],/Part 1, Part 2 or Final/);
 const html=renderSimplifiedInvoiceHtml(source);
 assert.match(html,/<div class="parties">[\s\S]*?buyer@example\.test[\s\S]*?\+1234567890[\s\S]*?<div class="metadata">/);
});

test('invoice typography survives validation and selects embedded Unicode fonts per section', async () => {
 const {documents}=fixture();
 const {renderOrderDocumentPdf, renderSimplifiedInvoiceHtml}=load('finance/order-document-pdf.ts');
 const appearance={fontFamily:'noto-serif',fontSize:11,fontWeight:'bold',sections:{customer:{fontFamily:'ubuntu',fontWeight:'normal',fontSize:12},instructions:{fontSize:14}}};
 const template=documents.validateTemplate({language:'en',config:config({appearance,payment:{instructions:'Payment details for the order.'}})});
 for(const key of ['fontFamily','fontWeight','fontSize','sections']) assert.deepEqual(template.appearance[key],appearance[key]);
 for(const invalid of [{fontFamily:'url(https://example.test/font)'},{fontWeight:'light'},{sections:{instructions:{fontSize:25}}},{sections:{unknown:{fontSize:12}}}]) {
  assert.throws(() => documents.validateTemplate({language:'en',config:config({appearance:invalid})}), /Некорректная настройка шаблона/);
 }
 const source={title:'INVOICE',number:'TEST-1',language:'en',templateSnapshot:template,
  dataSnapshot:{immutableInvoice:true,currency:'EUR',fieldKeys:['client.name'],values:{'client.name':'Олена Іваненко'}}};
 const pdf=(await renderOrderDocumentPdf(source)).toString('latin1');
 assert.match(pdf,/\/BaseFont \/[A-Z]+\+NotoSerif-Bold/);
 assert.match(pdf,/\/BaseFont \/[A-Z]+\+Ubuntu/);
 const html=renderSimplifiedInvoiceHtml(source);
 assert.match(html,/\.customer\{font-family:Ubuntu, Arial, sans-serif;font-size:12pt;font-weight:normal/);
 assert.match(html,/\.instructions\{font-family:"Noto Serif", Georgia, serif;font-size:14pt;font-weight:bold/);
 assert.match(html,/font-src data:/);
 assert.match(html,/@font-face\{font-family:"Noto Serif";font-weight:bold;src:url\(data:font\/woff2;base64,/);
 assert.match(html,/@font-face\{font-family:Ubuntu;font-weight:normal;src:url\(data:font\/woff2;base64,/);
 const legacyHtml=renderSimplifiedInvoiceHtml({...source,dataSnapshot:{...source.dataSnapshot,immutableInvoice:false}});
 assert.match(legacyHtml,/padding:17mm 17mm 19mm/);
 assert.doesNotMatch(legacyHtml,/@font-face|font-src data:/);
});

test('large fonts and long column headings keep the item and prices on the same page', async () => {
 const {renderOrderDocumentPdf}=load('finance/order-document-pdf.ts');
 const source={title:'INVOICE',number:'TEST-1',language:'en',
  templateSnapshot:config({appearance:{fontFamily:'noto-serif',fontWeight:'bold',sections:{items:{fontSize:24}}},labels:{qty:'Quantity '.repeat(17)}}),
  dataSnapshot:{immutableInvoice:true,currency:'EUR',fieldKeys:['table.items'],values:{},items:[{description:'Test costume',quantity:2,amountMinor:15000}]}};
 const pages=pdfPages(await renderOrderDocumentPdf(source));
 assert.equal(pages.length,1);
 assert.match(pages[0],/2€150\.00€300\.00Test costume/);
});

test('invoice shows both selected customer and delivery addresses when different', async () => {
 const {renderOrderDocumentPdf, renderSimplifiedInvoiceHtml}=load('finance/order-document-pdf.ts');
 const values={'client.address':'Billing street 1','delivery.address':'Shipping street 2'};
 const source={title:'INVOICE',number:'TEST-1',language:'en',templateSnapshot:config(),
  dataSnapshot:{immutableInvoice:true,currency:'EUR',fieldKeys:Object.keys(values),values}};
 for(const rendered of [pdfPages(await renderOrderDocumentPdf(source)).join(''),renderSimplifiedInvoiceHtml(source)]) {
  assert.match(rendered,/Billing street 1[\s\S]*Shipping street 2/);
 }
});

test('multipage PDF keeps payment and note headings with their first text chunk',async()=>{
 const {renderOrderDocumentPdf}=load('finance/order-document-pdf.ts');
 let multipage=0;
 for(let count=1;count<=14;count++) {
  const source={title:'INVOICE',number:'MULTIPAGE-1',language:'en',issueDate:new Date('2026-10-26'),templateSnapshot:config({labels:{instructions:'PAYMENT_HEADING',notes:'NOTES_HEADING'},notes:'NOTES_FIRST '+('Long note with meaningful detail. '.repeat(35)),footer:'FOOTER_FIRST '+('Footer text. '.repeat(40)),payment:{receiver:'Synthetic receiver',iban:'TEST-IBAN',bic:'TEST-BIC',instructions:'PAYMENT_FIRST '+('Payment instructions with details. '.repeat(30))}}),dataSnapshot:{immutableInvoice:true,currency:'EUR',orderNumber:'YO-1',fieldKeys:['table.items','finance.total','client.name'],values:{'client.name':'Test buyer','finance.total':{minor:33000,currency:'EUR'}},items:Array.from({length:count},(_,i)=>({description:'Product '+(i+1),quantity:1,amountMinor:1000}))}};
  const pages=pdfPages(await renderOrderDocumentPdf(source));if(pages.length>1)multipage++;
  for(const [heading,first] of [['PAYMENT_HEADING','PAYMENT_FIRST'],['NOTES_HEADING','NOTES_FIRST']]) {
   const headingPage=pages.findIndex(page=>page.includes(heading));assert.ok(headingPage>=0,heading+' is in PDF');
   assert.ok(pages[headingPage].includes(first),`${heading} orphaned at page ${headingPage+1} with ${count} items`);
  }
  assert.equal(pages.join('').split('FOOTER_FIRST').length-1,1);
 }
 assert.ok(multipage>0,'exercises real multipage output');
});


test('built-in templates can be edited in place without duplicate choices or changes to saved invoices',async()=>{
 const f=fixture(),key='builtin-invoice-en-sepa';
 const initial=(await f.documents.templates()).find(t=>t.id===key);
 const oldPreview=await f.documents.invoicePreview({orderId:'order-1',templateKey:key},user);
 const oldInvoice=await f.documents.invoiceFromTemplate({previewToken:oldPreview.previewToken,idempotencyKey:'before-template-edit'},user);
 const savedPdf=await new FinanceService(f.db,undefined,f.documents).document(oldInvoice.id);
 const updated=await f.documents.updateTemplate(key,{name:'My SEPA',expectedRevision:1,config:{...initial.config,seller:{name:'Updated Seller',address:'Updated address'},notes:'Updated invoice note'}},user);
 assert.equal(updated.id,key);assert.equal(updated.config.revision,2);assert.equal(updated.builtIn,false);
 const choices=await f.documents.templates();assert.equal(choices.filter(t=>t.id===key).length,1);
 assert.equal(choices.find(t=>t.id===key).name,'My SEPA');
 const next=await f.documents.invoicePreview({orderId:'order-1',templateKey:key},user);
 assert.match(next.html,/Updated Seller/);assert.match(next.html,/Updated invoice note/);assert.equal(next.templateRevision,2);
 assert.deepEqual((await new FinanceService(f.db,undefined,f.documents).document(oldInvoice.id)).pdf,savedPdf.pdf);
 assert.equal(oldInvoice.templateSnapshot.seller.name,'Test Seller');
 assert.ok(f.db.state.auditLog.some(a=>a.entityType==='DocumentTemplate'&&a.entityId===key));
});


test('first built-in edit inherits current seller defaults, then respects saved seller values',async()=>{
 const f=fixture(),key='builtin-invoice-en-swift';
 const listed=(await f.documents.templates()).find(t=>t.id===key);
 assert.deepEqual(listed.config.seller,{name:'Test Seller',address:'Test seller address'});
 const edited=await f.documents.updateTemplate(key,{name:'Renamed SWIFT',expectedRevision:1},user);
 assert.deepEqual(edited.config.seller,listed.config.seller);
 f.db.state.appSetting.find(x=>x.key==='sellerName').value='Different global seller';
 const p=await f.documents.invoicePreview({orderId:'order-1',templateKey:key},user);
 assert.match(p.html,/Test Seller/);assert.doesNotMatch(p.html,/Different global seller/);
 await f.documents.updateTemplate(key,{config:{...edited.config,seller:{name:edited.config.seller.name,address:''}},expectedRevision:2},user);
 await assert.rejects(f.documents.invoicePreview({orderId:'order-1',templateKey:key},user),/продавца/);
});

test('simultaneous built-in edits create one override and reject stale revision and unknown IDs',async()=>{
 const f=fixture(),key='builtin-invoice-fr-sepa';
 const results=await Promise.allSettled(['First','Second'].map(name=>f.documents.updateTemplate(key,{name,expectedRevision:1},user)));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.match(results.find(x=>x.status==='rejected').reason.message,/уже изменён/);
 assert.equal(f.db.state.documentTemplate.filter(x=>x.id===key).length,1);
 const current=(await f.documents.templates()).find(t=>t.id===key);assert.equal(current.config.revision,2);
 await assert.rejects(f.documents.updateTemplate('builtin-unrecognized',{name:'Unknown',expectedRevision:1},user),/не найден/);
 assert.equal(f.db.state.documentTemplate.length,1);
});

test('inactive and archived built-in overrides never resurrect defaults or allow an unsaved frozen preview',async()=>{
 for(const action of ['inactive','archive']) {
  const f=fixture(),key='builtin-invoice-en-sepa';
  const pending=await f.documents.invoicePreview({orderId:'order-1',templateKey:key},user);
  await f.documents.updateTemplate(key,{name:'Edited template',expectedRevision:1,active:action!=='inactive'},user);
  if(action==='archive')await f.documents.templateAction(key,{expectedRevision:2},user,true);
  const rows=(await f.documents.templates()).filter(x=>x.id===key);
  assert.equal(rows.length,action==='archive'?0:1);
  if(rows.length)assert.equal(rows[0].active,false);
  await assert.rejects(f.documents.invoicePreview({orderId:'order-1',templateKey:key},user),/не найден/);
  await assert.rejects(f.documents.invoiceFromTemplate({previewToken:pending.previewToken,idempotencyKey:'unavailable'},user),/не активен/);
  if(action==='archive')await assert.rejects(f.documents.updateTemplate(key,{name:'Resurrect',expectedRevision:2},user),/не найден/);
  assert.equal(f.db.state.invoice.length,0);
 }
});

test('frozen built-in previews retain old content after editing and saved replays survive archiving',async()=>{
 const f=fixture(),key='builtin-invoice-en-sepa';
 const p=await f.documents.invoicePreview({orderId:'order-1',templateKey:key},user);
 await f.documents.updateTemplate(key,{expectedRevision:1,config:config({notes:'New template content'})},user);
 const saved=await f.documents.invoiceFromTemplate({previewToken:p.previewToken,idempotencyKey:'frozen-builtin'},user);
 assert.equal(saved.documentOptions.templateRevision,1);assert.notEqual(saved.templateSnapshot.notes,'New template content');
 await f.documents.templateAction(key,{expectedRevision:2},user,true);
 const replay=await f.documents.invoiceFromTemplate({previewToken:p.previewToken,idempotencyKey:'frozen-builtin'},user);
 assert.equal(replay.id,saved.id);assert.equal(f.db.state.invoice.length,1);
});


test('built-in customer card can be edited without invoice seller details; invoices still require seller',async()=>{
 const f=fixture(),key='builtin-customer-card-ru';
 const initial=(await f.documents.templates()).find(t=>t.id===key);
 assert.deepEqual(initial.config.seller,{name:'',address:''});
 const updated=await f.documents.updateTemplate(key,{expectedRevision:1,config:{...initial.config,title:'Моя карточка'}},user);
 assert.equal(updated.kind,'CUSTOMER_CARD');assert.equal(updated.config.title,'Моя карточка');
 const invoiceKey='builtin-invoice-en-sepa',invoice=(await f.documents.templates()).find(t=>t.id===invoiceKey);
 await f.documents.updateTemplate(invoiceKey,{expectedRevision:1,config:{...invoice.config,seller:{name:'',address:''}}},user);
 await assert.rejects(f.documents.invoicePreview({orderId:'order-1',templateKey:invoiceKey},user),/продавца/);
});


test('first built-in materialization rolls back when audit fails',async()=>{
 const f=fixture(),key='builtin-invoice-en-sepa';
 f.db.auditLog.create=async()=>{throw Error('audit-write-failed')};
 await assert.rejects(f.documents.updateTemplate(key,{name:'Not committed',expectedRevision:1},user),/audit-write-failed/);
 assert.equal(f.db.state.documentTemplate.length,0);
 const row=(await f.documents.templates()).find(t=>t.id===key);assert.equal(row.builtIn,true);assert.equal(row.config.revision,1);
});

test('generic document save rechecks a built-in tombstone inside the saving transaction',async()=>{
 const f=fixture(),key='builtin-customer-card-ru';
 f.db.state.orderDocument=[];
 f.db.orderDocument={create:async({data})=>{f.db.state.orderDocument.push(data);return {id:'doc-1',...data}}};
 const transaction=f.db.$transaction.bind(f.db);
 f.db.$transaction=run=>{
  f.db.state.documentTemplate.push({id:key,name:'Archived card',kind:'CUSTOMER_CARD',language:'ru',active:false,archivedAt:new Date(),config:{}});
  return transaction(run);
 };
 await assert.rejects(f.documents.create({orderId:'order-1',templateKey:key},user),/шаблон документа не найден/);
 assert.equal(f.db.state.orderDocument.length,0);
});
