import {test,expect,type Page} from '@playwright/test';

const task={id:'target-task',columnId:'new',title:'Конкретная задача',type:'ADMINISTRATIVE',markerColor:'#7047eb',labels:[],attachments:[],assignee:{id:'me',displayName:'QA',role:'OWNER'}};
const board={columns:[{id:'new',name:'Новые',isDone:false,color:'#7047eb',sortOrder:0,tasks:[task,{...task,id:'other',title:'Чужая задача',assignee:{id:'other-user',displayName:'Other',role:'MANAGER'}}]}],users:[task.assignee,{id:'other-user',displayName:'Other',role:'MANAGER'}]};
async function tasks(page:Page,missing=false,empty=false){
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/auth/me')return route.fulfill({json:{user:{id:'me',role:'OWNER',displayName:'QA'}}});
  if(path==='/api/tasks/board')return route.fulfill({json:empty?{columns:[],users:board.users}:board});
  if(path==='/api/tasks/target-task')return missing?route.fulfill({status:404,json:{message:'Задача не найдена'}}):route.fulfill({json:task});
  if(path==='/api/communications/unread-count')return route.fulfill({json:{unreadCount:0}});
  return route.fulfill({json:{}});
 });
}
test('task deep link opens the exact dialog and restores my assignee after refresh',async({page})=>{
 await tasks(page);await page.goto('/?section=tasks&assignee=me&taskId=target-task');
 await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('dialog').getByLabel('Название',{exact:true})).toHaveValue(task.title);
 await page.getByRole('dialog').getByRole('button',{name:'Отмена',exact:true}).click();
 await expect(page.locator('.tasks-toolbar select').first()).toHaveValue('me');
 await expect(page.locator('.task-card')).not.toContainText(['Чужая задача']);
 await page.reload();await expect(page.getByRole('dialog').getByLabel('Название',{exact:true})).toHaveValue(task.title);
});

const conversations=[{id:'ig',channel:'INSTAGRAM',unreadCount:0,unreadVersion:0,lastMessageAt:'2026-10-14T12:00:00Z',messages:[]},{id:'fb',channel:'FACEBOOK',unreadCount:0,unreadVersion:0,lastMessageAt:'2026-10-15T12:00:00Z',messages:[]}];
const contact={id:'client',displayName:'Точный клиент',status:'LEAD',source:'FACEBOOK',preferredChannel:'FACEBOOK',orders:[],conversations,linkedChannels:['FACEBOOK','INSTAGRAM']};
async function inbox(page:Page){
 const calls:{path:string;query:URLSearchParams;method:string}[]=[];
 await page.route('**/api/**',route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;calls.push({path,query:url.searchParams,method:request.method()});
  if(path==='/api/auth/me')return route.fulfill({json:{user:{id:'me',role:'OWNER',displayName:'QA'}}});
  if(path==='/api/communications/unread-count')return route.fulfill({json:{unreadCount:0}});
  if(path==='/api/communications')return route.fulfill({json:{items:[contact],total:1,hasMore:false,scopeCounts:{all:1,unread:1,waiting:0},channelCounts:{}}});
  if(path==='/api/communications/client')return route.fulfill({json:url.searchParams.has('channel')?{...conversations.find(c=>c.channel===url.searchParams.get('channel')),clientId:'client',messages:[]}:{messages:[]}});
  return route.fulfill({json:path.includes('templates')?[]:{}});
 });return calls;
}
test('Inbox deep link selects the requested conversation channel even when another is newer',async({page})=>{
 await inbox(page);await page.goto('/?section=inbox&clientId=client&conversationId=ig&channel=INSTAGRAM');
 await expect(page.getByLabel('Канал ответа',{exact:true})).toHaveValue('INSTAGRAM');
 await page.reload();await expect(page.getByLabel('Канал ответа',{exact:true})).toHaveValue('INSTAGRAM');
});

test('history flush saves edits made while its first draft PUT is pending',async({page})=>{
 page.on('pageerror',error=>console.error('Held-edit browser error:',error.message));
 test.setTimeout(90_000);await inbox(page);
 await page.route(url=>url.pathname==='/api/tasks/board',route=>route.fulfill({json:{columns:[],users:[]}}));
 const saved:string[]=[];let stored='';let releaseFirst!:()=>void,releaseSecond!:()=>void;
 const first=new Promise<void>(resolve=>releaseFirst=resolve),second=new Promise<void>(resolve=>releaseSecond=resolve);
 const draft=(content:string)=>({id:'draft',channel:'INSTAGRAM',content,status:'DRAFT',direction:'OUTBOUND',createdAt:'2026-10-15T00:00:00Z'});
 await page.route(url=>url.pathname.includes('/drafts/'),async route=>{
  const content=route.request().postDataJSON().content;saved.push(content);
  await(saved.length===1?first:second);stored=content;await route.fulfill({json:draft(content)});
 });
 await page.route(url=>url.pathname==='/api/communications/client',route=>route.fulfill({json:new URL(route.request().url()).searchParams.has('channel')?{...conversations[0],clientId:'client',messages:stored?[draft(stored)]:[]}:{messages:stored?[draft(stored)]:[]}}));
 await page.goto('/?section=inbox&clientId=client&conversationId=ig&channel=INSTAGRAM',{waitUntil:'domcontentloaded'});
 const text=page.locator('.communications-compose textarea');await expect(text).toBeVisible({timeout:30_000});
 await page.evaluate(()=>{const current=location.href;history.replaceState(null,'','/?section=tasks');history.pushState(null,'',current)});
 await text.fill('Первый текст');await page.goBack();await expect.poll(()=>saved.length).toBe(1);
 await text.fill('Последний текст');releaseFirst();await expect.poll(()=>saved.length).toBe(2);
 await expect(text).toHaveValue('Последний текст');releaseSecond();await expect(text).toHaveCount(0);
 expect(saved).toEqual(['Первый текст','Последний текст']);
 await page.goForward();await expect(text).toHaveValue('Последний текст');
});

test('missing task shows an explicit error and never opens another task',async({page})=>{
 await tasks(page,true,true);await page.goto('/?section=tasks&taskId=target-task');
 await expect(page.getByText('Задача не найдена',{exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('Inbox rejects mismatched conversation identity before any read mark',async({page})=>{
 const calls=await inbox(page);await page.goto('/?section=inbox&clientId=client&conversationId=fb&channel=INSTAGRAM');
 await expect(page.getByText('Диалог из перехода не найден или недоступен',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Канал ответа',{exact:true})).toHaveCount(0);expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});
test('Inbox conversation context without client id never falls back to the first client',async({page})=>{
 const calls=await inbox(page);await page.goto('/?section=inbox&conversationId=ig&channel=INSTAGRAM');
 await expect(page.getByText('Диалог из перехода не найден или недоступен',{exact:true})).toBeVisible();await expect(page.getByLabel('Канал ответа',{exact:true})).toHaveCount(0);
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});
for(const [name,context,error] of [
 ['malformed link','conversationId=ig&channel=INSTAGRAM','Диалог из перехода не найден или недоступен'],
 ['missing client','clientId=missing&conversationId=ig&channel=INSTAGRAM','Клиент из перехода не найден во входящих'],
])test(`Inbox recovers from ${name} only after explicit contact selection`,async({page})=>{
 test.setTimeout(60_000);
 const calls=await inbox(page);await page.goto(`/?section=inbox&${context}`,{waitUntil:'domcontentloaded'});
 await expect(page.getByText(name==='missing client'?/^(Клиент из перехода не найден во входящих|Диалог из перехода не найден или недоступен)$/:error,{exact:true})).toBeVisible({timeout:30_000});await expect(page.getByLabel('Канал ответа',{exact:true})).toHaveCount(0);
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
 await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByLabel('Канал ответа',{exact:true})).toHaveCount(0);
 await expect(page.locator('.communications-client-list>button')).toHaveCount(1);
 await page.locator('.communications-client-list>button').first().click();
 await expect(page.getByLabel('Канал ответа',{exact:true})).toHaveValue('FACEBOOK');
 await expect(page.getByText('Диалог из перехода не найден или недоступен',{exact:true})).toHaveCount(0);
 for(const key of ['clientId','conversationId','channel'])expect(new URL(page.url()).searchParams.has(key)).toBe(false);
 await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByLabel('Канал ответа',{exact:true})).toHaveValue('FACEBOOK');
});
test('Inbox rejects a matching preview when the detail response has another conversation id',async({page})=>{
 const calls=await inbox(page);
 await page.route(url=>url.pathname==='/api/communications/client'&&url.searchParams.has('channel'),route=>route.fulfill({json:{id:'fb',clientId:'client',channel:'INSTAGRAM',messages:[]}}));
 await page.goto('/?section=inbox&clientId=client&conversationId=ig&channel=INSTAGRAM');
 await expect(page.getByText('Диалог из перехода не найден или недоступен',{exact:true})).toBeVisible();await expect(page.getByLabel('Канал ответа',{exact:true})).toHaveCount(0);
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});
test('Unread URL restores the real filter after refresh and can be cleared',async({page})=>{
 const calls=await inbox(page);await page.goto('/?section=inbox&conversationScope=UNREAD');
 await expect.poll(()=>calls.filter(call=>call.path==='/api/communications').at(-1)?.query.get('conversationScope')).toBe('UNREAD');
 await page.reload();await expect(page.locator('button[aria-pressed=true]').filter({hasText:'Непрочитанные'})).toBeVisible();
 await page.locator('.communications-secondary-filters').getByRole('button',{name:/^Все /}).click();await expect(page).not.toHaveURL(/conversationScope=/);
});
test('shipping upcoming target passes the seven-day cohort to the server and can clear it',async({page})=>{
 const queries:URLSearchParams[]=[];
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(path==='/api/auth/me')return route.fulfill({json:{user:{id:'me',role:'OWNER',displayName:'QA'}}});
  if(path==='/api/shipping'){queries.push(url.searchParams);return route.fulfill({json:{orders:[],carriers:[]}})}
  if(path==='/api/communications/unread-count')return route.fulfill({json:{unreadCount:0}});
  return route.fulfill({json:{}});
 });
 await page.goto('/?section=shipping&filter=upcoming&horizon=7');
 await expect.poll(()=>queries.at(-1)?.get('filter')).toBe('upcoming');expect(queries.at(-1)?.get('horizon')).toBe('7');
 await page.getByRole('status').getByRole('button',{name:'Сбросить',exact:true}).click();
 await expect(page).not.toHaveURL(/filter=upcoming|horizon=/);await expect.poll(()=>queries.at(-1)?.has('filter')).toBe(false);
});
test('production work target requests the entire cohort and exposes a removable filter',async({page})=>{
 const queries:URLSearchParams[]=[];
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(path==='/api/auth/me')return route.fulfill({json:{user:{id:'me',role:'OWNER',displayName:'QA'}}});
  if(path==='/api/orders/defaults')return route.fulfill({json:{defaultDurationDays:7,shippingLeadDays:3}});
  if(path==='/api/orders/production'){queries.push(url.searchParams);return route.fulfill({json:[]})}
  if(path==='/api/communications/unread-count')return route.fulfill({json:{unreadCount:0}});
  return route.fulfill({json:{}});
 });
 await page.goto('/?section=production&overviewFilter=work');
 await expect.poll(()=>queries.at(-1)?.get('overviewFilter')).toBe('work');
 expect(queries.at(-1)?.has('from')).toBe(false);expect(queries.at(-1)?.has('to')).toBe(false);
 await page.getByRole('status').getByRole('button',{name:'Сбросить',exact:true}).click();
 await expect(page).not.toHaveURL(/overviewFilter=/);await expect.poll(()=>queries.at(-1)?.has('from')).toBe(true);
});
test('upcoming shipping renders only the eligible parcel and opens its exact delivery context without writes',async({page})=>{
 const methods:string[]=[];
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;methods.push(route.request().method());
  if(path==='/api/auth/me')return route.fulfill({json:{user:{id:'me',role:'OWNER',displayName:'QA'}}});
  if(path==='/api/shipping')return route.fulfill({json:{orders:[{id:'order',number:'PARCEL-ORDER',shippingStatus:'SHIPPED',currency:'EUR',client:{displayName:'Получатель'},items:[],shipment:{carrier:'DHL',trackingNumber:'ALREADY-SENT',costMinor:1000,currency:'EUR',updatedAt:'2026-10-14T00:00:00Z'},orderShipments:[{id:'waiting',status:'NOT_READY',carrier:'DHL',currency:'EUR',customerChargeMinor:500}],upcomingShipments:[{orderId:'order',shipmentId:'waiting',status:'NOT_READY',expectedAt:'2026-10-16T00:00:00Z'}]}],carriers:[{carrier:'DHL',label:'DHL',enabled:true}]}});
  if(path==='/api/communications/unread-count')return route.fulfill({json:{unreadCount:0}});
  return route.fulfill({json:[]});
 });
 await page.goto('/?section=shipping&filter=upcoming&horizon=7');
 const rows=page.locator('.shipping-row');await expect(rows).toHaveCount(1);await expect(rows).not.toContainText('ALREADY-SENT');
 await rows.first().click();await expect(page).toHaveURL(/section=orders/);
 const url=new URL(page.url());expect(url.searchParams.get('orderId')).toBe('order');expect(url.searchParams.get('shipmentId')).toBe('waiting');expect(url.searchParams.get('tab')).toBe('delivery');expect(methods.every(method=>method==='GET')).toBe(true);
});
