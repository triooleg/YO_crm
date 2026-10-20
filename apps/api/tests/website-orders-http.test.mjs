import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {loadTargetModule} from './website-test-loader.mjs';
import {websitePayload} from './fixtures/website-orders.mjs';
import {websiteDatabase} from './fixtures/website-orders-database.mjs';
const require=createRequire(import.meta.url),{NestFactory}=require('@nestjs/core'),{Module,ValidationPipe}=require('@nestjs/common'),{json}=require('express');
const {WebsiteOrdersController,WebsiteOrdersExceptionFilter}=loadTargetModule('website-orders/website-orders.controller.ts');
const {WebsiteOrdersService}=loadTargetModule('website-orders/website-orders.service.ts');
const {WebsiteOrdersGuard,websiteOrdersSecurity,websiteOrdersBodyError}=loadTargetModule('website-orders/website-orders-security.ts');
const {TaxesModule}=loadTargetModule('taxes/taxes.module.ts'),{TaxesService}=loadTargetModule('taxes/taxes.service.ts');
const {WebsiteOrdersModule}=loadTargetModule('website-orders/website-orders.module.ts');
const {PrismaModule}=loadTargetModule('prisma.module.ts'),{PrismaService}=loadTargetModule('prisma.service.ts');
test('actual HTTP bearer/JSON boundary creates and replays orders with full properties, no session or PII errors',async()=>{
 const token='synthetic-website-http-token-0123456789',old=process.env.WEBSITE_ORDERS_API_TOKEN,oldAccounts=process.env.WEBSITE_ORDERS_SOURCE_ACCOUNTS;process.env.WEBSITE_ORDERS_API_TOKEN=token;process.env.WEBSITE_ORDERS_SOURCE_ACCOUNTS='calendar.yoleotard.com';
 const db=websiteDatabase();
 // Actual feature module and factory. Replace only infrastructure; never boot AppModule/.env/workers.
 Reflect.defineMetadata('providers',[{provide:PrismaService,useValue:db}],PrismaModule);
 Reflect.defineMetadata('providers',[{provide:TaxesService,useValue:{capturePayment:async()=>{}}}],TaxesModule);
 class TestModule{}Module({imports:[WebsiteOrdersModule]})(TestModule);
 const app=await NestFactory.create(TestModule,{logger:false,bodyParser:false});app.setGlobalPrefix('api');app.use('/api/integrations/website/orders',websiteOrdersSecurity,json({limit:'256kb'}),websiteOrdersBodyError);app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true}));await app.listen(0,'127.0.0.1');
 const request=async(body,auth=token)=>fetch((await app.getUrl())+'/api/integrations/website/orders',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:typeof body==='string'?body:JSON.stringify(body)});
 try{
  for(const auth of ['',token+'wrong']){const r=await request(websitePayload(),auth);assert.equal(r.status,401);assert.deepEqual(Object.keys(await r.json()).sort(),['code','message','ok']);}assert.equal(db.state.order.length,0);
  const p=websitePayload(),r=await request(p);assert.equal(r.status,200);const first=await r.json();assert.equal(first.ok,true);assert.equal(first.created,true);assert.match(r.headers.get('cache-control'),/no-store/);
  const second=await (await request(p)).json();assert.equal(second.orderId,first.orderId);assert.equal(second.created,false);assert.equal(db.state.order.length,1);assert.deepEqual(db.state.orderItem[0].properties.adjustedMeasurements,{chest:65});
  const malformed=await request('{"customer":"private-person');assert.equal(malformed.status,400);assert.ok(!(await malformed.text()).includes('private-person'));
  const wrong={...p,customer:{...p.customer,email:'private@example.invalid'},secret:token};const bad=await request(wrong);assert.equal(bad.status,400);const error=await bad.text();assert.ok(!error.includes(token)&&!error.includes('private@example.invalid'));assert.equal(db.state.order.length,1);
  const large=await request('"'+'x'.repeat(270000)+'"');assert.equal(large.status,413);assert.equal(db.state.order.length,1);
  process.env.WEBSITE_ORDERS_SOURCE_ACCOUNTS='';const disabled=await request(p);assert.equal(disabled.status,503);assert.equal(db.state.order.length,1);
 }finally{await app.close();if(old===undefined)delete process.env.WEBSITE_ORDERS_API_TOKEN;else process.env.WEBSITE_ORDERS_API_TOKEN=old;if(oldAccounts===undefined)delete process.env.WEBSITE_ORDERS_SOURCE_ACCOUNTS;else process.env.WEBSITE_ORDERS_SOURCE_ACCOUNTS=oldAccounts;}
});