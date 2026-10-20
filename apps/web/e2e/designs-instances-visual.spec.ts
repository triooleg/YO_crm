import { test, expect, type Page } from '@playwright/test';
const {loadTargetModule}=require('./website-sales-model-loader.cjs');
const {buildOrderListPage}=loadTargetModule('orders/order-list-read-model.ts');
// Isolated visual fixture: no live records, payments or provider calls.
async function fixture(page:Page){
 const stamp='2026-10-15T12:00:00Z';
 const athletes=Array.from({length:6},(_,n)=>({id:`a${n}`,firstName:`Спортсменка ${n+1}`,updatedAt:stamp,measurements:[{id:`m${n}`,athleteId:`a${n}`,measuredAt:stamp,values:Object.fromEntries(Array.from({length:17},(_,i)=>[`m${i+1}`,50+i/2]))}]}));
 const items=[3,1,2].map((quantity,n)=>({id:`d${n}`,name:['Дизайн A — Blue Galaxy','Дизайн B — Pink Rose','Дизайн C — Aqua Dream'][n],sku:`QA-00${n+1}`,notes:'Индивидуальный дизайн · контрольный пример',discipline:'RHYTHMIC_GYMNASTICS',quantity,priceMinor:[35000,25000,45000][n],productionStatus:'NOT_SCHEDULED',externalImageUrl:`https://visual-fixture.invalid/design-${n}.svg`,instances:Array.from({length:quantity},(_,j)=>{const a=athletes[n*2+j%2]!;return {id:`p${n}-${j}`,ordinal:j+1,updatedAt:stamp,productionStatus:'NOT_SCHEDULED',standardHeight:j%2?140:134,athlete:a,measurement:a.measurements[0]};})}));
 const order:any={id:'visual-order',number:'QA-VISUAL',compositionManaged:true,currency:'EUR',type:'CUSTOM_ORDER',priceMinor:220000,depositRequiredMinor:110000,paymentStatus:'PARTIALLY_PAID',productionStatus:'NOT_SCHEDULED',shippingStatus:'NOT_READY',salesStatus:'NEW_LEAD',createdAt:stamp,updatedAt:stamp,client:{id:'visual-client',displayName:'Контрольный клиент',source:'FACEBOOK',athletes},payments:[{id:'qa-payment',amountMinor:60000,currency:'EUR',method:'BANK_TRANSFER',receivedAt:stamp}],activities:[],invoices:[],items};
 await page.route('https://visual-fixture.invalid/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120"><rect width="100" height="120" fill="#f1edff"/><path d="M25 10L40 20H60L75 10L85 40L65 65L60 105H40L35 65L15 40Z" fill="#7342ff" stroke="#eca828" stroke-width="4"/></svg>'}));
 await page.route('**/api/**',route=>{const r=route.request(),u=new URL(r.url()),p=u.pathname;
 if(p.endsWith('/preview')){const before={quantity:6,totalMinor:220000,depositRequiredMinor:110000,paidMinor:60000,balanceMinor:160000,overpaymentMinor:0};return route.fulfill({json:{token:'qa-preview',currency:'EUR',before,after:{...before,quantity:5,totalMinor:185000,depositRequiredMinor:92500,balanceMinor:125000},warnings:[],blockers:[]}});}
 const result=p==='/api/auth/me'?{user:{role:'OWNER',displayName:'QA'}}:p==='/api/branding'?{}:p==='/api/communications/unread-count'?{unreadCount:0}:p==='/api/orders'?buildOrderListPage([order],Object.fromEntries(u.searchParams),new Date(stamp)):p==='/api/orders/visual-order'?order:p.endsWith('/measurements/usage')?{rows:items.flatMap(i=>i.instances.map(x=>({orderId:order.id,orderNumber:order.number,orderItemId:i.id,designName:i.name,instanceId:x.id,ordinal:x.ordinal,measurementId:x.measurement!.id,measuredAt:stamp,productionStatus:'NOT_SCHEDULED',archived:false}))),total:6,page:1,pageSize:20}:[];
 return route.fulfill({json:result});});
}
for(const width of [1920,1703,1366,390])test(`populated designs and changed states ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:width===1920?1080:width===1703?895:width===1366?768:844});await fixture(page);
 await page.goto('/?section=orders&orderId=visual-order&tab=designs');
 await expect(page.locator('.design-instance-card')).toHaveCount(3);await expect(page.getByRole('tab',{name:'Измерения',exact:true})).toBeVisible();
 await page.locator('.designs-instances').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`order-designs-${width}.png`),fullPage:true});
 await page.locator('.design-instance-card').first().getByRole('button',{name:'134 × 2',exact:true}).click();
 await expect(page.locator('[data-instance-id]')).toHaveCount(2);await page.locator('.designs-instances').screenshot({path:info.outputPath(`instances-${width}.png`)});
 await page.locator('[data-instance-id="p0-0"]').getByRole('button',{name:'Назначить спортсменку и измерения',exact:true}).click();
 const drawer=page.getByRole('dialog',{name:'Назначить спортсменку и измерения',exact:true});await expect(drawer).toBeVisible();await page.screenshot({path:info.outputPath(`assignment-${width}.png`)});
 await drawer.getByRole('button',{name:'Новая версия на основе выбранной',exact:true}).click();
 const editor=page.locator('.measurement-editor');await expect(editor.locator('input[name^="m"]')).toHaveCount(17);
 await expect(editor.locator('input[name="m15"]')).toHaveAttribute('step','0.5');await expect(editor.locator('input[name="m15"]')).toHaveAttribute('required','');
 await page.screenshot({path:info.outputPath(`measurements-basic-editor-${width}.png`)});
 await editor.getByRole('tab',{name:'Дополнительные',exact:true}).click();await expect(editor.locator('input[name="m17"]')).toBeVisible();await page.screenshot({path:info.outputPath(`measurements-additional-editor-${width}.png`)});
 await editor.getByRole('button',{name:'Отмена',exact:true}).click();await drawer.getByRole('button',{name:'Отмена',exact:true}).click();
 await page.getByRole('tab',{name:'Измерения',exact:true}).click();await expect(page.locator('.orders-tab-measurements-approved')).toBeVisible();
 await page.locator('.orders-measurement-summary').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`measurements-lower-${width}.png`),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const width of [1366,390])test(`complementary scroll and composition states ${width}`,async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height:width===390?844:768});await fixture(page);
 await page.goto('/?section=orders&orderId=visual-order&tab=designs');await expect(page.locator('.design-instance-card')).toHaveCount(3);
 await page.getByRole('heading',{name:/^QA-VISUAL/}).scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath(`header-${width}.png`)});
 await page.getByRole('tab',{name:'История',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`tabs-right-${width}.png`)});
 await page.locator('.design-instance-totals').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`designs-bottom-${width}.png`)});
 const card=page.locator('.design-instance-card').first();await card.getByRole('button',{name:'134 × 2',exact:true}).click();
 const row=page.locator('[data-instance-id="p0-0"]');await row.getByRole('button',{name:'Назначить спортсменку и измерения',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`table-right-${width}.png`)});
 await row.getByRole('button',{name:'Назначить спортсменку и измерения',exact:true}).click();const drawer=page.getByRole('dialog',{name:'Назначить спортсменку и измерения',exact:true});
 await drawer.getByRole('button',{name:'Новая версия на основе выбранной',exact:true}).click();const editor=page.locator('.measurement-editor');await editor.locator('input[name="m15"]').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`basic-bottom-${width}.png`)});
 await editor.getByRole('tab',{name:'Дополнительные',exact:true}).click();await editor.locator('input[name="m17"]').scrollIntoViewIfNeeded();await expect(editor.locator('input[name="m17"]')).toBeInViewport();await page.screenshot({path:info.outputPath(`additional-bottom-${width}.png`)});
 await editor.getByRole('button',{name:'Отмена',exact:true}).click();await drawer.getByRole('button',{name:'Отмена',exact:true}).click();
 await page.getByRole('tab',{name:'Измерения',exact:true}).click();await page.locator('.orders-athlete-rail').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`measurement-upper-${width}.png`)});
 await page.getByRole('tab',{name:/Дизайны/}).click();const menu=card.getByRole('button',{name:'Действия: Дизайн A — Blue Galaxy',exact:true});await menu.focus();await expect(menu).toBeFocused();await page.keyboard.press('Enter');await expect(page.getByRole('menuitem',{name:'Изменить количество',exact:true})).toBeVisible();await page.screenshot({path:info.outputPath(`menu-${width}.png`)});
 await page.getByRole('menuitem',{name:'Изменить количество',exact:true}).click();const modal=page.getByRole('dialog');await modal.getByLabel('Количество',{exact:true}).fill('2');await modal.getByLabel(/1\.1/).check();await page.screenshot({path:info.outputPath(`shrink-${width}.png`)});
 await modal.getByRole('button',{name:'Предварительный расчёт',exact:true}).click();await expect(modal).toContainText('2 200');await page.screenshot({path:info.outputPath(`preview-${width}.png`)});
 await page.route('**/api/orders/visual-order/composition/apply',route=>route.fulfill({status:503,json:{message:'Не удалось получить подтверждение сервера. Повторите эту же операцию: сохранённый результат будет восстановлен без дублирования дизайна.'}}));
 await modal.getByRole('button',{name:'Подтвердить изменение',exact:true}).click();await expect(modal.getByRole('alert')).toBeVisible();await expect(modal.locator('fieldset')).toHaveAttribute('disabled','');await expect(modal.getByLabel('Количество',{exact:true})).toBeDisabled();await expect(modal.getByRole('button',{name:'Предварительный расчёт',exact:true})).toBeDisabled();await page.screenshot({path:info.outputPath(`retry-error-${width}.png`)});
 expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
