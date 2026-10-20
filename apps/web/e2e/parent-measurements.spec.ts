import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { parentMeasurementsAccessCopy, parentMeasurementsCopy, localeNames } from '../lib/parent-measurements-i18n';
import type { Child, Draft, Locale, RangePolicy } from '../lib/parent-measurements-model';

// Browser contract harness only; production components always call the real HTTP API.
async function fixture(page: Page) {
  const state = { calls: [] as { method: string; path: string; body: any }[], children: [] as Child[], conflict: false, offline: false, loseSubmit: false, ranges: undefined as RangePolicy | undefined, policyConflict: false };
  const session = (locale = 'en') => ({ orderNumber: 'TEST-ORDER', locale, expiresAt: '2026-12-31T00:00:00Z', csrfToken: 'csrf-test', children: state.children, ranges: state.ranges });
  await page.route('**/api/public/parent-measurements**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/public/parent-measurements', ''), method = request.method();
    const body = method === 'GET' ? undefined : request.postDataJSON();
    state.calls.push({ method, path, body });
    const reply = (json: unknown, status = 200) => route.fulfill({ status, json, headers: { 'Cache-Control': 'no-store' } });
    if (state.offline) return route.abort('internetdisconnected');
    if (path === '/start') return reply(session(body.locale));
    if (path === '/session' || path === '/recover') return reply(session());
    if (path === '/children' && method === 'POST') { const child: Child = { id: `child-${state.children.length + 1}`, revision: 0, draft: { firstName: body.firstName } }; state.children.push(child); return reply(child); }
    const child = state.children.find(item => path.startsWith(`/children/${item.id}`));
    if (child && method === 'PATCH') { if (state.conflict || body.revision !== child.revision) return reply({ message: 'conflict' }, 409); child.revision++; child.draft = body.draft; return reply(child); }
    if (child && path.endsWith('/submit')) {
      if (state.policyConflict) return reply({message:'policy changed'},409);
      const result = { id: 'submission', measurementId: 'snapshot', reviewStatus: 'RECEIVED', assignmentStatus: 'UNASSIGNED' };
      child.submitted = result;
      if (state.loseSubmit) { state.loseSubmit = false; return route.abort('connectionreset'); }
      return reply(result);
    }
    if (child && path.endsWith('/revise')) { child.revision++; delete child.submitted; return reply(child); }
    if (child && method === 'DELETE') { state.children = state.children.filter(item => item.id !== child.id); return reply({ ok: true }); }
    if (path === '/share' || path === '/recovery') return reply({ url: `${new URL(request.url()).origin}/parent-measurements#${path === '/share' ? 'token=shared' : 'recover=private'}`, expiresAt: '2026-12-31T00:00:00Z' });
    if (path.startsWith('/photos/')) return reply({ message: 'not found' },404);
    return reply({ ok: true });
  });
  return state;
}

async function enter(page: Page, locale: Locale = 'en') {
  const ui = parentMeasurementsCopy[locale];
  await page.goto(`/parent-measurements#invite=test-invite&lang=${locale}`);
  if (locale === 'en') await page.screenshot({ path:'../../output/playwright/parent-measurements/welcome.png',fullPage:true });
  await page.getByLabel(ui.entryConsent).check();
  await page.getByRole('button', { name: `${parentMeasurementsAccessCopy[locale].newSession} →`, exact: true }).click();
  await expect(page.getByRole('heading', { name: ui.settings })).toBeVisible();
  if (locale === 'en') await page.screenshot({ path:'../../output/playwright/parent-measurements/settings.png',fullPage:true });
  await page.getByRole('button', { name: `${ui.next} →`, exact: true }).click();
}

async function addProfile(page: Page) {
  await page.getByLabel('First name', { exact: true }).fill('Browser Test');
  await page.getByRole('button', { name: '＋ Add an athlete', exact: true }).click();
  await page.screenshot({ path:'../../output/playwright/parent-measurements/profile.png',fullPage:true });
  await page.getByRole('combobox', { name: /^Sport/ }).click();
  await page.getByRole('option', { name: 'Figure skating', exact: true }).click();
  await page.getByRole('button', { name: 'Next →', exact: true }).click();
  await page.screenshot({ path:'../../output/playwright/parent-measurements/guide.png',fullPage:true });
  await page.getByRole('button', { name: 'Next →', exact: true }).click();
}

test('full mobile wizard sends only four required cm values, retries lost submit with one key and creates a revision', async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await enter(page); await addProfile(page);
  for (const [n, value] of [[1,'70'],[2,'60'],[3,'80'],[15,'130']] as const) {
    await page.getByLabel(new RegExp(`^№${n} ·`)).fill(value);
    await page.screenshot({ path: `../../output/playwright/parent-measurements/measure-${n}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Next →', exact: true }).click();
  }
  await expect(page.getByText('Required: 4/4', { exact: true })).toBeVisible();
  await expect(page.getByText('Additional: 0/13', { exact: true })).toBeVisible();
  await page.screenshot({ path:'../../output/playwright/parent-measurements/additional.png',fullPage:true });
  await page.getByRole('button', { name: 'Next →', exact: true }).click();
  await page.screenshot({ path:'../../output/playwright/parent-measurements/summary.png',fullPage:true });
  await page.getByLabel(parentMeasurementsCopy.en.submitConsent).check();
  state.loseSubmit = true;
  await page.getByRole('button', { name: 'Submit measurements →', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'The action failed' })).toBeVisible();
  await page.getByRole('button', { name: 'Submit measurements →', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Measurements sent to the CRM' })).toBeVisible();
  expect(state.calls.filter(call => call.path.endsWith('/submit')).map(call => call.body.operationKey)).toEqual([expect.any(String), state.calls.find(call => call.path.endsWith('/submit'))!.body.operationKey]);
  expect(state.children[0].draft.values).toEqual({ m1:70,m2:60,m3:80,m15:130 });
  expect(state.children[0].draft.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(state.children[0].draft.discipline).toBe('FIGURE_SKATING');
  await page.screenshot({ path: '../../output/playwright/parent-measurements/success.png', fullPage: true });
  await page.getByRole('button',{name:'Share with other parents',exact:true}).click();
  await page.getByRole('button',{name:'Create shared link',exact:true}).click();
  await expect(page.getByRole('img',{name:'QR · Share with other parents'})).toHaveAttribute('src',/^data:image\/png;base64,/);
  await page.screenshot({path:'../../output/playwright/parent-measurements/share-qr.png',fullPage:true});
  expect(await page.getByRole('textbox',{name:'Share with other parents',exact:true}).inputValue()).toContain('token=shared');
  await page.getByRole('button',{name:'← Back',exact:true}).click();
  await page.getByRole('button',{name:'Enter measurements',exact:true}).click();
  await page.getByRole('button', { name: 'Create a corrected version' }).click();
  await expect(page.getByRole('heading', { name: 'Athlete details' })).toBeVisible();
  expect(state.calls.some(call => call.path.endsWith('/revise'))).toBe(true);
});

test('trusted ranges wire sliders and explicit consent; changing a value removes its old consent',async({page})=>{
  const state=await fixture(page);
  const version='00000000-0000-4000-8000-000000000001';
  state.ranges={version,rules:[{id:'rule1',field:1,lowerCm:60,upperCm:80}]};
  await page.setViewportSize({width:390,height:844});
  await enter(page);await addProfile(page);
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuemin','57');
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuemax','83');
  await page.getByLabel(/^№1 ·/).fill('90');
  await expect(page.getByRole('alert').filter({hasText:parentMeasurementsCopy.en.warning})).toBeVisible();
  await page.screenshot({path:resolve(__dirname,'../../../.local/parent-measurements-refinement/public-red-zone.png'),fullPage:true});
  await page.getByRole('button',{name:'Next →',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Chest circumference (under arms)',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Checked, correct',exact:true}).click();
  await expect(page.getByRole('button',{name:'Checked, correct ✓',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByLabel(/^№1 ·/).fill('91');
  await expect(page.getByRole('button',{name:'Checked, correct',exact:true})).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'Checked, correct',exact:true}).click();
  await page.getByRole('button',{name:'Next →',exact:true}).click();
  for(const [n,value] of [[2,'60'],[3,'80'],[15,'130']] as const){await page.getByLabel(new RegExp(`^№${n} ·`)).fill(value);await page.getByRole('button',{name:'Next →',exact:true}).click();}
  // Optional values are subject to their own rule too, not just the four core screens.
  await page.getByRole('button',{name:'Next →',exact:true}).click();
  await page.getByLabel(parentMeasurementsCopy.en.submitConsent).check();
  await page.getByRole('button',{name:'Submit measurements →',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Measurements sent to the CRM'})).toBeVisible();
  expect(state.children[0].draft.rangeVersion).toBe(version);
  expect(state.children[0].draft.warningsAcknowledged).toEqual([`${version}:rule1:m1:182`]);
  expect(state.children[0].draft.values?.m1).toBe(91);
});

test('optional out-of-range values gate summary; submit 409 loads new policy without reusing prior consent',async({page})=>{
  const state=await fixture(page);
  const version='00000000-0000-4000-8000-000000000001';
  state.ranges={version,rules:[{id:'optional',field:4,lowerCm:20,upperCm:30}]};
  await enter(page);await addProfile(page);
  for(const [n,value] of [[1,'70'],[2,'60'],[3,'80'],[15,'130']] as const){await page.getByLabel(new RegExp(`^№${n} ·`)).fill(value);await page.getByRole('button',{name:'Next →',exact:true}).click();}
  await page.getByRole('button',{name:/^№4 · Front waist/}).click();
  await page.getByRole('textbox',{name:/^№4 ·/}).fill('40');
  await page.getByRole('button',{name:'Next →',exact:true}).click();
  await expect(page.getByRole('heading',{name:'All measurements',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Checked, correct',exact:true}).first().click();
  await page.getByRole('button',{name:'Next →',exact:true}).click();
  await page.getByLabel(parentMeasurementsCopy.en.submitConsent).check();
  // Removing consent in summary must prevent any submit HTTP request.
  await page.getByRole('button',{name:'Checked, correct ✓',exact:true}).click();
  await page.getByRole('button',{name:'Submit measurements →',exact:true}).click();
  expect(state.calls.filter(call=>call.path.endsWith('/submit'))).toHaveLength(0);
  await page.getByRole('button',{name:'Checked, correct',exact:true}).click();
  state.policyConflict=true;
  await page.getByRole('button',{name:'Submit measurements →',exact:true}).click();
  await expect(page.getByRole('button',{name:'Load the server version'})).toBeDisabled();
  state.ranges={version:'00000000-0000-4000-8000-000000000002',rules:[{id:'optional',field:4,lowerCm:20,upperCm:30}]};
  state.policyConflict=false;
  await page.getByLabel(parentMeasurementsCopy.en.reloadConsent).check();
  await page.getByRole('button',{name:'Load the server version'}).click();
  await page.getByRole('button',{name:'Enter measurements',exact:true}).click();
  await page.getByRole('button',{name:'Next →',exact:true}).click();
  await page.getByRole('button',{name:'Next →',exact:true}).click();
  for(let i=0;i<4;i++)await page.getByRole('button',{name:'Next →',exact:true}).click();
  await expect(page.getByRole('button',{name:'Checked, correct',exact:true}).first()).toHaveAttribute('aria-pressed','false');
  expect(state.children[0].draft.values?.m4).toBe(40);
  await page.screenshot({path:'../../output/playwright/parent-measurements/range-policy-reloaded.png',fullPage:true});
});

test('a valid invitation stays private behind manual entry until explicitly opened',async({page})=>{
  const state=await fixture(page);
  await page.goto(`/parent-measurements#invite=${'A'.repeat(43)}&lang=en`);
  await expect(page.getByRole('textbox',{name:'Invitation code',exact:true})).not.toBeVisible();
  expect(state.calls).toHaveLength(0);
  await page.getByRole('button',{name:'Enter invitation code manually'}).click();
  await expect(page.getByRole('textbox',{name:'Invitation code',exact:true})).toHaveValue('A'.repeat(43));
});

test('inches require explicit rounding and unit toggles never rewrite cm; recovery stays private',async({page})=>{
  const state=await fixture(page);await enter(page);await addProfile(page);
  await page.getByRole('button',{name:'cm → inches',exact:true}).click();
  await page.getByLabel(/^№1 ·/).fill('27,56');
  await expect(page.getByRole('button',{name:'Confirm rounding',exact:true})).toBeVisible();
  expect(state.children[0].draft.values?.m1).toBeUndefined();
  await page.getByRole('button',{name:'Confirm rounding',exact:true}).click();
  for(let n=0;n<3;n++){
    await page.getByRole('button',{name:'inches → cm',exact:true}).click();
    await expect(page.getByLabel(/^№1 ·/)).toHaveValue('70');
    await page.getByRole('button',{name:'cm → inches',exact:true}).click();
    await expect(page.getByLabel(/^№1 ·/)).toHaveValue('27.56');
  }
  await page.getByRole('button',{name:'Continue later',exact:true}).click();
  await page.getByRole('button',{name:'Create private link',exact:true}).click();
  await expect(page.getByLabel('Save private access',{exact:true})).toHaveValue(/recover=private/);
  await expect(page.getByRole('img',{name:/QR/})).toHaveCount(0);
  expect(state.children[0].draft.values?.m1).toBe(70);
  await page.screenshot({path:'../../output/playwright/parent-measurements/recovery.png',fullPage:true});
});

test('no private autoload, explicit resume, offline warning and CAS stop', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/parent-measurements#token=test&lang=en');
  await expect(page.getByRole('heading', { name: parentMeasurementsCopy.en.title })).toBeVisible();
  // Server-rendered heading can appear before hydration clears the private fragment.
  await expect(page).not.toHaveURL(/token/);
  expect(state.calls).toEqual([]);
  await page.getByLabel(parentMeasurementsCopy.en.entryConsent).check();
  await page.getByRole('button', { name: 'Open my saved data' }).click();
  await page.getByRole('button', { name: 'Next →', exact:true }).click();
  await addProfile(page);
  state.offline = true;
  await page.getByLabel(/^№1 ·/).fill('71');
  await expect(page.getByRole('alert').filter({ hasText:'No server connection' })).toBeVisible();
  state.offline = false; state.conflict = true;
  await page.getByRole('button', { name:'Retry',exact:true }).click();
  await expect(page.getByRole('button', { name:'Load the server version' })).toBeDisabled();
  const before = state.calls.filter(call=>call.method==='PATCH').length;
  await expect(page.getByLabel(/^№1 ·/)).toBeDisabled();
  await page.getByLabel(parentMeasurementsCopy.en.reloadConsent).check();
  state.conflict = false;
  await page.getByRole('button', { name:'Load the server version' }).click();
  await expect(page.getByRole('heading', { name:'My athletes' })).toBeVisible();
  expect(state.calls.filter(call=>call.method==='PATCH').length).toBe(before);
});

for (const locale of Object.keys(localeNames) as Locale[]) {
  test(`six-language public wizard and narrow layout: ${locale}`, async ({ page }) => {
    await fixture(page); const ui = parentMeasurementsCopy[locale];
    await enter(page,locale);
    for (const width of [320,360,375,390,430,768,1366,1920]) {
      await page.setViewportSize({ width,height:900 });
      await expect(page.getByRole('heading',{name:ui.roster,exact:true})).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      if (width===320 || width===390) await page.screenshot({path:`../../output/playwright/parent-measurements/${locale}-${width}.png`,fullPage:true});
    }
  });
}

test('numeric input stays compact beside a slider and empty fields are never auto-filled',async({page})=>{
 const state=await fixture(page);await enter(page);await addProfile(page);
 const input=page.getByLabel(/^№1 ·/),slider=page.getByRole('slider');
 await expect(input).toHaveValue('');
 await expect(slider).toBeVisible();
 expect(state.children[0].draft.values?.m1).toBeUndefined();
 await input.fill('70');
 await expect(slider).toHaveAttribute('aria-valuenow','70');
 await slider.focus();await page.keyboard.press('ArrowRight');
 await expect(input).toHaveValue('70.5');
 for(const width of [320,390,768,1366]){
  await page.setViewportSize({width,height:900});
  const a=(await input.boundingBox())!,b=(await slider.boundingBox())!;
  expect(a.width).toBeLessThan(135);expect(b.x).toBeGreaterThan(a.x+a.width);
  expect(Math.abs(a.y+a.height/2-(b.y+b.height/2))).toBeLessThan(24);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await input.fill('250');await expect(slider).toHaveAttribute('aria-valuemax','250');
 await slider.focus();await page.keyboard.press('ArrowLeft');await expect(input).toHaveValue('249.5');
 await expect.poll(()=>state.children[0].draft.values?.m1).toBe(249.5);
 for(const width of [320,390]){await page.setViewportSize({width,height:844});for(const value of ['70','90','100','100.5']){await input.fill(value);expect(await input.evaluate(node=>{const style=getComputedStyle(node),canvas=document.createElement('canvas'),context=canvas.getContext('2d')!;context.font=style.font;return context.measureText(node.value).width<=node.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);})).toBe(true);}await page.screenshot({path:resolve(__dirname,`../../../.local/parent-measurements-refinement/public-number-${width}.png`),fullPage:true});}
 await input.fill('70');await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:resolve(__dirname,'../../../.local/parent-measurements-refinement/public-input-compact.png'),fullPage:true});
});

test('English and French guides use their supplied measurement tables',async({page})=>{
 for(const locale of ['en','fr'] as const){
  const ui=parentMeasurementsCopy[locale];await page.setViewportSize({width:locale==='en'?390:1280,height:900});await page.goto('about:blank');await fixture(page);await enter(page,locale);
  await page.getByLabel(ui.firstName,{exact:true}).fill('Locale Test');
  await page.getByRole('button',{name:`＋ ${ui.add}`,exact:true}).click();
  await page.getByRole('combobox',{name:new RegExp(`^${ui.sport}`)}).click();
  await page.getByRole('option',{name:ui.sports[0],exact:true}).click();
  await page.getByRole('button',{name:`${ui.next} →`,exact:true}).click();
  await expect(page.locator(`img[src="/parent-measurements/reference-${locale}.jpg"]`)).toBeVisible();
  await page.getByRole('button',{name:`${ui.next} →`,exact:true}).click();
  await page.getByText(ui.diagram,{exact:true}).click();
  await expect(page.locator(`img[src="/parent-measurements/reference-${locale}.jpg"]`).first()).toBeVisible();
  await page.getByRole('button',{name:new RegExp(`^${ui.zoom}:`)}).click();
  await expect(page.getByRole('dialog').locator('img')).toHaveAttribute('src',`/parent-measurements/reference-${locale}.jpg`);
  const closeBounds=(await page.getByRole('button',{name:ui.close,exact:true}).boundingBox())!;expect(closeBounds.x+closeBounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({path:resolve(__dirname,`../../../.local/parent-measurements-refinement/zoom-${locale}.png`),fullPage:true});
  await page.getByRole('button',{name:ui.close,exact:true}).click();
 }
});
