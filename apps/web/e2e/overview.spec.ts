import { test, expect, type Page } from '@playwright/test';
import { moveFinanceMonth } from '../lib/finance-report';

// Deliberately synthetic acceptance fixtures; never used by the runtime component.
async function overviewFixture(page:Page,role='OWNER',options:{failTasks?:boolean;failFinance?:boolean;delayOrders?:Promise<void>;transform?:(path:string,json:any,query:URLSearchParams)=>unknown}={}){
 const calls:{path:string;method:string;query:URLSearchParams;body:unknown}[]=[];let failTasks=options.failTasks;
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  calls.push({path,method:request.method(),query:url.searchParams,body:request.postData()?request.postDataJSON():null});
  const output=(json:unknown)=>route.fulfill({json:options.transform?options.transform(path,json,url.searchParams):json});
  if(path==='/api/auth/me')return output({user:{id:'staff-1',role,displayName:'QA',email:'qa@example.test'}});
  if(path==='/api/branding')return output({});
  if(path==='/api/communications/unread-count')return output({unreadCount:3});
  if(path==='/api/overview/orders'){
   if(options.delayOrders)await options.delayOrders;
   return output({month:url.searchParams.get('month'),currency:url.searchParams.get('currency'),today:'2026-10-15',counts:{total:24,previousTotal:18,work:8,ready:5,overdue:2,requiresVerification:1,awaitingPayment:3},ring:{total:24,excluded:0,segments:[{key:'new',count:4},{key:'work',count:8},{key:'ready',count:5},{key:'awaiting',count:3},{key:'completed',count:4}]},trend:Array.from({length:Number(url.searchParams.get('range')||6)},(_,index)=>({month:moveFinanceMonth(url.searchParams.get('month')!,index-Number(url.searchParams.get('range')||6)+1),orders:24-index,clients:12-index})),recent:[{id:'order-1',number:'QA-101',clientName:'Synthetic client',modelImagePath:null,salesStatus:'IN_PRODUCTION',createdAt:'2026-10-12',amountMinor:33000,originalAmountMinor:33000,originalCurrency:'EUR'}],valuationError:null});
  }
  if(path==='/api/overview/tasks'){
   if(failTasks){failTasks=false;return route.fulfill({status:503,json:{message:'Задачи временно недоступны'}})}
   return output({userId:'staff-1',doneColumnId:'done-column',rows:[{id:'task-1',title:'Проверить синтетический заказ',columnId:'todo',dueAt:'2026-10-15',clientName:'Synthetic client',orderId:'order-1',orderNumber:'QA-101'}]});
  }
  if(path==='/api/overview/messages')return output({unreadCount:3,rows:[{conversationId:'conversation-1',clientId:'client-1',clientName:'Synthetic client',avatarUrl:null,channel:'INSTAGRAM',preview:'Тестовое входящее сообщение',at:'2026-10-15T09:24:00Z',unreadCount:1}]});
  if(path==='/api/overview/shipments')return output({today:'2026-10-15',count7:5,requiresVerification:0,rows:[{id:'shipment-1',orderId:'order-1',shipmentId:'shipment-1',number:'QA-101',clientName:'Synthetic client',carrier:'DHL',status:'READY',expectedAt:'2026-10-15',forecast:false}]});
  if(path==='/api/finance/report'){
   if(options.failFinance)return route.fulfill({status:422,json:{message:'Нет действующего курса USD'}});
   const currency=url.searchParams.get('currency')||'EUR';
   return output({month:url.searchParams.get('month'),currency,valuationVersion:'v1',valuation:{provider:null,effectiveDate:null,fetchedAt:null,officialUrl:null},current:{receivedMinor:312368,expensesMinor:62435,resultMinor:249933},previous:{receivedMinor:745872,expensesMinor:48800,resultMinor:697072},monthlyTrend:Array.from({length:Number(url.searchParams.get('range')||6)},(_,index)=>({month:moveFinanceMonth(url.searchParams.get('month')!,index-Number(url.searchParams.get('range')||6)+1),receivedMinor:312368,expensesMinor:62435,resultMinor:249933}))});
  }
  if(path==='/api/tasks/task-1/move')return output({id:'task-1',columnId:'done-column'});
  return route.fulfill({json:[]});
 });
 return calls;
}

test('overview renders seven real aggregate KPI and independent working panels without writes',async({page})=>{
 const calls=await overviewFixture(page);await page.goto('/?section=overview&period=2026-10&currency=EUR');
 await expect(page.locator('.overview-kpi')).toHaveCount(7);
 await expect(page.getByRole('heading',{name:'Мои задачи',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Последние сообщения',exact:true})).toBeVisible();
 await expect(page.locator('.overview-kpis')).toContainText('3 123,68'.replace(' ','\u00a0'));
 await expect.poll(()=>new Set(calls.filter(call=>call.path.startsWith('/api/overview/')||call.path==='/api/finance/report').map(call=>call.path)).size).toBe(5);
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});

for(const [width,height] of [[1536,1024],[1920,1080],[1703,895],[1440,900],[1366,768],[820,1180],[390,844]] as const)test(`overview layout and SVG geometry ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height});const calls=await overviewFixture(page),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/?section=overview&period=2026-10&currency=EUR');await expect(page.locator('.overview-page')).toHaveAttribute('data-overview-ready','true');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await expect(page.getByRole('button',{name:'Предыдущий месяц обзора',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Следующий месяц обзора',exact:true})).toBeVisible();
 if(width>=1536){const tops=await page.locator('.overview-kpi').evaluateAll(nodes=>nodes.map(node=>Math.round(node.getBoundingClientRect().top)));expect(new Set(tops).size).toBe(1);}
 await expect.poll(()=>page.locator('.overview-bar-chart').evaluateAll(nodes=>nodes.every(node=>Math.abs((node as SVGSVGElement).viewBox.baseVal.width-node.getBoundingClientRect().width)<2&&Math.abs((node as SVGSVGElement).viewBox.baseVal.height-node.getBoundingClientRect().height)<2))).toBe(true);
 await page.screenshot({path:info.outputPath(`overview-top-${width}.png`)});
 await page.getByRole('heading',{name:'Мои задачи',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`overview-work-${width}.png`)});
 await page.locator('.overview-attention').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`overview-attention-${width}.png`)});
 expect(errors).toEqual([]);expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});

test('overview period arrows manual picker and currency retain unrelated URL state',async({page})=>{
 const calls=await overviewFixture(page);await page.goto('/?section=overview&period=2026-10&currency=USD&retained=1');await expect(page.locator('.overview-page')).toHaveAttribute('data-overview-ready','true');
 const latest=()=>calls.filter(call=>call.path==='/api/overview/orders').at(-1)!.query;
 await page.getByRole('button',{name:'Предыдущий месяц обзора',exact:true}).click();await expect.poll(()=>latest().get('month')).toBe('2026-09');
 await page.getByRole('button',{name:'Следующий месяц обзора',exact:true}).click();await expect.poll(()=>latest().get('month')).toBe('2026-10');
 const trigger=page.getByRole('button',{name:'Выбрать месяц и год обзора',exact:true});await trigger.click();await page.getByRole('button',{name:'2026',exact:true}).click();await page.getByRole('button',{name:'2025',exact:true}).click();await page.getByRole('button',{name:/^март\.?$/i}).click();
 await expect.poll(()=>latest().get('month')).toBe('2025-03');await expect(trigger).toContainText(/март 2025/i);
 expect(latest().get('currency')).toBe('USD');await expect(page).toHaveURL(/retained=1/);
 await page.getByRole('combobox',{name:'Валюта обзора',exact:true}).click();await page.getByRole('option',{name:'₴ UAH',exact:true}).click();await expect.poll(()=>latest().get('currency')).toBe('UAH');
 await expect(page).toHaveURL(/period=2025-03/);await expect(page).toHaveURL(/currency=UAH/);
 await page.reload();await expect(page.getByRole('combobox',{name:'Валюта обзора',exact:true})).toHaveValue('₴ UAH');await expect(trigger).toContainText(/март 2025/i);
 await page.getByRole('combobox',{name:'Горизонт динамики',exact:true}).click();await page.getByRole('option',{name:'12 месяцев',exact:true}).click();await expect.poll(()=>latest().get('range')).toBe('12');
 expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});

test('failed task panel retries alone and task checkbox locks repeated synchronous submissions',async({page})=>{
 const calls=await overviewFixture(page,'OWNER',{failTasks:true});let release!:()=>void;const delay=new Promise<void>(resolve=>release=resolve);let writes=0;
 await page.route('**/api/tasks/task-1/move',async route=>{writes++;expect(route.request().method()).toBe('PATCH');expect(route.request().postDataJSON()).toEqual({columnId:'done-column'});await delay;await route.fulfill({json:{id:'task-1'}})});
 await page.goto('/?section=overview&period=2026-10');const tasks=page.locator('.overview-tasks');await expect(tasks.getByRole('alert')).toContainText('Задачи временно недоступны');await expect(page.locator('.overview-recent-orders')).toContainText('QA-101');
 await expect(page.locator('.overview-page')).toHaveAttribute('data-overview-ready','true');const otherCalls=calls.filter(call=>call.path==='/api/overview/orders').length;
 await tasks.getByRole('button',{name:'Повторить',exact:true}).click();await expect(tasks.getByRole('checkbox')).toBeEnabled();expect(calls.filter(call=>call.path==='/api/overview/orders').length).toBe(otherCalls);
 await tasks.getByRole('checkbox').evaluate((node:HTMLInputElement)=>{node.click();node.click()});await expect.poll(()=>writes).toBe(1);await expect(tasks.getByRole('checkbox')).toBeDisabled();release();await expect(tasks.getByRole('checkbox')).toBeEnabled();expect(writes).toBe(1);
});

test('task mutation failure preserves task and provides local error',async({page})=>{
 await overviewFixture(page);await page.route('**/api/tasks/task-1/move',route=>route.fulfill({status:409,json:{message:'Статус задачи изменён'}}));await page.goto('/?section=overview&period=2026-10');const tasks=page.locator('.overview-tasks');await tasks.getByRole('checkbox').click();await expect(tasks.getByRole('alert')).toContainText('Статус задачи изменён');await expect(tasks.getByRole('checkbox')).toBeEnabled();await expect(tasks).toContainText('Проверить синтетический заказ');
});

test('FX failure never fabricates zero and does not hide other sources',async({page})=>{
 await overviewFixture(page,'OWNER',{failFinance:true});await page.goto('/?section=overview&period=2026-10&currency=USD');await expect(page.locator('.overview-finance-card').getByRole('alert')).toContainText('Нет действующего курса USD');
 await expect(page.locator('.overview-recent-orders')).toContainText('QA-101');await expect(page.locator('.overview-finance-card .overview-bar-chart')).toHaveCount(0);
 const financial=page.locator('.overview-kpi').filter({hasText:'Получено'});await expect(financial.getByRole('alert')).toContainText('Нет действующего курса USD');await expect(financial.locator('strong')).toHaveCount(0);
});

for(const role of ['MANAGER','ACCOUNTANT','PRODUCTION'])test(`overview respects role ${role} without requesting forbidden domains`,async({page})=>{
 const calls=await overviewFixture(page,role);await page.goto('/?section=overview&period=2026-10');await expect(page.locator('.overview-page')).toHaveAttribute('data-overview-ready','true');
 const requested=calls.filter(call=>call.path.startsWith('/api/overview/')||call.path==='/api/finance/report').map(call=>call.path);
 if(role==='ACCOUNTANT'){expect([...new Set(requested)]).toEqual(['/api/finance/report']);await expect(page.locator('.overview-kpi')).toHaveCount(3);await expect(page.locator('.overview-messages')).toHaveCount(0)}
 else if(role==='PRODUCTION'){expect([...new Set(requested)]).toEqual(['/api/overview/tasks']);await expect(page.locator('.overview-kpi')).toHaveCount(0)}
 else{expect(requested).not.toContain('/api/finance/report');await expect(page.locator('.overview-kpi')).toHaveCount(4);await expect(page.locator('.overview-finance-card')).toHaveCount(0)}
});

test('attention panel hides restores and remains read-only',async({page})=>{
 const calls=await overviewFixture(page);await page.goto('/?section=overview&period=2026-10');await expect(page.locator('.overview-attention')).toBeVisible();await page.getByRole('button',{name:'Скрыть панель внимания',exact:true}).click();await expect(page.locator('.overview-attention')).toHaveCount(0);await page.reload();await expect(page.getByRole('button',{name:'Показать панель внимания',exact:true})).toBeVisible();await page.getByRole('button',{name:'Показать панель внимания',exact:true}).click();await expect(page.locator('.overview-attention')).toBeVisible();expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});

async function expectTarget(page:Page,context:Record<string,string>){
 await expect.poll(()=>{const query=new URL(page.url()).searchParams;return Object.fromEntries(Object.keys(context).map(key=>[key,query.get(key)]))}).toEqual(context);
}
const kpiTargets=[
 ['Всего заказов',{section:'orders',overviewFilter:'period',period:'2026-10'}],['В производстве',{section:'production',overviewFilter:'work'}],['Готовы к отправке',{section:'orders',overviewFilter:'ready'}],['Просрочено',{section:'orders',overviewFilter:'overdue'}],
 ['Получено',{section:'finance',period:'2026-10',currency:'EUR',tab:'payments',metric:'received'}],['Расходы',{section:'finance',period:'2026-10',currency:'EUR',tab:'expenses',metric:'expenses'}],['Финансовый результат',{section:'finance',period:'2026-10',currency:'EUR',tab:'payments',metric:'result'}],
] as const;
for(const [label,target] of kpiTargets)test(`KPI navigation applies target ${label}`,async({page})=>{
 await overviewFixture(page);await page.goto('/?section=overview&period=2026-10&currency=EUR');await expect(page.locator('.overview-page')).toHaveAttribute('data-overview-ready','true');await page.locator('.overview-kpis').getByRole('button',{name:label,exact:true}).click();await expectTarget(page,target);
});

for(const [index,key] of ['new','work','ready','awaiting','completed'].entries())for(const surface of ['segment','legend'])test(`ring ${surface} ${key} opens exact filtered period`,async({page})=>{
 await overviewFixture(page);await page.goto('/?section=overview&period=2026-10&currency=EUR');await expect(page.locator('.overview-page')).toHaveAttribute('data-overview-ready','true');
 const buttons=surface==='segment'?page.locator('.overview-ring').getByRole('button'):page.locator('.overview-ring-legend').getByRole('button');
 await expect(buttons).toHaveCount(5);await buttons.nth(index).focus();await page.keyboard.press('Enter');await expectTarget(page,{section:'orders',overviewFilter:key,period:'2026-10'});
});

for(const [mode,target] of [['Заказы',{section:'orders',overviewFilter:'period'}],['Доходы',{section:'finance',tab:'payments',metric:'received',currency:'EUR'}],['Клиенты',{section:'clients'}]] as const)test(`trend mode ${mode} bar uses its own month target`,async({page})=>{
 await overviewFixture(page);await page.goto('/?section=overview&period=2026-10&currency=EUR');await page.locator('.overview-trend-card').getByText(mode,{exact:true}).click();
 const bar=page.locator('.overview-trend-card svg').getByRole('button').first();await expect(bar).toBeVisible();await bar.focus();await page.keyboard.press('Space');await expectTarget(page,{...target,period:'2026-05'});
});
for(const [label,tab,metric] of [['Получено','payments','received'],['Расходы','expenses','expenses']] as const)test(`finance ${label} series opens exact monthly journal`,async({page})=>{
 await overviewFixture(page);await page.goto('/?section=overview&period=2026-10&currency=EUR');const bar=page.locator('.overview-finance-card svg').getByRole('button',{name:new RegExp(` · ${label}:`)}).first();await bar.click();await expectTarget(page,{section:'finance',period:'2026-05',currency:'EUR',tab,metric});
});

for(const [locator,target] of [
 ['.overview-task-open',{section:'tasks',assignee:'me',taskId:'task-1'}],['.overview-order-row',{section:'orders',orderId:'order-1'}],['.overview-shipment-open',{section:'orders',orderId:'order-1',shipmentId:'shipment-1',tab:'delivery'}],['.overview-shipment-row > button:last-child',{section:'orders',orderId:'order-1',shipmentId:'shipment-1',tab:'delivery'}],['.overview-message-row',{section:'inbox',clientId:'client-1',conversationId:'conversation-1',channel:'INSTAGRAM'}],
 ['.overview-alert-red',{section:'orders',overviewFilter:'overdue'}],['.overview-alert-orange',{section:'orders',overviewFilter:'unpaid'}],['.overview-alert-violet',{section:'shipping',filter:'upcoming',horizon:'7'}],['.overview-alert-blue',{section:'inbox',conversationScope:'UNREAD'}],
] as const)test(`record or alert navigation ${locator}`,async({page})=>{
 const calls=await overviewFixture(page);await page.goto('/?section=overview&period=2026-10&currency=EUR');await expect(page.locator('.overview-page')).toHaveAttribute('data-overview-ready','true');await page.locator(locator).first().click();await expectTarget(page,target);expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});

test('ring integer percentages total 100 with largest remainder and true arc proportions',async({page})=>{
 let equal=false;await overviewFixture(page,'OWNER',{transform:(path,json)=>path==='/api/overview/orders'&&equal?{...json,ring:{total:3,excluded:21,segments:[{key:'new',count:1},{key:'work',count:1},{key:'ready',count:1},{key:'awaiting',count:0},{key:'completed',count:0}]}}:json});
 await page.goto('/?section=overview&period=2026-10');const shares=page.locator('.overview-ring-legend small');await expect(shares).toHaveText(['17%','33%','21%','12%','17%']);
 expect(await shares.evaluateAll(nodes=>nodes.reduce((sum,node)=>sum+parseInt(node.textContent||'0',10),0))).toBe(100);
 equal=true;await page.reload();await expect(shares).toHaveText(['34%','33%','33%','0%','0%']);
 await expect(page.locator('.overview-ring').getByRole('button')).toHaveCount(3);await expect(page.locator('.overview-status-card')).toContainText('Исключено из диаграммы: 21');
 const arc=await page.locator('.overview-ring circle').first().getAttribute('stroke-dasharray');expect(Number(arc!.split(' ')[0])).toBeCloseTo(100/3,8);
});

test('empty panels zero ring and unconfigured done column remain honest and read-only',async({page})=>{
 let empty=true;const calls=await overviewFixture(page,'OWNER',{transform:(path,json)=>{
  if(path==='/api/overview/orders')return {...json,counts:{...json.counts,total:0,overdue:0,requiresVerification:35},ring:{total:0,excluded:0,segments:json.ring.segments.map((row:any)=>({...row,count:0}))},trend:[],recent:[]};
  if(path==='/api/finance/report')return {...json,monthlyTrend:[]};
  if(path==='/api/overview/tasks')return {...json,doneColumnId:null,rows:empty?[]:json.rows};
  if(path==='/api/overview/messages'||path==='/api/overview/shipments')return {...json,rows:[]};return json;
 }});await page.goto('/?section=overview&period=2026-10');await expect(page.locator('.overview-page')).toHaveAttribute('data-overview-ready','true');
 await expect(page.getByText('Нет доступных заказов',{exact:true})).toBeVisible();await expect(page.locator('.overview-tasks')).toContainText('Нет открытых задач');await expect(page.locator('.overview-messages')).toContainText('Нет доступных сообщений');await expect(page.locator('.overview-shipments')).toContainText('Нет запланированных отправок');
 await expect(page.locator('.overview-ring').getByRole('button')).toHaveCount(0);await expect(page.locator('.overview-trend-card')).toContainText('Нет данных за выбранный период');await expect(page.locator('.overview-finance-card')).toContainText('Нет данных за выбранный период');await expect(page.locator('.overview-kpi').filter({hasText:'Просрочено'})).toContainText('35 · Требует проверки');await expect(page.locator('.overview-attention')).toContainText('35 · Сроки заказов требуют проверки');
 empty=false;await page.reload();await expect(page.locator('.overview-tasks').getByRole('checkbox')).toBeDisabled();expect(calls.filter(call=>call.method!=='GET')).toEqual([]);
});

test('VIEWER never requests restricted overview data',async({page})=>{
 const calls=await overviewFixture(page,'VIEWER');await page.goto('/?section=overview');await expect(page.locator('.overview-page')).toHaveAttribute('data-overview-ready','true');await expect(page.locator('.overview-page')).toContainText('Нет доступных блоков обзора для вашей роли');expect(calls.filter(call=>call.path.startsWith('/api/overview/')||call.path==='/api/finance/report')).toEqual([]);await expect(page.locator('.overview-kpi')).toHaveCount(0);
});

test('late response for previous month cannot replace the selected report',async({page})=>{
 await overviewFixture(page);let release!:()=>void,started=false;const pending=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/overview/orders?*',async(route)=>{
  const month=new URL(route.request().url()).searchParams.get('month');
  if(month==='2026-10'){started=true;await pending;await route.fulfill({json:{month,currency:'EUR',counts:{total:999}}}).catch(()=>undefined);return}
  await route.fulfill({json:{month,currency:'EUR',today:'2026-10-15',counts:{total:7,previousTotal:7,work:0,ready:0,overdue:0,requiresVerification:0,awaitingPayment:0},ring:{total:0,excluded:7,segments:[]},trend:[],recent:[],valuationError:null}});
 });
 await page.goto('/?section=overview&period=2026-10');await expect.poll(()=>started).toBe(true);await page.getByRole('button',{name:'Следующий месяц обзора',exact:true}).click();const kpi=page.locator('.overview-kpi').filter({hasText:'Всего заказов'});await expect(kpi.locator('strong')).toHaveText('7');release();await expect(page.locator('.overview-page')).toHaveAttribute('data-overview-ready','true');await expect(kpi.locator('strong')).toHaveText('7');await expect(kpi).not.toContainText('999');
});
for(const width of [1440,1366])test(`large UAH finance values keep six readable visual labels ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await overviewFixture(page,'OWNER',{transform:(path,json)=>path==='/api/finance/report'?{...json,monthlyTrend:json.monthlyTrend.map((row:any)=>({...row,receivedMinor:row.receivedMinor*40,expensesMinor:row.expensesMinor*40,resultMinor:row.resultMinor*40}))}:json});
 await page.goto('/?section=overview&period=2026-10&currency=UAH');await expect(page.locator('.overview-page')).toHaveAttribute('data-overview-ready','true');
 const labels=page.locator('.overview-finance-card .overview-chart-value');await expect(labels).toHaveCount(6);
 const bounds=await page.locator('.overview-finance-card .overview-bar-chart').boundingBox();expect(bounds).not.toBeNull();
 for(const label of await labels.all()){const box=await label.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(bounds!.x-1);expect(box!.x+box!.width).toBeLessThanOrEqual(bounds!.x+bounds!.width+1);expect(await label.evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12)}
 await expect(page.locator('.overview-finance-card svg').getByRole('button').first()).toHaveAttribute('aria-label',/124.?947,20/);
});
