import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),require=createRequire(resolve(root,'apps/web/package.json'));
const ts=require('typescript'),i18nModule={exports:{}};new Function('exports',ts.transpileModule(await readFile(resolve(root,'apps/web/lib/i18n.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(i18nModule.exports);const {ordersDashboardUi,orderCreatedDateUi}=i18nModule.exports;
const labels={...orderCreatedDateUi,save:ordersDashboardUi.save,cancel:ordersDashboardUi.cancel};
const original={id:'order-1',createdAt:'2026-10-20T10:11:12.123Z'};
test('order created date popover saves and refreshes without changing other dates',{skip:process.env.YO_ORDER_CREATED_DATE_BROWSER!=='1',timeout:180000},async t=>{
 const {chromium,expect}=require('@playwright/test'),out=resolve(root,'.local/order-created-date');await mkdir(out,{recursive:true});
 await writeFile(resolve(out,'loader.cjs'),`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText`);
 const component=resolve(root,'apps/web/components/orders/order-created-date-editor').replaceAll('\\','/'),theme=resolve(root,'apps/web/lib/mantine-theme').replaceAll('\\','/');
 await writeFile(resolve(out,'entry.tsx'),`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{MantineProvider}from'@mantine/core';import{yoleotardTheme}from'${theme}';import{OrderCreatedDateEditor}from'${component}';function App(){const[order,setOrder]=useState(${JSON.stringify(original)}),[role,setRole]=useState('OWNER');window.fixture={setOrder,setRole};async function request(path,init){const r=await fetch('/api'+path,{...init,headers:{'Content-Type':'application/json'}});if(!r.ok)throw Object.assign(Error('PRIVATE'),{status:r.status});return r.json()}return <MantineProvider theme={yoleotardTheme}><main style={{padding:16}}><table><tbody><tr><td><OrderCreatedDateEditor order={order} actions={['OWNER','ADMIN','MANAGER'].includes(role)?{request,onSaved:async saved=>{setOrder(old=>old.id===saved.id?{...old,...saved}:old);await new Promise(ok=>setTimeout(ok,50));}}:undefined}>20 окт. 2026</OrderCreatedDateEditor></td></tr></tbody></table><output>{order.id} | {order.createdAt}</output></main></MantineProvider>}createRoot(document.getElementById('app')).render(<React.StrictMode><App/></React.StrictMode>);`);
 const webpack=require('next/dist/compiled/webpack/webpack').webpack;await new Promise((ok,fail)=>{const compiler=webpack({mode:'development',devtool:false,entry:resolve(out,'entry.tsx'),output:{path:out,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js'],modules:[resolve(root,'apps/web/node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:resolve(out,'loader.cjs')}]}});compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?fail(error||Error(stats.toString({all:false,errors:true}))):ok()));});

 let status=200,hold=false;const releases=[],calls=[],errors=[];
 const css=Buffer.concat([await readFile(require.resolve('@mantine/core/styles.css')),await readFile(require.resolve('@mantine/dates/styles.css')),await readFile(resolve(root,'apps/web/app/orders-dashboard.css'))]);
 const server=createServer(async(req,res)=>{if(req.url.startsWith('/api/')){let body='';for await(const part of req)body+=part;const input=JSON.parse(body);calls.push({path:req.url,method:req.method,input});if(hold)await new Promise(ok=>releases.push(ok));res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(status===200?{id:'order-1',createdAt:input.createdAt}:{message:'PRIVATE'}));return;}if(req.url==='/bundle.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(await readFile(resolve(out,'bundle.js')));return;}if(req.url==='/styles.css'){res.writeHead(200,{'content-type':'text/css'});res.end(css);return;}res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="app"></div><script src="/bundle.js"></script></html>');});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true});t.after(async()=>{releases.splice(0).forEach(release=>release());await browser.close();server.closeAllConnections();await new Promise(ok=>server.close(ok));});const page=await browser.newPage({viewport:{width:1366,height:768},timezoneId:'America/Los_Angeles'});page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
 const button=name=>page.getByRole('button',{name,exact:true}),input=()=>page.getByRole('textbox',{name:labels.title,exact:true});
 async function reset(){status=200;hold=false;await page.evaluate(value=>{window.fixture.setOrder(value);window.fixture.setRole('OWNER')},original);}
 await t.test('cancel and Escape never mutate; save uses the existing timestamp guard',async()=>{
  await button(labels.edit).click();await input().fill('02.03.2025');await input().press('Tab');await button(labels.cancel).click();assert.equal(calls.length,0);
  await button(labels.edit).click();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(button(labels.edit)).toBeFocused();assert.equal(calls.length,0);
  await button(labels.edit).click();await input().fill('02.03.2025');await input().press('Tab');await button(labels.save).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.deepEqual(calls.at(-1),{path:'/api/orders/order-1/created-at',method:'PATCH',input:{createdAt:'2025-03-02T11:11:12.123Z',expectedCreatedAt:original.createdAt}});await expect(page.locator('output')).toContainText('2025-03-02T11:11:12.123Z');
 });
 await t.test('conflict and network failure retain a draft and never expose private errors',async()=>{
  for(const code of [409,500]){await reset();status=code;await button(labels.edit).click();await input().fill('02.03.2025');await input().press('Tab');await button(labels.save).click();await expect(page.getByRole('alert')).toContainText(code===409?labels.conflict:labels.saveFailed);assert.equal((await page.content()).includes('PRIVATE'),false);await expect(input()).toHaveValue('02.03.2025');await button(labels.cancel).click();}
 });
 await t.test('pending submit locks duplicates and a late receipt never replaces another order',async()=>{
  await reset();hold=true;const before=calls.length;await button(labels.edit).click();await input().fill('02.03.2025');await input().press('Tab');await button(labels.save).evaluate(el=>{el.click();el.click()});await expect.poll(()=>calls.length).toBe(before+1);await expect(button(labels.cancel)).toBeDisabled();
  await page.evaluate(value=>window.fixture.setOrder(value),{...original,id:'order-2'});await expect(page.getByRole('dialog')).toHaveCount(0);hold=false;releases.splice(0).forEach(ok=>ok());await expect(page.locator('output')).toContainText('order-2 | '+original.createdAt);
 });
 await t.test('readonly roles have no trigger and responsive date calendar stays within viewport',async()=>{
  await reset();for(const role of ['PRODUCTION','ACCOUNTANT','SEAMSTRESS','CUTTER','']){await page.evaluate(role=>window.fixture.setRole(role),role);await expect(button(labels.edit)).toHaveCount(0);}
  await reset();for(const[width,height]of [[1920,1080],[1366,768],[390,844]]){await page.setViewportSize({width,height});await button(labels.edit).click();await input().click();await page.screenshot({path:resolve(out,'calendar-'+width+'.png'),fullPage:true,animations:'disabled'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await input().press('Tab');await button(labels.cancel).click();}
 });
 assert.deepEqual(errors,[]);await writeFile(resolve(out,'evidence.json'),JSON.stringify({calls,errors,scope:'local synthetic API; real Mantine DateInput'},null,2));
});
