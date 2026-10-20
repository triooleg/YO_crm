import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const base=process.env.PARENT_MEASUREMENTS_HTTP_BASE;
test('integrated public HTTP authorization, DTO order, private images and revocation',{skip:!base,timeout:120000},async t=>{
 assert.equal(base,'http://127.0.0.1:4509/api');
 const f=JSON.parse(readFileSync(process.env.PARENT_MEASUREMENTS_HTTP_FIXTURE,'utf8'));
 const origin='http://127.0.0.1:3530',prefix='/public/parent-measurements';
 const staff={Cookie:'yoleotard_crm_session='+f.staffCookie};
 const token=new URLSearchParams(new URL(f.invite.url).hash.slice(1)).get('invite');
 async function request(method,path,data,headers={}){return fetch(base+path,{method,headers:{...(data===undefined?{}:{'Content-Type':'application/json',Origin:origin}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});}
 const opened=await request('POST',prefix+'/start',{token,locale:'en',consent:true});assert.equal(opened.status,201);
 const session=await opened.json(),cookie=opened.headers.get('set-cookie').split(';')[0];
 const auth={Cookie:cookie,'X-PM-CSRF':session.csrfToken};
 const created=await request('POST',prefix+'/children',{firstName:'HTTP QA'},auth);assert.equal(created.status,201);const child=await created.json();
 await t.test('strict input survives real global-to-controller pipe order',async()=>{
  for(const [path,data] of [['/children',{firstName:'Must reject',athleteId:'foreign'}],['/start',{token,locale:'en',consent:true,orderId:'foreign'}],['/share',{childId:'foreign'}]]){
   const response=await request('POST',prefix+path,data,auth);assert.equal(response.status,400);assert.match(response.headers.get('cache-control'),/no-store/);
  }
 });
 await t.test('staff and participant credentials cannot substitute for each other',async()=>{
  assert.equal((await request('GET',prefix+'/session',undefined,staff)).status,401);
  assert.equal((await request('GET','/orders/'+f.order.id+'/parent-measurements',undefined,auth)).status,401);
  assert.equal((await request('GET',prefix+'/session',undefined,{Cookie:cookie+'; '+cookie})).status,401);
 });
 await t.test('unsafe origins, missing CSRF and wrong content types cannot mutate',async()=>{
  assert.equal((await request('POST',prefix+'/children',{firstName:'No CSRF'},{Cookie:cookie})).status,403);
  assert.equal((await request('POST',prefix+'/children',{firstName:'Wrong origin'},{...auth,Origin:'https://attacker.invalid'})).status,403);
  assert.equal((await fetch(base+prefix+'/children',{method:'POST',headers:{...auth,Origin:origin,'Content-Type':'text/plain'},body:'{}'})).status,403);
 });
 await t.test('private image is reencoded, scoped and served without cache',async()=>{
  const source=await require('sharp')({create:{width:16,height:16,channels:3,background:'#eee'}}).png().toBuffer();
  const uploaded=await request('POST',prefix+'/photos/'+child.id,{mimeType:'image/png',base64:source.toString('base64')},auth);assert.equal(uploaded.status,201);
  const photo=await request('GET',prefix+'/photos/'+child.id,undefined,auth);assert.equal(photo.status,200);assert.equal(photo.headers.get('content-type'),'image/jpeg');assert.match(photo.headers.get('cache-control'),/no-store/);assert.ok((await photo.arrayBuffer()).byteLength>0);
  assert.equal((await request('GET',prefix+'/photos/'+child.id)).status,401);
  assert.equal((await request('POST',prefix+'/photos/'+child.id,{mimeType:'image/svg+xml',base64:Buffer.from('<svg/>').toString('base64')},auth)).status,400);
  const jpeg=await require('sharp')(source).jpeg().toBuffer(),large=Buffer.concat([jpeg,Buffer.alloc(2097152-jpeg.length)]);
  assert.equal((await request('POST',prefix+'/photos/'+child.id,{mimeType:'image/jpeg',base64:large.toString('base64')},auth)).status,201);
 });
 await t.test('photo quota includes superseded files and atomically admits only the last slot',async()=>{
  const source=await require('sharp')({create:{width:2,height:2,channels:3,background:'#aaa'}}).png().toBuffer();
  for(let i=2;i<29;i++)assert.equal((await request('POST',prefix+'/photos/'+child.id,{mimeType:'image/png',base64:source.toString('base64')},auth)).status,201);
  const outcomes=await Promise.all([1,2].map(()=>request('POST',prefix+'/photos/'+child.id,{mimeType:'image/png',base64:source.toString('base64')},auth)));
  assert.deepEqual(outcomes.map(r=>r.status).sort(),[201,409]);
 });
 await t.test('body limits and malformed JSON use safe JSON errors with no raw data',async()=>{
  const oversized=await request('PATCH',prefix+'/children/'+child.id,{revision:0,draft:{firstName:'HTTP QA',notes:'x'.repeat(33000),values:{}}},auth);assert.equal(oversized.status,413);assert.match(oversized.headers.get('cache-control'),/no-store/);
  const malformed=await fetch(base+prefix+'/children',{method:'POST',headers:{...auth,Origin:origin,'Content-Type':'application/json'},body:'{"firstName":"PRIVATE_MARKER",'});assert.equal(malformed.status,400);assert.ok(!(await malformed.text()).includes('PRIVATE_MARKER'));
 });
 await t.test('accepted private photo is visible to authorized staff only for its own order',async()=>{
  const saved=await request('PATCH',prefix+'/children/'+child.id,{revision:0,draft:{firstName:'HTTP QA',discipline:'FIGURE_SKATING',measuredAt:'2026-10-18',values:{m1:70,m2:56,m3:72,m15:122}}},auth);
  assert.equal(saved.status,200);const draft=await saved.json();
  const submitted=await request('POST',prefix+'/children/'+child.id+'/submit',{revision:draft.revision,operationKey:'http_photo_confirm_12345',consent:true},auth);
  assert.equal(submitted.status,201);const receipt=await submitted.json();
  const path='/orders/'+f.order.id+'/parent-measurements/submissions/'+receipt.id+'/photo';
  const image=await request('GET',path,undefined,staff);assert.equal(image.status,200);assert.match(image.headers.get('cache-control'),/no-store/);assert.equal(image.headers.get('content-type'),'image/jpeg');assert.ok((await image.arrayBuffer()).byteLength>0);
  assert.equal((await request('GET',path,undefined,auth)).status,401);
  assert.equal((await request('GET',path.replace(f.order.id,'foreign-order'),undefined,staff)).status,404);
  assert.equal((await request('GET','/parent-measurements/settings/ranges',undefined,staff)).status,403);
 });
 await t.test('invalid invitation returns no order or client projection',async()=>{
  const bad=await request('POST',prefix+'/start',{token:'a'.repeat(43),locale:'en',consent:true});assert.equal(bad.status,401);const text=await bad.text();assert.ok(!text.includes(f.order.number)&&!text.includes('clientId'));
 });
 await t.test('staff revocation immediately invalidates descendants without deleting history',async()=>{
  const revoked=await request('POST','/orders/'+f.order.id+'/parent-measurements/invitations/'+f.invite.id+'/revoke',{},staff);assert.equal(revoked.status,201);
  assert.equal((await request('GET',prefix+'/session',undefined,auth)).status,401);
  assert.equal((await request('POST',prefix+'/start',{token,locale:'en',consent:true})).status,401);
  const dashboard=await (await request('GET','/orders/'+f.order.id+'/parent-measurements',undefined,staff)).json();assert.ok(dashboard.submissions.length>=3);
 });
});
