import {test,expect,type Page} from '@playwright/test';
async function fixture(page:Page,fail=false){
 const contact={id:'client',displayName:'Черновик клиента',source:'INSTAGRAM',preferredChannel:'INSTAGRAM',status:'LEAD',orders:[],conversations:[{id:'ig',channel:'INSTAGRAM',unreadCount:0,unreadVersion:0,lastMessageAt:'2026-10-14T12:00:00Z',messages:[]},{id:'fb',channel:'FACEBOOK',unreadCount:0,unreadVersion:0,lastMessageAt:'2026-10-15T12:00:00Z',messages:[]}]};
 let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);const saved:string[]=[];let stored:string|undefined;const messages=()=>stored?[{id:'draft',channel:'INSTAGRAM',content:stored,status:'DRAFT',direction:'OUTBOUND',createdAt:'2026-10-15T00:00:00Z'}]:[];
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  if(path==='/api/auth/me')return route.fulfill({json:{user:{id:'me',role:'OWNER',displayName:'QA'}}});
  if(path==='/api/communications/unread-count')return route.fulfill({json:{unreadCount:0}});
  if(path==='/api/communications')return route.fulfill({json:{items:[contact],total:1,hasMore:false,scopeCounts:{all:1,unread:0,waiting:0},channelCounts:{}}});
  if(path.includes('/drafts/')){saved.push(req.postDataJSON().content);await pending;if(!fail)stored=saved.at(-1);return fail?route.fulfill({status:503,json:{message:'Draft unavailable'}}):route.fulfill({json:{id:'draft',channel:'INSTAGRAM',content:saved.at(-1),status:'DRAFT',direction:'OUTBOUND',createdAt:'2026-10-15T00:00:00Z'}})}
  if(path==='/api/communications/client')return route.fulfill({json:url.searchParams.has('channel')?{...contact.conversations[0],clientId:'client',messages:messages()}:{messages:messages()}});
  if(path==='/api/tasks/board')return route.fulfill({json:{columns:[],users:[]}});
  return route.fulfill({json:path.includes('templates')?[]:{}});
 });
 await page.goto('/?section=inbox&clientId=client&conversationId=ig&channel=INSTAGRAM');
 await expect(page.locator('.communications-compose textarea')).toBeVisible();
 await page.evaluate(()=>{const current=location.href;history.replaceState(null,'','/?section=tasks');history.pushState(null,'',current)});
 return {saved,release};
}
test('history Back waits for a pending Inbox draft flush before remount and Forward restores context',async({page})=>{
 const state=await fixture(page);const text=page.locator('.communications-compose textarea');await text.fill('Не потерять при Назад');
 await page.goBack();await expect.poll(()=>state.saved.length).toBe(1);
 await expect(text).toHaveValue('Не потерять при Назад');await expect(page.locator('.tasks-workspace')).toHaveCount(0);
 state.release();await expect(text).toHaveCount(0);await expect(page).toHaveURL(/section=tasks/);
 await page.goForward();await expect(page.getByLabel('Канал ответа',{exact:true})).toHaveValue('INSTAGRAM');
 await expect(text).toHaveValue('Не потерять при Назад');expect(state.saved).toEqual(['Не потерять при Назад']);
});
test('history draft failure preserves Inbox text and restores its address instead of remounting',async({page})=>{
 const state=await fixture(page,true);const text=page.locator('.communications-compose textarea');await text.fill('Несохранённый ответ');
 await page.goBack();await expect.poll(()=>state.saved.length).toBe(1);state.release();
 await expect(page.getByText('Не удалось сохранить черновик',{exact:false})).toBeVisible();
 await expect(page).toHaveURL(/section=inbox/);await expect(text).toHaveValue('Несохранённый ответ');
});
