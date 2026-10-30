import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

test('order filters close outside while options and saved filter values remain usable', {skip:process.env.YO_ORDER_FILTER_BROWSER!=='1',timeout:120000},async t=>{
  const require = createRequire(import.meta.url), { chromium, expect } = require('@playwright/test');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), web = resolve(root, 'apps/web');
  const out = resolve(root, '.local/order-filter-outside/browser'); await mkdir(out, { recursive: true });
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
    if(url.pathname.startsWith('/api/')){requests.push({path:url.pathname,method:req.method,query:url.search});res.setHeader('content-type','application/json');return res.end('[]');}
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
  const trigger=()=>page.getByRole('button',{name:/^Фильтры/}),menu=()=>page.getByRole('dialog',{name:'Фильтры',exact:true});
  await trigger().click();await expect(menu()).toBeVisible();
  await page.getByRole('heading',{name:'Заказы',exact:true}).click();await expect(menu()).toHaveCount(0);
  await trigger().click();await menu().getByRole('combobox',{name:'Источник заказа',exact:true}).click();
  await page.getByRole('option',{name:'Instagram',exact:true}).click();
  await expect(menu()).toBeVisible();await expect(menu().getByRole('combobox',{name:'Источник заказа',exact:true})).toHaveValue('Instagram');
  await menu().getByRole('combobox',{name:'Статус',exact:true}).selectOption('CANCELLED');await expect(menu()).toBeVisible();
  await page.getByRole('heading',{name:'Заказы',exact:true}).click();await expect(menu()).toHaveCount(0);
  await trigger().click();await expect(menu().getByRole('combobox',{name:'Статус',exact:true})).toHaveValue('CANCELLED');await expect(menu().getByRole('combobox',{name:'Источник заказа',exact:true})).toHaveValue('Instagram');
  await trigger().click();await expect(menu()).toHaveCount(0);
  for(const width of [1920,1366,390]){
    await page.setViewportSize({width,height:1000});await trigger().click();await expect(menu()).toBeVisible();
    await page.screenshot({animations:'disabled',path:resolve(out,`filters-open-${width}.png`)});
    if(width===390)await page.getByRole('heading',{name:'Заказы',exact:true}).tap();else await page.getByRole('heading',{name:'Заказы',exact:true}).click();
    await expect(menu()).toHaveCount(0);
  }
  await trigger().click();await menu().getByRole('button',{name:'Очистить все',exact:true}).click();await expect(menu()).toBeVisible();await expect(menu().getByRole('combobox',{name:'Статус',exact:true})).toHaveValue('all');
  assert.ok(requests.every(r=>r.method==='GET'));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await writeFile(resolve(out,'receipt.json'),JSON.stringify({status:'PASS',widths:[1920,1366,390],outsideClick:true,touchOutside:true,insideOptionsPreserved:true,valuesRetained:true,noMutations:true,noPageErrors:true},null,2));
});
