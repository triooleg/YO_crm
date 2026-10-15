import { expect, test, type Page, type Route } from "@playwright/test";

const board={columns:[{id:"column-new",name:"Новые",color:"#7047eb",isDone:false,sortOrder:0,tasks:[]}],users:[{id:"user-owner",displayName:"QA",role:"OWNER"}]};
const conversation={id:"conversation-task",channel:"FACEBOOK",lastMessageAt:"2026-09-13T08:00:00.000Z",unreadCount:0,unreadVersion:0,messages:[]};
const client={id:"client-task",displayName:"Task Client",status:"ACTIVE",source:"FACEBOOK",preferredChannel:"FACEBOOK",orders:[],buyerSummary:{purchaseCount:0,paymentTotals:[]},linkedChannels:["FACEBOOK"],conversations:[conversation]};
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return{promise,resolve}}

async function mockTaskApi(page:Page,mutating:(route:Route,path:string)=>Promise<boolean>){await page.route("**/api/**",async route=>{const request=route.request(),path=new URL(request.url()).pathname;if(await mutating(route,path))return;if(request.method()!=="GET")return route.fulfill({status:405,json:{message:`Unexpected ${request.method()} ${path}`}});if(path==="/api/auth/me")return route.fulfill({json:{user:{email:"qa@yoleotard.local",displayName:"QA",role:"OWNER"}}});if(path==="/api/branding")return route.fulfill({json:{}});if(path==="/api/tasks/board")return route.fulfill({json:board});if(path==="/api/communications/templates")return route.fulfill({json:[]});if(path==="/api/communications")return route.fulfill({json:{items:[client],total:1,hasMore:false,channelCounts:{FACEBOOK:1}}});if(path===`/api/communications/${client.id}`)return route.fulfill({json:{messages:[]}});if(path===`/api/clients/${client.id}`)return route.fulfill({json:{...client,athletes:[],workTasks:[]}});return route.fulfill({status:501,json:{message:`Unexpected ${request.method()} ${path}`}})})}

async function verifyBusyTaskDialog(page:Page,open:()=>Promise<void>){const gate=deferred();let posts=0;await mockTaskApi(page,async(route,path)=>{if(path==="/api/tasks"&&route.request().method()==="POST"){posts++;await gate.promise;await route.fulfill({json:{id:"task-created"}});return true}return false});await open();const dialog=page.getByRole("dialog",{name:"+ Новая задача"});await dialog.getByLabel("Название").fill("Проверка блокировки");await dialog.locator("form").evaluate(form=>{form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))});await expect.poll(()=>posts).toBe(1);await page.keyboard.press("Escape");await page.locator(".mantine-Modal-overlay").click({position:{x:4,y:4}});await expect(dialog).toBeVisible();await expect(dialog.getByRole("button",{name:"Закрыть"})).toBeDisabled();await expect(dialog.getByRole("button",{name:"Отмена"})).toBeDisabled();expect(posts).toBe(1);gate.resolve();await expect(dialog).toBeHidden()}

test("задача из раздела Задачи блокирует закрытие и двойную отправку",async({page})=>{await verifyBusyTaskDialog(page,async()=>{await page.goto("/?section=tasks");await page.getByRole("button",{name:"+ Новая задача"}).click()})});

test("задача из Входящих блокирует закрытие и двойную отправку",async({page})=>{await verifyBusyTaskDialog(page,async()=>{await page.goto("/?section=inbox");await page.getByRole("button",{name:"Создать задачу",exact:true}).first().click()})});


test('unknown board metrics stay unavailable rather than zero',async({page})=>{
 await mockTaskApi(page,async(route,path)=>{if(path==='/api/tasks/board'){await route.fulfill({status:503,json:{message:'Board offline'}});return true}return false});
 await page.goto('/?section=tasks');await expect(page.getByRole('alert').filter({hasText:'Board offline'})).toContainText('Board offline');
 await expect(page.locator('.tasks-stats b')).toHaveText(['—','—','—','—']);
});
test('completed past-due task agrees with the non-overdue counter',async({page})=>{
 await mockTaskApi(page,async(route,path)=>{if(path!=='/api/tasks/board')return false;
  await route.fulfill({json:{columns:[{...board.columns[0],id:'done',isDone:true,tasks:[{id:'done-task',title:'Completed example',columnId:'done',dueAt:'2020-01-01T12:00:00Z',type:'ADMIN',labels:[],attachments:[]}]}],users:board.users}});return true});
 await page.goto('/?section=tasks');await expect(page.getByText('Completed example',{exact:true})).toBeVisible();
 await expect(page.locator('.tasks-stats b').nth(2)).toHaveText('0');await expect(page.locator('time.late')).toHaveCount(0);
});
test('failed archived-board load retains the active mode',async({page})=>{
 await mockTaskApi(page,async(route,path)=>{if(path==='/api/tasks/board'&&new URL(route.request().url()).searchParams.get('archived')==='true'){await route.fulfill({status:503,json:{message:'Archive offline'}});return true}return false});
 await page.goto('/?section=tasks');await expect(page.locator('.tasks-stats b').first()).toHaveText('0');
 await page.getByRole('button',{name:'Архивные',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'Archive offline'})).toContainText('Archive offline');
 await expect(page.getByRole('button',{name:'Архивные',exact:true})).toHaveAttribute('aria-pressed','false');
});
