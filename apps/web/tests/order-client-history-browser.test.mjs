import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';

// Mount the real Orders list cell with real Mantine/theme/CSS. The test-only
// export avoids expanding the production module's public API.
test('Orders client history badge preserves count evidence, compact layout and client/order clicks', {skip:process.env.YO_ORDER_CLIENT_HISTORY_BROWSER!=='1',timeout:180000},async t=>{
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
 const canonical=resolve(process.env.YO_CRM_SOURCE_ROOT??root),web=resolve(canonical,'apps/web'),require=createRequire(resolve(web,'package.json'));
 const {chromium,expect}=require('@playwright/test'),out=resolve(root,'.local/order-client-history/browser');await mkdir(out,{recursive:true});
 const source=await readFile(resolve(root,'apps/web/components/orders-dashboard.tsx'),'utf8');
 const ownDictionary=await readFile(resolve(root,'apps/web/lib/i18n.ts'),'utf8');
 const addition=ownDictionary.match(/export const ordersClientHistoryUi = \{[\s\S]*?\n\};/)?.[0]??'';
 const canonicalDictionary=(await readFile(resolve(web,'lib/i18n.ts'),'utf8')).replace(/export const ordersClientHistoryUi = \{[\s\S]*?\n\};/,'');
 await writeFile(resolve(out,'i18n.ts'),canonicalDictionary+'\n'+addition+'\n');
 const cellModule=source.replace(/(from\s*["'])(\.[^"']+)(["'])/g,(_all,start,path,end)=>start+(path.endsWith('/i18n')?resolve(out,'i18n'):resolve(web,'components',path)).replaceAll('\\','/')+end)+'\nexport {OrderCell};';
 await writeFile(resolve(out,'dashboard.tsx'),cellModule);
 await writeFile(resolve(out,'loader.cjs'),`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText`);
 await writeFile(resolve(out,'css-loader.cjs'),`module.exports=s=>"const style=document.createElement('style');style.textContent="+JSON.stringify(s)+";document.head.appendChild(style)"`);
 const counts=[2,123456,Number.MAX_SAFE_INTEGER,undefined,0,1,-1,2.5,'2',null,{},Number.MAX_SAFE_INTEGER+1,Infinity,NaN];
 // Deliberately give every client 8 history rows. Badge must never infer count.
 const specimens=counts.map((count,index)=>({id:'order-'+index,number:'YO-'+(index+1),type:'CUSTOM',discipline:'RHYTHMIC_GYMNASTICS',createdAt:'2026-10-29T10:00:00.000Z',currency:'EUR',priceMinor:10000,depositRequiredMinor:5000,salesStatus:'NEW',productionStatus:'NOT_STARTED',paymentStatus:'UNPAID',shippingStatus:'NOT_READY',client:{id:'client-'+index,displayName:'Очень длинное имя клиента для проверки сокращения '+index,country:'UA',source:'INSTAGRAM',orderCount:count,orders:Array.from({length:8},()=>({}))},items:[],payments:[],activities:[],invoices:[]}));
 // JSON cannot retain nonfinite values; restore them inside this synthetic UI.
 await writeFile(resolve(out,'entry.tsx'),`import React from'react';import{createRoot}from'react-dom/client';import{MantineProvider}from'@mantine/core';import{yoleotardTheme}from'${resolve(web,'lib/mantine-theme').replaceAll('\\','/')}';import{OrderCell}from'./dashboard';const orders=${JSON.stringify(specimens)};orders[12].client.orderCount=Infinity;orders[13].client.orderCount=NaN;window.fixture={client:[],expand:[],setCount:(index,count)=>{orders[index].client.orderCount=count;render()}};const columns=['client','model','quantity','deadline','payment','production','delivery','status','created','menu'];function App(){return <MantineProvider theme={yoleotardTheme}><section className="orders-dashboard"><h1>Синтетическая проверка клиентов</h1><div className="orders-table-scroll"><table className="orders-table orders-dashboard-table"><colgroup><col className="orders-controls"/>{columns.map(id=><col key={id} className={'orders-col orders-col-'+id}/>)}</colgroup><thead><tr><th></th>{columns.map(id=><th key={id}>{id}</th>)}</tr></thead><tbody>{orders.map((order,index)=><tr key={order.id} data-case={index}><td className="orders-controls"/>{columns.map(id=>id==='client'?<OrderCell key={id} id={id} order={order} columnOrder={columns} expanded={false} detailsId={'details-'+index} statusPending={false} onClient={()=>window.fixture.client.push(index)} onExpand={()=>window.fixture.expand.push(index)} onStatus={()=>{}} onDeadline={()=>{}} onDiscipline={()=>{}} onPreview={()=>{}} onPreviewLeave={()=>{}} onProduction={()=>{}} onDelivery={()=>{}}/>:<td key={id} className={'orders-col orders-col-'+id}>{id==='model'?'Соседняя модель':''}</td>)}</tr>)}</tbody></table></div></section></MantineProvider>}const view=createRoot(document.getElementById('app'));function render(){view.render(<App/>)}render();`);
 const webpack=require('next/dist/compiled/webpack/webpack').webpack;
 await new Promise((ok,fail)=>{const compiler=webpack({mode:'development',devtool:false,entry:resolve(out,'entry.tsx'),output:{path:out,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.mjs','.js'],modules:[resolve(web,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:resolve(out,'loader.cjs')},{test:/\.css$/,use:resolve(out,'css-loader.cjs')}]}});compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?fail(error??Error(stats.toString({all:false,errors:true}))):ok()));});
 const layout=await readFile(resolve(web,'app/layout.tsx'),'utf8');
 const cssPaths=[...layout.matchAll(/import ["'](\.\/[^"']+\.css)["'];/g)].map(m=>m[1].endsWith('/orders-dashboard.css')?resolve(root,'apps/web/app/orders-dashboard.css'):resolve(web,'app',m[1]));
 const css=Buffer.concat([await readFile(require.resolve('@mantine/core/styles.css')),...await Promise.all(cssPaths.map(path=>readFile(path)))]);
 const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://127.0.0.1').pathname;if(path==='/bundle.js'){res.setHeader('content-type','text/javascript');return res.end(await readFile(resolve(out,'bundle.js')));}if(path==='/style.css'){res.setHeader('content-type','text/css');return res.end(css);}res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="app"></div><script src="/bundle.js"></script>');});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>new Promise(ok=>server.close(ok)));
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();page.setDefaultTimeout(6000);
 const errors=[],external=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():(external.push('blocked'),route.abort()));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await t.test('only authoritative safe integers greater than one render count-only badges',async()=>{
  await expect(page.locator('.orders-client-order-count')).toHaveCount(3);
  for(const [index,value] of [[0,'2'],[1,'123456'],[2,'9007199254740991']])await expect(page.locator(`[data-case="${index}"] .orders-client-order-count`)).toHaveText(value);
  for(let index=3;index<counts.length;index++)await expect(page.locator(`[data-case="${index}"] .orders-client-order-count`)).toHaveCount(0);
 });
 for(const viewport of [{width:1920,height:1080},{width:1366,height:768},{width:390,height:844}])await t.test(`real Mantine blue/white badge and name ellipsis at ${viewport.width}`,async()=>{
  await page.setViewportSize(viewport);
  for(const index of [0,1,2]){
   const row=page.locator(`[data-case="${index}"]`),badge=row.locator('.orders-client-order-count');await expect(badge).toBeVisible();
   const geometry=await row.evaluate(el=>{const badge=el.querySelector('.orders-client-order-count'),name=el.querySelector('.orders-client-name-row strong'),cell=el.querySelector('.orders-client-cell'),button=el.querySelector('.orders-client-button'),country=button.querySelector('small');const b=badge.getBoundingClientRect(),n=name.getBoundingClientRect(),c=cell.getBoundingClientRect(),s=country.getBoundingClientRect(),style=getComputedStyle(badge),text=getComputedStyle(name);return {badge:{left:b.left,right:b.right,top:b.top,bottom:b.bottom,height:b.height},name:{right:n.right,width:n.width,scroll:name.scrollWidth,client:name.clientWidth},cell:{right:c.right},country:{top:s.top},color:style.color,bg:style.backgroundColor,expected:getComputedStyle(document.documentElement).getPropertyValue('--mantine-color-blue-filled'),whiteSpace:getComputedStyle(badge.querySelector('.mantine-Badge-label')).whiteSpace,ellipsis:text.textOverflow};});
   assert.ok(geometry.badge.right<=geometry.cell.right+1);assert.ok(geometry.badge.left>=geometry.name.right-1);assert.ok(geometry.name.width>0);assert.ok(geometry.name.scroll>geometry.name.client);assert.equal(geometry.ellipsis,'ellipsis');assert.equal(geometry.whiteSpace,'nowrap');assert.equal(geometry.color,'rgb(255, 255, 255)');assert.ok(geometry.bg.startsWith('rgb('));assert.ok(geometry.badge.height<=22);assert.ok(geometry.country.top>=geometry.badge.bottom-1);
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:resolve(out,`preview-${viewport.width}.png`),fullPage:false,animations:'disabled'});
 });
 await t.test('badge tooltip is localized and client/order controls keep their click targets',async()=>{
  await page.setViewportSize({width:1366,height:768});const row=page.locator('[data-case="0"]');await row.locator('.orders-client-order-count').hover();await expect(page.getByRole('tooltip')).toHaveText('Всего заказов клиента: 2');
  await row.locator('.orders-client-order-count').click();assert.deepEqual(await page.evaluate(()=>window.fixture.client),[0]);
  await row.getByRole('button',{name:specimens[0].client.displayName,exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.fixture.client),[0,0]);
  await row.locator('.orders-order-number').click();assert.deepEqual(await page.evaluate(()=>window.fixture.expand),[0]);
 });
 await t.test('detail refresh changes authoritative count without inferring from partial history',async()=>{
  await page.evaluate(()=>window.fixture.setCount(0,7));await expect(page.locator('[data-case="0"] .orders-client-order-count')).toHaveText('7');
  await page.evaluate(()=>window.fixture.setCount(0,undefined));await expect(page.locator('[data-case="0"] .orders-client-order-count')).toHaveCount(0);
 });
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await writeFile(resolve(out,'receipt.json'),JSON.stringify({status:'PASS',viewports:[1920,1366,390],safeIntegerCases:counts.length,errors,external,syntheticOnly:true},null,2));
});
