import {expect,test,type Page} from "@playwright/test";
import {detail,fixture,rows} from "../components/clients/tests/fixtures";
import {clientsListRefreshUi} from "../lib/clients-workspace-i18n";

const clients=Array.from({length:43},(_,i)=>({
 ...rows[0],id:`client-${i+1}`,displayName:`Покупатель ${i+1}`,
}));

async function pagedClients(page:Page, beforePage?:(pageNumber:number,search:string)=>Promise<boolean>){
 await fixture(page);
 await page.route("**/api/clients/client-*?**",route=>{
  const id=new URL(route.request().url()).pathname.split("/").at(-1)!;
  return route.fulfill({json:{...detail(id),...clients.find(row=>row.id===id),channels:detail(id).channels}});
 });
 const requests:{page:number;size:number;search:string;country:string;direction:string}[]=[];
 await page.route("**/api/clients?**",async route=>{
  const params=new URL(route.request().url()).searchParams;
  if(params.get("view")!=="workspace")return route.fallback();
  const pageNumber=Number(params.get("page")),size=Number(params.get("pageSize"));
  const search=params.get("search")??"",country=params.get("country")??"",direction=params.get("direction")??"";
  requests.push({page:pageNumber,size,search,country,direction});
  if(beforePage&&!await beforePage(pageNumber,search))return route.fulfill({status:503,json:{message:"Список временно недоступен"}});
  const filtered=search?clients.filter(row=>row.displayName===search):clients;
  const ordered=direction==="asc"?[...filtered].reverse():filtered;
  await route.fulfill({json:{
   items:ordered.slice((pageNumber-1)*size,pageNumber*size),total:ordered.length,page:pageNumber,pageSize:size,
   statistics:{active:ordered.length,leads:0,repeat:ordered.length},
   filters:{countries:["Spain"],sources:["INSTAGRAM"],statuses:["ACTIVE"]},
  }}).catch(()=>{});
 });
 return requests;
}

const buyer=(page:Page,n:number)=>page.getByRole("button",{name:`Покупатель ${n}`,exact:true});
const listEnd=(page:Page)=>page.locator(".clients-pagination");

test("statistics share the heading row and the desktop detail panel scrolls under the CRM header",async({page},testInfo)=>{
 await page.setViewportSize({width:1920,height:760});
 await pagedClients(page);
 await page.goto("/?section=clients");
 await expect(page.locator(".clients-detail-panel")).toBeVisible();
 const stats=page.getByRole("region",{name:"По выбранным фильтрам"});
 await expect(stats.locator(".mantine-Paper-root")).toHaveCount(4);
 const [title,cards]=await Promise.all([
  page.getByRole("heading",{name:"Клиенты",exact:true}).boundingBox(),
  stats.boundingBox(),
 ]);
 expect(cards!.x).toBeGreaterThan(title!.x+title!.width);
 expect(title!.y).toBeGreaterThan(cards!.y);
 expect(title!.y).toBeLessThan(cards!.y+cards!.height);
 await buyer(page,15).scrollIntoViewIfNeeded();
 const panel=page.locator(".clients-detail-panel");
 const controls=await page.locator(".clients-sticky-controls").boundingBox();
 await expect.poll(async()=>(await panel.boundingBox())!.y).toBeLessThan(controls!.y+controls!.height+32);
 expect((await panel.boundingBox())!.y).toBeGreaterThanOrEqual(controls!.y+controls!.height);
 expect(await panel.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
 await panel.hover();
 await page.mouse.wheel(0,100);
 await expect.poll(()=>panel.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 await panel.evaluate(el=>el.scrollTo(0,0));
 await expect(panel.getByRole("heading",{name:"Покупатель 1",exact:true})).toBeInViewport();
 await page.screenshot({path:testInfo.outputPath("clients-desktop-sticky.png")});
});

test("appends through the last page on scroll and keeps row selection and deep links",async({page})=>{
 await page.setViewportSize({width:1366,height:760});
 const requests=await pagedClients(page);
 await page.goto("/?section=clients&clientId=client-1&country=Spain");
 const selected=page.getByRole("checkbox",{name:"Выбрать клиента: Покупатель 1",exact:true});
 await selected.check();
 const initialUrl=page.url();
 expect(requests.map(request=>request.page)).toEqual([1]);
 await listEnd(page).scrollIntoViewIfNeeded();
 await expect(buyer(page,21)).toBeVisible();
 await expect(selected).toBeChecked();
 await expect(page).toHaveURL(initialUrl);
 await buyer(page,21).click();
 await expect(page.getByRole("heading",{name:"Покупатель 21"})).toBeVisible();
 await listEnd(page).scrollIntoViewIfNeeded();
 await expect(buyer(page,43)).toBeVisible();
 await listEnd(page).scrollIntoViewIfNeeded();
 await expect(page.locator(".clients-table tbody tr")).toHaveCount(43);
 expect(requests.map(request=>request.page)).toEqual([1,2,3]);
 expect(requests.every(request=>request.country==="Spain"&&request.direction==="desc")).toBe(true);
 await page.goBack();
 await expect(page.getByRole("heading",{name:"Покупатель 1"})).toBeVisible();
 await expect(page).toHaveURL(/clientId=client-1/);
 await page.goForward();
 await expect(page.getByRole("heading",{name:"Покупатель 21"})).toBeVisible();
 await expect(page).toHaveURL(/clientId=client-21/);
});

test("retries only the failed page and ignores a late append after a search change",async({page})=>{
 await page.setViewportSize({width:1366,height:760});
 let pageTwoAttempts=0;
 let resume!:()=>void;
 const delayed=new Promise<void>(resolve=>{resume=resolve;});
 const requests=await pagedClients(page,async(number,search)=>{
  if(search)return true;
  if(number===2)return ++pageTwoAttempts>1;
  if(number===3)await delayed;
  return true;
 });
 await page.goto("/?section=clients&page=1");
 await expect(buyer(page,1)).toBeVisible();
 await listEnd(page).scrollIntoViewIfNeeded();
 const alert=page.getByRole("alert").filter({hasText:"Список временно недоступен"});
 await expect(alert).toBeVisible();
 await expect(buyer(page,1)).toBeVisible();
 await alert.getByRole("button",{name:"Повторить"}).click();
 await expect(buyer(page,21)).toBeVisible();
 await listEnd(page).scrollIntoViewIfNeeded();
 await expect.poll(()=>requests.some(request=>request.page===3)).toBe(true);
 try{
  await page.getByRole("textbox",{name:/Поиск по имени/}).fill("Покупатель 5");
  await expect(page.locator(".clients-table tbody tr")).toHaveCount(1);
  await expect(buyer(page,5)).toBeVisible();
 }finally{resume();}
 await expect(buyer(page,43)).toHaveCount(0);
 await expect(page).toHaveURL(/clientId=client-1/);
 expect(requests.map(({page})=>page)).toEqual([1,2,2,3,1]);
});

test("overlapping pages stop append and offer a refresh with the same filters and selection",async({page})=>{
 await page.setViewportSize({width:1366,height:760});
 const requests=await pagedClients(page);
 let injected=false;
 await page.route("**/api/clients?**",route=>{
  const params=new URL(route.request().url()).searchParams;
  if(injected||params.get("view")!=="workspace"||params.get("page")!=="3")return route.fallback();
  injected=true;
  return route.fulfill({json:{
   items:clients.slice(39,42),total:43,page:3,pageSize:20,
   statistics:{active:43,leads:0,repeat:43},
   filters:{countries:["Spain"],sources:["INSTAGRAM"],statuses:["ACTIVE"]},
  }});
 });
 await page.goto("/?section=clients&page=2&pageSize=20&country=Spain&clientId=client-21");
 const selected=page.getByRole("checkbox",{name:"Выбрать клиента: Покупатель 21",exact:true});
 await selected.check();
 const initialUrl=page.url();
 await listEnd(page).scrollIntoViewIfNeeded();
 const alert=page.getByRole("alert").filter({hasText:clientsListRefreshUi.notice});
 await expect(alert).toBeVisible();
 await expect(page.locator(".clients-table tbody tr")).toHaveCount(20);
 await expect(buyer(page,41)).toHaveCount(0);
 await expect(selected).toBeChecked();
 await expect(page).toHaveURL(initialUrl);
 expect(requests.map(({page})=>page)).toEqual([2]);
 await alert.getByRole("button",{name:clientsListRefreshUi.action}).click();
 await expect(alert).toHaveCount(0);
 await expect(selected).toBeChecked();
 await expect(page).toHaveURL(initialUrl);
 await expect(page.getByRole("heading",{name:"Покупатель 21",exact:true})).toBeVisible();
 await listEnd(page).scrollIntoViewIfNeeded();
 await expect(buyer(page,43)).toBeVisible();
 await expect(page.locator(".clients-table tbody tr")).toHaveCount(23);
 expect(requests.map(({page,country})=>[page,country])).toEqual([[2,"Spain"],[2,"Spain"],[3,"Spain"]]);
});

test("mobile direct page and page size are preserved while the list appends",async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:740});
 const requests=await pagedClients(page);
 await page.goto("/?section=clients&page=2&pageSize=15");
 await expect(buyer(page,16)).toBeVisible();
 await expect(buyer(page,1)).toHaveCount(0);
 await expect(page.locator(".clients-detail-panel")).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await listEnd(page).scrollIntoViewIfNeeded();
 await expect(buyer(page,43)).toBeVisible();
 await expect(page).toHaveURL(/page=2&pageSize=15/);
 await expect(page.locator(".clients-table tbody tr")).toHaveCount(28);
 await page.locator(".crm-content").evaluate(el=>el.scrollTo(0,0));
 await expect(page.locator(".clients-header-stats .mantine-Paper-root").last()).toBeInViewport();
 await expect(buyer(page,16)).toBeInViewport();
 await page.screenshot({path:testInfo.outputPath("clients-mobile-after-append.png")});
 await listEnd(page).locator("select").selectOption("50");
 await expect(buyer(page,1)).toBeVisible();
 await expect(page).toHaveURL(/page=1&pageSize=50/);
 expect(requests.map(({page,size})=>[page,size])).toEqual([[2,15],[3,15],[1,50]]);
});
