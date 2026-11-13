import {expect,test} from '@playwright/test';
import {fixture,detail,rows} from '../components/clients/tests/fixtures';

test('merge exposes different fields without operation conflicts and submits the reviewed choice',async({page})=>{
 const calls=await fixture(page);await page.goto('/?section=clients&clientId=a');
 await page.getByRole('checkbox',{name:'Выбрать клиента: scarletsteward',exact:true}).check();await page.getByRole('checkbox',{name:'Выбрать клиента: Gina Embley',exact:true}).check();
 await page.getByRole('button',{name:'Объединить клиентов (2)',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Предпросмотр',exact:true}).click();
 await dialog.getByRole('combobox',{name:'Страна',exact:true}).click();await page.getByRole('option',{name:'Gina Embley: Spain',exact:true}).click();
 await dialog.getByRole('button',{name:'Предпросмотр',exact:true}).click();await dialog.getByRole('checkbox',{name:'Проверьте изменения перед подтверждением'}).check();
 await dialog.getByRole('button',{name:'Подтвердить объединение',exact:true}).click();
 await expect.poll(()=>calls.find(call=>call.path.endsWith('/merge-batch'))?.body.fieldChoices.country).toBe('b');
});

test('channel conflicts show a localized reason and cannot be confirmed',async({page})=>{
 const calls=await fixture(page);await page.route('**/api/clients/a/merge-preview',route=>route.fulfill({json:{token:'preview-token',clients:rows.slice(0,2).map(row=>({...row,counts:{orders:row.orderCount}})),fieldChoices:{},conflicts:[{code:'CLIENT_MERGE_CHANNEL_CONFLICT',clientIds:['a','b']}]}}));
 await page.goto('/?section=clients&clientId=a');await page.getByRole('checkbox',{name:'Выбрать клиента: scarletsteward',exact:true}).check();await page.getByRole('checkbox',{name:'Выбрать клиента: Gina Embley',exact:true}).check();await page.getByRole('button',{name:'Объединить клиентов (2)',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Предпросмотр',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText(/канал/);await dialog.getByRole('checkbox',{name:'Проверьте изменения перед подтверждением'}).check();await expect(dialog.getByRole('button',{name:'Подтвердить объединение',exact:true})).toBeDisabled();
 expect(calls.some(call=>call.path.endsWith('/merge-batch'))).toBe(false);
});

for(const verified of [false,true])test(`new order stale snapshot requires consent; verified=${verified}`,async({page})=>{
 await fixture(page);const client=detail('a');client.athletes[0]!.measurements=[{id:'stale-snapshot',measuredAt:new Date(Date.now()-200*86400000).toISOString()}] as never[];
 await page.route('**/api/clients/a?**',route=>{const url=new URL(route.request().url());return url.searchParams.get('tab')==='overview'?route.fulfill({json:client}):route.fallback();});
 await page.route('**/api/orders/model-image',route=>route.fulfill({json:{path:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png'}}));
 await page.route('**/api/orders',route=>route.request().method()==='POST'?route.fulfill({json:{id:'new-order',number:'26-999'}}):route.fallback());
 await page.goto('/?section=clients&clientId=a');await expect(page.getByRole('button',{name:/устарели/})).toBeVisible();
 await page.getByRole('button',{name:'+ Новый заказ',exact:true}).first().click();
 const warning=page.getByRole('dialog',{name:'Мерки старше 180 дней',exact:true});await expect(warning).toBeVisible();
 await warning.getByRole('button',{name:verified?'Мерки проверены — использовать':'Продолжить без устаревших мерок',exact:true}).click();
 const form=page.locator('.order-form');await expect(form).toBeVisible();await form.getByRole('textbox',{name:'Описание изделия',exact:true}).fill('Test design');await form.getByRole('textbox',{name:'Общая цена',exact:true}).fill('100');
 await form.locator('input[type=file]').setInputFiles({name:'design.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFzUAAAAASUVORK5CYII=','base64')});
 const sent=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/orders'&&request.method()==='POST');await form.getByRole('button',{name:'Создать заказ',exact:true}).click();const body=(await sent).postDataJSON();
 expect(body.measurementId).toBe(verified?'stale-snapshot':undefined);expect(body.items[0].measurementId).toBe(verified?'stale-snapshot':undefined);
 expect(client.athletes[0]!.measurements[0]).toHaveProperty('id','stale-snapshot');
});
