import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

test('KPI active state remains exclusive across source clicks and navigation', {skip:process.env.YO_ORDER_KPI_BROWSER!=='1',timeout:120000},async t=>{
  const require = createRequire(import.meta.url), { chromium, expect } = require('@playwright/test');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), web = resolve(root, 'apps/web');
  const out = resolve(root, '.local/kpi-active/browser'); await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'loader.cjs'), `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText`);
  await writeFile(resolve(out, 'css-loader.cjs'), `module.exports=s=>"const style=document.createElement('style');style.textContent="+JSON.stringify(s)+";document.head.appendChild(style)"`);
  await writeFile(resolve(out,'entry.tsx'),`import React from'react';import{createRoot}from'react-dom/client';import{MantineProvider}from'@mantine/core';import{yoleotardTheme}from'${resolve(web,'lib/mantine-theme').replaceAll('\\','/')}';import{OrdersDashboard}from'${resolve(web,'components/orders-dashboard').replaceAll('\\','/')}';createRoot(document.getElementById('app')).render(<MantineProvider theme={yoleotardTheme}><OrdersDashboard role="OWNER" onNavigate={()=>{}}/></MantineProvider>);`);
  const webpack = require('next/dist/compiled/webpack/webpack').webpack;
  await new Promise((ok, fail) => webpack({ mode:'development',devtool:false,entry:resolve(out,'entry.tsx'),output:{path:out,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.mjs','.js'],modules:[resolve(web,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,use:resolve(out,'loader.cjs')},{test:/\.css$/,use:resolve(out,'css-loader.cjs')}] }}, (err,stats) => err || stats.hasErrors() ? fail(err ?? Error(stats.toString({all:false,errors:true}))) : ok()));
  const layout = await readFile(resolve(web,'app/layout.tsx'),'utf8');
  const styles = [...layout.matchAll(/import ["'](\.\/[^"']+\.css)["'];/g)].map(m=>resolve(web,'app',m[1]));
  const css = Buffer.concat([await readFile(require.resolve('@mantine/core/styles.css')),...await Promise.all(styles.map(p=>readFile(p)))]);

  const requests=[],errors=[],external=[];
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname.startsWith('/api/')){requests.push({path:url.pathname,method:req.method,query:url.search});res.setHeader('content-type','application/json');return res.end(url.pathname==='/api/orders'?JSON.stringify({items:[],total:4,page:1,pageSize:20,focusFound:false,metrics:{total:4,active:3,unpaid:1,deposit:1,urgent:1,overdue:0,ready:1,completed:1,work:1},sources:{total:4,websiteCount:2},disciplines:['RHYTHMIC_GYMNASTICS']}):'[]');}
    if(url.pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');return res.end(await readFile(resolve(out,'bundle.js')));}
    if(url.pathname==='/style.css'){res.setHeader('content-type','text/css');return res.end(css);}
    res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="app"></div><script src="/bundle.js"></script>');
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>new Promise(ok=>server.close(ok)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1366,height:900},hasTouch:true});page.setDefaultTimeout(6000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():(external.push(r.request().url()),r.abort()));
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(base);

  const grid=page.locator('.orders-kpi-grid'),all=()=>grid.getByRole('button',{name:/Все заказы/}),website=()=>grid.getByRole('button',{name:/Онлайн-заказы/});
  async function route(expected){await expect.poll(()=>page.evaluate(()=>Object.fromEntries(new URLSearchParams(location.search)))).toMatchObject(expected);}
  async function active(a,w){for(const [button,value]of [[all(),a],[website(),w]]){await expect(button).toHaveAttribute('aria-pressed',String(value));assert.equal(await button.evaluate(e=>e.classList.contains('active')),value);}}
  async function noSource(){await expect.poll(()=>page.evaluate(()=>new URLSearchParams(location.search).has('source'))).toBe(false);}
  await t.test('website click deactivates All Orders aria and class',async()=>{await page.goto(base);await active(true,false);await website().click();await route({source:'WEBSITE',quick:'all'});await active(false,true);});
  await t.test('All KPI clears source and quick, preserving status discipline search sort',async()=>{
    await page.goto(base+'/?source=WEBSITE&quick=ready&status=CONFIRMED&discipline=RHYTHMIC_GYMNASTICS&search=keep&sort=client&direction=asc');await active(false,true);await all().click();await noSource();await route({quick:'all',status:'CONFIRMED',discipline:'RHYTHMIC_GYMNASTICS',search:'keep',sort:'client',direction:'asc'});await active(true,false);
  });
  await t.test('direct URL reload and browser back restore exclusive state',async()=>{
    await page.goto(base+'/?source=WEBSITE&quick=all');await website().waitFor();await page.reload();await route({source:'WEBSITE',quick:'all'});await website().click();await noSource();await active(true,false);await page.goBack();await route({source:'WEBSITE',quick:'all'});await active(false,true);
  });
  await t.test('quick All chip preserves source; website toggle preserves other quick filters',async()=>{
    await page.goto(base+'/?source=INSTAGRAM&quick=urgent&status=CONFIRMED&discipline=RHYTHMIC_GYMNASTICS');await website().waitFor();await website().click();await route({source:'WEBSITE',quick:'urgent',status:'CONFIRMED',discipline:'RHYTHMIC_GYMNASTICS'});await page.locator('.orders-quick-filters').getByRole('button',{name:/^Все/}).click();await route({source:'WEBSITE',quick:'all',status:'CONFIRMED',discipline:'RHYTHMIC_GYMNASTICS'});await active(false,true);
  });
  assert.ok(requests.every(r=>r.method==='GET'));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);

});
