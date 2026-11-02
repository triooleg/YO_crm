import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const shell=await readFile(new URL("../components/crm-shell.tsx",import.meta.url),"utf8");
const css=await readFile(new URL("../app/crm-shell.css",import.meta.url),"utf8");
const inboxCss=await readFile(new URL("../app/inbox-reference.css",import.meta.url),"utf8");
test("все разделы используют одну верхнюю навигацию без бокового меню",()=>{assert.match(shell,/className="crm-shell inbox-reference-shell"/);assert.match(shell,/<header className="crm-topbar">/);assert.match(shell,/const topbarItems = \[items\[0\].*items\[8\]\]/);assert.doesNotMatch(shell,/<aside className="crm-nav">/);assert.doesNotMatch(shell,/crm-nav-label/);assert.doesNotMatch(shell,/nav-collapsed/);assert.doesNotMatch(shell,/setCollapsed/);assert.doesNotMatch(shell,/crm-collapse/);assert.match(shell,/title=\{count\?`\$\{name\}: \$\{count\}`:name\}/);assert.match(inboxCss,/grid-template-columns:minmax\(0,1fr\)/)});
test("клиенты и доставка не занимают отдельные пункты верхнего меню",()=>{
  assert.match(shell,/const topbarItems = \[items\[0\], items\[1\], items\[3\], items\[4\], items\[5\], items\[7\], items\[8\]\]/);
  assert.doesNotMatch(shell,/const topbarItems = .*items\[2\]/);
  assert.doesNotMatch(shell,/const topbarItems = .*items\[6\]/);
});
test("поиск и уведомления из общей шапки открывают входящие",()=>{assert.match(shell,/updateGlobalSearch/);assert.match(shell,/sectionId!=="inbox"\)navigate\("inbox"\)/);assert.match(shell,/onClick=\{showUnread\}/)});
test("колокольчик, пункт Входящие и вкладка браузера показывают общий счётчик непрочитанных",()=>{
  assert.match(shell,/fetch\("\/api\/communications\/unread-count"/);
  assert.match(shell,/createVisibilityPolling\(pollUnreadCount\)/);
  assert.match(shell,/crm-topbar-notification-badge/);
  assert.match(shell,/crm-topbar-nav-badge/);
  assert.match(shell,/applyUnreadBrowserState/);
  assert.match(shell,/unreadRequests\.current\.invalidate\(\)/);
  assert.match(shell,/onUnreadRefresh=\{\(\)=>void refreshUnreadCount\(\)\}/);
  assert.match(inboxCss,/\.crm-topbar-notifications\.has-unread/);
  assert.match(inboxCss,/\.crm-topbar-notification-badge/);
  assert.match(inboxCss,/\.crm-topbar-nav-badge/);
});
test("из входящих можно создать клиента с источником",()=>{assert.match(shell,/Клиент из входящих/);assert.match(shell,/source:data.source/);assert.match(shell,/fetch\("\/api\/clients"/)});


test("shell badge scheduler preserves auth cadence, role guards and explicit refresh paths",()=>{
  assert.match(shell,/createVisibilityPolling\(pollWebsiteNotifications\)/);
  assert.doesNotMatch(shell,/setInterval\(refresh(?:UnreadCount|WebsiteNotifications),5000\)/);
  assert.match(shell,/setInterval\(verifyAuth,60_000\)/);
  assert.match(shell,/if\(!authenticated\|\|!unreadAllowed\)/);
  assert.match(shell,/unreadPolling\.current\?\.refresh\(\)/);
  assert.match(shell,/websitePolling\.current\?\.refresh\(delay\)/);
  assert.match(shell,/refreshWebsiteNotifications\(1000\)/);
  assert.match(shell,/polling\.stop\(\)/);
});

test("finance pending work is invalidated by stable auth identity/role and explicit auth boundaries",()=>{
  assert.match(shell,/import \{[^}]*\binvalidateFinanceRequests\b[^}]*\} from "\.\.\/lib\/finance-request-coordinator"/);
  assert.match(shell,/type AuthUser = \{ id:string;/);
  assert.match(shell,/const authUserId=auth\?auth\.id:null,authRole=auth\?auth\.role:null/);
  assert.doesNotMatch(shell,/useEffect\(\(\)=>\{invalidateFinanceRequests\(\)\}/);
  assert.match(shell,/if\(forceInvalidate\|\|previous\?\.id!==nextIdentity\?\.id\|\|previous\?\.role!==nextIdentity\?\.role\)invalidateFinanceRequests\(\)/);
  assert.match(shell,/applyAuth\(false,true\)/);
  assert.match(shell,/applyAuth\(x\.user\)/);
  assert.match(shell,/onSuccess=\{user=>\{authSequence\.current\+\+;applyAuth\(user,true\)/);
  assert.match(shell,/changed=\(\)=>\{invalidateFinanceRequests\(\);authSequence/);
  assert.match(shell,/const logout=async\(\)=>\{invalidateFinanceRequests\(\);authSequence/);
  assert.match(shell,/\[authenticated,unreadAllowed,authUserId,authRole\]/);
});


test("actual shell auth boundaries synchronously isolate delayed finance A from same-role B and repeat login",async()=>{
  const {default:ts}=await import('typescript');
  const {createFinanceRequestCoordinator}=await import('../lib/finance-request-coordinator.ts');
  const pending=[];
  const coordinator=createFinanceRequestCoordinator(()=>new Promise(resolve=>pending.push(resolve)));
  let invalidations=0,user=null;
  const invalidateFinanceRequests=()=>{invalidations++;coordinator.invalidate()};
  const authIdentity={current:null},authSequence={current:0};
  const declaration=shell.match(/  const applyAuth=([\s\S]*?);\r?\n  const branding=/)?.[0].replace(/\r?\n  const branding=$/,'');
  assert.ok(declaration,'shell exposes its synchronous auth application boundary');
  const code=ts.transpileModule(declaration,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const applyAuth=new Function('authIdentity','setAuth','invalidateFinanceRequests',code+';return applyAuth;')(authIdentity,next=>user=next,invalidateFinanceRequests);
  const loginBody=shell.match(/onSuccess=\{user=>\{([^}]+)\}\}/)?.[1];
  assert.ok(loginBody);
  const login=new Function('user','authSequence','applyAuth','setAuthError',loginBody);
  const logoutBody=shell.match(/const logout=async\(\)=>\{([^\n]+)\};/)?.[1];
  assert.ok(logoutBody);
  const logout=new Function('invalidateFinanceRequests','authSequence','fetch','applyAuth','setAuthError','authUi','return async()=>{'+logoutBody+'}')(invalidateFinanceRequests,authSequence,async()=>{assert.equal(invalidations,firstCount+1,'invalidate happens before logout transport');return {ok:true}},applyAuth,()=>{},{});
  const a={id:'A',role:'MANAGER'},b={id:'B',role:'MANAGER'};
  login(a,authSequence,applyAuth,()=>{});
  const firstCount=invalidations;applyAuth({...a});assert.equal(invalidations,firstCount,'same-identity verification does not invalidate');
  const old=coordinator.request('/api/finance/report','MANAGER');
  const rejected=assert.rejects(old);
  await logout();login(b,authSequence,applyAuth,()=>{});
  const fresh=coordinator.request('/api/finance/report','MANAGER');
  assert.equal(pending.length,2,'same-role B cannot attach to A pending transport');
  pending[0](new Response('A'));await rejected;
  pending[1](new Response('B'));assert.equal(await (await fresh).text(),'B');
  const beforeRepeat=invalidations;login({...b},authSequence,applyAuth,()=>{});assert.equal(invalidations,beforeRepeat+1,'same-user fresh login starts a new generation');
  applyAuth({...b,role:'ADMIN'});assert.equal(invalidations,beforeRepeat+2);
  applyAuth(false,true);assert.equal(user,false);assert.equal(invalidations,beforeRepeat+3,'401/403 clears synchronously');
});


test("both committed navigation paths invalidate financial flights across writable workspaces",()=>{
  assert.match(shell,/beforeFinanceNavigation\(sectionId,next\)/);
  assert.match(shell,/beforeFinanceNavigation\(previous\.section,next\)/);
  assert.match(shell,/key=\{`\$\{auth\.id\}-\$\{auth\.role\}-\$\{sectionId\}-\$\{routeVersion\}`\}/);
});
