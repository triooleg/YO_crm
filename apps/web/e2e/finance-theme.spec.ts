import {test,expect} from '@playwright/test';
for(const saved of ['dark','auto'])test(`Finance preserves CRM light scheme on entry/exit with saved ${saved}`,async({page})=>{
 await page.emulateMedia({colorScheme:'dark'});
 await page.addInitScript(value=>localStorage.setItem('mantine-color-scheme-value',value),saved);
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/auth/me')return route.fulfill({json:{user:{role:'OWNER',displayName:'QA'}}});
  if(path==='/api/branding')return route.fulfill({json:{}});
  if(path==='/api/finance/report')return route.fulfill({status:503,json:{message:'Нет данных для теста темы'}});
  return route.fulfill({json:path.endsWith('/unread-count')?{unreadCount:0}:[]});
 });
 await page.goto('/?section=finance');await expect(page.locator('.finance-report-page')).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme','light');
 await page.getByRole('button',{name:'Заказы',exact:true}).click();
 await expect(page.locator('.finance-report-page')).toHaveCount(0);
 await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme','light');
 expect(await page.evaluate(()=>localStorage.getItem('mantine-color-scheme-value'))).toBe(saved);
});
