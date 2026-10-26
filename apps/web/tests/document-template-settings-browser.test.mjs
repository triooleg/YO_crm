import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

test('invoice template settings: draft JSON, readonly copies, validation, PDF and lifecycle', { skip: process.env.YO_TEMPLATE_SETTINGS_BROWSER !== '1', timeout: 180000 }, async t => {
  const require = createRequire(import.meta.url), { chromium, expect } = require('@playwright/test');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), web = resolve(root, 'apps/web'), out = resolve(root, '.local/invoice-template-settings-browser');
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'loader.cjs'), `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText`);
  await writeFile(resolve(out, 'css-loader.cjs'), `module.exports=s=>'const el=document.createElement("style");el.textContent='+JSON.stringify(s)+';document.head.appendChild(el)'`);
  await writeFile(resolve(out, 'entry.tsx'), `import React from'react';import{createRoot}from'react-dom/client';import{MantineProvider}from'@mantine/core';import{yoleotardTheme}from'${resolve(web,'lib/mantine-theme').replaceAll('\\','/')}';import{DocumentTemplateSettings}from'${resolve(web,'components/document-template-settings').replaceAll('\\','/')}';createRoot(document.getElementById('app')).render(<React.StrictMode><MantineProvider theme={yoleotardTheme}><DocumentTemplateSettings/></MantineProvider></React.StrictMode>);`);
  const webpack = require('next/dist/compiled/webpack/webpack').webpack;
  await new Promise((ok, fail) => webpack({ mode:'development',devtool:false,entry:resolve(out,'entry.tsx'),output:{path:out,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js'],modules:[resolve(web,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,use:resolve(out,'loader.cjs')},{test:/\.css$/,use:resolve(out,'css-loader.cjs')}] }},(err,stats)=>err||stats.hasErrors()?fail(err??Error(stats.toString({all:false,errors:true}))):ok()));
  const css = Buffer.concat([await readFile(require.resolve('@mantine/core/styles.css')), await readFile(resolve(web,'app/styles.css'))]);
  const config = { version:1,title:'INVOICE',fieldKeys:['order.number','client.name','finance.total','table.items'],showLogo:true,seller:{name:'Synthetic atelier',address:''},payment:{receiver:'',iban:'',bic:'',instructions:''},currency:null,purpose:'SEPA',isDefault:false,revision:1,notes:'',appearance:{accentColor:'#6c4ad1',mutedColor:'#756d7c',fontSize:10},labels:{},editableMetadata:['issueDate','notes'] };
  let templates = [{id:'builtin',name:'Builtin English',kind:'INVOICE',language:'en',active:true,builtIn:true,config},{id:'generic',name:'Карточка',kind:'CUSTOMER_CARD',language:'ru',active:true,builtIn:false,updatedAt:'2026-10-25T00:00:00Z',config:{...config,isDefault:true,revision:3}}];
  const calls=[], errors=[]; let rejectValidation=false, rejectUpdate=true;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1'); const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=chunks.length?JSON.parse(Buffer.concat(chunks)):undefined;
    const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    if(url.pathname.startsWith('/api/')) {
      calls.push({path:url.pathname,method:req.method,body});
      if(url.pathname==='/api/finance/document-templates'&&req.method==='GET')return send(templates);
      if(url.pathname==='/api/finance/document-field-definitions')return send([{key:'order.number',group:'order',label:{ru:'Номер заказа'},kind:'text'}]);
      if(url.pathname==='/api/orders')return send({items:[{id:'order-1',number:'TEST-1',currency:'EUR'}],page:1,total:1,totalPages:1});
      if(url.pathname.endsWith('/validate'))return send(rejectValidation?{message:'Сервер: недопустимое поле'}:body.config,rejectValidation?400:200);
      if(url.pathname.endsWith('/preview-html'))return send({html:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px sans-serif;margin:24px;color:#241f2b}h1{color:#6c4ad1}table{width:100%;border-collapse:collapse}td{padding:12px;border-bottom:1px solid #eee}</style></head><body><h1>INVOICE</h1><p>TEST-1</p><table><tr><td>Synthetic item</td><td>1</td><td>100 EUR</td></tr></table><p>Unsaved &lt;script&gt; draft</p><script>parent.document.body.dataset.unsafePreview="executed"</script></body></html>'});
      if(url.pathname.endsWith('/preview')){res.writeHead(200,{'content-type':'application/pdf'});return res.end('%PDF-1.4\n%%EOF');}
      if(url.pathname==='/api/finance/document-templates'&&req.method==='POST'){const row={...body,id:'custom-1',active:true,builtIn:false};templates.push(row);return send(row);}
      if(url.pathname==='/api/finance/document-templates/generic'&&req.method==='PATCH'){
        if(rejectUpdate){rejectUpdate=false;return send({message:'Конфликт редакции'},409);}
        templates=templates.map(row=>row.id==='generic'?{...row,...body,config:{...body.config,revision:4}}:row);return send(templates.find(row=>row.id==='generic'));
      }
      if(url.pathname.endsWith('/default')){templates=templates.map(row=>({...row,config:{...row.config,isDefault:row.id==='custom-1'}}));return send({});}
      if(url.pathname.endsWith('/archive')){templates=templates.filter(row=>row.id!=='custom-1');return send({});}
      return send({message:'Unexpected endpoint'},501);
    }
    if(url.pathname==='/bundle.js'){res.writeHead(200,{'content-type':'text/javascript'});return res.end(await readFile(resolve(out,'bundle.js')));}
    if(url.pathname==='/styles.css'){res.writeHead(200,{'content-type':'text/css'});return res.end(css);}
    res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><body><main id="app"></main><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok)); const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await new Promise(ok=>server.close(ok));await writeFile(resolve(out,'evidence.json'),JSON.stringify({calls,errors,provenance:'Real component with synthetic local HTTP; no production/backend proof'},null,2));});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}); page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);
  await expect(page.getByRole('heading',{name:'Шаблоны инвойсов'})).toBeVisible();
  await expect(page.locator('[data-template-id]').first()).toHaveAttribute('data-template-id','generic');
  await page.locator('[data-template-id="builtin"]').getByRole('button',{name:'Просмотреть',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Название шаблона',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Дублировать',exact:true}).last().click();
  await page.getByRole('textbox',{name:'Название шаблона',exact:true}).fill('My draft');
  await page.getByRole('tab',{name:'JSON-конфигурация'}).click();
  const editor=page.getByRole('textbox',{name:'JSON-конфигурация',exact:true});
  await editor.fill('{bad');
  await page.getByRole('button',{name:'Проверить JSON',exact:true}).click();
  await expect(page.getByRole('alert').last()).toContainText('JSON');
  assert.equal(calls.filter(c=>c.path.endsWith('/validate')).length,0);
  const advanced={...config,notes:'Unsaved <script> draft',footer:'Footer from JSON',requiredFields:['seller.name','customer.name'],appearance:{...config.appearance,logoText:'Brand'},labels:{'finance.total':'Согласованная сумма'}};
  await editor.fill(JSON.stringify(advanced,null,2));
  rejectValidation=true;await page.getByRole('button',{name:'Проверить JSON',exact:true}).click();
  await expect(page.getByRole('alert').last()).toContainText('Сервер: недопустимое поле');
  rejectValidation=false;await page.getByRole('button',{name:'Проверить JSON',exact:true}).click();
  await expect(page.getByText('Конфигурация проверена сервером')).toBeVisible();
  await page.getByRole('combobox',{name:'Заказ для проверки'}).click();await page.getByRole('option',{name:'TEST-1 · EUR'}).click();
  await page.getByRole('button',{name:'Предпросмотр PDF',exact:true}).click();
  await expect(page.locator('iframe[title="Предпросмотр шаблона"]')).toBeVisible();
  await expect(page.frameLocator('iframe[title="Предпросмотр шаблона"]').getByRole('heading',{name:'INVOICE'})).toBeVisible();
  await expect(page.locator('iframe[title="Предпросмотр шаблона"]')).toHaveAttribute('sandbox','');
  assert.equal(await page.evaluate(()=>document.body.dataset.unsafePreview),undefined);
  assert.equal(calls.findLast(c=>c.path.endsWith('/preview')).body.config.notes,'Unsaved <script> draft');
  assert.deepEqual(calls.findLast(c=>c.path.endsWith('/preview')).body.config.requiredFields,['seller.name','customer.name']);
  assert.deepEqual(calls.findLast(c=>c.path.endsWith('/preview')).body.config.labels,{'finance.total':'Согласованная сумма'});
  await expect(page.locator('.invoice-template-code pre script')).toHaveCount(0);
  assert.equal(calls.filter(c=>c.path==='/api/finance/document-templates'&&c.method==='POST').length,0);
  await page.screenshot({path:resolve(out,'desktop-editor.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(out,'mobile-editor.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:'Сохранить шаблон',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved=calls.find(c=>c.path==='/api/finance/document-templates'&&c.method==='POST');assert.equal(saved.body.config.isDefault,false);assert.equal(saved.body.kind,'INVOICE');
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-template-id="custom-1"]').getByRole('button',{name:'По умолчанию',exact:true}).click();
  await expect(page.locator('[data-template-id]').first()).toHaveAttribute('data-template-id','custom-1');
  await page.locator('[data-template-id="custom-1"]').getByRole('button',{name:'Архивировать',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Архивировать',exact:true}).click();
  await expect(page.locator('[data-template-id="custom-1"]')).toHaveCount(0);
  await page.locator('[data-template-id="generic"]').getByRole('button',{name:'Изменить шаблон',exact:true}).click();
  await page.getByRole('textbox',{name:'Название шаблона',exact:true}).fill('Updated generic');
  await page.getByRole('button',{name:'Сохранить шаблон',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Конфликт редакции');
  await expect(page.getByRole('textbox',{name:'Название шаблона',exact:true})).toHaveValue('Updated generic');
  await page.getByRole('button',{name:'Сохранить шаблон',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const patch=calls.findLast(c=>c.method==='PATCH');assert.equal(patch.body.expectedRevision,3);assert.equal(patch.body.kind,undefined);
  assert.equal(templates.find(row=>row.id==='generic').kind,'CUSTOMER_CARD');
  for(const width of [1920,1366,390]){
    await page.setViewportSize({width,height:width===390?844:900});
    await page.screenshot({path:resolve(out,'list-'+width+'.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  assert.deepEqual(errors,[]);
});
