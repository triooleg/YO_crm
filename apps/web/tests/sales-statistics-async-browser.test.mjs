import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer} from 'node:http';

test('sales statistics keeps mounted charts, scroll and query-coherent data during async controls', {skip:process.env.YO_SALES_ASYNC_BROWSER!=='1',timeout:180000},async t=>{
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),sourceRoot=resolve(process.env.YO_CRM_SOURCE_ROOT??root),web=resolve(sourceRoot,'apps/web'),out=resolve(root,'.local/sales-statistics-async/browser');
 const require=createRequire(resolve(web,'package.json')),{chromium,expect}=require('@playwright/test');
 const {fixtureModel}=await import(pathToFileURL(resolve(web,'tests/fixtures/sales-statistics-browser-fixture.mjs')));
 await mkdir(out,{recursive:true});
 for(const [name,file] of [['workspace','sales-statistics-workspace'],['modes','overview-modes-workspace']]){
  const source=await readFile(resolve(root,`apps/web/components/${file}.tsx`),'utf8');
  await writeFile(resolve(out,`${name}.tsx`),source.replace(/(from\s*['"])(\.[^'"]+)(['"])/g,(_all,a,path,b)=>a+(path==='./sales-statistics-workspace'?resolve(out,'workspace'):path==='../lib/sales-statistics'?resolve(root,'apps/web/lib/sales-statistics'):resolve(web,'components',path)).replaceAll('\\','/')+b));
 }
 const shell=process.env.YO_SALES_ASYNC_SHELL==='1';
 if(shell){const file=process.env.YO_SALES_SHELL_SOURCE??resolve(web,'components/crm-shell.tsx'),source=await readFile(file,'utf8');await writeFile(resolve(out,'shell.tsx'),source.replace(/(from\s*['"])(\.[^'"]+)(['"])/g,(_all,a,path,b)=>a+(path==='./overview-modes-workspace'?resolve(out,'modes'):resolve(web,'components',path)).replaceAll('\\','/')+b))}
 await writeFile(resolve(out,'loader.cjs'),`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText`);
 await writeFile(resolve(out,'css-loader.cjs'),`module.exports=s=>"const style=document.createElement('style');style.textContent="+JSON.stringify(s)+";document.head.appendChild(style)"`);
 await writeFile(resolve(out,'entry.tsx'),`import React from'react';import{createRoot}from'react-dom/client';import{MantineProvider}from'@mantine/core';import{OverviewModesWorkspace}from'./modes';${shell?"import{CrmShell}from'./shell';":''}import{yoleotardTheme}from'${resolve(web,'lib/mantine-theme').replaceAll('\\','/')}';window.fixture={navigations:[],role:'OWNER'};const root=createRoot(document.getElementById('app'));window.fixture.render=()=>root.render(<MantineProvider theme={yoleotardTheme}>${shell?'<CrmShell/>':'<OverviewModesWorkspace role={window.fixture.role} onNavigate={(...args)=>window.fixture.navigations.push(args)}/>'}</MantineProvider>);window.fixture.render();`);
 const webpack=require('next/dist/compiled/webpack/webpack').webpack;
 await new Promise((ok,fail)=>{const compiler=webpack({mode:'development',devtool:false,plugins:[new webpack.DefinePlugin({'process.env':JSON.stringify({NODE_ENV:'development'})})],entry:resolve(out,'entry.tsx'),output:{path:out,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js'],modules:[resolve(web,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:resolve(out,'loader.cjs')},{test:/\.css$/,use:resolve(out,'css-loader.cjs')}]}});compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?fail(error??Error(stats.toString({all:false,errors:true}))):ok()));});
 const layout=await readFile(resolve(web,'app/layout.tsx'),'utf8'),cssPaths=[...layout.matchAll(/import ['"](.\/[^'"]+\.css)['"]/g)].map(m=>resolve(web,'app',m[1]));
 const css=Buffer.concat([await readFile(require.resolve('@mantine/core/styles.css')),await readFile(require.resolve('@mantine/dates/styles.css')),...await Promise.all(cssPaths.map(p=>readFile(p)))]);
 const server=createServer(async(req,res)=>{if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');return res.end(await readFile(resolve(out,'bundle.js')))}if(req.url==='/style.css'){res.setHeader('content-type','text/css');return res.end(css)}res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="app"></div><script src="/bundle.js"></script>')});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1366,height:768},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(7000);
 const model=fixtureModel('OWNER'),calls=[],errors=[],violations=[],held=[];let hold=false,documents=0,failed=false,activeRole='OWNER';
 t.after(async()=>{for(const r of held.splice(0))await r.abort().catch(()=>{});await browser.close();server.closeAllConnections();await new Promise(ok=>server.close(ok));await writeFile(resolve(out,'receipt.json'),JSON.stringify({calls,errors,violations,documents,syntheticOnly:true},null,2))});
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.hostname!=='127.0.0.1'||req.method()!=='GET'){violations.push(req.url());return route.abort()}if(req.isNavigationRequest())documents++;if(!url.pathname.startsWith('/api/'))return route.continue();calls.push(url.pathname+url.search);if(url.pathname==='/api/overview/sales-statistics'){if(hold){held.push(route);return}if(failed)return route.fulfill({status:503,json:{message:'synthetic failure'}});return route.fulfill({json:(activeRole==='OWNER'?model:fixtureModel(activeRole)).report(Object.fromEntries(url.searchParams))})}return route.fulfill({json:url.pathname.endsWith('/tasks')?{rows:[]}:url.pathname.endsWith('/messages')?{rows:[],unreadCount:0}:url.pathname.endsWith('/shipments')?{rows:[],count7:0,requiresVerification:0}:{month:'2026-10',currency:'EUR',counts:{total:0},ring:{total:0,segments:[]},trend:[],recent:[],current:{},previous:{},monthlyTrend:[]}})});
 await page.route('**/api/auth/me',route=>route.fulfill({json:{user:{id:'synthetic-owner',role:'OWNER',displayName:'Synthetic QA',email:'qa@example.test'}}}));
 for(const [path,json]of [['/api/branding',{}],['/api/communications/unread-count',{unreadCount:0}],['/api/orders/website-notifications',{items:[],unreadCount:0}]])await page.route(`**${path}`,route=>route.fulfill({json}));
 const ready=()=>expect(page.locator('.sales-statistics-page')).toHaveAttribute('data-statistics-ready','true');
 const release=async()=>{const routes=held.splice(0);for(const route of routes)await route.fulfill({json:model.report(Object.fromEntries(new URL(route.request().url()).searchParams))}).catch(()=>{});};
 await page.goto(`http://127.0.0.1:${server.address().port}/?section=overview&view=statistics&from=2026-01-01&to=2026-10-31&currency=EUR`);await ready();
 await t.test('metric request retains chart DOM and scroll while awaiting response',async()=>{
  const select=page.locator('input[aria-label="Показатель диаграмм"]').first();await select.scrollIntoViewIfNeeded();
  await page.evaluate(()=>{window.fixture.grid=document.querySelector('.sales-statistics-grid');window.fixture.scroll=window.scrollY});hold=true;
  try{await select.click();await page.getByRole('option',{name:'Изделия',exact:true}).click();await expect.poll(()=>held.length).toBe(1);
   assert.equal(await page.evaluate(()=>document.querySelector('.sales-statistics-grid')===window.fixture.grid),true,'pending fetch must not remove entire report');
   assert.ok(await page.evaluate(()=>Math.abs(scrollY-window.fixture.scroll)<3),'pending fetch must preserve scroll');
  }finally{hold=false;await release();await ready()}
 });
 await t.test('all tab controls and browser history update within one document',async()=>{
  for(const name of ['Источники','Клиенты','Виды спорта','Типы заказов','Страны']){await page.locator('.sales-statistics-toolbar label').filter({hasText:new RegExp(`^${name}$`)}).click();await ready()}
  await page.evaluate(()=>window.fixture.node=document.querySelector('.sales-statistics-page'));await page.goBack();await ready();assert.equal(await page.evaluate(()=>document.querySelector('.sales-statistics-page')===window.fixture.node),true);await page.goForward();await ready();assert.equal(documents,1);
 });
 await t.test('mode changes stay inside overview caller without shell navigate/remount',async()=>{
  await page.locator('.sales-statistics-mode label').filter({hasText:/^Обзор$/}).click();await expect(page.locator('.overview-page')).toBeVisible();assert.deepEqual(await page.evaluate(()=>window.fixture.navigations),[]);
  assert.equal(new URL(page.url()).searchParams.get('view'),'overview');await page.goBack();await ready();
 });
 const select=async(label,option,index=0)=>{await page.locator(`input[aria-label="${label}"]`).nth(index).click();await page.getByRole('option',{name:option,exact:true}).click()};
 await t.test('months, metric selectors, sorting and explicit filters remain async with original queries',async()=>{
  for(const [label,value,param,expected] of [['Горизонт диаграмм','12 месяцев','months','12'],['Показатель новых и постоянных клиентов','Заказы','customerMetric','orders'],['Показатель выручки','Фактические поступления','revenueMetric','payments'],['Ранжирование клиентов','Изделия','ranking','pieces']]){await select(label,value);await ready();assert.equal(new URL('http://localhost'+calls.at(-1)).searchParams.get(param),expected)}
  await page.getByRole('button',{name:'Сортировать: Заказы',exact:true}).first().click();await ready();assert.equal(new URL('http://localhost'+calls.at(-1)).searchParams.get('sort'),'orders');
  const count=calls.length;await select('Источник','Instagram');assert.equal(calls.length,count,'draft filter must not request until Apply');await page.getByRole('button',{name:'Применить',exact:true}).first().click();await ready();assert.equal(new URL('http://localhost'+calls.at(-1)).searchParams.get('source'),'INSTAGRAM');
  assert.equal(documents,1);
 });
 await t.test('late requests cannot overwrite newest currency and old values retain their currency',async()=>{
  const before=await page.locator('.sales-statistics-financial-summary').innerText();hold=true;
  try{await select('Валюта отчёта','USD');await expect.poll(()=>held.length).toBe(1);assert.equal(await page.locator('.sales-statistics-financial-summary').innerText(),before);await expect(page.getByRole('button',{name:'Экспорт',exact:true})).toBeDisabled();
   await select('Валюта отчёта','UAH');await expect.poll(()=>held.length).toBe(2);const newest=held.pop();await newest.fulfill({json:model.report(Object.fromEntries(new URL(newest.request().url()).searchParams))});await ready();const current=await page.locator('.sales-statistics-financial-summary').innerText();await release();assert.equal(await page.locator('.sales-statistics-financial-summary').innerText(),current);assert.equal(new URL(page.url()).searchParams.get('currency'),'UAH');
  }finally{hold=false;await release()}
 });
 await t.test('failed refresh keeps last coherent charts, error and disabled export; retry recovers',async()=>{
  const summary=await page.locator('.sales-statistics-financial-summary').innerText();failed=true;await select('Валюта отчёта','EUR');await ready();await expect(page.getByRole('alert')).toBeVisible();assert.equal(await page.locator('.sales-statistics-financial-summary').innerText(),summary);await expect(page.getByRole('button',{name:'Экспорт',exact:true})).toBeDisabled();failed=false;await page.getByRole('button',{name:'Повторить',exact:true}).click();await ready();await expect(page.getByRole('alert')).toHaveCount(0);
 });
 for(const width of [1920,1366,390])await t.test(`responsive async workspace ${width}`,async()=>{await page.setViewportSize({width,height:width===390?844:900});await ready();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:resolve(out,`statistics-${width}.png`),fullPage:true,animations:'disabled'})});
 if(!shell)await t.test('role change clears retained financial DOM immediately and ignores pending owner response',async()=>{
  await page.setViewportSize({width:1366,height:768});hold=true;await select('Валюта отчёта','USD');await expect.poll(()=>held.length).toBe(1);activeRole='MANAGER';await page.evaluate(()=>{window.fixture.role='MANAGER';window.fixture.render()});await expect(page.locator('.sales-statistics-financial-summary')).toHaveCount(0);await expect.poll(()=>held.length).toBe(2);hold=false;const manager=held.pop();await manager.fulfill({json:fixtureModel('MANAGER').report(Object.fromEntries(new URL(manager.request().url()).searchParams))});await ready();await release();await expect(page.locator('.sales-statistics-financial-summary')).toHaveCount(0);await expect(page.locator('input[aria-label="Валюта отчёта"]')).toHaveCount(0);
 });
 assert.deepEqual(errors,[]);assert.deepEqual(violations,[]);
});
