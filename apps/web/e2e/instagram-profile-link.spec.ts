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

test("Instagram shared photos open in the Inbox and unavailable media has a readable fallback", async ({page}) => {
 const client={id:"instagram-qa",displayName:"Synthetic Instagram client",source:"INSTAGRAM",status:"LEAD",orders:[],conversations:[{
  id:"ig-conversation",channel:"INSTAGRAM",unreadCount:0,lastMessageAt:"2026-11-06T08:30:00Z",
 }]};
 const photoUrl=(id:string)=>`/api/communications/messages/${id}/attachments/0/download?inline=1`;
 let expired=true;
 const originalUrl="https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=synthetic";
 const messages=["available","expired"].map(id=>({
  id,content:"[Вложение]",direction:"INBOUND",channel:"INSTAGRAM",status:"RECEIVED",
  createdAt:"2026-11-06T08:30:00Z",metadata:{attachments:[{type:"image",sharedInstagramPhoto:true,originalUrl,url:photoUrl(id)}]},
 }));
 const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/5KcAAAAASUVORK5CYII=","base64");
 await page.route("**/api/**", route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==="/api/auth/me")return route.fulfill({json:{user:{id:"owner",role:"OWNER",displayName:"QA",email:"qa@example.test"}}});
  if(path==="/api/communications")return route.fulfill({json:{items:[client],total:1,hasMore:false,scopeCounts:{all:1,unread:0,waiting:0,spam:0},channelCounts:{INSTAGRAM:1}}});
  if(path==="/api/communications/instagram-qa")return route.fulfill({json:{messages}});
  if(path.includes("/messages/available/attachments/"))return route.fulfill({body:png,contentType:"image/png"});
  if(path.includes("/messages/expired/attachments/"))return expired
   ? route.fulfill({status:502,json:{message:"expired"}})
   : route.fulfill({body:png,contentType:"image/png"});
  if(path==="/api/branding")return route.fulfill({json:{}});
  if(path==="/api/communications/unread-count")return route.fulfill({json:{unreadCount:0}});
  return route.fulfill({json:[]});
 });
 await page.setViewportSize({width:1366,height:900});
 await page.goto("/?section=inbox");
 await page.locator(".communications-client-list>button").filter({hasText:client.displayName}).click();
 const chat=page.locator(".communications-messages");
 const photo=chat.getByRole("button",{name:"Открыть вложение: Фото из публикации Instagram",exact:true});
 await expect(photo).toBeVisible();
 await expect.poll(()=>photo.locator("img").evaluate(img=>img.naturalWidth)).toBe(1);
 await expect(chat.getByText("Фото из публикации Instagram недоступно",{exact:true})).toBeVisible();
 await expect(chat.getByRole("link",{name:"Открыть оригинал",exact:true})).toHaveAttribute("href",originalUrl);
 const retry=chat.getByRole("button",{name:"Повторить загрузку",exact:true});
 await retry.focus();
 const rejected=page.waitForResponse(response=>response.url().endsWith(photoUrl("expired"))&&response.status()===502);
 await page.keyboard.press("Enter");
 await rejected;
 await expect(retry).toBeFocused();

 expired=false;
 await page.keyboard.press("Enter");
 await expect(photo).toHaveCount(2);
 const recoveredPhoto=photo.filter({has:page.locator(`img[src="${photoUrl("expired")}"]`)});
 await expect.poll(()=>recoveredPhoto.locator("img").evaluate(img=>img.naturalWidth)).toBe(1);
 await expect(recoveredPhoto).toBeFocused();
 await photo.first().click();
 await expect(page.getByRole("dialog").locator("img")).toHaveAttribute("src",photoUrl("available"));
});
