import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './website-test-loader.mjs';
const {OrderDocumentsService}=loadTargetModule('finance/order-documents.service.ts');
function fixture(number='26-671',issued=false){
 const writes=[],preview={actorId:'owner',expiresAt:'2099-01-01T00:00:00Z',invoiceId:issued?'saved':null,invoice:{orderId:'order',number:'INV-internal',documentOptions:{immutable:true,displayNumber:'YO-671',numberSource:'ORDER'},dataSnapshot:{orderNumber:'YO-671'}},pdfBase64:Buffer.from('SYNTHETIC').toString('base64')};
 const db={$executeRawUnsafe:async()=>{},order:{findFirst:async()=>({id:'order',clientId:'client',number})},appSetting:{findUnique:async({where})=>where.section_key.section==='invoice-previews'?{value:preview}:null,create:async input=>writes.push(input)},invoice:{findFirst:async()=>({id:'saved',number:'INV-internal',documentOptions:{displayNumber:'YO-671'}})}};
 db.invoice.findUnique=async()=>({id:'saved',...structuredClone(preview.invoice)});db.$transaction=async fn=>fn(db);return {service:new OrderDocumentsService(db),writes};
}
test('unsaved prepared invoice is rejected after order renumber before any artifact or invoice write',async()=>{
 const f=fixture();await assert.rejects(()=>f.service.invoiceFromTemplate({previewToken:'preview',idempotencyKey:'request'},{id:'owner'}),e=>e.getStatus()===409);assert.deepEqual(f.writes,[]);
});
test('unchanged unsaved preview remains downloadable and saved issued replay retains immutable old number',async()=>{
 const same=fixture('YO-671');assert.equal((await same.service.invoicePreviewDocument('preview',{id:'owner'})).number,'YO-671');assert.deepEqual(same.writes,[]);
 const saved=fixture('26-671',true),result=await saved.service.invoiceFromTemplate({previewToken:'preview',idempotencyKey:'request'},{id:'owner'});assert.equal(result.number,'YO-671');assert.equal(saved.writes.length,1);assert.equal(saved.writes[0].data.section,'invoice-idempotency');
});
test('unsaved preview download is rejected after renumber rather than presenting the stale order number',async()=>{
 const f=fixture();await assert.rejects(()=>f.service.invoicePreviewDocument('preview',{id:'owner'}),e=>e.getStatus()===409);assert.deepEqual(f.writes,[]);
});
