import {test,expect} from '@playwright/test';
import {join} from 'node:path';
for(const width of [1920,1366,390])test(`спам скрывает клиента и позволяет восстановить переписку ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:width===390?844:width===1920?1080:768});
  let spamAt:string|null=null;
  const writes:unknown[]=[];
  const client=()=>({id:'spam-client',displayName:'Клиент для проверки спама',source:'CHATWOOT',status:'LEAD',inboxSpamAt:spamAt,orders:[],conversations:[{id:'spam-conversation',channel:'CHATWOOT',unreadCount:0,lastMessageAt:'2026-10-14T12:58:00Z',messages:[{id:'reply',content:'Последний реальный ответ',createdAt:'2026-10-14T12:00:00Z',sentAt:'2026-10-14T12:58:00Z',direction:'OUTBOUND',status:'SENT'}]}]});
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(path==='/api/auth/me')return route.fulfill({json:{user:{role:'OWNER',displayName:'QA',email:'qa@example.test'}}});
    if(path==='/api/branding')return route.fulfill({json:{}});
    if(path==='/api/communications/unread-count')return route.fulfill({json:{unreadCount:0}});
    if(path==='/api/communications/spam-client/spam'){
      const body=request.postDataJSON();writes.push(body);spamAt=body.spam?'2026-10-14T13:00:00.000Z':null;
      return route.fulfill({json:{id:'spam-client',inboxSpamAt:spamAt}});
    }
    if(path==='/api/communications'){
      const visible=Boolean(spamAt)===(url.searchParams.get('spamScope')==='SPAM');
      return route.fulfill({json:{items:visible?[client()]:[],total:visible?1:0,hasMore:false,scopeCounts:{all:visible?1:0,unread:0,waiting:0,spam:spamAt?1:0},channelCounts:{CHATWOOT:visible?1:0}}});
    }
    if(path==='/api/communications/spam-client')return route.fulfill({json:{messages:[{id:'incoming',content:'Входящее сообщение',createdAt:'2026-10-14T12:47:00Z',direction:'INBOUND',status:'RECEIVED',channel:'CHATWOOT'},...client().conversations[0].messages.map(message=>({...message,channel:'CHATWOOT'})),{id:'draft',content:'Черновик не является сообщением',status:'DRAFT',direction:'OUTBOUND',channel:'CHATWOOT',createdAt:'2026-10-14T12:59:00Z'}]}});
    if(path==='/api/clients/spam-client')return route.fulfill({json:{id:'spam-client',displayName:client().displayName,athletes:[],workTasks:[]}});
    if(path==='/api/communications/spam-client/read')return route.fulfill({json:{readCount:0}});
    return route.fulfill({json:[]});
  });
  await page.goto('/?section=inbox');
  const row=page.locator('.communications-client-list>button').filter({hasText:client().displayName});
  await expect(row).toContainText('Последний реальный ответ');
  if(width!==390)await row.click();
  await expect(page.locator('.communications-message-stack')).toContainText('Последний реальный ответ');
  await page.screenshot({path:process.env.YO_CRM_VISUAL_DIR?join(process.env.YO_CRM_VISUAL_DIR,`inbox-chronology-${width}.png`):info.outputPath('inbox-chronology.png')});
  const mark=page.locator('.communications-chat-header').getByRole('button',{name:'Пометить как спам',exact:true});
  await expect(mark).toBeVisible();
  const markBox=await mark.boundingBox();
  expect(markBox).not.toBeNull();expect(markBox!.x).toBeGreaterThanOrEqual(0);expect(markBox!.x+markBox!.width).toBeLessThanOrEqual(width);
  await page.screenshot({path:process.env.YO_CRM_VISUAL_DIR?join(process.env.YO_CRM_VISUAL_DIR,`inbox-spam-button-${width}.png`):info.outputPath('inbox-spam-button.png')});
  await mark.click();
  const dialog=page.getByRole('dialog',{name:'Пометить как спам',exact:true});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Отмена',exact:true}).click();
  await expect(dialog).toBeHidden();expect(writes).toEqual([]);
  await mark.click();
  await dialog.getByRole('button',{name:'Пометить как спам',exact:true}).click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveCount(0);
  if(width===390)await page.getByRole('button',{name:'Чаты',exact:true}).click();
  await page.getByRole('button',{name:/^Спам/}).click();
  if(width===390){await expect(page.locator('.communications-chat-client')).toContainText(client().displayName);await page.getByRole('button',{name:'Чаты',exact:true}).click();}
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator('.communications-message-stack')).toContainText('Входящее сообщение');
  await expect(page.locator('.communications-message-stack')).not.toContainText('Черновик не является сообщением');
  const restoreButton=page.locator('.communications-chat-header').getByRole('button',{name:'Вернуть из спама',exact:true});
  await expect(restoreButton).toBeVisible();
  const restoreBox=await restoreButton.boundingBox();
  expect(restoreBox).not.toBeNull();expect(restoreBox!.x).toBeGreaterThanOrEqual(0);expect(restoreBox!.x+restoreBox!.width).toBeLessThanOrEqual(width);
  await restoreButton.click();
  const restore=page.getByRole('dialog',{name:'Вернуть из спама',exact:true});
  await page.screenshot({path:process.env.YO_CRM_VISUAL_DIR?join(process.env.YO_CRM_VISUAL_DIR,`inbox-spam-restore-${width}.png`):info.outputPath(`inbox-spam-restore-${width}.png`)});
  await restore.getByRole('button',{name:'Вернуть из спама',exact:true}).click();
  await expect(restore).toBeHidden();
  expect(writes).toEqual([{spam:true,expectedSpamAt:null},{spam:false,expectedSpamAt:'2026-10-14T13:00:00.000Z'}]);
  if(width===390)await page.getByRole('button',{name:'Чаты',exact:true}).click();
  await page.locator('.communications-secondary-filters').getByRole('button',{name:/^Все/}).click();
  if(width===390){await expect(page.locator('.communications-chat-client')).toContainText(client().displayName);await page.getByRole('button',{name:'Чаты',exact:true}).click();}
  await expect(row).toBeVisible();
});

test('чтение спама и ошибка read не меняют нормальный unread badge',async({page})=>{
  let release!:()=>void,readStarted=false;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const client={id:'spam-unread',displayName:'Spam unread',inboxSpamAt:'2026-10-14T12:00:00Z',status:'LEAD',source:'CHATWOOT',orders:[],conversations:[{id:'spam-unread-conversation',channel:'CHATWOOT',unreadCount:5,unreadVersion:1,lastMessageAt:'2026-10-14T12:00:00Z',messages:[{content:'Spam message',createdAt:'2026-10-14T12:00:00Z'}]}]};
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    if(path==='/api/auth/me')return route.fulfill({json:{user:{role:'OWNER',displayName:'QA'}}});
    if(path==='/api/branding')return route.fulfill({json:{}});
    if(path==='/api/communications/unread-count')return route.fulfill({json:{unreadCount:3}});
    if(path==='/api/communications')return route.fulfill({json:{items:url.searchParams.has('spamScope')?[client]:[],total:1,hasMore:false,scopeCounts:{all:0,waiting:0,unread:0,spam:1},channelCounts:{}}});
    if(path==='/api/communications/spam-unread/read'){readStarted=true;await gate;return route.fulfill({status:409,json:{message:'Read conflict'}});}
    if(path==='/api/communications/spam-unread')return route.fulfill({json:{messages:[{id:'spam-msg',content:'Spam message',createdAt:'2026-10-14T12:00:00Z',direction:'INBOUND',status:'RECEIVED',channel:'CHATWOOT'}]}});
    return route.fulfill({json:[]});
  });
  await page.goto('/?section=inbox');
  const badge=page.locator('.crm-topbar-notification-badge');
  await expect(badge).toHaveText('3');
  await page.getByRole('button',{name:/^Спам/}).click();
  await expect.poll(()=>readStarted).toBe(true);
  await expect(badge).toHaveText('3');
  release();
  await expect(page.locator('.communications-client-list>button em')).toHaveText('5');
  await expect(badge).toHaveText('3');
});
