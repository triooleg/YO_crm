import {test,expect,type Page} from '@playwright/test';
import {join} from 'node:path';

const contacts=Array.from({length:48},(_,i)=>({id:`contact-${i}`,displayName:`Контакт ${String(i).padStart(2,'0')}`,status:'LEAD',source:'CHATWOOT',orders:[],conversations:[{id:`conversation-${i}`,channel:'CHATWOOT',unreadCount:0,lastMessageAt:'2026-10-14T12:00:00Z',messages:[{id:`message-${i}`,content:`Сообщение ${i}`,createdAt:'2026-10-14T12:00:00Z',direction:'INBOUND',status:'RECEIVED'}]}]}));
const scrollEnd=(page:Page)=>page.locator('.communications-client-list').evaluate(el=>{el.scrollTop=el.scrollHeight;});
async function setup(page:Page,options:{hold?:Promise<void>;pollHold?:Promise<void>;pollReady?:()=>boolean;deleteHold?:Promise<void>;fail?:boolean;preferred?:boolean;overlap?:boolean;draft?:boolean;deleteMessage?:boolean}={}){
 const requests:{offset:number;limit:number;search:string}[]=[];let fail=options.fail,deleted=false;
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(path==='/api/auth/me')return route.fulfill({json:{user:{role:'OWNER',displayName:'QA',email:'qa@example.test'}}});
  if(path==='/api/branding')return route.fulfill({json:{}});
  if(path==='/api/communications/unread-count')return route.fulfill({json:{unreadCount:0}});
  if(path==='/api/communications'){
   const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||15),search=url.searchParams.get('search')||'';
   requests.push({offset,limit,search});
   if(offset===0&&options.pollReady?.()&&options.pollHold)await options.pollHold;
   if(offset===0&&deleted&&options.deleteHold)await options.deleteHold;
   if(offset>0&&options.hold)await options.hold;
   if(offset>0&&fail){fail=false;return route.fulfill({status:503,json:{message:'Не удалось загрузить контакты'}});}
   const rows=search?contacts.filter(c=>c.displayName.includes(search)):contacts;
   const items=rows.slice(offset,offset+limit);if(options.overlap&&offset===15)items[0]=rows[14];
   return route.fulfill({json:{items,preferredItem:options.preferred&&offset===0?{...contacts[47],displayName:'Выбранный контакт'}:undefined,total:rows.length,hasMore:offset+limit<rows.length,scopeCounts:{all:rows.length,unread:0,waiting:0,spam:0},channelCounts:{CHATWOOT:rows.length}}});
  }
  if(path==='/api/communications/messages/sent-message/delete'){deleted=true;return route.fulfill({json:{}});}
  if(/^\/api\/communications\/contact-\d+$/.test(path))return route.fulfill({json:{messages:options.draft?[{id:'saved-draft',status:'DRAFT',direction:'OUTBOUND',content:'Сохранённый черновик',channel:'CHATWOOT',createdAt:'2026-10-14T12:00:00Z'}]:options.deleteMessage&&!deleted?[{id:'sent-message',status:'SENT',direction:'OUTBOUND',content:'Удаляемый ответ',channel:'CHATWOOT',createdAt:'2026-10-14T12:00:00Z'}]:[]}});
  if(/^\/api\/communications\/contact-\d+\/read$/.test(path))return route.fulfill({json:{readCount:0}});
  if(path.startsWith('/api/clients/contact-'))return route.fulfill({json:{athletes:[],workTasks:[]}});
  return route.fulfill({json:[]});
 });
 return requests;
}

for(const width of [1920,1366,390])test(`контакты добавляются снизу по 15 без замены списка ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:width===390?844:width===1920?1080:768});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 let release!:()=>void;const hold=new Promise<void>(r=>release=r);
 const requests=await setup(page,{hold,draft:true});await page.goto('/?section=inbox');
 await expect(page.locator('.communications-chat-client')).toContainText('Контакт 00');
 if(width===390){await page.getByRole('button',{name:'Чаты',exact:true}).click();await expect(page.locator('.communications-clients')).toHaveClass(/mobile-open/);}
 const rows=page.locator('.communications-client-list>button'),list=page.locator('.communications-client-list');
 await expect(rows).toHaveCount(15);await expect(page.getByRole('button',{name:'Загрузить ещё',exact:true})).toHaveCount(0);
 await rows.first().evaluate(el=>el.setAttribute('data-retained','yes'));
 const selected=await page.locator('.communications-chat-client').textContent();
 await expect(page.locator('.communications-compose textarea')).toHaveValue('Сохранённый черновик');
 await scrollEnd(page);await expect.poll(()=>requests.filter(r=>r.offset>0).length).toBe(1);
 await scrollEnd(page);await expect(rows).toHaveCount(15);await expect(rows.first()).toHaveAttribute('data-retained','yes');
 const top=await list.evaluate(el=>el.scrollTop);
 expect(requests.filter(r=>r.offset>0)).toEqual([{offset:15,limit:15,search:''}]);
 release();await expect(rows).toHaveCount(30);expect(await list.evaluate(el=>el.scrollTop)).toBe(top);
 await expect(rows.first()).toHaveAttribute('data-retained','yes');expect(await page.locator('.communications-chat-client').textContent()).toBe(selected);
 await scrollEnd(page);await expect(rows).toHaveCount(45);await scrollEnd(page);await expect(rows).toHaveCount(48);
 expect(requests.filter(r=>r.offset>0).map(r=>r.offset)).toEqual([15,30,45]);
 await expect(page.locator('.communications-compose textarea')).toHaveValue('Сохранённый черновик');
 await page.screenshot({path:process.env.YO_CRM_VISUAL_DIR?join(process.env.YO_CRM_VISUAL_DIR,`inbox-infinite-scroll-${width}.png`):info.outputPath('infinite-scroll.png')});
 expect(errors).toEqual([]);
});

test('поздняя страница старого поиска не попадает в новый список',async({page})=>{
 let release!:()=>void;const hold=new Promise<void>(r=>release=r);const requests=await setup(page,{hold});
 await page.goto('/?section=inbox');const rows=page.locator('.communications-client-list>button');await expect(rows).toHaveCount(15);
 await scrollEnd(page);await expect.poll(()=>requests.some(r=>r.offset===15)).toBe(true);
 await page.locator('.communications-clients input').first().fill('Контакт 04');
 await expect(rows).toHaveCount(1);await expect(rows).toContainText('Контакт 04');release();
 await expect(page.locator('.communications-client-pagination')).toHaveCount(0);await expect(rows).toHaveCount(1);
});

test('старый поиск после сохранения черновика не отменяет новый поиск',async({page})=>{
 let release!:()=>void,started=false;const hold=new Promise<void>(r=>release=r);
 const requests=await setup(page,{draft:true});
 await page.route('**/api/communications/contact-0/drafts/**',async route=>{started=true;await hold;return route.fulfill({json:{id:'saved-draft',content:'Новый черновик',status:'DRAFT',direction:'OUTBOUND',channel:'CHATWOOT'}});});
 await page.goto('/?section=inbox');const rows=page.locator('.communications-client-list>button');await expect(rows).toHaveCount(15);
 const editor=page.locator('.communications-compose textarea');await expect(editor).toHaveValue('Сохранённый черновик');await editor.fill('Новый черновик');
 const search=page.locator('.communications-clients input').first();await search.fill('Контакт 0');await expect.poll(()=>started).toBe(true);await search.fill('Контакт 04');
 await page.waitForTimeout(300);release();await expect(rows).toHaveCount(1);await expect(rows).toContainText('Контакт 04');
 expect(requests.some(r=>r.search==='Контакт 0')).toBe(false);expect(requests.some(r=>r.search==='Контакт 04')).toBe(true);
});

test('ошибка страницы сохраняет строки и допускает повтор без сброса offset',async({page})=>{
 const requests=await setup(page,{fail:true});await page.goto('/?section=inbox');const rows=page.locator('.communications-client-list>button');await expect(rows).toHaveCount(15);
 await scrollEnd(page);const retry=page.locator('.communications-client-pagination').getByRole('button',{name:'Повторить',exact:true});await expect(retry).toBeVisible();await expect(rows).toHaveCount(15);
 await retry.click();await expect(rows).toHaveCount(30);expect(requests.filter(r=>r.offset>0).map(r=>r.offset)).toEqual([15,15]);
});

test('polling не повторяет неудачную подгрузку до явного Повторить',async({page})=>{
 const requests=await setup(page,{fail:true});await page.goto('/?section=inbox');const rows=page.locator('.communications-client-list>button');await expect(rows).toHaveCount(15);
 await scrollEnd(page);const retry=page.locator('.communications-client-pagination').getByRole('button',{name:'Повторить',exact:true});await expect(retry).toBeVisible();
 const initial=requests.filter(r=>r.offset===0).length;
 await expect.poll(()=>requests.filter(r=>r.offset===0).length,{timeout:16000}).toBeGreaterThanOrEqual(initial+2);
 await expect(retry).toBeVisible();expect(requests.filter(r=>r.offset>0).length).toBe(1);await expect(rows).toHaveCount(15);
 await retry.click();await expect(rows).toHaveCount(30);
});

test('окно после удаления сообщения не сокращает уже завершённую подгрузку',async({page})=>{
 let releaseAppend!:()=>void,releaseDelete!:()=>void;
 const hold=new Promise<void>(r=>releaseAppend=r),deleteHold=new Promise<void>(r=>releaseDelete=r);
 const requests=await setup(page,{hold,deleteHold,deleteMessage:true});await page.goto('/?section=inbox');const rows=page.locator('.communications-client-list>button');await expect(rows).toHaveCount(15);
 const initial=requests.filter(r=>r.offset===0).length;
 await expect(page.locator('.communications-message-stack')).toContainText('Удаляемый ответ');await scrollEnd(page);await expect.poll(()=>requests.some(r=>r.offset===15)).toBe(true);
 await page.locator('.communications-message-stack article.out').hover();await page.locator('.communications-message-more summary').evaluate(el=>el.click());await page.getByRole('menuitem',{name:'Удалить сообщение',exact:true}).evaluate(el=>el.click());
 const dialog=page.getByRole('dialog',{name:'Удаление сообщения',exact:true});await dialog.getByRole('button',{name:'Удалить из CRM',exact:true}).click();
 await expect.poll(()=>requests.filter(r=>r.offset===0).length).toBe(initial+1);releaseAppend();await expect(rows).toHaveCount(30);releaseDelete();await expect(dialog).toBeHidden();await expect(rows).toHaveCount(30);
 await scrollEnd(page);await expect(rows).toHaveCount(45);expect(requests.filter(r=>r.offset>0).map(r=>r.offset)).toEqual([15,30]);
});

test('закреплённый выбранный контакт не пропускает пятнадцатую строку страницы',async({page})=>{
 const requests=await setup(page,{preferred:true});await page.goto('/?section=inbox&clientId=contact-47');const rows=page.locator('.communications-client-list>button');await expect(rows).toHaveCount(15);await expect(rows.first()).toContainText('Выбранный контакт');
 await scrollEnd(page);await expect(rows).toHaveCount(30);expect(requests.find(r=>r.offset>0)?.offset).toBe(14);await expect(rows.filter({hasText:'Контакт 14'})).toHaveCount(1);
});

for(const appendFirst of [true,false])test(`запоздавший polling не сокращает подгруженный список appendFirst=${appendFirst}`,async({page})=>{
 let pollReady=false;
 let releasePoll!:()=>void,releaseAppend!:()=>void;
 const pollHold=new Promise<void>(r=>releasePoll=r),hold=new Promise<void>(r=>releaseAppend=r);
 const requests=await setup(page,{pollHold,hold,pollReady:()=>pollReady});await page.goto('/?section=inbox');const rows=page.locator('.communications-client-list>button');await expect(rows).toHaveCount(15);
 const initial=requests.filter(r=>r.offset===0).length;pollReady=true;
 await expect.poll(()=>requests.filter(r=>r.offset===0).length,{timeout:10000}).toBe(initial+1);
 await scrollEnd(page);await expect.poll(()=>requests.some(r=>r.offset===15)).toBe(true);
 const pollResponse=page.waitForResponse(r=>r.url().includes('/communications?offset=0'));
 if(appendFirst){releaseAppend();await expect(rows).toHaveCount(30);releasePoll();}
 else{releasePoll();await pollResponse;await expect(rows).toHaveCount(15);releaseAppend();}
 if(appendFirst)await pollResponse;
 await expect(rows).toHaveCount(30);
 await expect.poll(()=>requests.some(r=>r.offset===0&&r.limit===30),{timeout:10000}).toBe(true);await expect(rows).toHaveCount(30);
 await scrollEnd(page);await expect(rows).toHaveCount(45);expect(requests.filter(r=>r.offset>0).map(r=>r.offset)).toEqual([15,30]);
});

test('пересечение страниц не создаёт дублей и не сбрасывает сырой offset',async({page})=>{
 const requests=await setup(page,{overlap:true});await page.goto('/?section=inbox');const rows=page.locator('.communications-client-list>button');await expect(rows).toHaveCount(15);
 await scrollEnd(page);await expect(rows).toHaveCount(29);await expect(rows.filter({hasText:'Контакт 14'})).toHaveCount(1);
 await scrollEnd(page);await expect(rows).toHaveCount(44);expect(requests.filter(r=>r.offset>0).map(r=>r.offset)).toEqual([15,30]);
});
