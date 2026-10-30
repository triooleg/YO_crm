import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

test('tracking controls generate language links and retry refresh without repeating a mutation', {skip:process.env.YO_TRACKING_CONTROLS_BROWSER!=='1',timeout:120000},async t=>{
  const require = createRequire(import.meta.url), { chromium, expect } = require('@playwright/test');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), web = resolve(root, 'apps/web');
  const out = resolve(root, '.local/tracking-controls/browser'); await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'loader.cjs'), `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText`);
  await writeFile(resolve(out, 'css-loader.cjs'), `module.exports=s=>"const style=document.createElement('style');style.textContent="+JSON.stringify(s)+";document.head.appendChild(style)"`);
  await writeFile(resolve(out,'entry.tsx'),`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{MantineProvider}from'@mantine/core';import{yoleotardTheme}from'${resolve(web,'lib/mantine-theme').replaceAll('\\','/')}';import{ShipmentTrackingUrl}from'${resolve(web,'components/orders/shipment-tracking-url').replaceAll('\\','/')}';function App(){const[shipment,setShipment]=useState({id:'parcel',trackingNumber:'PC0000020000000001NPG',trackingRevision:1});window.replaceTracking=setShipment;return <MantineProvider theme={yoleotardTheme}><main style={{padding:20,maxWidth:650}}><ShipmentTrackingUrl orderId="order" shipment={shipment} canEdit={true} onSaved={async()=>{const r=await fetch('/api/refresh');if(!r.ok)throw Error('refresh');setShipment(await r.json())}}/></main></MantineProvider>}createRoot(document.getElementById('app')).render(<App/>);`);
  const webpack = require('next/dist/compiled/webpack/webpack').webpack;
  await new Promise((ok, fail) => webpack({ mode:'development',devtool:false,entry:resolve(out,'entry.tsx'),output:{path:out,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.mjs','.js'],modules:[resolve(web,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,use:resolve(out,'loader.cjs')},{test:/\.css$/,use:resolve(out,'css-loader.cjs')}] }}, (err,stats) => err || stats.hasErrors() ? fail(err ?? Error(stats.toString({all:false,errors:true}))) : ok()));
  const layout = await readFile(resolve(web,'app/layout.tsx'),'utf8');
  const styles = [...layout.matchAll(/import ["'](\.\/[^"']+\.css)["'];/g)].map(m=>resolve(web,'app',m[1]));
  const css = Buffer.concat([await readFile(require.resolve('@mantine/core/styles.css')),...await Promise.all(styles.map(p=>readFile(p)))]);

  let parcel={id:'parcel',trackingNumber:'PC0000020000000001NPG',trackingRevision:1},failRefresh=false;
  const mutations=[],errors=[],external=[];
  const options=()=>['uk','en'].map(language=>({language,url:`https://nova.global/${language==='uk'?'ua':'en'}-ua/track/?Tracking_ID=${parcel.trackingNumber}`}));
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    const send=(body,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body))};
    if(url.pathname==='/api/refresh')return failRefresh?send({},500):send(parcel);
    if(url.pathname.startsWith('/api/')){
      if(req.method==='GET')return send({options:options(),url:options()[0].url,language:'uk'});
      let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);mutations.push({method:req.method,input});
      assert.equal(input.orderId,'order');assert.equal(input.shipmentId,'parcel');assert.equal(input.trackingRevision,parcel.trackingRevision);assert.equal(input.trackingUrl,undefined);
      if(req.method==='DELETE')parcel={...parcel,trackingNumber:null,trackingRevision:parcel.trackingRevision+1};
      else parcel={...parcel,trackingRevision:parcel.trackingRevision+1};return send(parcel);
    }
    if(url.pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');return res.end(await readFile(resolve(out,'bundle.js')))}
    if(url.pathname==='/style.css'){res.setHeader('content-type','text/css');return res.end(css)}
    res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="app"></div><script src="/bundle.js"></script>');
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>new Promise(ok=>server.close(ok)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1366,height:900}});page.setDefaultTimeout(6000);
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():(external.push(route.request().url()),route.abort()));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.getByRole('link',{name:'Отследить посылку'})).toHaveAttribute('href',options()[0].url);
  await page.getByRole('button',{name:'Изменить язык ссылки'}).click();
  await expect(page.getByRole('textbox',{name:'Ссылка отслеживания'})).toHaveAttribute('readonly','');
  await page.getByRole('combobox',{name:'Язык ссылки'}).click();await page.getByRole('option',{name:'Английский'}).click();
  await expect(page.getByRole('textbox',{name:'Ссылка отслеживания'})).toHaveValue(options()[1].url);
  failRefresh=true;await page.getByRole('button',{name:'Сохранить',exact:true}).dblclick();
  await expect(page.getByRole('alert')).toContainText('Изменение сохранено');assert.equal(mutations.length,1);assert.equal(mutations[0].input.language,'en');
  await expect(page.getByRole('button',{name:'Отмена',exact:true})).toBeDisabled();
  failRefresh=false;await page.getByRole('button',{name:'Обновить данные'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);assert.equal(mutations.length,1);
  for(const width of [1920,1366,390]){
    await page.setViewportSize({width,height:900});await page.getByRole('button',{name:'Изменить язык ссылки'}).click();
    const box=await page.getByRole('dialog').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);
    if(width===390){for(const control of [page.getByRole('combobox',{name:'Язык ссылки'}),page.getByRole('button',{name:'Сохранить',exact:true}),page.getByRole('button',{name:'Отмена',exact:true})]){const target=await control.boundingBox();assert.ok(target.height>=43);assert.ok(target.x>=0&&target.x+target.width<=width+1);}}
    await page.screenshot({path:resolve(out,`language-${width}.png`),animations:'disabled'});
    await page.getByRole('button',{name:'Отмена',exact:true}).click();
  }
  await page.getByRole('button',{name:'Удалить трек-номер',exact:true}).click();await page.getByRole('button',{name:'Отмена',exact:true}).click();assert.equal(mutations.length,1);
  await page.getByRole('button',{name:'Удалить трек-номер',exact:true}).click();failRefresh=true;
  await page.getByRole('dialog').getByRole('button',{name:'Удалить трек-номер',exact:true}).dblclick();await expect(page.getByRole('alert')).toContainText('Изменение сохранено');assert.equal(mutations.length,2);
  failRefresh=false;await page.getByRole('button',{name:'Обновить данные'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('link')).toHaveCount(0);assert.equal(mutations.length,2);
  parcel={id:'parcel',trackingNumber:'PC0000020000000002NPG',trackingRevision:4};await page.evaluate(value=>window.replaceTracking(value),parcel);
  await expect(page.getByRole('button',{name:'Удалить трек-номер',exact:true})).toBeVisible();await expect(page.getByRole('link')).toHaveAttribute('href',options()[0].url);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await writeFile(resolve(out,'receipt.json'),JSON.stringify({status:'PASS',mutations:mutations.map(m=>m.method),widths:[1920,1366,390],noExternalRequests:true},null,2));
});
