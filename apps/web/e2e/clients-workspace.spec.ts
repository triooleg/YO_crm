import {expect,test} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,detail,rows,now} from '../components/clients/tests/fixtures';
for(const width of [1920,1366,1024,390,320])test(`layout and lazy tabs ${width}`,async({page},info)=>{await page.setViewportSize({width,height:width===1920?1080:width===1366?768:width===390?844:width===320?740:768});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const calls=await fixture(page,true);await page.goto('/?section=clients&clientId=a');await expect(page.getByRole('heading',{name:'scarletsteward',exact:true})).toBeVisible();if(width>=1200)await expect(page.getByRole('table')).toBeVisible();expect(calls.filter(c=>c.query.includes('tab=conversations')||c.query.includes('tab=files'))).toHaveLength(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);if(width>=1200){const bounds=await page.locator('.clients-columns').evaluate(el=>{const left=el.children[0].getBoundingClientRect().width,right=el.children[1].getBoundingClientRect().width;return left/(left+right);});expect(bounds).toBeGreaterThanOrEqual(.60);expect(bounds).toBeLessThanOrEqual(.65);}await expect(page.locator('.clients-order-list').first().locator('.clients-order')).toHaveCount(3);const directory=process.env.YO_CRM_VISUAL_DIR;if(directory)mkdirSync(directory,{recursive:true});await page.screenshot({path:directory?join(directory,`clients-${width}.png`):info.outputPath(`clients-${width}.png`),fullPage:true});if(width===390){await page.locator('.clients-order-designs .order-image-trigger').first().click();await expect(page.getByRole('dialog',{name:/Просмотр дизайна/})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:/Просмотр дизайна/})).toHaveCount(0);await expect(page.getByRole('heading',{name:'scarletsteward',exact:true})).toBeVisible();}await page.getByRole('tab',{name:'Переписка',exact:true}).click();await expect(page.getByText('Здравствуйте!',{exact:true})).toBeVisible();const link=page.getByRole('link',{name:/Открыть диалог/});await expect(link).toHaveAttribute('href',/conversationId=conversation-a/);await expect(link).toHaveAttribute('href',/clientsReturn=/);expect(calls.filter(c=>c.method!=='GET')).toHaveLength(0);await page.getByRole('tab',{name:'Файлы',exact:true}).click();await expect(page.getByText('Файлов клиента нет',{exact:true})).toBeVisible();if(width<1200){await page.getByRole('button',{name:'К списку клиентов',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);const trigger=page.getByRole('button',{name:'Gina Embley',exact:true});await trigger.click();await expect(page.getByRole('heading',{name:'Gina Embley',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(trigger).toBeFocused();}await expect(page.getByRole('button',{name:'Заказы: Gina Embley, 1'})).toBeVisible();await expect(page.getByRole('button',{name:/Заказы: Клиент без заказов.*, 0/})).toBeVisible();expect(errors).toEqual([]);});
test('client outside page, URL state, creation preflight, merge token and athlete export flow',async({page})=>{const calls=await fixture(page);await page.setViewportSize({width:1366,height:900});await page.goto('/?section=clients&clientId=outside&page=3&pageSize=50&period=2026-10');await expect(page.getByRole('heading',{name:'Клиент вне страницы'})).toBeVisible();await expect(page).toHaveURL(/clientId=outside/);await page.getByRole('button',{name:'+ Новый клиент',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:'Имя',exact:true}).fill('Мария');await dialog.getByLabel('Email',{exact:true}).fill('New@Example.com');await dialog.getByRole('button',{name:'Создать клиента',exact:true}).click();await expect(dialog).toHaveCount(0);expect(calls.find(c=>c.path==='/api/clients'&&c.method==='POST')?.body.email).toBe('new@example.com');expect(calls.findIndex(c=>c.query.includes('view=duplicates'))).toBeLessThan(calls.findIndex(c=>c.path==='/api/clients'&&c.method==='POST'));await page.getByRole('checkbox',{name:'Выбрать клиента: scarletsteward',exact:true}).check();await page.getByRole('checkbox',{name:'Выбрать клиента: Gina Embley',exact:true}).check();await page.getByRole('button',{name:'Объединить клиентов (2)',exact:true}).click();await page.getByRole('button',{name:'Предпросмотр',exact:true}).click();await page.getByRole('checkbox',{name:'Проверьте изменения перед подтверждением'}).check();await page.getByRole('button',{name:'Подтвердить объединение'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);const merge=calls.find(c=>c.path.endsWith('/merge-batch'))!;expect(merge.body).toEqual({sourceClientIds:['b'],fieldChoices:{},previewToken:'preview-token'});await expect(page.getByRole('heading',{name:'scarletsteward',exact:true})).toBeVisible();await page.getByRole('button',{name:'Добавить спортсменку'}).click();await page.getByRole('dialog').getByRole('textbox',{name:'Имя',exact:true}).fill('  Анна  ');await page.getByRole('dialog').getByRole('button',{name:'Добавить спортсмена',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(calls.find(c=>c.path.endsWith('/athletes'))?.body).toEqual({firstName:'Анна'});});

test('currency unknowns, profile manager and note visibility preserve payloads without sending messages',async({page})=>{
 const calls=await fixture(page);await page.setViewportSize({width:1366,height:1000});await page.goto('/?section=clients&clientId=a&returnConversationId=conversation-a&returnChannel=INSTAGRAM');
 await expect(page.getByRole('button',{name:'Вернуться к переписке'})).toBeVisible();
 await page.getByRole('combobox',{name:'Валюта отчёта'}).click();await page.getByRole('option',{name:'UAH',exact:true}).click();
 await expect(page).toHaveURL(/currency=UAH/);await expect(page.getByRole('heading',{name:'scarletsteward',exact:true})).toBeVisible();
 await expect(page.locator('.clients-summary-money>div').first().locator('p').nth(1)).toHaveText('—');
 await expect(page.locator('.clients-summary-money>div').nth(1).locator('p').nth(1)).toHaveText('—');
 await page.getByRole('button',{name:'Редактировать',exact:true}).click();
 await page.getByRole('dialog').getByRole('combobox',{name:'Менеджер',exact:true}).click();await page.getByRole('option',{name:'Другой менеджер',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(calls.find(c=>c.path==='/api/clients/a'&&c.method==='PATCH')?.body.responsibleManagerId).toBe('other');
 await page.getByRole('tab',{name:'Заметки',exact:true}).click();await expect(page.getByRole('heading',{name:'История действий',exact:true})).toBeVisible();await expect(page.getByText('Клиент создан',{exact:true})).toBeVisible();await page.getByRole('textbox',{name:'Заметки',exact:true}).fill('Новая заметка');
 await page.getByRole('combobox',{name:'Видимость заметки'}).click();await page.getByRole('option',{name:'Клиентская',exact:true}).click();await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect.poll(()=>calls.find(c=>c.path.endsWith('/notes'))?.body).toEqual({notes:'Новая заметка',visibility:'CLIENT',expectedUpdatedAt:now});
 expect(calls.filter(c=>c.method!=='GET'&&c.path.includes('communications'))).toHaveLength(0);
});
test('slow previous client response cannot overwrite selection and search keeps client URL',async({page})=>{
 await fixture(page);await page.setViewportSize({width:1366,height:1000});
 await page.route('**/api/clients/a?**',async route=>{await new Promise(resolve=>setTimeout(resolve,700));await route.fulfill({json:detail('a')}).catch(()=>{});});
 await page.goto('/?section=clients&clientId=a');await page.getByRole('button',{name:'Gina Embley',exact:true}).click();await expect(page.getByRole('heading',{name:'Gina Embley',exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:/Поиск по имени/}).fill('scarlet');await expect(page).toHaveURL(/search=scarlet/);await expect(page).toHaveURL(/clientId=b/);
 await expect(page.getByRole('button',{name:'scarletsteward',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Gina Embley',exact:true})).toBeVisible();
});

test('weak duplicate candidates require an explicit separate-client confirmation',async({page})=>{
 const calls=await fixture(page);await page.setViewportSize({width:1366,height:1000});
 await page.route('**/api/clients?**',async route=>{const url=new URL(route.request().url());if(url.searchParams.get('view')!=='duplicates')return route.fallback();return route.fulfill({json:{items:[{...rows[0],reasons:['NAME'],duplicateIds:['b']},{...rows[1],reasons:['NAME'],duplicateIds:['a']}],total:2,page:1,pageSize:20}});});
 await page.goto('/?section=clients');await page.getByRole('button',{name:'Найти дубликаты',exact:true}).click();await expect(page.getByRole('dialog').getByText('scarletsteward',{exact:true})).toBeVisible();expect(calls.filter(call=>call.method!=='GET')).toHaveLength(0);await page.getByRole('dialog').getByRole('button',{name:'Закрыть'}).click();
 await page.getByRole('button',{name:'+ Новый клиент',exact:true}).click();await page.getByRole('dialog').getByRole('textbox',{name:'Имя',exact:true}).fill('scarletsteward');await page.getByRole('dialog').getByRole('button',{name:'Создать клиента',exact:true}).click();await expect(page.getByRole('button',{name:'Создать отдельного клиента',exact:true})).toBeVisible();expect(calls.filter(call=>call.path==='/api/clients'&&call.method==='POST')).toHaveLength(0);await page.getByRole('button',{name:'Создать отдельного клиента',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(calls.filter(call=>call.path==='/api/clients'&&call.method==='POST')).toHaveLength(1);expect(calls.filter(call=>call.path.includes('merge-batch'))).toHaveLength(0);
});
test('Inbox callback carries exact conversation and clients return URL @integration',async({page})=>{
 await fixture(page);await page.setViewportSize({width:1366,height:1000});await page.goto('/?section=clients&clientId=a&pageSize=50&country=Spain');await page.getByRole('tab',{name:'Переписка',exact:true}).click();const link=page.getByRole('link',{name:/Открыть диалог/});await expect(link).toHaveAttribute('href',/conversationId=conversation-a/);await link.click();await expect(page).toHaveURL(/section=inbox/);await expect(page).toHaveURL(/conversationId=conversation-a/);const returnUrl=new URL(page.url()).searchParams.get('clientsReturn');expect(returnUrl?.startsWith('/?')).toBe(true);const params=new URL(returnUrl!,'http://crm').searchParams;expect(params.get('clientId')).toBe('a');expect(params.get('pageSize')).toBe('50');expect(params.get('country')).toBe('Spain');
});

test('sort, page size and keyboard dialog return preserve selection',async({page})=>{
 const calls=await fixture(page);await page.setViewportSize({width:1366,height:1000});await page.goto('/?section=clients&clientId=b');await expect(page.getByRole('heading',{name:'Gina Embley',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Дата создания',exact:false}).click();await expect(page).toHaveURL(/direction=asc/);await expect.poll(()=>calls.filter(call=>call.path==='/api/clients').at(-1)?.query).toContain('direction=asc');
 await page.locator('.clients-pagination select').selectOption('50');await expect(page).toHaveURL(/pageSize=50/);await expect(page).toHaveURL(/clientId=b/);
 const trigger=page.getByRole('button',{name:'+ Новый клиент',exact:true});await trigger.click();await expect(page.getByRole('dialog').getByRole('textbox',{name:'Имя',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(trigger).toBeFocused();
});

test('global duplicates paginate independently of an empty page and keep pairwise reasons weak',async({page})=>{
 await fixture(page);const queries:string[]=[];
 await page.route('**/api/clients?**',async route=>{const url=new URL(route.request().url());if(url.searchParams.get('view')!=='duplicates')return route.fallback();queries.push(url.search);const current=Number(url.searchParams.get('page')??1),size=Number(url.searchParams.get('pageSize')??20);return route.fulfill({json:{items:current===1?[{...rows[0],reasons:['EMAIL','NAME'],duplicateIds:['b'],related:[{id:'b',reasons:['NAME']}],relatedTruncated:true}]:[],total:60,page:current,pageSize:size}});});
 await page.setViewportSize({width:1366,height:1000});await page.goto('/?section=clients');await page.getByRole('button',{name:'Найти дубликаты',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByText(/Совпадение имени — только слабый сигнал/)).toBeVisible();await expect(dialog.getByText('Другая карточка (b): Совпадает имя (слабый сигнал)',{exact:true})).toBeVisible();await expect(dialog.getByText(/Список связанных карточек сокращён/)).toBeVisible();
 await dialog.getByRole('checkbox',{name:'scarletsteward'}).check();await expect(dialog.getByRole('button',{name:'Объединить клиентов (1)',exact:true})).toBeDisabled();await dialog.getByRole('combobox',{name:'На странице',exact:true}).selectOption('15');await expect.poll(()=>queries.at(-1)).toContain('pageSize=15');await dialog.getByText('2',{exact:true}).click();await expect(dialog.getByText('На этой странице нет кандидатов',{exact:true})).toBeVisible();await expect(dialog.getByText('из 60',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Объединить клиентов (1)',exact:true})).toBeDisabled();await dialog.getByRole('combobox',{name:'На странице',exact:true}).selectOption('50');await expect.poll(()=>queries.at(-1)).toContain('pageSize=50');
});

for(const width of [1366,390]) test(`client archive needs confirmation and refreshes filtered statistics at ${width}`, async ({page},info) => {
 await fixture(page);
 await page.setViewportSize({width,height:900});
 let archived=false;
 const writes: unknown[]=[];
 await page.route('**/api/clients?**', route => {
  const params=new URL(route.request().url()).searchParams;
  if(params.get('view')!=='workspace')return route.fallback();
  const items=rows.filter(row=>!archived||row.id!=='c').map(row=>({...row,updatedAt:now}));
  return route.fulfill({json:{
   items,total:archived?40:41,page:1,pageSize:20,
   statistics:{active:28,leads:archived?12:13,repeat:7},
   filters:{countries:['Spain'],sources:['INSTAGRAM'],statuses:['ACTIVE','LEAD']},
  }});
 });
 await page.route('**/api/clients/c/archive', route => {
  expect(route.request().method()).toBe('PATCH');
  writes.push(route.request().postDataJSON());
  archived=true;
  return route.fulfill({json:{id:'c',archivedAt:now}});
 });
 await page.goto('/?section=clients&country=Spain');
 const stats=page.getByRole('region',{name:'По выбранным фильтрам'});
 await expect(stats.getByText('41',{exact:true})).toBeVisible();
 await expect(stats.getByText('7',{exact:true})).toBeVisible();
 const button=page.getByRole('button',{name:'Удалить из списка',exact:true});
 const checkbox=page.getByRole('checkbox',{name:/Клиент без заказов/});
 await expect(button).toBeDisabled();
 await checkbox.check();
 await expect(button).toBeEnabled();
 const dialog=page.getByRole('dialog',{name:'Удалить из списка'});
 await page.screenshot({path:info.outputPath('client-statistics.png')});
 await button.click();
 await page.screenshot({path:info.outputPath('client-archive-dialog.png')});
 await dialog.getByRole('button',{name:'Отмена',exact:true}).click();
 await expect(button).toBeFocused();
 expect(writes).toHaveLength(0);
 await button.click();
 await dialog.getByRole('button',{name:'Переместить в архив'}).click();
 await expect(dialog).toHaveCount(0);
 await expect(button).toBeDisabled();
 await expect(page.getByRole('textbox',{name:/Поиск по имени/})).toBeFocused();
 await expect(stats.getByText('40',{exact:true})).toBeVisible();
 await expect(stats.getByText('12',{exact:true})).toBeVisible();
 await expect(page).toHaveURL(/country=Spain/);
 expect(writes).toEqual([{expectedUpdatedAt:now}]);
});

test('client archive reports protected clients in a multi-selection', async ({page}) => {
 await fixture(page);
 await page.setViewportSize({width:1366,height:900});
 let archived=false;
 await page.route('**/api/clients?**', route => {
  if(new URL(route.request().url()).searchParams.get('view')!=='workspace')return route.fallback();
  const items=rows.filter(row=>!archived||row.id!=='c').map(row=>({...row,updatedAt:now}));
  return route.fulfill({json:{items,total:items.length,page:1,pageSize:20,
   filters:{countries:[],sources:[],statuses:[]}}});
 });
 await page.route('**/api/clients/c/archive', route => {
  archived=true;
  return route.fulfill({json:{id:'c',archivedAt:now}});
 });
 await page.route('**/api/clients/b/archive', route =>
  route.fulfill({status:409,json:{message:'У клиента есть заказы'}}));
 await page.goto('/?section=clients');
 const table=page.getByRole('table');
 await expect(table.getByRole('button',{name:/Удалить из списка/})).toHaveCount(0);
 await table.getByRole('checkbox',{name:'Выбрать клиента: Gina Embley',exact:true}).check();
 await table.getByRole('checkbox',{name:/Клиент без заказов/}).check();
 await page.getByRole('button',{name:'Удалить из списка',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Удалить из списка'});
 await expect(dialog.getByText('Gina Embley',{exact:true})).toBeVisible();
 await expect(dialog.getByText(/^Клиент без заказов/)).toBeVisible();
 await dialog.getByRole('button',{name:'Переместить в архив'}).click();
 await expect(dialog.getByRole('alert')).toContainText('Gina Embley');
 await expect(dialog.getByRole('button',{name:'Переместить в архив'})).toHaveCount(0);
 const close=dialog.getByRole('button',{name:'Закрыть',exact:true}).last();
 await expect(close).toBeFocused();
 await close.click();
 await expect(table.getByRole('checkbox',{name:/Клиент без заказов/})).toHaveCount(0);
 await expect(table.getByRole('checkbox',{name:'Выбрать клиента: Gina Embley',exact:true})).toBeChecked();
});
