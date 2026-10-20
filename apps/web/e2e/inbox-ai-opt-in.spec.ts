import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

type FixtureMessage = { id: string; conversationId: string; channel: string; content: string; direction: string; status: string; createdAt: string; metadata?: { aiRunId?: string; composerDraftKey?: string } };
const aiDraft: FixtureMessage = {
  id: 'saved-ai-draft', conversationId: 'conversation-ai-opt-in', channel: 'FACEBOOK',
  content: 'QA unsolicited saved AI reply', direction: 'OUTBOUND', status: 'DRAFT',
  createdAt: '2026-10-15T12:00:02.000Z',
  metadata: { aiRunId: 'ai-run-from-inbound', composerDraftKey: 'saved-ai-draft-key' },
};
const inbound = {
  id: 'incoming-ai-opt-in', conversationId: 'conversation-ai-opt-in', channel: 'FACEBOOK',
  content: 'QA new incoming message', direction: 'INBOUND', status: 'SENT',
  createdAt: '2026-10-15T12:00:01.000Z',
};
const manualDraft: FixtureMessage = { ...aiDraft, id: 'saved-manual-draft', content: 'QA stored manual draft', metadata: { composerDraftKey: 'saved-manual-draft-key' } };
const earlierInbound = { ...inbound, id: 'earlier-incoming', content: 'QA earlier incoming message', createdAt: '2026-10-15T12:00:00.000Z' };
const switchName = 'AI-помощник для ответа в этой переписке';
const explicitReply = { action: 'REPLY', text: '', instructions: '', clientId: 'client-ai-opt-in', messageIds: ['earlier-incoming'] };

// Same Inbox HTTP/list/detail seam as client-account-split and Mantine Inbox tests.
// Entire API is mocked. Any unexpected mutation is recorded and rejected.
async function inboxFixture(page: Page, options: {
  initialDraft?: 'manual' | 'ai'; initialInbound?: boolean; pollDraft?: 'manual' | 'ai'; secondChannel?: boolean; holdGenerate?: boolean;
} = {}) {
  let published = false, detailReads = 0;
  let releaseGenerate!: () => void;
  const generationGate = new Promise<void>(resolve => { releaseGenerate = resolve; });
  const stored = new Map<string, FixtureMessage>(), sent: FixtureMessage[] = [], unexpected: string[] = [];
  if (options.initialDraft) { const initial = options.initialDraft === 'ai' ? aiDraft : manualDraft; stored.set(initial.id, structuredClone(initial)); }
  if (options.secondChannel) stored.set('whatsapp-manual-draft', { ...manualDraft, id: 'whatsapp-manual-draft', conversationId: 'conversation-whatsapp-opt-in', channel: 'WHATSAPP', content: 'QA stored WhatsApp manual draft', metadata: { composerDraftKey: 'whatsapp-manual-key' } });
  const writes: { method: string; path: string; body: unknown }[] = [];
  const client = () => ({
    id: 'client-ai-opt-in', displayName: 'QA opt-in client', status: 'ACTIVE',
    source: 'FACEBOOK', preferredChannel: 'FACEBOOK', waitingForReply: published,
    orders: [], buyerSummary: { purchaseCount: 0, paymentTotals: [] }, linkedChannels: options.secondChannel ? ['FACEBOOK', 'WHATSAPP'] : ['FACEBOOK'],
    conversations: [{ id: 'conversation-ai-opt-in', channel: 'FACEBOOK',
      lastMessageAt: published ? inbound.createdAt : '2026-10-15T12:00:00.000Z',
      unreadCount: 0, unreadVersion: 0, messages: published ? [inbound] : options.initialInbound ? [earlierInbound] : [] },
      ...(options.secondChannel ? [{ id: 'conversation-whatsapp-opt-in', channel: 'WHATSAPP', lastMessageAt: '2026-10-15T11:00:00.000Z', unreadCount: 0, unreadVersion: 0, messages: [] }] : [])],
  });
  await page.route('**/api/**', async route => {
    const request = route.request(), p = new URL(request.url()).pathname, method = request.method();
    if (method !== 'GET') {
      const body = request.postDataJSON(); writes.push({ method, path: p, body });
      if (method === 'POST' && p === '/api/ai-assistant/generate') {
        if (options.holdGenerate) await generationGate;
        return route.fulfill({ json: { text: 'QA explicit AI reply returned', aiRunId: 'ai-explicit-run', targetLanguage: 'en' } });
      }
      if (method === 'PUT' && p.startsWith('/api/communications/client-ai-opt-in/drafts/')) {
        const key = decodeURIComponent(p.split('/').at(-1)!);
        const previous = [...stored.values()].find(draft => draft.metadata?.composerDraftKey === key);
        const draft: FixtureMessage = { id: previous?.id ?? 'local-manual-draft', conversationId: 'conversation-ai-opt-in', content: body.content, channel: body.channel,
          direction: 'OUTBOUND', status: 'DRAFT', createdAt: new Date().toISOString(), metadata: { composerDraftKey: key, ...(body.aiRunId ? { aiRunId: body.aiRunId } : {}) } };
        stored.set(draft.id, draft); return route.fulfill({ json: draft });
      }
      if (method === 'POST' && p === '/api/communications/client-ai-opt-in/messages' && body.action === 'SEND') {
        const message = { ...inbound, id: 'sent-manual-message', content: body.content, channel: body.channel, direction: 'OUTBOUND', metadata: body.aiRunId ? { aiRunId: body.aiRunId } : undefined };
        sent.push(message); if (body.draftMessageId) stored.delete(body.draftMessageId);
        return route.fulfill({ json: message });
      }
      unexpected.push(`${method} ${p}`);
      return route.fulfill({ status: 405, json: { message: 'Unexpected fixture mutation' } });
    }
    if (p === '/api/auth/me') return route.fulfill({ json: { user: { role: 'OWNER', displayName: 'QA operator', email: 'qa@example.test' } } });
    if (p === '/api/branding') return route.fulfill({ json: {} });
    if (p === '/api/communications/unread-count') return route.fulfill({ json: { unreadCount: 0 } });
    if (p === '/api/communications/templates') return route.fulfill({ json: [] });
    if (p === '/api/communications') return route.fulfill({ json: {
      items: [client()], total: 1, hasMore: false,
      scopeCounts: { all: 1, unread: 0, waiting: published ? 1 : 0 },
      channelCounts: { FACEBOOK: 1, INSTAGRAM: 0, WHATSAPP: 0, CHATWOOT: 0, EMAIL: 0 },
    } });
    if (p === '/api/communications/client-ai-opt-in') {
      detailReads++; return route.fulfill({ json: { messages: [...(options.initialInbound ? [earlierInbound] : []), ...(published ? [inbound] : []), ...stored.values(), ...sent] } });
    }
    if (p === '/api/clients/client-ai-opt-in') return route.fulfill({ json: { id: 'client-ai-opt-in', displayName: 'QA opt-in client', athletes: [], workTasks: [] } });
    if (p === '/api/ai-assistant/clients/client-ai-opt-in/summaries') return route.fulfill({ json: { firstMessageDate: '2026-10-15', items: [] } });
    unexpected.push(`GET ${p}`); return route.fulfill({ status: 501, json: { message: `Unexpected fixture GET: ${p}` } });
  });
  return { writes, unexpected, releaseGenerate, reads: () => detailReads, publish: () => { published = true; const draft = options.pollDraft === 'manual' ? manualDraft : aiDraft; stored.set(draft.id, structuredClone(draft)); } };
}

async function openInbox(page: Page) {
  const initialDetail = page.waitForResponse(response => new URL(response.url()).pathname === '/api/communications/client-ai-opt-in');
  await page.goto('/?section=inbox'); await initialDetail;
  await expect(page.locator('.communications-chat-client')).toContainText('QA opt-in client', { timeout: 30000 });
  await expect(page.locator('.communications-compose textarea')).toBeEnabled();
}
async function storedMessages(page: Page): Promise<FixtureMessage[]> {
  // Browser fetch stays inside the mocked page-route boundary; APIRequestContext would bypass it.
  return page.evaluate(async () => (await (await fetch('/api/communications/client-ai-opt-in')).json()).messages);
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  const filename = process.env.INBOX_AI_SCREEN_DIR ? join(process.env.INBOX_AI_SCREEN_DIR, name) : info.outputPath(name);
  mkdirSync(dirname(filename), { recursive: true }); await page.screenshot({ path: filename, fullPage: false });
}
const generateCalls = (writes: { path: string; body: unknown }[]) => writes.filter(w => w.path === '/api/ai-assistant/generate');
async function setAi(page: Page, checked: boolean) {
  const toggle = page.getByRole('switch', { name: switchName, exact: true });
  if (await toggle.isChecked() !== checked) { await toggle.focus(); await toggle.press('Space'); }
  if (checked) await expect(toggle).toBeChecked(); else await expect(toggle).not.toBeChecked();
}

test('new inbound polling never restores a saved AI draft into the composer while AI is off', async ({ page }) => {
  const state = await inboxFixture(page);
  const initialDetail = page.waitForResponse(response => new URL(response.url()).pathname === '/api/communications/client-ai-opt-in');
  await page.goto('/?section=inbox');
  await initialDetail;
  await expect(page.locator('.communications-chat-client')).toContainText('QA opt-in client', { timeout: 30000 });
  const composer = page.locator('.communications-compose textarea');
  const panel = page.getByRole('button', { name: /Предложение ответа от AI/ });
  await expect(composer).toHaveValue('');
  await expect(panel).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#communications-ai-panel-body')).toHaveCount(0);
  expect(state.reads()).toBeGreaterThanOrEqual(1);
  state.publish();
  const polled = page.waitForResponse(response => new URL(response.url()).pathname === '/api/communications/client-ai-opt-in');
  const detail = await (await polled).json();
  await expect(page.locator('.communications-message-content').filter({ hasText: inbound.content })).toBeVisible();
  expect(detail.messages).toContainEqual(aiDraft);
  expect(state.writes.filter(w => w.path === '/api/ai-assistant/generate')).toEqual([]);
  expect(state.writes).toEqual([]); // No deletion, overwrite, autosave or send of the stored AI draft.
  expect(state.unexpected).toEqual([]);
  await expect(panel).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#communications-ai-panel-body')).toHaveCount(0);
  await expect(composer, 'AI off must keep the empty composer unchanged after new inbound polling').toHaveValue('');
});

test('an unclassified manual server draft arriving after open also cannot fill an empty composer through polling', async ({ page }) => {
  const state = await inboxFixture(page, { pollDraft: 'manual' }); await openInbox(page);
  const composer = page.locator('.communications-compose textarea'); await expect(composer).toHaveValue('');
  state.publish(); const polled = page.waitForResponse(r => new URL(r.url()).pathname === '/api/communications/client-ai-opt-in');
  await polled; await expect(page.locator('.communications-message-content').filter({ hasText: inbound.content })).toBeVisible();
  await expect(composer).toHaveValue('');
  expect(await storedMessages(page)).toContainEqual(manualDraft);
  expect(state.writes).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('new inbound polling preserves typed manual text and the separate stored AI draft', async ({ page }) => {
  const state = await inboxFixture(page); await openInbox(page);
  const composer = page.locator('.communications-compose textarea'); await composer.fill('QA operator keeps this text');
  state.publish(); const polled = page.waitForResponse(r => new URL(r.url()).pathname === '/api/communications/client-ai-opt-in');
  await polled; await expect(page.locator('.communications-message-content').filter({ hasText: inbound.content })).toBeVisible();
  await expect(composer).toHaveValue('QA operator keeps this text');
  await expect.poll(() => state.writes.filter(w => w.method === 'PUT').length).toBe(1);
  const puts = state.writes.filter(w => w.method === 'PUT');
  expect(puts.map(w => w.body)).toEqual([{ content: 'QA operator keeps this text', channel: 'FACEBOOK' }]);
  expect(await storedMessages(page)).toContainEqual(aiDraft);
  expect(generateCalls(state.writes)).toEqual([]); expect(state.unexpected).toEqual([]);
});

for (const kind of ['manual', 'ai'] as const) test(`initial ${kind} draft restores and sends manually with its existing provenance`, async ({ page }) => {
  const draft = kind === 'ai' ? aiDraft : manualDraft;
  const state = await inboxFixture(page, { initialDraft: kind, secondChannel: true }); await openInbox(page);
  const composer = page.locator('.communications-compose textarea'); await expect(composer).toHaveValue(draft.content);
  const channels = page.locator('.communications-chat-header select');
  await channels.selectOption('WHATSAPP'); await expect(composer).toHaveValue('QA stored WhatsApp manual draft');
  await channels.selectOption('FACEBOOK'); await expect(composer).toHaveValue(draft.content);
  await expect(page.getByRole('switch', { name: switchName, exact: true })).not.toBeChecked();
  await page.locator('.communications-compose').getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(composer).toHaveValue('');
  const sends = state.writes.filter(w => w.path === '/api/communications/client-ai-opt-in/messages'); expect(sends).toHaveLength(1);
  expect(sends[0]!.body).toMatchObject({ action: 'SEND', content: draft.content, channel: 'FACEBOOK', draftMessageId: draft.id, clientRequestId: expect.any(String) });
  if (kind === 'ai') expect(sends[0]!.body).toHaveProperty('aiRunId', 'ai-run-from-inbound');
  else expect(sends[0]!.body).not.toHaveProperty('aiRunId');
  expect(generateCalls(state.writes)).toEqual([]); expect(state.unexpected).toEqual([]);
});

for (const width of [1366, 390]) test(`AI Switch defaults off and stays synchronized with the existing panel toggle at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  const state = await inboxFixture(page, { initialInbound: true }); await openInbox(page);
  const toggle = page.getByRole('switch', { name: switchName, exact: true });
  const oldToggle = page.getByRole('button', { name: /Предложение ответа от AI/ });
  await expect(toggle).not.toBeChecked(); await expect(oldToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#communications-ai-panel-body')).toHaveCount(0);
  await toggle.scrollIntoViewIfNeeded(); await screenshot(page, info, `inbox-ai-off-${width}.png`);
  await setAi(page, true); await expect(oldToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#communications-ai-panel-body')).toBeVisible();
  await expect(page.getByText('Генерация ответа — только по нажатию кнопки. Новые сообщения её не запускают.', { exact: true })).toBeVisible();
  await screenshot(page, info, `inbox-ai-on-${width}.png`);
  expect(generateCalls(state.writes)).toEqual([]);
  await oldToggle.click(); await expect(toggle).not.toBeChecked();
  await oldToggle.click(); await expect(toggle).toBeChecked();
  await setAi(page, false); await expect(oldToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.communications-compose textarea')).toHaveValue('');
  expect(state.writes).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('enabling AI and selecting a message never generates until the explicit REPLY button', async ({ page }) => {
  const state = await inboxFixture(page, { initialInbound: true }); await openInbox(page);
  await setAi(page, true);
  await page.getByRole('button', { name: /Ответ AI$/ }).click();
  await page.getByRole('checkbox', { name: 'Выбрать входящее сообщение для ответа', exact: true }).check();
  expect(generateCalls(state.writes)).toEqual([]);
  await page.getByRole('button', { name: /Сформировать ответ на русском$/ }).click();
  await expect(page.getByRole('textbox', { name: 'AI-черновик на русском', exact: true })).toHaveValue('QA explicit AI reply returned');
  expect(generateCalls(state.writes).map(w => w.body)).toEqual([explicitReply]);
  await expect(page.locator('.communications-compose textarea')).toHaveValue('');
  expect(state.writes).toHaveLength(1); expect(state.unexpected).toEqual([]);
});

test('OFF invalidates an in-flight explicit reply and reopening cannot reveal its late result or overwrite manual text', async ({ page }) => {
  const state = await inboxFixture(page, { initialInbound: true, holdGenerate: true });
  try {
    await openInbox(page); const composer = page.locator('.communications-compose textarea');
    await composer.fill('QA manual text survives turning AI off');
    await setAi(page, true);
    await page.getByRole('button', { name: /Ответ AI$/ }).click();
    await page.getByRole('checkbox', { name: 'Выбрать входящее сообщение для ответа', exact: true }).check();
    await page.getByRole('button', { name: /Сформировать ответ на русском$/ }).click();
    await expect.poll(() => generateCalls(state.writes).length).toBe(1);
    await setAi(page, false); await expect(page.locator('#communications-ai-panel-body')).toHaveCount(0);
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/ai-assistant/generate');
    state.releaseGenerate(); await (await response).finished();
    // Flush the response's React rendering before reopening, without sleeps/fake clock.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await setAi(page, true);
    await expect(page.getByRole('textbox', { name: 'AI-черновик на русском', exact: true })).toHaveCount(0);
    await expect(page.getByText('QA explicit AI reply returned', { exact: true })).toHaveCount(0);
    await expect(composer).toHaveValue('QA manual text survives turning AI off');
    expect(generateCalls(state.writes).map(w => w.body)).toEqual([explicitReply]);
    expect(state.writes.filter(w => w.path.endsWith('/messages'))).toEqual([]); expect(state.unexpected).toEqual([]);
  } finally { state.releaseGenerate(); }
});
