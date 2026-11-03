import {expect,test,type Page,type TestInfo} from "@playwright/test";
import {join} from "node:path";
import {mkdirSync} from "node:fs";
import {fixture,detail} from "../components/clients/tests/fixtures";
import type {ClientDetail} from "../components/clients/types";

const screenshotPath=(info:TestInfo,name:string)=>{
 const directory=process.env.YO_CRM_VISUAL_DIR;
 if(directory)mkdirSync(directory,{recursive:true});
 return directory?join(directory,name):info.outputPath(name);
};

// Reuse the workspace shell fixture and override only the client API with
// mutable records: successful writes must be visible in a subsequent GET.
async function mockClients(page:Page){
 await fixture(page);
 const writes:Array<{path:string;body:unknown}>=[];
 const reads:Array<{path:string;query:string}>=[];
 function client(id:string,displayName:string,country:string):ClientDetail{
  const base=detail(id);
  return {...base,id,displayName,country,status:"ACTIVE",channels:[],athletes:[],orders:[],recentOrders:[],orderCount:0,latestOrder:null,
   summary:{...base.summary,total:0,completed:0,inProgress:0,cancelled:0,orderTotalMinor:0,paidTotalMinor:0,totalsByCurrency:[],paidByCurrency:[],firstOrderAt:null,lastOrderAt:null}} as ClientDetail;
 }
 const clients=new Map<string,ClientDetail>([
  ["client-eve",client("client-eve","Eve Emeterio","Spain")],
  ["client-anna",client("client-anna","Anna First","Italy")],
 ]);
 await page.route("**/api/clients**",async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
  if(method==="GET")reads.push({path,query:url.search});
  if(path==="/api/clients"&&method==="GET"){
   if(url.searchParams.get("view")==="duplicates")return route.fulfill({json:{items:[],page:1,pageSize:20,total:0}});
   const search=(url.searchParams.get("search")??"").toLowerCase();
   const items=[...clients.values()].filter(value=>value.displayName.toLowerCase().includes(search)).map(value=>({...value,channels:[]}));
   return route.fulfill({json:{items,total:items.length,page:1,pageSize:Number(url.searchParams.get("pageSize")??20),filters:{countries:["Spain","Italy"],sources:["MANUAL"],statuses:["ACTIVE","INACTIVE"]}}});
  }
  if(path==="/api/clients"&&method==="POST"){
   const body=req.postDataJSON();writes.push({path,body});
   const created={...client("client-new",`${body.firstName} ${body.lastName??""}`.trim(),body.country??""),...body};
   clients.set(created.id,created);return route.fulfill({json:created});
  }
  const athlete=path.match(/^\/api\/clients\/([^/]+)\/athletes$/);
  if(athlete&&method==="POST"){
   const body=req.postDataJSON();writes.push({path,body});
   const record={id:"athlete-new",...body,measurements:[]};clients.get(athlete[1])!.athletes.push(record);
   return route.fulfill({json:record});
  }
  const preview=path.match(/^\/api\/clients\/([^/]+)\/merge-preview$/);
  if(preview&&method==="POST"){
   const body=req.postDataJSON();writes.push({path,body});
   return route.fulfill({json:{token:"client-preview",clients:[preview[1],...body.sourceClientIds].map(id=>({...clients.get(id),counts:{orders:0,athletes:clients.get(id)?.athletes.length??0}})),conflicts:[],fieldChoices:{country:preview[1],...body.fieldChoices}}});
  }
  const merge=path.match(/^\/api\/clients\/([^/]+)\/merge-batch$/);
  if(merge&&method==="POST"){
   const body=req.postDataJSON();writes.push({path,body});
   if(body.previewToken!=="client-preview")return route.fulfill({status:409,json:{message:"Предпросмотр устарел"}});
   for(const id of body.sourceClientIds)clients.delete(id);
   return route.fulfill({json:{id:merge[1]}});
  }
  const selected=path.match(/^\/api\/clients\/([^/]+)$/);
  if(selected&&method==="GET"){
   const value=clients.get(selected[1]);if(!value)return route.fulfill({status:404,json:{message:"Клиент не найден"}});
   if(url.searchParams.get("tab")==="files")return route.fulfill({json:{items:value.files??[],total:value.files?.length??0,page:1,pageSize:20}});
   if(url.searchParams.get("tab")==="conversations")return route.fulfill({json:{items:[],total:0,page:1,pageSize:20}});
   return route.fulfill({json:value});
  }
  return route.fallback();
 });
 return {writes,reads,clients};
}

for(const viewport of [
 {name:"desktop",width:1920,height:1080},
 {name:"laptop",width:1366,height:768},
 {name:"mobile",width:390,height:844},
])test(`Mantine-контролы клиентов сохраняют сценарии и payload — ${viewport.name}`,async({page},info)=>{
 const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 const {writes,reads}=await mockClients(page);await page.setViewportSize(viewport);await page.goto("/?section=clients");
 const profile=page.getByRole("button",{name:"Меню профиля"});await profile.click();
 await expect(page.getByRole("menuitem",{name:"Настройки"})).toBeVisible();await page.keyboard.press("Escape");await expect(profile).toBeFocused();
 const search=page.getByRole("textbox",{name:/Поиск по имени/});await expect(search).toHaveClass(/mantine-TextInput-input/);
 await search.fill("Anna");await expect(page.getByRole("button",{name:"Anna First",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Eve Emeterio",exact:true})).toBeHidden();await search.fill("");
 const create=page.getByRole("button",{name:"+ Новый клиент",exact:true});await create.click();
 let dialog=page.getByRole("dialog",{name:"Создать клиента",exact:true});await expect(dialog.getByRole("textbox",{name:"Имя",exact:true})).toBeFocused();
 await dialog.screenshot({path:screenshotPath(info,`mantine-client-create-${viewport.width}x${viewport.height}.png`)});
 await page.keyboard.press("Escape");await expect(create).toBeFocused();await create.click();
 dialog=page.getByRole("dialog",{name:"Создать клиента",exact:true});
 await dialog.getByRole("textbox",{name:"Имя",exact:true}).fill("Maria");await dialog.getByRole("textbox",{name:"Фамилия",exact:true}).fill("Lopez");
 await dialog.getByRole("textbox",{name:"Страна",exact:true}).fill("Spain");await dialog.getByRole("textbox",{name:"Телефон",exact:true}).fill("+34600111222");
 await dialog.getByRole("textbox",{name:"Instagram",exact:true}).fill("@maria_lopez");await dialog.getByRole("textbox",{name:"Язык общения",exact:true}).fill("es");
 await dialog.getByRole("button",{name:"Создать клиента",exact:true}).click();await expect(page.getByRole("heading",{name:"Maria Lopez",exact:true})).toBeVisible();
 expect(writes[0]).toEqual({path:"/api/clients",body:{firstName:"Maria",lastName:"Lopez",country:"Spain",phone:"+34600111222",instagram:"@maria_lopez",language:"es"}});
 expect(reads.some(read=>read.query.includes("view=duplicates"))).toBe(true);
 const overview=page.getByRole("tab",{name:"Обзор",exact:true}),orders=page.getByRole("tab",{name:/^Заказы/});
 await expect(overview).toHaveAttribute("aria-selected","true");await overview.focus();await page.keyboard.press("ArrowRight");await expect(orders).toHaveAttribute("aria-selected","true");await overview.click();
 const addAthlete=page.getByRole("button",{name:"Добавить спортсменку",exact:true});await addAthlete.click();
 dialog=page.getByRole("dialog",{name:"Новый спортсмен",exact:true});await expect(dialog.getByRole("textbox",{name:"Имя",exact:true})).toBeFocused();
 await dialog.screenshot({path:screenshotPath(info,`mantine-athlete-create-${viewport.width}x${viewport.height}.png`)});
 await page.keyboard.press("Escape");await expect(addAthlete).toBeFocused();await addAthlete.click();dialog=page.getByRole("dialog",{name:"Новый спортсмен",exact:true});
 await dialog.getByRole("textbox",{name:"Имя",exact:true}).fill("  Sofia  ");await dialog.getByRole("textbox",{name:"Фамилия",exact:true}).fill(" Lopez ");
 await dialog.getByLabel("Дисциплина").selectOption("RHYTHMIC_GYMNASTICS");await dialog.getByRole("button",{name:"Добавить спортсмена",exact:true}).click();
 await expect(page.getByText("Sofia Lopez",{exact:true})).toBeVisible();
 expect(writes[1]).toEqual({path:"/api/clients/client-new/athletes",body:{firstName:"Sofia",lastName:"Lopez",discipline:"RHYTHMIC_GYMNASTICS"}});
 expect(reads.filter(read=>read.path==="/api/clients/client-new"&&read.query.includes("tab=overview")).length).toBeGreaterThanOrEqual(2);
 if(viewport.width<1200){await page.getByRole("button",{name:"К списку клиентов",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);}
 await page.getByRole("checkbox",{name:"Выбрать клиента: Maria Lopez",exact:true}).check();await page.getByRole("checkbox",{name:"Выбрать клиента: Eve Emeterio",exact:true}).check();
 const merge=page.getByRole("button",{name:"Объединить клиентов (2)",exact:true});await merge.click();dialog=page.getByRole("dialog",{name:"Объединение клиентов",exact:true});
 const target=dialog.getByRole("combobox",{name:"Основная карточка",exact:true});await expect(target).toHaveValue("Maria Lopez");await target.focus();await page.keyboard.press("Tab");
 expect(await dialog.evaluate(element=>element.contains(document.activeElement))).toBe(true);await page.keyboard.press("Escape");await expect(merge).toBeFocused();await merge.click();
 dialog=page.getByRole("dialog",{name:"Объединение клиентов",exact:true});await dialog.getByRole("button",{name:"Предпросмотр",exact:true}).click();
 await expect(dialog.getByRole("combobox",{name:"Имя клиента",exact:true})).toBeVisible();
 await expect(dialog.getByText("Конфликтов полей нет",{exact:true})).toBeVisible();
 await expect(dialog.getByRole("button",{name:"Подтвердить объединение",exact:true})).toBeDisabled();
 await dialog.screenshot({path:screenshotPath(info,`mantine-client-merge-${viewport.width}x${viewport.height}.png`)});
 await dialog.getByRole("checkbox",{name:"Проверьте изменения перед подтверждением",exact:true}).check();await dialog.getByRole("button",{name:"Подтвердить объединение",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Maria Lopez",exact:true})).toBeVisible();
 expect(writes).toEqual([
  {path:"/api/clients",body:{firstName:"Maria",lastName:"Lopez",country:"Spain",phone:"+34600111222",instagram:"@maria_lopez",language:"es"}},
  {path:"/api/clients/client-new/athletes",body:{firstName:"Sofia",lastName:"Lopez",discipline:"RHYTHMIC_GYMNASTICS"}},
  {path:"/api/clients/client-new/merge-preview",body:{sourceClientIds:["client-eve"],fieldChoices:{}}},
  {path:"/api/clients/client-new/merge-batch",body:{sourceClientIds:["client-eve"],fieldChoices:{country:"client-new"},previewToken:"client-preview"}},
 ]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)).toBe(false);expect(errors).toEqual([]);
 await page.screenshot({path:screenshotPath(info,`mantine-clients-${viewport.width}x${viewport.height}.png`),fullPage:true});
});

test("client card shows its real status and lazy existing files instead of a placeholder",async({page})=>{
 const {clients,reads}=await mockClients(page);const eve=clients.get("client-eve")!;eve.status="INACTIVE";
 eve.files=[{id:"file-1",name:"Actual-file.pdf",path:"00000000-0000-4000-8000-000000000001.pdf",sizeBytes:20,createdAt:"2026-10-01T12:00:00Z"}];
 await page.setViewportSize({width:1366,height:768});await page.goto("/?section=clients&clientId=client-eve");await expect(page.getByRole("region",{name:"Клиент: Eve Emeterio",exact:true}).getByText("Неактивный клиент",{exact:true})).toBeVisible();
 expect(reads.some(read=>read.query.includes("tab=files"))).toBe(false);await page.getByRole("tab",{name:"Файлы",exact:true}).click();
 await expect(page.getByRole("link",{name:"Просмотр",exact:true})).toHaveAttribute("href",/client-files\/00000000/);await expect(page.getByText("Actual-file.pdf",{exact:true})).toBeVisible();
});

test("failed optional duplicate lookup leaves selected profile and activity history usable",async({page})=>{
 const {writes}=await mockClients(page);await page.route("**/api/clients?**",route=>new URL(route.request().url()).searchParams.get("view")==="duplicates"?route.fulfill({status:503,json:{message:"Поиск дубликатов недоступен"}}):route.fallback());
 await page.setViewportSize({width:1366,height:768});await page.goto("/?section=clients&clientId=client-eve");await expect(page.getByRole("heading",{name:"Eve Emeterio",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Найти дубликаты",exact:true}).click();await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Поиск дубликатов недоступен");
 await page.getByRole("dialog").getByRole("button",{name:"Закрыть",exact:true}).click();await page.getByRole("tab",{name:"Заметки",exact:true}).click();await expect(page.getByRole("heading",{name:"История действий",exact:true})).toBeVisible();await expect(page.getByText("Клиент создан",{exact:true})).toBeVisible();expect(writes).toEqual([]);
});
