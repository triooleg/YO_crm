import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

// Mounted production component and real theme; only the HTTP boundary is synthetic.
test('shipment notification action: selection, fallback, partial retry, uncertainty and responsive preview', { skip: process.env.YO_SHIPMENT_NOTIFICATION_BROWSER !== '1', timeout: 180000 }, async t => {
  const require = createRequire(import.meta.url), { chromium, expect } = require('@playwright/test');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), web = resolve(root, 'apps/web'), out = resolve(root, '.local/shipment-notification-browser');
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'loader.cjs'), `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText`);
  await writeFile(resolve(out, 'entry.tsx'), `import React from'react';import{createRoot}from'react-dom/client';import{MantineProvider}from'@mantine/core';import{yoleotardTheme}from'${resolve(web,'lib/mantine-theme').replaceAll('\\','/')}';import{ShipmentNotificationAction}from'${resolve(web,'components/shipment-notification-action').replaceAll('\\','/')}';const params=new URLSearchParams(location.search);createRoot(document.getElementById('app')).render(<React.StrictMode><MantineProvider theme={yoleotardTheme}><ShipmentNotificationAction clientId={params.get('client')||'synthetic-client'} conversationId="synthetic-conversation" channel="INSTAGRAM" canSend={!params.has('readonly')} onSent={()=>{document.body.dataset.sent='yes'}}/></MantineProvider></React.StrictMode>);`);
  const webpack = require('next/dist/compiled/webpack/webpack').webpack;
  await new Promise((ok, fail) => webpack({ mode:'development',devtool:false,entry:resolve(out,'entry.tsx'),output:{path:out,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js'],modules:[resolve(web,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,use:resolve(out,'loader.cjs')}] }}, (err,stats) => err || stats.hasErrors() ? fail(err ?? Error(stats.toString({all:false,errors:true}))) : ok()));
  const css=Buffer.concat(await Promise.all([readFile(require.resolve('@mantine/core/styles.css')), ...['app/styles.css','app/mantine-overrides.css'].map(path=>readFile(resolve(web,path)))]));
  const parcel={id:'s1',carrier:'UPS',trackingNumber:'SYNTHETIC-123',trackingUrl:'https://www.ups.com/track?tracknum=SYNTHETIC-123',trackingRevision:1};
  const options={orders:[{id:'o1',number:'YO-101',shipments:[parcel]}],chat:{available:true},email:{available:true,recipient:'synthetic@example.test',requiresConfirmation:true},languages:[{value:'en',label:'Английский'},{value:'ru',label:'Русский'}]};
  const preview={...parcel,scopeToken:'synthetic-scope',orderId:'o1',orderNumber:'YO-101',shipmentId:'s1',language:'en',content:'Your order has been shipped! 📦\n\nYou can track your package using the link below:\n\n'+parcel.trackingUrl+'\n\nThank you for choosing Yoleotard! ❤️',subject:'Your Yoleotard order YO-101 has been shipped',emailRecipient:'synthetic@example.test',emailRequiresConfirmation:true,chatAvailable:true,emailAvailable:true};
  const posts=[],errors=[],requests=[];let mode='normal',previous,sendCount=0;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');const chunks=[];for await(const chunk of req)chunks.push(chunk);
    requests.push([mode,url.pathname]);
    const body=chunks.length?JSON.parse(Buffer.concat(chunks)):undefined;
    const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    if(url.pathname==='/api/shipment-notifications/options')return send({...options,orders:mode==='empty'?[]:mode==='multiple'?[...options.orders,{id:'o2',number:'YO-102',shipments:[{...parcel,id:'s2'},{...parcel,id:'s3'}]}]:options.orders});
    if(url.pathname==='/api/shipment-notifications/preview')return send({...preview,...body,previous,content:body.language==='ru'?'Ваш заказ отправлен! '+parcel.trackingUrl:preview.content,...(mode==='emailOnly'?{chatAvailable:false,chatReason:'Для Instagram требуется разрешённое окно отправки.'}:{}),...(mode==='noEmail'?{emailAvailable:false,emailRecipient:undefined}: {})});
    if(url.pathname==='/api/shipment-notifications/send'){
      posts.push(body);sendCount++;
      if(mode==='conflict')return send({message:'Данные изменились'},409);
      // The send may have succeeded, but its acknowledgement is unreadable.
      // Return an incomplete JSON response instead of triggering Chromium's transport retries.
      if(mode==='lost'){res.writeHead(200,{'content-type':'application/json'});res.end('{');return;}
      const deliveries=sendCount===1?[{channel:'EMAIL',status:'SENT',sentAt:'2026-10-27T10:00:00Z'},{channel:'CHAT',status:'FAILED',error:'Отправка в чат не подтверждена.'}]:[{channel:'EMAIL',status:'SENT',sentAt:'2026-10-27T10:00:00Z'},{channel:'CHAT',status:'SENT',sentAt:'2026-10-27T10:01:00Z'}];
      previous={id:'n1',content:body.content,subject:body.subject,deliveries};return send(previous);
    }
    if(url.pathname==='/api/shipment-notifications/n1')return send({id:'n1',deliveries:[{channel:'EMAIL',status:'SENT',sentAt:'2026-10-27T10:00:00Z'},{channel:'CHAT',status:'UNKNOWN'}]});
    if(url.pathname==='/bundle.js'){res.writeHead(200,{'content-type':'text/javascript'});return res.end(await readFile(resolve(out,'bundle.js')));}
    if(url.pathname==='/styles.css'){res.writeHead(200,{'content-type':'text/css'});return res.end(css);}
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><body><main id="app" style="padding:12px"></main><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>server.close());
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1366,height:768}});page.on('pageerror',error=>errors.push(error.message));
  const base=`http://127.0.0.1:${server.address().port}`;
  const action=()=>page.getByRole('button',{name:'Отправить трек-номер'});
  t.after(async()=>{ if(errors.length) console.error('Browser errors:',errors); });
  await page.goto(base+'/?readonly');await expect(action()).toHaveCount(0);
  mode='empty';await page.goto(base);await expect(action()).toHaveCount(0);
  mode='normal';await page.goto(base);
  try { await action().click({timeout:10000}); } catch(error) { console.error({requests,errors,html:await page.locator('body').innerText()});await page.screenshot({path:resolve(out,'debug.png')});throw error; }
  await expect(page.getByLabel('Текст уведомления')).toBeVisible();await expect(page.getByRole('button',{name:'Отправить уведомление',exact:true})).toBeDisabled();
  for(const [width,height] of [[1920,1080],[1366,768],[390,844]]){
    await page.setViewportSize({width,height});await page.screenshot({path:resolve(out,`preview-${width}.png`),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const dialog=await page.getByRole('dialog').boundingBox();assert.ok(dialog.x>=0 && dialog.x+dialog.width<=width+1);
  }
  await page.getByLabel('Язык сообщения').selectOption('ru');await expect(page.getByLabel('Текст уведомления')).toHaveValue(/Ваш заказ/);
  await page.getByLabel('Текст уведомления').fill('Проверенный текст '+parcel.trackingUrl);
  await page.getByRole('checkbox',{name:'Подтверждаю адрес клиента'}).check();
  await page.getByRole('button',{name:'Отправить уведомление',exact:true}).click();
  await expect(page.getByText('Отправлено',{exact:true})).toBeVisible();await expect(page.getByText('Ошибка',{exact:true})).toBeVisible();
  await expect(page.getByRole('switch',{name:'Отправить на email'})).toBeDisabled();
  await page.getByRole('button',{name:'Повторить неудачную отправку'}).click();await expect(page.getByText('Отправлено',{exact:true})).toHaveCount(2);
  assert.equal(posts.length,2);assert.equal(posts[1].sendEmail,false);assert.equal(posts[1].sendChat,true);assert.equal(posts[1].content,posts[0].content);assert.equal(posts[0].language,'ru');
  await page.getByRole('button',{name:'Проверить статус'}).click();await expect(page.getByText('Отправлено',{exact:true})).toHaveCount(2);
  assert.equal(await page.getAttribute('body','data-sent'),'yes');
  previous=undefined;mode='multiple';await page.goto(base);await action().click();await expect(page.getByLabel('Текст уведомления')).toHaveCount(0);
  await page.getByLabel('Заказ',{exact:true}).selectOption('o2');await expect(page.getByLabel('Текст уведомления')).toHaveCount(0);
  await page.getByLabel('Посылка',{exact:true}).selectOption('s3');await expect(page.getByLabel('Текст уведомления')).toBeVisible();
  mode='emailOnly';await page.goto(base);await action().click();await expect(page.getByRole('switch',{name:'Отправить в чат'})).toBeDisabled();await expect(page.getByRole('switch',{name:'Отправить на email'})).toBeChecked();
  mode='noEmail';await page.goto(base);await action().click();await expect(page.getByRole('switch',{name:'Отправить на email'})).toBeDisabled();await expect(page.getByRole('button',{name:'Отправить уведомление',exact:true})).toBeEnabled();
  mode='conflict';await page.goto(base);await action().click();await page.getByRole('checkbox',{name:'Подтверждаю адрес клиента'}).check();await page.getByRole('button',{name:'Отправить уведомление',exact:true}).click();
  await expect(page.getByText(/Сервер отклонил запрос/)).toBeVisible();await expect(page.getByLabel('Текст уведомления')).toHaveCount(0);
  await page.getByRole('button',{name:'Повторить загрузку'}).click();await expect(page.getByLabel('Текст уведомления')).toBeVisible();
  mode='lost';await page.goto(base);await action().click();await page.getByRole('checkbox',{name:'Подтверждаю адрес клиента'}).check();await page.getByRole('button',{name:'Отправить уведомление',exact:true}).click();
  await expect(page.getByText(/Повтор для этого канала заблокирован/)).toBeVisible();await expect(page.getByRole('button',{name:'Отправить уведомление',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Проверить статус'}).click();await expect(page.getByRole('button',{name:'Отправить уведомление',exact:true})).toBeDisabled();
  await page.screenshot({path:resolve(out,'unknown-390.png'),fullPage:true});
  assert.equal(posts.length,4);assert.deepEqual(errors,[]);
});
