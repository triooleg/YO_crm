import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

test('order tabs cancel the exact expense, retain client totals and recover refresh without a second DELETE', { skip: process.env.YO_EXPENSE_CANCELLATION_BROWSER !== '1', timeout: 180000 }, async t => {
  const require = createRequire(import.meta.url), { chromium, expect } = require('@playwright/test');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), web = resolve(root, 'apps/web');
  const out = resolve(root, '.local/expense-cancellation/browser'); await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'loader.cjs'), `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText`);
  await writeFile(resolve(out, 'css-loader.cjs'), `module.exports=s=>"const style=document.createElement('style');style.textContent="+JSON.stringify(s)+";document.head.appendChild(style)"`);
  const expense = id => ({ id, amountMinor: 99700, currency: 'UAH', incurredAt: '2026-10-27', archivedAt: null, category: { id: 'delivery', name: 'Доставка' } });
  const fixture = { id: 'synthetic-order', number: 'YO-TEST', currency: 'EUR', priceMinor: 28000, deliveryMinor: 0, taxMinor: 0, depositRequiredMinor: 14000, updatedAt: '2026-10-27T00:00:00Z', createdAt: '2026-10-01', type: 'WEBSITE_SALE', source: 'WEBSITE', orderSource:'WEBSITE', salesStatus: 'NEW', productionStatus: 'NOT_SCHEDULED', shippingStatus: 'READY', paymentStatus: 'PAID', client: { id: 'c', displayName: 'Тестовый клиент', source:'INSTAGRAM',language:'uk',phone:'+380000000000',email:'client@example.test',country:'Ukraine',orders:[{id:'synthetic-order',number:'YO-TEST',currency:'EUR',priceMinor:28000,createdAt:'2026-10-01'}], athletes: [], files: [] }, items: [{ id: 'i', name: 'Тестовый дизайн', quantity: 1, priceMinor: 28000, instances: [] }], paymentHistory: [{id:'p',amountMinor:30200,currency:'EUR',receivedAt:'2026-10-27',method:'BANK_TRANSFER',canVoid:true},{id:'cancelled-p',amountMinor:100,currency:'EUR',receivedAt:'2026-10-01',method:'BANK_TRANSFER',canVoid:false,voidedAt:'2026-10-14',voidReason:'Тестовая причина'}], payments: [{ id: 'p', amountMinor: 30200, currency: 'EUR', receivedAt: '2026-10-27', method: 'BANK_TRANSFER' }], invoices: [], expenses: [expense('linked'), expense('standalone')], orderShipments: [{ id: 's', updatedAt: '2026-10-27T00:00:00Z', carrier: 'NOVA_GLOBAL', status: 'READY', trackingNumber: 'TEST-PARCEL', currency: 'EUR', customerChargeMinor: 0, atelierCostMinor: 99700, atelierExpense: expense('linked'), atelierExpenseId: 'linked', instances: [] }], files: [], activities: [], notesStructured: [] };
  await writeFile(resolve(out, 'entry.tsx'), `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{MantineProvider}from'@mantine/core';import{yoleotardTheme}from'${resolve(web,'lib/mantine-theme').replaceAll('\\','/')}';import{OrderExpandedTabs}from'${resolve(web,'components/orders/order-expanded-tabs').replaceAll('\\','/')}';function App(){const[order,setOrder]=useState(${JSON.stringify(fixture)}),role=new URLSearchParams(location.search).get('role')||'OWNER';const request=async(path,init)=>{const response=await fetch('/api'+path,init);const body=await response.json();if(!response.ok)throw new Error(body.message);return body};const bridge={request,onSaved:async()=>{try{setOrder(await request('/orders/synthetic-order'))}catch{}},onCancellationSaved:async()=>{setOrder(await request('/orders/synthetic-order'))}};window.addParcel=()=>setOrder(current=>({...current,orderShipments:[...current.orderShipments,{...current.orderShipments[0],id:"second",trackingNumber:null,atelierExpense:null,atelierExpenseId:null,atelierCostMinor:0}]}));const props=new Proxy({order,taxRole:role,statusPending:false,onUpdateShipment:async()=>{if(window.__pauseDelivery)await new Promise(resolve=>window.__resolveDelivery=resolve)},onCreateShipment:async()=>{},onVoidPayment:["OWNER","ADMIN","ACCOUNTANT"].includes(role)?async(id,reason,expected)=>{window.__voidCalls??=[];window.__voidCalls.push({id,reason,expected})}:undefined,expenseActions:['OWNER','ADMIN','ACCOUNTANT'].includes(role)?bridge:undefined},{get:(o,k)=>k in o?o[k]:typeof k==='string'&&k.startsWith('on')?()=>Promise.resolve():undefined});return <MantineProvider theme={yoleotardTheme}><div className="orders-table-scroll"><table className="orders-dashboard-table"><tbody><tr className="orders-expanded-row"><td><div className="orders-approved-expanded"><OrderExpandedTabs {...props}/></div></td></tr></tbody></table></div></MantineProvider>}createRoot(document.getElementById('app')).render(<App/>);`);
  const webpack = require('next/dist/compiled/webpack/webpack').webpack;
  await new Promise((ok, fail) => webpack({ mode:'development',devtool:false,entry:resolve(out,'entry.tsx'),output:{path:out,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.mjs','.js'],modules:[resolve(web,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,use:resolve(out,'loader.cjs')},{test:/\.css$/,use:resolve(out,'css-loader.cjs')}] }}, (err,stats) => err || stats.hasErrors() ? fail(err ?? Error(stats.toString({all:false,errors:true}))) : ok()));
  const layout = await readFile(resolve(web,'app/layout.tsx'),'utf8');
  const styles = [...layout.matchAll(/import ["'](\.\/[^"']+\.css)["'];/g)].map(m=>resolve(web,'app',m[1]));
  const css = Buffer.concat([await readFile(require.resolve('@mantine/core/styles.css')),...await Promise.all(styles.map(p=>readFile(p)))]);
  let order, deleted, created, failDelete = false, failRefresh = false;
  const reset = () => { order=structuredClone(fixture); deleted=[]; created=[]; failDelete=false; failRefresh=false; }; reset();
  const server = createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    if(req.method==='POST' && url.pathname==='/api/finance/expenses'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const entry={...JSON.parse(Buffer.concat(chunks)),id:'new-expense',archivedAt:null,category:{id:'delivery',name:'Доставка'}};
      created.push(entry);order.expenses.push(entry);return send(entry);
    }
    if(url.pathname==='/api/finance/exchange-rates/ensure-current')return send({cache:{effectiveDate:new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Kyiv'}).format(new Date()),fetchedAt:new Date().toISOString(),rates:[{baseCurrency:'EUR',quoteCurrency:'UAH',numerator:'50',denominator:'1'}]}});
    if(req.method==='GET' && url.pathname==='/api/finance')return send({categories:[{id:'delivery',name:'Доставка',active:true}]});
    if(req.method==='DELETE'){
      deleted.push(url.pathname);
      if(failDelete)return send({message:'Налоговый расход нельзя отменить здесь'},409);
      const id=decodeURIComponent(url.pathname.split('/').at(-1)), entry=order.expenses.find(e=>e.id===id);
      if(!entry)return send({message:'Расход не найден'},404);
      order.expenses=order.expenses.filter(e=>e.id!==id);
      if(id==='linked')Object.assign(order.orderShipments[0],{atelierCostMinor:0,atelierExpense:null,atelierExpenseId:null});
      return send({...entry,archivedAt:'2026-10-27T01:00:00Z'});
    }
    if(url.pathname==='/api/orders/synthetic-order')return failRefresh?send({message:'Сбой чтения'},503):send(order);
    if(url.pathname.startsWith('/api/finance/taxes/orders/'))return send({orderId:'synthetic-order',entries:[],incomplete:false,completeness:{incomplete:false,missing:[],accruedUahMinor:0}});
    if(url.pathname.startsWith('/api/'))return send([]);
    if(url.pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');return res.end(await readFile(resolve(out,'bundle.js')));}
    if(url.pathname==='/style.css'){res.setHeader('content-type','text/css');return res.end(css);}
    res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="app"></div><script src="/bundle.js"></script>');
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>new Promise(ok=>server.close(ok)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1920,height:1000}}), errors=[], external=[];
  page.setDefaultTimeout(8000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():(external.push(route.request().url()),route.abort()));
  const base=`http://127.0.0.1:${server.address().port}`;
  const go=async(tab,role='OWNER')=>{await page.goto(base+'/?role='+role);await page.getByRole('tab',{name:tab,exact:true}).click();};
  const open=()=>page.getByRole('button',{name:/Отменить расход/,exact:false}).first().click();
  const confirm=()=>page.getByRole('dialog').getByRole('button',{name:'Отменить расход',exact:true});

  await go('Финансы');
  await expect(page.locator('.orders-finance-expenses').getByText('19,94 €',{exact:true})).toHaveCount(2);
  await page.getByRole('button',{name:'Изменить: Доставка для клиента',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('textbox',{name:'Доставка, оплачиваемая клиентом',exact:true})).toHaveValue('0,00');
  await page.getByRole('dialog').getByRole('button',{name:'Отмена',exact:true}).click();
  await page.evaluate(()=>window.addParcel());await page.getByRole('button',{name:'Изменить: Доставка для клиента',exact:true}).click();
  const parcelPicker=page.getByRole('dialog').getByRole('combobox',{name:/Посылка/});await expect(parcelPicker).toBeEnabled();
  await page.screenshot({animations:'disabled',path:resolve(out,'client-delivery-editor-1920.png')});
  await page.evaluate(()=>window.__pauseDelivery=true);await page.getByRole('button',{name:'Сохранить посылку',exact:true}).click();
  await expect(parcelPicker).toBeDisabled();await expect(page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.evaluate(()=>window.__resolveDelivery());await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('tab',{name:'Клиент',exact:true})).toHaveCount(0);
  const paymentCancel=page.getByRole('button',{name:/^Отменить оплату:/});
  await expect(paymentCancel).toHaveCount(1);await expect(paymentCancel.locator('svg')).toHaveCount(1);
  const voidComment=page.locator('.orders-payment-row.is-voided .orders-payment-comment');
  await expect(voidComment).toContainText('Тестовая причина');assert.ok(!(await voidComment.textContent()).includes('14 окт.'));
  await paymentCancel.click();await expect(page.getByRole('dialog')).toContainText('Причина отмены');
  await page.getByRole('button',{name:'Отмена',exact:true}).click();assert.equal((await page.evaluate(()=>window.__voidCalls))?.length||0,0);
  await paymentCancel.click();await page.getByRole('textbox',{name:'Причина отмены'}).fill('Проверка отмены');
  await page.getByRole('dialog').getByRole('button',{name:'Отменить оплату',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.deepEqual(await page.evaluate(()=>window.__voidCalls),[{id:'p',reason:'Проверка отмены',expected:'2026-10-27T00:00:00Z'}]);
  await go('Доставка'); await open();
  await expect(page.getByRole('dialog')).toContainText('997');
  await page.getByRole('dialog').getByRole('button',{name:'Назад',exact:true}).click();assert.equal(deleted.length,0);
  await open();await confirm().click();await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.deepEqual(deleted,['/api/finance/expenses/linked']);
  assert.equal(order.priceMinor,28000);assert.equal(order.payments[0].amountMinor,30200);assert.equal(order.orderShipments[0].trackingNumber,'TEST-PARCEL');
  await expect(page.getByRole('button',{name:/Отменить расход/})).toHaveCount(0);
  await page.getByRole('tab',{name:'Финансы',exact:true}).click();await expect(page.getByRole('button',{name:/Отменить расход/})).toHaveCount(1);
  await open();await confirm().click();await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.deepEqual(deleted,['/api/finance/expenses/linked','/api/finance/expenses/standalone']);
  assert.equal(order.expenses.length,0);assert.equal(order.priceMinor,28000);assert.equal(order.payments[0].amountMinor,30200);

  reset();await go('Финансы');await open();failDelete=true;await confirm().click();
  await expect(page.getByRole('alert')).toContainText('Налоговый расход');assert.equal(order.expenses.length,2);
  await page.getByRole('dialog').getByRole('button',{name:'Назад',exact:true}).click();
  failDelete=false;failRefresh=true;await open();await confirm().click();
  await expect(page.getByRole('alert')).toContainText('Расход отменён');assert.equal(deleted.length,2);
  await expect(page.getByRole('dialog').getByRole('button',{name:'Отменить расход',exact:true})).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button',{name:'Назад',exact:true}).click();
  await page.getByRole('tab',{name:'Доставка',exact:true}).click();await open();
  await expect(page.getByRole('dialog').getByRole('button',{name:'Отменить расход',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Обновить данные',exact:true}).click();assert.equal(deleted.length,2);
  await expect(page.getByRole('alert')).toContainText('Расход отменён');
  failRefresh=false;await page.getByRole('button',{name:'Обновить данные',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);assert.equal(deleted.length,2);
  await page.getByRole('tab',{name:'Доставка',exact:true}).click();await expect(page.getByRole('button',{name:/Отменить расход/})).toHaveCount(0);

  reset();await go('Финансы','MANAGER');await expect(page.getByRole('button',{name:/Отменить расход/})).toHaveCount(0);
  await page.getByRole('tab',{name:'Доставка',exact:true}).click();await expect(page.getByRole('button',{name:/Отменить расход/})).toHaveCount(0);
  reset();await go('Финансы');failRefresh=true;
  await page.getByRole('button',{name:/Добавить расход/}).click();
  await expect(page.getByRole('dialog')).toContainText('Добавить расход');
  await page.getByRole('dialog').getByRole('textbox',{name:/Сумма/}).fill('10');
  await page.getByRole('button',{name:'Сохранить расход',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);assert.equal(created.length,1);
  await expect(page.getByRole('button',{name:'Сохранить расход',exact:true})).toHaveCount(0);
  assert.equal(order.priceMinor,28000);assert.equal(order.payments[0].amountMinor,30200);
  for(const width of [1920,1366,390]){
    reset();await page.setViewportSize({width,height:1000});await go('Детали');
    await expect(page.locator('.orders-client-details-columns')).toContainText('Клиент с');await expect(page.locator('.orders-client-details-columns')).toContainText('Общая сумма покупок');
    const columns=await page.locator('.orders-client-details-columns').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);assert.equal(columns,width===390?1:2);
    await page.screenshot({animations:'disabled',path:resolve(out,`details-${width}.png`)});await go('Финансы');
    if(width===390){const button=await page.getByRole('button',{name:/^Отменить оплату:/}).boundingBox();assert.ok(button.width>=43&&button.height>=43);assert.ok(button.x>=0&&button.x+button.width<=width+1);}
    await page.screenshot({animations:'disabled',path:resolve(out,`finance-${width}.png`)});await page.locator('.orders-finance-side').screenshot({animations:'disabled',path:resolve(out,`finance-actions-${width}.png`)});await open();
    const box=await page.getByRole('dialog').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);
    await page.screenshot({animations:"disabled",path:resolve(out,`finance-confirm-${width}.png`)});
    await page.getByRole('dialog').getByRole('button',{name:'Назад',exact:true}).click();
    await page.getByRole('tab',{name:'Доставка',exact:true}).click();
    if(width===390){const action=await page.getByRole('button',{name:/Отменить расход/}).boundingBox();assert.ok(action.width>=43&&action.height>=43);assert.ok(action.x+action.width<=width+1);}
    await page.screenshot({animations:"disabled",path:resolve(out,`delivery-${width}.png`)});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await writeFile(resolve(out,'receipt.json'),JSON.stringify({status:'PASS',noPageErrors:true,noExternalRequests:true,productionMutations:false,widths:[1920,1366,390]},null,2));
});
