import { test, expect, type Page } from '@playwright/test';
const {loadTargetModule}=require('./website-sales-model-loader.cjs');
const {buildOrderListPage}=loadTargetModule('orders/order-list-read-model.ts');

// Browser/API seam: all records and mutations are intercepted, never production.
test('composition requires server preview and explicit instance IDs before apply', async ({ page }) => {
 const calls: { path: string; body: any }[] = [];
 const instances = Array.from({length:5},(_,i)=>({id:`piece-${i}`,ordinal:i+1,updatedAt:'2026-10-15T12:00:00Z',productionStatus:'NOT_SCHEDULED',standardHeight:134}));
 const order:any={id:'design-order',number:'QA-DESIGN',currency:'EUR',type:'CUSTOM_ORDER',priceMinor:50000,depositRequiredMinor:25000,paymentStatus:'UNPAID',productionStatus:'NOT_SCHEDULED',shippingStatus:'NOT_READY',salesStatus:'NEW_LEAD',createdAt:'2026-10-15T12:00:00Z',client:{id:'client-design',displayName:'QA',source:'INSTAGRAM',athletes:[]},payments:[],activities:[],invoices:[],items:[{id:'design-1',name:'QA design',quantity:5,priceMinor:10000,instances}]};
 await page.route('**/api/**',async route=>{
  const r=route.request(),p=new URL(r.url()).pathname;
  if(r.method()==='POST'){calls.push({path:p,body:r.postDataJSON()});if(p.endsWith('/preview'))return route.fulfill({json:{token:'server-token',currency:'EUR',before:{quantity:5,totalMinor:50000,depositRequiredMinor:25000,paidMinor:0,balanceMinor:50000,overpaymentMinor:0},after:{quantity:4,totalMinor:40000,depositRequiredMinor:20000,paidMinor:0,balanceMinor:40000,overpaymentMinor:0},warnings:[],blockers:[]}});return route.fulfill({json:{operationId:'op-1'}});}
  const result=p==='/api/auth/me'?{user:{role:'OWNER',displayName:'QA'}}:p==='/api/branding'?{}:p==='/api/communications/unread-count'?{unreadCount:0}:p==='/api/orders'?buildOrderListPage([order],Object.fromEntries(new URL(r.url()).searchParams),new Date('2026-10-15T12:00:00Z')):p==='/api/orders/design-order'?order:[];
  return route.fulfill({json:result});
 });
 await page.goto('/?section=orders&orderId=design-order&tab=designs');
 await page.getByRole('tab',{name:/Дизайны/}).click();
 await expect(page.locator('.design-instance-card')).toHaveCount(1);
 await page.getByRole('button',{name:'134 × 5',exact:true}).click();
 await expect(page.locator('[data-instance-id]')).toHaveCount(5);
 await page.getByRole('button',{name:'Действия: QA design',exact:true}).click();
 await page.getByRole('menuitem',{name:'Изменить количество',exact:true}).click();
 const modal=page.getByRole('dialog');await modal.getByLabel('Количество').fill('4');
 await expect(modal.getByRole('button',{name:'Предварительный расчёт',exact:true})).toBeDisabled();
 await modal.getByLabel(/1\.2/).check();await modal.getByRole('button',{name:'Предварительный расчёт',exact:true}).click();
 await expect(modal).toContainText('500,00');await expect(modal).toContainText('400,00');
 expect(calls[0]!.body.archiveInstanceIds).toEqual(['piece-1']);
 await modal.getByRole('button',{name:'Подтвердить изменение',exact:true}).click();
 expect(calls[1]!.body.expectedToken).toBe('server-token');expect(calls[1]!.body.operationKey).toBeTruthy();
});

async function assignmentFixture(page:Page){
 const calls:{path:string;body:any}[]=[];
 const values=Object.fromEntries(Array.from({length:17},(_,i)=>[`m${i+1}`,50+i/2]));
 const athlete={id:'athlete-1',firstName:'QA athlete',updatedAt:'2026-10-15T12:00:00Z',measurements:[{id:'measurement-1',athleteId:'athlete-1',measuredAt:'2026-10-01T12:00:00Z',values},{id:'measurement-2',athleteId:'athlete-1',measuredAt:'2026-10-14T12:00:00Z',values:{...values,m1:60}}]};
 const instances=Array.from({length:6},(_,i)=>({id:`piece-${i}`,ordinal:i+1,updatedAt:'2026-10-15T12:00:00Z',productionStatus:'NOT_SCHEDULED',standardHeight:i<2?134:140,athlete,measurement:athlete.measurements[0]}));
 const order:any={id:'design-order',number:'QA-DESIGN',compositionManaged:true,currency:'EUR',type:'CUSTOM_ORDER',priceMinor:60000,depositRequiredMinor:30000,paymentStatus:'UNPAID',productionStatus:'NOT_SCHEDULED',shippingStatus:'NOT_READY',salesStatus:'NEW_LEAD',createdAt:'2026-10-15T12:00:00Z',client:{id:'client-design',displayName:'QA',source:'INSTAGRAM',athletes:[athlete]},payments:[],activities:[],invoices:[],items:[{id:'design-1',name:'QA design',quantity:6,priceMinor:10000,instances}]};
 await page.route('**/api/**',async route=>{
  const r=route.request(),u=new URL(r.url()),p=u.pathname;
  if(r.method()!=='GET'){
   calls.push({path:p,body:r.postDataJSON()});
   if(p.endsWith('/instances/assign')){for(const target of r.postDataJSON().targets){const piece=instances.find(i=>i.id===target.id)!;piece.measurement=athlete.measurements.find(m=>m.id===r.postDataJSON().measurementId)!;}return route.fulfill({json:{count:r.postDataJSON().targets.length}});}
   return route.fulfill({status:409,json:{message:'QA conflict: draft preserved'}});
  }
  const result=p==='/api/auth/me'?{user:{role:'OWNER',displayName:'QA'}}:p==='/api/branding'?{}:p==='/api/communications/unread-count'?{unreadCount:0}:p==='/api/orders'?buildOrderListPage([order],Object.fromEntries(u.searchParams),new Date('2026-10-15T12:00:00Z')):p==='/api/orders/design-order'?order:p.endsWith('/measurements/usage')?{rows:[{orderId:order.id,orderNumber:order.number,orderItemId:'design-1',designName:'QA design',instanceId:'piece-1',ordinal:2,measurementId:'measurement-1',measuredAt:'2026-10-01T12:00:00Z',productionStatus:'NOT_SCHEDULED',archived:false}],total:1,page:1,pageSize:20}:[];
  return route.fulfill({json:result});
 });
 return {calls,order};
}

test('design photo editor shows current image and clearly selects a replacement',async({page})=>{
 const {order}=await assignmentFixture(page);order.items[0].modelImagePath='current-design.png';
 await page.route('**/api/orders/images/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=','base64')}));
 await page.goto('/?section=orders&orderId=design-order&tab=designs');
 await page.getByRole('button',{name:'Редактировать дизайн',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Редактировать дизайн',exact:true});
 await expect(dialog.getByRole('img',{name:'Текущее фото дизайна',exact:true})).toHaveAttribute('src','/api/orders/images/current-design.png');
 await expect(dialog.getByText('Выберите фото для загрузки', {exact:true})).toBeVisible();
 await dialog.locator('input[type=file]').setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=','base64')});
 await expect(dialog.getByRole('img',{name:'Новое фото дизайна',exact:true})).toHaveAttribute('src',/^blob:/);
 await expect(dialog).toContainText('replacement.png');
});

test('saving design keeps the mounted order, open pieces and tab while refreshing server totals',async({page})=>{
 const {order}=await assignmentFixture(page);let applied=false;
 await page.route('**/api/orders/design-order/composition/**',async route=>{
  const body=route.request().postDataJSON();
  const summary={quantity:6,totalMinor:60000,depositRequiredMinor:30000,paidMinor:0,balanceMinor:60000,overpaymentMinor:0};
  if(route.request().url().endsWith('/preview'))return route.fulfill({json:{token:'edit-token',currency:'EUR',before:summary,after:summary,blockers:[],warnings:[]}});
  order.items[0].name=body.command.name;applied=true;return route.fulfill({json:{operationId:'edit-op'}});
 });
 let listRequested=false;let releaseList!:()=>void;const listGate=new Promise<void>(resolve=>{releaseList=resolve});
 await page.route(/\/api\/orders\?/,async route=>{
  if(applied){listRequested=true;await listGate;}
  return route.fulfill({json:buildOrderListPage([order],Object.fromEntries(new URL(route.request().url()).searchParams),new Date('2026-10-15T12:00:00Z'))});
 });
 await page.goto('/?section=orders&orderId=design-order&tab=designs');
 await page.getByRole('button',{name:'134 × 2',exact:true}).click();
 await page.locator('.design-instance-card').first().evaluate(el=>{(window as any).__originalDesignCard=el;(window as any).__sameDocument=true;});
 await page.getByRole('button',{name:'Редактировать дизайн',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Редактировать дизайн',exact:true});
 await dialog.getByRole('textbox',{name:/Название дизайна/}).fill('Updated QA design');
 await dialog.getByRole('button',{name:'Предварительный расчёт',exact:true}).click();
 await dialog.getByRole('button',{name:'Подтвердить изменение',exact:true}).click();
 await expect.poll(()=>listRequested).toBe(true);
 await expect.poll(()=>page.evaluate(()=>(window as any).__originalDesignCard.isConnected)).toBe(true);
 releaseList();
 await expect(dialog).not.toBeVisible();
 await expect(page.locator('.design-instance-name h4')).toHaveText('Updated QA design');
 await expect(page.locator('[data-instance-id]')).toHaveCount(2);
 await expect(page.getByRole('tab',{name:/Дизайны/})).toHaveAttribute('aria-selected','true');
 expect(await page.evaluate(()=>(window as any).__sameDocument)).toBe(true);
 expect(await page.evaluate(()=>(window as any).__originalDesignCard.isConnected)).toBe(true);
});

test('changing sport saves asynchronously without remounting the expanded order',async({page})=>{
 const {order}=await assignmentFixture(page);let saved=false,listRequested=false,writes=0;
 let releaseList!:()=>void;const gate=new Promise<void>(resolve=>{releaseList=resolve});
 await page.route('**/api/orders/design-order/discipline',route=>{
  writes++;order.discipline=route.request().postDataJSON().discipline;saved=true;return route.fulfill({json:order});
 });
 await page.route(/\/api\/orders\?/,async route=>{
  if(saved){listRequested=true;await gate;}
  return route.fulfill({json:buildOrderListPage([order],Object.fromEntries(new URL(route.request().url()).searchParams),new Date('2026-10-15T12:00:00Z'))});
 });
 await page.goto('/?section=orders&orderId=design-order&tab=designs');
 await page.getByRole('button',{name:'134 × 2',exact:true}).click();
 await page.locator('.design-instance-card').first().evaluate(el=>{(window as any).__sportCard=el;(window as any).__sportDocument=true;});
 await page.locator('.orders-discipline-trigger').click();
 await page.getByRole('menuitem',{name:'Фигурное катание',exact:true}).click();
 await expect.poll(()=>listRequested).toBe(true);
 expect(await page.evaluate(()=>(window as any).__sportCard.isConnected)).toBe(true);
 releaseList();
 await expect(page.locator('.orders-discipline-trigger')).toHaveText('Фигурное катание');
 await expect(page.locator('.design-instance-name')).toContainText('Фигурное катание');
 await expect(page.locator('[data-instance-id]')).toHaveCount(2);
 await expect(page.getByRole('tab',{name:/Дизайны/})).toHaveAttribute('aria-selected','true');
 expect(await page.evaluate(()=>(window as any).__sportCard.isConnected&&(window as any).__sportDocument)).toBe(true);
 expect(writes).toBe(1);
});

for(const failedRead of ['detail','list'])test(`photo save retries ${failedRead} refresh without repeating upload or committed apply`,async({page})=>{
 const {order}=await assignmentFixture(page);let applied=false,fail=true,uploads=0,applies=0;
 await page.route('**/api/orders/model-image',route=>{uploads++;return route.fulfill({json:{path:'saved-photo.png'}});});
 await page.route('**/api/orders/design-order/composition/**',route=>{
  const body=route.request().postDataJSON(),summary={quantity:6,totalMinor:60000,depositRequiredMinor:30000,paidMinor:0,balanceMinor:60000,overpaymentMinor:0};
  if(route.request().url().endsWith('/preview'))return route.fulfill({json:{token:'photo-token',currency:'EUR',before:summary,after:summary,blockers:[],warnings:[]}});
  applies++;applied=true;order.items[0].modelImagePath=body.command.modelImagePath;return route.fulfill({json:{operationId:'photo-op'}});
 });
 await page.route('**/api/orders/design-order',route=>{
  if(applied&&fail&&failedRead==='detail'){fail=false;return route.fulfill({status:503,json:{message:'QA detail refresh failed'}});}
  return route.fulfill({json:order});
 });
 await page.route(/\/api\/orders\?/,route=>{
  if(applied&&fail&&failedRead==='list'){fail=false;return route.fulfill({status:503,json:{message:'QA list refresh failed'}});}
  return route.fulfill({json:buildOrderListPage([order],Object.fromEntries(new URL(route.request().url()).searchParams),new Date('2026-10-15T12:00:00Z'))});
 });
 await page.goto('/?section=orders&orderId=design-order&tab=designs');
 await page.getByRole('button',{name:'Редактировать дизайн',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Редактировать дизайн',exact:true});
 await dialog.locator('input[type=file]').setInputFiles({name:'saved-photo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=','base64')});
 await dialog.getByRole('button',{name:'Предварительный расчёт',exact:true}).click();
 await dialog.getByRole('button',{name:'Подтвердить изменение',exact:true}).click();
 await expect(dialog).toContainText(`QA ${failedRead} refresh failed`);
 await expect(dialog.getByRole('textbox',{name:/Название дизайна/})).toBeDisabled();
 await dialog.getByRole('button',{name:'Подтвердить изменение',exact:true}).click();
 await expect(dialog).not.toBeVisible();
 expect(uploads).toBe(1);expect(applies).toBe(1);
 await expect(page.getByRole('tab',{name:/Дизайны/})).toHaveAttribute('aria-selected','true');
});

for(const width of [1366,390])test(`photo editor current/replacement and clear at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const {order,calls}=await assignmentFixture(page);
 order.items[0].externalImageUrl='https://design-photo-fixture.invalid/current.svg';
 await page.route('https://design-photo-fixture.invalid/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="128" height="144"><rect width="128" height="144" fill="#efe8ff"/><path d="M30 15L55 28H73L98 15L111 50L86 75L80 130H48L42 75L17 50Z" fill="#7947ff"/></svg>'}));
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/?section=orders&orderId=design-order&tab=designs');
 await page.getByRole('button',{name:'Редактировать дизайн',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Редактировать дизайн',exact:true});
 await expect(dialog.getByRole('img',{name:'Текущее фото дизайна',exact:true})).toBeVisible();
 await dialog.locator('input[type=file]').setInputFiles({name:'new-photo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=','base64')});
 await expect(dialog.getByRole('img',{name:'Новое фото дизайна',exact:true})).toBeVisible();
 await dialog.screenshot({path:`../../.local/design-photo-fix/photo-editor-${width}.png`});
 await dialog.locator('input[type=file]').setInputFiles([]);
 await expect(dialog.getByRole('img',{name:'Новое фото дизайна',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('img',{name:'Текущее фото дизайна',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Отмена',exact:true}).click();
 expect(calls).toEqual([]);expect(errors).toEqual([]);
});

test('assignment explicitly shares one immutable version with selected stable pieces only',async({page})=>{
 const {calls}=await assignmentFixture(page);
 await page.goto('/?section=orders&orderId=design-order&tab=designs');
 await expect(page.getByRole('button',{name:'134 × 2',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'134 × 2',exact:true}).click();
 await page.locator('[data-instance-id="piece-0"]').getByRole('button',{name:'Назначить спортсменку и измерения',exact:true}).click();
 const drawer=page.getByRole('dialog',{name:'Назначить спортсменку и измерения',exact:true});
 await expect(drawer.getByLabel('Ростовой размер',{exact:true})).toHaveValue('134');
 await drawer.getByLabel('Ростовой размер',{exact:true}).fill('128');
 await drawer.getByLabel('Версия мерок',{exact:true}).click();
 await page.getByRole('option').filter({hasText:'measurement-2'}).click();
 await drawer.getByLabel(/QA design · 1\.2/).check();
 await drawer.getByRole('button',{name:'Сохранить',exact:true}).click();
 const assignment=calls.find(c=>c.path.endsWith('/instances/assign'))!;
 expect(assignment.body.targets).toEqual([{id:'piece-0',expectedUpdatedAt:'2026-10-15T12:00:00Z'},{id:'piece-1',expectedUpdatedAt:'2026-10-15T12:00:00Z'}]);
 expect(assignment.body.standardHeight).toBe(128);
 expect(assignment.body.measurementId).toBe('measurement-2');expect(assignment.body.athleteId).toBe('athlete-1');
 expect(calls).toHaveLength(1);
});

test('measurements keeps 17-field sections and usage opens the exact existing piece',async({page})=>{
 await assignmentFixture(page);await page.goto('/?section=orders&orderId=design-order&tab=measurements');
 await expect(page.locator('.orders-tab-measurements-approved')).toBeVisible();
 await expect(page.locator('.orders-approved-measurement-grid')).toContainText('№15');
 await page.locator('.design-usage-row').first().click();
 await expect(page).toHaveURL(/tab=designs/);await expect(page).toHaveURL(/instanceId=piece-1/);
 await expect(page.locator('[data-instance-id="piece-1"][data-focused]')).toBeVisible();
});

test('duplicate defaults to no assignments and unknown settlement blocks apply without inventing zero',async({page})=>{
 await assignmentFixture(page);let command:any;
 await page.route('**/api/orders/design-order/composition/preview',async route=>{
  command=route.request().postDataJSON();const summary={quantity:6,totalMinor:60000,depositRequiredMinor:30000,paidMinor:null,balanceMinor:null,overpaymentMinor:null};
  return route.fulfill({json:{token:'unknown-fx',currency:'EUR',before:summary,after:{...summary,quantity:12,totalMinor:120000},blockers:['QA unknown FX'],warnings:[]}});
 });
 await page.goto('/?section=orders&orderId=design-order&tab=designs');
 await page.getByRole('button',{name:'Действия: QA design',exact:true}).click();
 await page.getByRole('menuitem',{name:'Дублировать дизайн',exact:true}).click();
 const modal=page.getByRole('dialog');await expect(modal.getByRole('checkbox')).not.toBeChecked();
 await modal.getByRole('button',{name:'Предварительный расчёт',exact:true}).click();
 expect(command.copyAssignments).toBe(false);
 await expect(modal.getByRole('cell',{name:'Требует проверки',exact:true})).toHaveCount(6);
 await expect(modal).toContainText('QA unknown FX');
 await expect(modal.getByRole('button',{name:'Подтвердить изменение',exact:true})).toBeDisabled();
 await modal.getByRole('button',{name:'Отмена',exact:true}).click();
 await expect(page.locator('.design-instance-card')).toHaveCount(1);
});

for(const size of [{width:1920,height:1080},{width:1703,height:895},{width:1366,height:768},{width:390,height:844}])test(`designs and measurements approved geometry ${size.width}`,async({page},info)=>{
 await page.setViewportSize(size);await assignmentFixture(page);
 await page.goto('/?section=orders&orderId=design-order&tab=designs');
 await expect(page.locator('.design-instance-card')).toHaveCount(1);
 await page.locator('.designs-instances').scrollIntoViewIfNeeded();
 await page.locator('.designs-instances').screenshot({path:info.outputPath(`designs-${size.width}.png`)});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('tab',{name:'Измерения',exact:true}).click();
 await expect(page.locator('.design-measurement-usage')).toContainText('QA-DESIGN');
 await page.locator('.orders-tab-measurements-approved').scrollIntoViewIfNeeded();
 await page.locator('.orders-tab-measurements-approved').screenshot({path:info.outputPath(`measurements-${size.width}.png`)});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('archived foreign usage stays in the current order and opens the exact readonly history',async({page})=>{
 const {calls}=await assignmentFixture(page);
 const measuredAt='2025-10-01T12:00:00Z';const archivedAt='2026-10-01T12:00:00Z';
 await page.route('**/api/order-tabs/design-order/measurements/usage?*',route=>route.fulfill({json:{rows:[{orderId:'archived-order',orderNumber:'QA-OLD',orderItemId:'archived-design',designName:'Old archived design',instanceId:'archived-piece',ordinal:8,measurementId:'old-snapshot',measuredAt,productionStatus:'READY',archived:true}],total:1,page:1,pageSize:20}}));
 await page.route('**/api/order-tabs/design-order/instances/archived-piece/history',route=>route.fulfill({json:{orderId:'archived-order',orderNumber:'QA-OLD',currency:'EUR',design:{id:'archived-design',name:'Old archived design',sku:'OLD-1',notes:'Historical notes',designNumber:3,priceMinor:12000,archivedAt},instance:{id:'archived-piece',ordinal:8,standardHeight:134,productionStatus:'READY',archivedAt,athlete:{id:'athlete-1',firstName:'QA athlete',lastName:null},measurement:{id:'old-snapshot',athleteId:'athlete-1',measuredAt,values:Object.fromEntries(Array.from({length:17},(_,i)=>[`m${i+1}`,60+i/2])),archivedAt}},archived:true}}));
 await page.goto('/?section=orders&orderId=design-order&tab=measurements');
 await page.locator('.design-usage-row').first().click();
 await expect(page).toHaveURL(/orderId=design-order/);await expect(page).toHaveURL(/historyInstanceId=archived-piece/);
 const card=page.getByTestId('historical-instance');await expect(card).toContainText('QA-OLD');
 await expect(card).toContainText('archived-piece');await expect(card).toContainText('old-snapshot');
 await expect(card.locator('.orders-approved-measurement-grid>div')).toHaveCount(17);
 await expect(card.getByRole('button',{name:/Назначить|Сохранить|Архивировать|Редактировать/})).toHaveCount(0);
 await page.reload();await expect(card).toContainText('old-snapshot');
 expect(calls).toEqual([]);
});

test('creating an athlete then cancelling refreshes parent data without assigning or deleting',async({page})=>{
 const {calls,order}=await assignmentFixture(page);let refreshes=0,created=false;
 await page.route('**/api/order-tabs/design-order/athletes',async route=>{
  created=true;const athlete={id:'created-athlete',firstName:'Created QA',updatedAt:'2026-10-15T12:00:00Z',measurements:[]};
  order.client.athletes.push(athlete);return route.fulfill({json:athlete});
 });
 await page.route('**/api/orders/design-order',route=>{if(created)refreshes++;return route.fulfill({json:order});});
 await page.goto('/?section=orders&orderId=design-order&tab=designs');
 await page.getByRole('button',{name:'134 × 2',exact:true}).click();
 await page.locator('[data-instance-id="piece-0"]').getByRole('button',{name:'Назначить спортсменку и измерения',exact:true}).click();
 const drawer=page.getByRole('dialog',{name:'Назначить спортсменку и измерения',exact:true});
 await drawer.getByRole('button',{name:'Добавить спортсменку',exact:true}).click();
 await drawer.getByLabel('Имя спортсменки',{exact:true}).fill('Created QA');
 await drawer.getByRole('button',{name:'Сохранить',exact:true}).first().click();
 await drawer.getByRole('button',{name:'Отмена',exact:true}).click();
 await expect(drawer).toHaveCount(0);await expect.poll(()=>refreshes).toBeGreaterThan(0);
 expect(calls).toEqual([]);
});

test('creating an immutable measurement version then cancelling refreshes without implicit assignment',async({page})=>{
 const {calls,order}=await assignmentFixture(page);let created=false,refreshes=0;
 await page.route('**/api/order-tabs/design-order/athletes/athlete-1/measurements',async route=>{
  created=true;const measurement={id:'new-immutable-version',athleteId:'athlete-1',measuredAt:'2026-10-15T12:00:00Z',values:{m1:50,m2:50.5,m3:51,m15:57}};
  order.client.athletes[0].measurements.push(measurement);return route.fulfill({json:measurement});
 });
 await page.route('**/api/orders/design-order',route=>{if(created)refreshes++;return route.fulfill({json:order});});
 await page.goto('/?section=orders&orderId=design-order&tab=designs');
 await page.getByRole('button',{name:'134 × 2',exact:true}).click();
 await page.locator('[data-instance-id="piece-0"]').getByRole('button',{name:'Назначить спортсменку и измерения',exact:true}).click();
 const drawer=page.getByRole('dialog',{name:'Назначить спортсменку и измерения',exact:true});
 await drawer.getByRole('button',{name:'Новая версия на основе выбранной',exact:true}).click();
 await page.getByRole('button',{name:'Сохранить замеры',exact:true}).click();
 await expect(drawer).toContainText('Версия создана. Подтвердите назначение выбранным экземплярам.');
 await drawer.getByRole('button',{name:'Отмена',exact:true}).click();
 await expect(drawer).toHaveCount(0);await expect.poll(()=>refreshes).toBeGreaterThan(0);
 expect(calls).toEqual([]);expect(order.items[0].instances[0].measurement.id).toBe('measurement-1');
});

test('copying historical values uses the assigned instance snapshot as CAS and hides archived-version action',async({page})=>{
 const {calls,order}=await assignmentFixture(page);
 order.client.athletes[0].measurements[1].archivedAt='2026-10-15T12:00:00Z';
 await page.goto('/?section=orders&orderId=design-order&tab=measurements');
 await page.getByRole('combobox',{name:'Версия мерок',exact:true}).click();
 await page.getByRole('option').filter({hasText:'measurement-2'}).click();
 await expect(page.getByRole('button',{name:'Архивировать версию',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Изменить замеры',exact:true}).click();
 await page.getByRole('button',{name:'Сохранить замеры',exact:true}).click();
 await expect.poll(()=>calls.length).toBe(1);
 expect(calls[0]!.path).toBe('/api/order-tabs/design-order/instances/piece-0/measurement');
 expect(calls[0]!.body.m1).toBe(60);
 expect(calls[0]!.body.expectedMeasurementId).toBe('measurement-1');
 expect(calls[0]!.body.expectedUpdatedAt).toBe('2026-10-15T12:00:00Z');
});


test('context athlete creation keeps operationKey after an unknown network outcome',async({page})=>{
 await assignmentFixture(page);const bodies:any[]=[];
 await page.route('**/api/order-tabs/design-order/athletes',route=>{
  bodies.push(route.request().postDataJSON());
  return bodies.length===1?route.abort('failed'):route.fulfill({json:{id:'retry-athlete',firstName:'Retry QA',measurements:[]}});
 });
 await page.goto('/?section=orders&orderId=design-order&tab=designs');
 await page.getByRole('button',{name:'134 × 2',exact:true}).click();
 await page.locator('[data-instance-id="piece-0"]').getByRole('button',{name:'Назначить спортсменку и измерения',exact:true}).click();
 const drawer=page.getByRole('dialog',{name:'Назначить спортсменку и измерения',exact:true});
 await drawer.getByRole('button',{name:'Добавить спортсменку',exact:true}).click();
 await drawer.getByLabel('Имя спортсменки',{exact:true}).fill('Retry QA');
 const save=drawer.getByRole('button',{name:'Сохранить',exact:true}).first();
 await save.click();await expect(drawer.getByRole('alert')).toBeVisible();await save.click();
 await expect(drawer.getByLabel('Имя спортсменки',{exact:true})).toHaveCount(0);
 expect(bodies).toHaveLength(2);expect(bodies[0].operationKey).toMatch(/^[0-9a-f-]{36}$/i);expect(bodies[1]).toEqual(bodies[0]);
});

test('context version retries freeze measuredAt and key until cancel and reopen',async({page})=>{
 await assignmentFixture(page);const bodies:any[]=[];
 await page.route('**/api/order-tabs/design-order/athletes/athlete-1/measurements',route=>{
  bodies.push(route.request().postDataJSON());return route.fulfill({status:409,json:{message:'QA conflict'}});
 });
 await page.goto('/?section=orders&orderId=design-order&tab=designs');
 await page.getByRole('button',{name:'134 × 2',exact:true}).click();
 await page.locator('[data-instance-id="piece-0"]').getByRole('button',{name:'Назначить спортсменку и измерения',exact:true}).click();
 const drawer=page.getByRole('dialog',{name:'Назначить спортсменку и измерения',exact:true});
 await drawer.getByRole('button',{name:'Новая версия на основе выбранной',exact:true}).click();
 await page.getByRole('button',{name:'Сохранить замеры',exact:true}).click();
 await expect(page.getByText('QA conflict',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Сохранить замеры',exact:true}).click();
 await expect.poll(()=>bodies.length).toBe(2);
 expect(bodies[0].operationKey).toMatch(/^[0-9a-f-]{36}$/i);expect(bodies[1]).toEqual(bodies[0]);
 await page.locator('.measurement-editor input[name="m1"]').fill('61');
 await page.getByRole('button',{name:'Сохранить замеры',exact:true}).click();
 await expect.poll(()=>bodies.length).toBe(3);
 expect(bodies[2].operationKey).toBe(bodies[0].operationKey);expect(bodies[2].measuredAt).toBe(bodies[0].measuredAt);expect(bodies[2].m1).toBe(61);
 await expect(page.getByText('QA conflict',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Отмена',exact:true}).last().click();
 await drawer.getByRole('button',{name:'Новая версия на основе выбранной',exact:true}).click();
 await page.getByRole('button',{name:'Сохранить замеры',exact:true}).click();
 await expect.poll(()=>bodies.length).toBe(4);expect(bodies[3].operationKey).not.toBe(bodies[0].operationKey);
});


for(const action of ['ADD','DUPLICATE'] as const)test(`${action} retry after committed response loss keeps the original operation and blocks repreview`,async({page})=>{
 const {order}=await assignmentFixture(page);const writes:any[]=[],operations=new Set<string>();let previews=0;
 await page.route('**/api/orders/design-order/composition/preview',route=>{
  previews++;const summary={quantity:6,totalMinor:60000,depositRequiredMinor:30000,paidMinor:0,balanceMinor:60000,overpaymentMinor:0};
  return route.fulfill({json:{token:'retry-frozen-token',currency:'EUR',before:summary,after:{...summary,quantity:12,totalMinor:120000},warnings:[],blockers:[]}});
 });
 await page.route('**/api/orders/design-order/composition/apply',route=>{
  const body=route.request().postDataJSON();writes.push(body);
  // Persist before losing the response, and replay the result only for the original key.
  if(!operations.has(body.operationKey)){operations.add(body.operationKey);order.items.push({...order.items[0],id:`copy-${operations.size}`,instances:[]});}
  return writes.length===1?route.abort('failed'):route.fulfill({json:{operationId:'durable-operation'}});
 });
 await page.goto('/?section=orders&orderId=design-order&tab=designs');
 if(action==='ADD')await page.getByRole('button',{name:'Добавить дизайн',exact:true}).click();
 else{await page.getByRole('button',{name:'Действия: QA design',exact:true}).click();await page.getByRole('menuitem',{name:'Дублировать дизайн',exact:true}).click();}
 const modal=page.getByRole('dialog');
 if(action==='ADD'){await modal.getByRole('textbox',{name:'Название дизайна',exact:true}).fill('Retry design');await modal.getByRole('textbox',{name:'Цена за единицу',exact:true}).fill('100');}
 await modal.getByRole('button',{name:'Предварительный расчёт',exact:true}).click();
 await modal.getByRole('button',{name:'Подтвердить изменение',exact:true}).click();
 await expect(modal.getByRole('alert')).toBeVisible();
 await expect(modal.locator('fieldset')).toHaveAttribute('disabled','');
 await expect(modal.getByRole('textbox',{name:'Название дизайна',exact:true})).toBeDisabled();
 await expect(modal.getByRole('button',{name:'Предварительный расчёт',exact:true})).toBeDisabled();
 await modal.getByRole('button',{name:'Подтвердить изменение',exact:true}).click();
 await expect(modal).toHaveCount(0);
 expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);expect(previews).toBe(1);expect(operations.size).toBe(1);expect(order.items).toHaveLength(2);
});


for(const action of ['ADD','DUPLICATE'] as const)test(`${action} parent refresh read failure never resubmits a committed mutation`,async({page})=>{
 const {order}=await assignmentFixture(page);let writes=0,failedReads=0;
 await page.route('**/api/orders/design-order/composition/preview',route=>{
  const summary={quantity:6,totalMinor:60000,depositRequiredMinor:30000,paidMinor:0,balanceMinor:60000,overpaymentMinor:0};
  return route.fulfill({json:{token:'refresh-frozen-token',currency:'EUR',before:summary,after:summary,warnings:[],blockers:[]}});
 });
 await page.route('**/api/orders/design-order/composition/apply',async route=>{
  writes++;
  await page.route('**/api/orders/design-order',read=>{failedReads++;return failedReads===1?read.fulfill({status:503,json:{message:'QA refresh failure'}}):read.fulfill({json:order});});
  return route.fulfill({json:{operationId:'already-saved'}});
 });
 await page.goto('/?section=orders&orderId=design-order&tab=designs');
 if(action==='ADD')await page.getByRole('button',{name:'Добавить дизайн',exact:true}).click();
 else{await page.getByRole('button',{name:'Действия: QA design',exact:true}).click();await page.getByRole('menuitem',{name:'Дублировать дизайн',exact:true}).click();}
 const modal=page.getByRole('dialog');
 if(action==='ADD'){await modal.getByRole('textbox',{name:'Название дизайна',exact:true}).fill('Refresh design');await modal.getByRole('textbox',{name:'Цена за единицу',exact:true}).fill('100');}
 await modal.getByRole('button',{name:'Предварительный расчёт',exact:true}).click();
 await modal.getByRole('button',{name:'Подтвердить изменение',exact:true}).click();
 await expect(modal).toContainText('QA refresh failure');
 await expect(modal.getByRole('textbox',{name:/Название дизайна/})).toBeDisabled();
 await modal.getByRole('button',{name:'Подтвердить изменение',exact:true}).click();
 await expect(modal).toHaveCount(0);expect(failedReads).toBe(2);expect(writes).toBe(1);
});
