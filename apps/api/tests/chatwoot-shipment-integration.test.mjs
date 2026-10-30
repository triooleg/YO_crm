import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTargetModule } from './website-test-loader.mjs';

const { CommunicationsService } = loadTargetModule('communications/communications.service.ts');
const { normalizeChatwootWebhook } = loadTargetModule('communications/chatwoot-webhook.ts');
const { clearChatwootShipmentProofs } = loadTargetModule('communications/chatwoot-shipment-capability.ts');
const { encryptSecret } = loadTargetModule('secret-box.ts');
const token = 'synthetic-chatwoot-proof-token';
const origin = 'https://chatwoot.example.test';

function normalizedMessage({ providerId = 42, inboxId = 7, accountId = 2,
  channelType = 'Channel::WebWidget', createdAt = 1793095200 } = {}) {
  const events = normalizeChatwootWebhook({
    event: 'message_created', message_type: 'incoming', id: createdAt,
    content: 'Synthetic website question', created_at: createdAt,
    sender: { id: 9, name: 'Synthetic client' }, account: { id: accountId },
    inbox: { id: inboxId, channel_type: channelType },
    conversation: { id: providerId, account_id: accountId, inbox_id: inboxId,
      contact_inbox: { source_id: 'website-contact-9' } },
  });
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.channel, 'CHATWOOT');
  // Supply the Message projection persisted for a normalized inbound event by
  // CommunicationsService.persistInbound. This test exercises the real normalizer,
  // service capability method, settings decryption, route resolver and HTTP proof;
  // inbound persistence itself is outside this read-only capability seam.
  return { direction: event.direction, createdAt: event.receivedAt, receivedAt: event.receivedAt,
    metadata: { ...event.metadata, source: 'CHATWOOT', accountId: event.accountId, inboxId: event.inboxId } };
}

function fixture(t) {
  const previousKey = process.env.SETTINGS_ENCRYPTION_KEY, previousFetch = globalThis.fetch;
  process.env.SETTINGS_ENCRYPTION_KEY = 'synthetic-chatwoot-integration-encryption-key';
  clearChatwootShipmentProofs();
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = previousKey;
    clearChatwootShipmentProofs();
  });
  const conversation = { id: 'local-chat', clientId: 'client-1', channel: 'CHATWOOT',
    archivedAt: null, externalId: 'website-contact-9' };
  const messages = [normalizedMessage()], queries = [], http = [], attempts = [];
  const settings = Object.entries({ enabled: true, baseUrl: origin, accountId: '2', inboxId: '7',
    accessTokenEncrypted: encryptSecret(token) }).map(([key, value]) => ({ section: 'integration.chatwoot', key, value }));
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => value === undefined || row[key] === value);
  const view = query => {
    queries.push(structuredClone(query));
    if (!matches(conversation, query.where)) return null;
    const options = query.select?.messages || query.include?.messages;
    const rows = messages.filter(m => matches(m, options?.where)).sort((a, b) =>
      options?.orderBy?.createdAt === 'asc' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt);
    const selectedMessages = options ? rows.slice(0, options.take).map(row => options.select
      ? Object.fromEntries(Object.entries(options.select).filter(([, selected]) => selected).map(([key]) => [key, row[key]]))
      : row) : undefined;
    const result = { ...conversation, ...(options ? { messages: selectedMessages } : {}) };
    return structuredClone(query.select
      ? Object.fromEntries(Object.entries(query.select).filter(([, selected]) => selected).map(([key]) => [key, result[key]]))
      : result);
  };
  let inTransaction = false;
  const db = {
    conversation: { findFirst: async query => view(query), findUnique: async query => view(query) },
    appSetting: { findMany: async ({ where }) => structuredClone(settings.filter(row => matches(row, where))) },
    client: { findFirst: async ({ where }) => where.id === conversation.clientId ? { id: 'client-1', source: 'CHATWOOT', preferredChannel: 'CHATWOOT', email: null } : null },
    messageDeliveryAttempt: {
      findUnique: async () => null, findFirst: async () => null,
      create: async ({ data }) => { attempts.push(structuredClone(data)); throw new Error('unexpected reservation'); },
    },
    $executeRaw: async () => 1,
    $transaction: async callback => { inTransaction = true; try { return await callback(db); } finally { inTransaction = false; } },
  };
  const inboxTypes = new Map([['7', 'Channel::WebWidget'], ['8', 'Channel::Api']]);
  const providerInboxes = new Map([['42', '7'], ['99', '8']]);
  globalThis.fetch = async (url, init) => {
    assert.equal(inTransaction, false, 'capability must not perform HTTP while a transaction owns the send lock');
    const request = { url: String(url), method: init?.method || 'GET', headers: { ...init?.headers }, redirect: init?.redirect };
    http.push(request);
    assert.equal(request.method, 'GET', 'proof must never send a customer message');
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers.api_access_token, token);
    const match = request.url.match(/^https:\/\/chatwoot\.example\.test\/api\/v1\/accounts\/2\/(conversations|inboxes)\/(\d+)$/);
    assert.ok(match, `unexpected provider request ${request.url}`);
    const [, resource, id] = match;
    const body = resource === 'conversations' ? { id: Number(id), account_id: 2, inbox_id: Number(providerInboxes.get(id)) }
      : { id: Number(id), channel_type: inboxTypes.get(id) };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const service = new CommunicationsService(db, {});
  return { service, db, conversation, messages, queries, http, settings, attempts,
    available: (allowLookup = true, expected) => service.shipmentChatwootAvailable('client-1', 'local-chat', 'website-contact-9', allowLookup, expected),
  };
}

test('actual Chatwoot capability proves normalized WebWidget metadata with authenticated conversation/inbox GETs and reuses cache in transaction', async t => {
  const h = fixture(t);
  assert.equal(h.messages[0].metadata.source, 'CHATWOOT');
  assert.equal(h.messages[0].metadata.accountId, '2');
  assert.equal(h.messages[0].metadata.inboxId, '7');
  assert.equal(h.messages[0].metadata.chatwootConversationId, '42');
  assert.equal(h.messages[0].metadata.chatwootChannel, undefined, 'historical normalizer does not persist channel type');
  assert.equal(await h.available(), true);
  assert.deepEqual(h.http.map(r => r.url), [
    `${origin}/api/v1/accounts/2/conversations/42`, `${origin}/api/v1/accounts/2/inboxes/7`,
  ]);
  assert.equal(await h.db.$transaction(() => h.available(false, '42')), true);
  assert.equal(await h.db.$transaction(() => h.available(false, '99')), false);
  assert.equal(h.http.length, 2);
  assert.equal(h.attempts.length, 0);
});

test('latest outbound sender route cannot borrow proof from an older trusted WebWidget route', async t => {
  const h = fixture(t);
  assert.equal(await h.available(), true);
  h.messages.push({ direction: 'OUTBOUND', createdAt: new Date('2026-10-28T12:00:00Z'),
    metadata: { source: 'CRM', provider: 'CHATWOOT', chatwootConversationId: '99' } });
  assert.equal(await h.available(), false);
  assert.equal(await h.db.$transaction(() => h.available(false, '99')), false);
  assert.equal(h.http.length, 2, 'untrusted new route must not reuse or refresh the old route proof');
  assert.equal(h.attempts.length, 0);
});

test('new API route cannot reuse the cached proof of an older WebWidget provider conversation', async t => {
  const h = fixture(t);
  assert.equal(await h.available(), true);
  h.settings.find(s => s.key === 'inboxId').value = '8';
  h.messages.push(normalizedMessage({ providerId: 99, inboxId: 8, channelType: 'Channel::Api', createdAt: 1793196000 }));
  assert.equal(await h.db.$transaction(() => h.available(false, '99')), false);
  assert.equal(h.http.length, 2, 'cache miss in transaction must not cause HTTP');
  assert.equal(await h.available(), false);
  assert.deepEqual(h.http.slice(2).map(r => r.url), [
    `${origin}/api/v1/accounts/2/conversations/99`, `${origin}/api/v1/accounts/2/inboxes/8`,
  ]);
});

test('same provider route remains provable after a CRM outbound message without trusted account/inbox metadata', async t => {
  const h = fixture(t);
  h.messages.push({ direction: 'OUTBOUND', createdAt: new Date('2026-10-28T12:00:00Z'),
    metadata: { source: 'CRM', chatwootConversationId: '42' } });
  assert.equal(await h.available(), true, 'matching older inbound provenance may prove the route actually selected by the sender');
  assert.equal(h.http.length, 2);
});

for (const [label, patch] of [
  ['wrong account', { accountId: '9' }], ['wrong inbox', { inboxId: '9' }], ['untrusted source', { source: 'CRM' }],
]) test(`actual Chatwoot method rejects normalized provenance with ${label}`, async t => {
  const h = fixture(t); Object.assign(h.messages[0].metadata, patch);
  assert.equal(await h.available(), false);
  assert.equal(h.http.length + h.attempts.length, 0);
});

test('sender refuses an unproved changed provider route before reserving an attempt, without HTTP in transaction', async t => {
  const h = fixture(t);
  assert.equal(await h.available(), true);
  h.messages.push({ direction: 'OUTBOUND', createdAt: new Date('2026-10-28T12:00:00Z'),
    metadata: { source: 'CRM', chatwootConversationId: '99' } });
  await assert.rejects(h.service.sendShipmentChat('client-1', {
    conversationId: 'local-chat', externalId: 'website-contact-9', channel: 'CHATWOOT', content: 'Synthetic tracking notification',
    clientRequestId: '11111111-1111-4111-8111-111111111111',
  }, { id: 'manager-1', role: 'MANAGER' }), error => error.getStatus?.() === 409);
  assert.equal(h.attempts.length, 0);
  assert.equal(h.http.length, 2);
});
