import {test,expect} from '@playwright/test';
const {loadTargetModule}=require('./website-sales-model-loader.cjs');
const {metaConversationInboxUrl}=loadTargetModule('communications/meta-webhook.ts');

test('Instagram username fallback is an honestly labelled profile in every Inbox link',async({page},info)=>{
 const url=metaConversationInboxUrl('INSTAGRAM','17841407931852361:708610235356092',{instagramClientUsername:'synthetic.client'});
 const client={id:'instagram-qa',displayName:'Synthetic Instagram client',instagramUsername:'synthetic.client',source:'INSTAGRAM',status:'LEAD',orders:[],conversations:[{id:'ig-conversation',channel:'INSTAGRAM',connectedAccountUrl:url,unreadCount:0,lastMessageAt:'2026-10-15T12:00:00Z',messages:[]}]};
 const writes:string[]=[];
 await page.route('**/api/**',async route=>{
  const r=route.request(),p=new URL(r.url()).pathname;
  if(r.method()!=='GET'&&!p.endsWith('/read'))writes.push(p);
  if(p==='/api/auth/me')return route.fulfill({json:{user:{role:'OWNER',displayName:'QA',email:'qa@example.test'}}});
  if(p==='/api/branding')return route.fulfill({json:{}});
  if(p==='/api/communications/unread-count')return route.fulfill({json:{unreadCount:0}});
  if(p==='/api/communications')return route.fulfill({json:{items:[client],total:1,hasMore:false,scopeCounts:{all:1,unread:0,waiting:0,spam:0},channelCounts:{INSTAGRAM:1}}});
  if(p==='/api/communications/instagram-qa')return route.fulfill({json:{messages:[]}});
  if(p==='/api/clients/instagram-qa')return route.fulfill({json:{...client,athletes:[],workTasks:[]}});
  return route.fulfill({json:[]});
 });
 for(const width of [1536,390]){
  await page.setViewportSize({width,height:1080});await page.goto('/?section=inbox');
  if(width!==390)await page.locator('.communications-client-list>button').filter({hasText:client.displayName}).click();
  const link=page.locator('.communications-chat-account');
  await expect(link).toHaveAttribute('href','https://www.instagram.com/synthetic.client/');
  await expect(link).toContainText('Открыть профиль в Instagram');
  await expect(link).toHaveAttribute('title',/нажмите «Написать»/);
  await expect(page.locator('a[href*="ig.me/m/"],a[href*="instagram.com/m/"]')).toHaveCount(0);
  await page.locator('.communications-chat-header').screenshot({path:info.outputPath(`instagram-profile-fallback-${width}.png`)});
 }
 expect(writes).toEqual([]);
});
