import test from 'node:test';
import assert from 'node:assert/strict';
import * as navigation from '../lib/crm-sections.ts';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const inbox = readFileSync(new URL('../components/communications-workspace.tsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../components/crm-shell.tsx', import.meta.url), 'utf8');

test('common header exposes Clients exactly once with existing icon, localization and active state', () => {
  const declarations = shell.match(/const items=[\s\S]*?const topbarItems = [^;]+;/)?.[0];
  assert.ok(declarations);
  const compiled = ts.transpileModule(declarations, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const entries = new Function('navigationUi', compiled + ';return topbarItems;')({ clients: 'Клиенты' });
  assert.deepEqual(entries.map(item => item[0]), ['overview', 'inbox', 'clients', 'orders', 'production', 'finance', 'tasks', 'settings']);
  assert.equal(entries.filter(item => item[0] === 'clients').length, 1);
  assert.equal(entries.find(item => item[0] === 'clients')[1], 'Клиенты');
  assert.match(shell, /<CrmNavIcon section=\{id\}/);
  assert.match(shell, /aria-current=\{sectionId===id\?"page":undefined\}/);
});

test('Clients return accepts only the relative CRM Clients screen and restores its filters', () => {
  const href = '/?section=clients&clientId=before-merge&search=Anna&country=UA&source=INSTAGRAM&status=ACTIVE&page=3&pageSize=50&sort=orders&direction=desc&tab=orders';
  assert.equal(navigation.validateClientsReturnHref(href), href);
  assert.equal(navigation.validateClientsReturnHref('?section=clients&page=2'), '/?section=clients&page=2');
  for (const value of [undefined, '', '//evil.test/?section=clients', 'https://crm.yoleotard.com/?section=clients', 'javascript:alert(1)', '/orders?section=clients', '/?section=inbox', '/?section=clients&section=inbox', '/\\evil.test/?section=clients', '/%2f%2fevil.test?section=clients', '/?section=clients\n', '/?section=clients#//evil.test']) {
    assert.equal(navigation.validateClientsReturnHref(value), undefined, String(value));
  }
});

test('Inbox returns to selected canonical client with Clients filters and the exact active conversation', () => {
  const clientsReturn = '/?section=clients&clientId=old&search=Анна&country=UA&source=INSTAGRAM&status=ACTIVE&page=3&pageSize=50&sort=orders&direction=desc&tab=orders&orderId=foreign&action=new-order&conversationId=stale&clientsReturn=nested';
  const search = '?' + new URLSearchParams({ section: 'inbox', clientId: 'old', clientsReturn });
  const context = navigation.createInboxClientContext(search, 'canonical', 'conversation-2', 'WHATSAPP');
  assert.deepEqual(context, { search: 'Анна', country: 'UA', source: 'INSTAGRAM', status: 'ACTIVE', page: '3', pageSize: '50', sort: 'orders', direction: 'desc', tab: 'orders', clientId: 'canonical', returnConversationId: 'conversation-2', returnChannel: 'WHATSAPP' });
  const params = new URL(navigation.createCrmNavigationHref('clients', search, context), 'https://crm.test').searchParams;
  assert.equal(params.get('clientId'), 'canonical');
  assert.equal(params.get('returnConversationId'), 'conversation-2');
  assert.equal(params.get('returnChannel'), 'WHATSAPP');
  for (const key of ['clientsReturn', 'conversationId', 'channel', 'orderId', 'action']) assert.equal(params.has(key), false, key);
});

test('Clients currency survives Inbox roundtrip for EUR, USD and UAH without using unrelated Inbox filters', () => {
  for (const currency of ['EUR', 'USD', 'UAH']) {
    const clientsReturn = '/?' + new URLSearchParams({ section: 'clients', clientId: 'old', currency, page: '3', search: 'Anna' });
    const inboxHref = navigation.createCrmNavigationHref('inbox', '', { clientId: 'canonical', conversationId: 'exact', channel: 'EMAIL', clientsReturn });
    const inboxSearch = new URL(inboxHref, 'https://crm.test').search;
    const context = navigation.createInboxClientContext(inboxSearch + '&currency=unrelated', 'canonical', 'exact', 'EMAIL');
    const result = new URL(navigation.createCrmNavigationHref('clients', inboxSearch, context), 'https://crm.test').searchParams;
    assert.equal(result.get('currency'), currency);
    assert.equal(result.get('clientId'), 'canonical');
    assert.equal(result.get('page'), '3');
    assert.equal(result.get('returnConversationId'), 'exact');
    assert.equal(result.get('returnChannel'), 'EMAIL');
    const plainInbox = navigation.createInboxClientContext('?section=inbox&currency=' + currency, 'canonical');
    assert.equal(Object.hasOwn(plainInbox, 'currency'), false);
  }
});

test('ordinary Inbox and invalid return locations select the current client without inventing a dialogue', () => {
  assert.deepEqual(navigation.createInboxClientContext('?section=inbox', 'canonical', 'exact', 'EMAIL'), { clientId: 'canonical', returnConversationId: 'exact', returnChannel: 'EMAIL' });
  assert.deepEqual(navigation.createInboxClientContext('?clientsReturn=https%3A%2F%2Fevil.test%2F%3Fsection%3Dclients', 'canonical'), { clientId: 'canonical' });
  assert.deepEqual(navigation.createInboxClientContext('', 'canonical', 'exact'), { clientId: 'canonical' });
});

test('Clients → Inbox → Clients → Inbox preserves filters and targets the same exact dialogue', () => {
  const initial = '?section=clients&clientId=c&search=Anna%26Maria&page=3&pageSize=50&country=UA';
  const toInbox = navigation.createCrmNavigationHref('inbox', initial, { clientId: 'c', conversationId: 'dialogue', channel: 'INSTAGRAM', clientsReturn: '/' + initial });
  const backContext = navigation.createInboxClientContext(new URL(toInbox, 'https://crm.test').search, 'c', 'dialogue', 'INSTAGRAM');
  const back = navigation.createCrmNavigationHref('clients', new URL(toInbox, 'https://crm.test').search, backContext);
  const clients = new URL(back, 'https://crm.test');
  assert.equal(clients.searchParams.get('search'), 'Anna&Maria');
  assert.equal(clients.searchParams.get('page'), '3');
  assert.equal(clients.searchParams.get('pageSize'), '50');
  assert.equal(clients.searchParams.get('country'), 'UA');
  const again = navigation.createCrmNavigationHref('inbox', clients.search, { clientId: clients.searchParams.get('clientId'), conversationId: clients.searchParams.get('returnConversationId'), channel: clients.searchParams.get('returnChannel'), clientsReturn: back });
  const inbox = new URL(again, 'https://crm.test').searchParams;
  assert.equal(inbox.get('clientId'), 'c');
  assert.equal(inbox.get('conversationId'), 'dialogue');
  assert.equal(inbox.get('channel'), 'INSTAGRAM');
  assert.equal(inbox.has('returnConversationId'), false);
  assert.equal(inbox.has('returnChannel'), false);
});

test('roundtrip keys are destination-scoped and cannot leak into other screens', () => {
  const context = { clientId: 'canonical', conversationId: 'exact', channel: 'EMAIL', clientsReturn: '/?section=clients&page=2', returnConversationId: 'old', returnChannel: 'WHATSAPP' };
  const current = '?section=clients&clientsReturn=old&returnConversationId=stale&returnChannel=EMAIL&theme=light';
  const inbox = new URL(navigation.createCrmNavigationHref('inbox', current, context), 'https://crm.test').searchParams;
  assert.equal(inbox.get('clientsReturn'), '/?section=clients&page=2');
  assert.equal(inbox.get('returnConversationId'), null);
  assert.equal(inbox.get('returnChannel'), null);
  for (const section of ['orders', 'production', 'finance', 'tasks', 'overview']) {
    const params = new URL(navigation.createCrmNavigationHref(section, current, context), 'https://crm.test').searchParams;
    for (const key of ['clientsReturn', 'returnConversationId', 'returnChannel']) assert.equal(params.has(key), false, `${section}:${key}`);
    assert.equal(params.get('theme'), 'light');
  }
  const invalid = new URL(navigation.createCrmNavigationHref('inbox', '', { clientsReturn: '//evil.test/?section=clients' }), 'https://crm.test');
  assert.equal(invalid.searchParams.has('clientsReturn'), false);
});

test('shell forwards Clients destination and context; Inbox client actions share the guarded return path', () => {
  assert.match(shell, /<ClientWorkspace onNavigate=\{\(next:\s*"orders"\s*\|\s*"inbox",\s*context\?:Record<string,string>\)=>void navigate\(next,context\)\}/);
  assert.match(inbox, /className="communications-open-client" onClick=\{openClientFromInbox\}/);
  assert.match(inbox, /onClick=\{openClientFromInbox\}>⌁ \{ui\.measurementsShortcut\}/);
  assert.match(inbox, /detail\.id!==context\.id\|\|detail\.clientId!==c\.id\|\|detail\.channel!==context\.channel\|\|detail\.archivedAt/);
  assert.match(inbox, /if\(!context\.id\|\|!context\.channel\|\|!c\.conversations\.some/);
  assert.match(shell, /if\(!saved\|\|sequence!==routeSequence\.current\)return/);
});

test('real Inbox client action waits for draft persistence, uses active conversation, and never sends a message', async () => {
  const navigateBody = inbox.match(/  async function navigateFromInbox\([\s\S]*?\r?\n  }/)?.[0];
  const openBody = inbox.match(/  function openClientFromInbox\([\s\S]*?\r?\n  }/)?.[0];
  assert.ok(navigateBody && openBody, 'Inbox exposes the guarded client navigation action');
  const source = ts.transpileModule(navigateBody + '\n' + openBody, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = [], errors = [], sequence = [];
  let resolveSave;
  const client = { id: 'canonical', conversations: [{ id: 'facebook', channel: 'FACEBOOK' }, { id: 'email-exact', channel: 'EMAIL' }] };
  const run = new Function('navigate', 'flushComposerDraftBeforeNavigation', 'setError', 'ui', 'client', 'activeChannel', 'createInboxClientContext', 'window', source + ';return openClientFromInbox;');
  const open = run((...args) => { sequence.push('navigate'); calls.push(args); }, () => { sequence.push('save'); return new Promise(resolve => { resolveSave = resolve; }); }, value => errors.push(value), { draftAutosaveFailed: 'save failed' }, client, 'EMAIL', navigation.createInboxClientContext, { location: { search: '?section=inbox&clientsReturn=%2F%3Fsection%3Dclients%26page%3D4' } });
  open();
  assert.deepEqual(sequence, ['save']);
  assert.equal(calls.length, 0);
  resolveSave(false);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(errors, ['save failed']);
  assert.equal(calls.length, 0);
  open();
  resolveSave(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [['clients', { page: '4', clientId: 'canonical', returnConversationId: 'email-exact', returnChannel: 'EMAIL' }]]);
  assert.doesNotMatch(source, /\b(?:fetch|sendMessage|send)\s*\(/);
});
