import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

// Execute production TS, including link validation/language normalization. No
// Nest application, generated JS, network client, SMTP server or live DB starts.
const require = createRequire(import.meta.url);
const modules = new Map();
function load(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  const exports = {};
  modules.set(url.href, exports);
  const code = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    experimentalDecorators: true, emitDecoratorMetadata: false,
  } }).outputText;
  vm.runInNewContext(code, { exports, URL, Date, console, require(name) {
    if (/\/(prisma|communications|email-transport)\.service$/.test(name)) return {};
    return name.startsWith('.') ? load(new URL(`${name}.ts`, url)) : require(name);
  } }, { filename: url.pathname });
  return exports;
}
const { ShipmentNotificationService } = load(new URL('../src/shipping/shipment-notification.service.ts', import.meta.url));
const actor = { id: 'manager-1', role: 'MANAGER' };
const scope = { clientId: 'client-1', conversationId: 'chat-1', channel: 'FACEBOOK' };
const selection = { ...scope, orderId: 'order-1', shipmentId: 'parcel-1' };
const copy = value => structuredClone(value);
const sorted = value => JSON.parse(JSON.stringify(value)); // VM realm-neutral assertions
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Deliberately interpret filters rather than returning canned query results:
// missing ownership/archive predicates must change observable test outcomes.
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === 'AND') return [].concat(value).every(w => matches(row, w));
    if (key === 'OR') return value.some(w => matches(row, w));
    if (key === 'NOT') return !matches(row, value);
    if (key === 'shipmentId_trackingRevision') return matches(row, value);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
      if ('path' in value) return value.path.reduce((a, k) => a?.[k], row[key]) === value.equals;
      return row[key] != null && matches(row[key], value);
    }
    return row[key]?.valueOf() === value?.valueOf();
  });
}

function fixture() {
  const now = new Date();
  const state = {
    clients: [{ id: 'client-1', archivedAt: null, email: 'profile@example.test', language: 'en' },
      { id: 'client-2', archivedAt: null, email: 'other@example.test', language: 'ru' }],
    conversations: [{ id: 'chat-1', clientId: 'client-1', archivedAt: null, channel: 'FACEBOOK', externalId: 'page-1:recipient-1' },
      { id: 'chat-2', clientId: 'client-2', archivedAt: null, channel: 'FACEBOOK', externalId: 'page-1:recipient-2' }],
    orders: [{ id: 'order-1', number: 'YO-100', clientId: 'client-1', archivedAt: null, deliveryEmail: 'order@example.test', salesStatus: 'COMPLETED', createdAt: now },
      { id: 'order-2', number: 'YO-101', clientId: 'client-1', archivedAt: null, deliveryEmail: null, salesStatus: 'NEW', createdAt: now },
      { id: 'order-other', number: 'YO-999', clientId: 'client-2', archivedAt: null, deliveryEmail: 'other@example.test', createdAt: now },
      { id: 'order-archived', number: 'YO-OLD', clientId: 'client-1', archivedAt: now, deliveryEmail: null, createdAt: now }],
    parcels: [
      ['parcel-1', 'order-1', null, 'PC0000020000072054NPG'],
      ['parcel-2', 'order-1', null, 'PC0000020000072055NPG'],
      ['parcel-3', 'order-2', null, 'PC0000020000072056NPG'],
      ['parcel-other', 'order-other', null, 'OTHER123'],
      ['parcel-archived', 'order-1', now, 'ARCHIVED123'],
      ['parcel-old-order', 'order-archived', null, 'OLD123'],
      ['parcel-empty', 'order-2', null, null],
      ['parcel-invalid', 'order-2', null, 'bad number'],
    ].map(([id, orderId, archivedAt, trackingNumber]) => ({ id, orderId, archivedAt, trackingNumber,
      carrier: 'NOVA_GLOBAL', trackingUrl: null, trackingRevision: 1, createdAt: now })),
    legacyShipments: [],
    messages: [{ conversationId: 'chat-1', direction: 'INBOUND', metadata: { receiverId: 'page-1', accountId: 'page-1' }, createdAt: now, receivedAt: now }],
    settings: Object.entries({ enabled: true, pageId: 'page-1', pageAccessTokenEncrypted: 'synthetic-token' })
      .map(([key, value]) => ({ section: 'integration.meta', key, value, updatedAt: now })),
    templates: [], notifications: [], deliveries: [], attempts: [], activities: [], audits: [],
  };
  const calls = [], locks = [], outcomes = { CHAT: 'SENT', EMAIL: 'SENT' };
  const chatwoot = { available: false, calls: [] };
  let sequence = 0, txTail = Promise.resolve(), beforeTransaction, providerGate, onAttemptRead;
  const joinedParcel = row => ({ ...row, order: state.orders.find(o => o.id === row.orderId) });
  const joinedNotification = row => row && ({ ...row, deliveries: state.deliveries.filter(d => d.notificationId === row.id) });
  const deliveryView = row => row && ({ ...row, notification: copy(state.notifications.find(n => n.id === row.notificationId)) });
  function mutableModel(key, view = row => row) {
    const find = where => state[key].find(row => matches(row, where));
    return {
      findUnique: async ({ where }) => copy(view(find(where)) || null),
      findUniqueOrThrow: async ({ where }) => { const row = find(where); assert.ok(row, `${key} row must exist`); return copy(view(row)); },
      findMany: async ({ where = {} } = {}) => copy(state[key].filter(row => matches(row, where)).map(view)),
      create: async ({ data }) => {
        if (key === 'notifications') assert.ok(!state.notifications.some(n => n.shipmentId === data.shipmentId && n.trackingRevision === data.trackingRevision), 'unique shipment revision');
        if (key === 'deliveries') assert.ok(!state.deliveries.some(d => d.notificationId === data.notificationId && d.channel === data.channel), 'unique delivery channel');
        const row = { id: `${key}-${++sequence}`, createdAt: new Date(), ...copy(data) };
        if (key === 'notifications') for (const k of ['conversationId', 'conversationExternalId', 'conversationChannel']) row[k] ??= null;
        if (key === 'deliveries') Object.assign(row, { status: 'PENDING', startedAt: null, sentAt: null, messageId: null, error: null }, copy(data));
        state[key].push(row);
        return copy(view(row));
      },
      update: async ({ where, data }) => { const row = find(where); assert.ok(row); Object.assign(row, copy(data)); return copy(view(row)); },
      updateMany: async ({ where, data }) => { const rows = state[key].filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, copy(data))); return { count: rows.length }; },
    };
  }
  const findMessages = ({ where, orderBy = { createdAt: 'desc' }, take }) => {
    const rules = [].concat(orderBy);
    return copy(state.messages.filter(row => matches(row, where)).sort((a, b) => {
      for (const rule of rules) for (const [key, direction] of Object.entries(rule)) {
        const delta = (a[key]?.valueOf() ?? 0) - (b[key]?.valueOf() ?? 0);
        if (delta) return direction === 'desc' ? -delta : delta;
      }
      return 0;
    }).slice(0, take));
  };
  const attempts = mutableModel('attempts');
  const db = {
    client: { findFirst: async ({ where }) => copy(state.clients.find(row => matches(row, where)) || null) },
    conversation: { findFirst: async ({ where }) => copy(state.conversations.find(row => matches(row, where)) || null) },
    order: { ...mutableModel('orders'), findMany: async ({ where, select }) => copy(state.orders.filter(row => matches(row, where)).map(row => ({ ...row,
      orderShipments: state.parcels.filter(p => p.orderId === row.id && matches(p, select?.orderShipments?.where)),
    }))) },
    shipment: mutableModel('legacyShipments'),
    orderShipment: { ...mutableModel('parcels'), findFirst: async ({ where }) => copy(state.parcels.map(joinedParcel).find(row => matches(row, where)) || null) },
    message: { findFirst: async query => findMessages(query)[0] || null, findMany: async query => findMessages(query) },
    appSetting: { findMany: async ({ where, orderBy = [] }) => copy(state.settings.filter(row => matches(row, where)).sort((a, b) => {
      for (const rule of [].concat(orderBy)) for (const [key, direction] of Object.entries(rule)) {
        const delta = String(a[key]).localeCompare(String(b[key]));
        if (delta) return direction === 'desc' ? -delta : delta;
      }
      return 0;
    })) },
    messageTemplate: { findMany: async ({ where }) => copy(state.templates.filter(row => matches(row, where))) },
    shipmentNotification: mutableModel('notifications', joinedNotification),
    shipmentNotificationDelivery: mutableModel('deliveries', deliveryView),
    messageDeliveryAttempt: { ...attempts, findUnique: async query => {
      const result = await attempts.findUnique(query);
      await onAttemptRead?.(query, result);
      return result;
    } },
    activity: mutableModel('activities'), auditLog: mutableModel('audits'),
  };
  // Transactions overlap until the advisory lock is acquired; then serialize.
  // A rollback restores DB writes. Provider dispatch remains outside this lock,
  // so the real conditional PENDING claim must protect concurrent doubleclicks.
  db.$transaction = async callback => {
    const hook = beforeTransaction; beforeTransaction = undefined; hook?.();
    let release, snapshot;
    const tx = { ...db,
      $executeRaw: async (strings, ...values) => {
        assert.match(strings.join('?'), /pg_advisory_xact_lock/);
        // One transaction may additionally lock the original provider attempt's
        // conversation. Reusing the transaction must not wait on its own lock.
        if (!release) {
          const previous = txTail;
          txTail = new Promise(resolve => { release = resolve; });
          await previous;
          snapshot = copy(state);
        }
        locks.push(values[0]);
        return 1;
      },
      $queryRaw: async strings => { assert.match(strings.join('?'), /FOR UPDATE/); return []; },
    };
    try { return await callback(tx); }
    catch (error) { if (snapshot) Object.assign(state, snapshot); throw error; }
    finally { release?.(); }
  };
  const smtp = { enabled: true, smtpHost: 'smtp.example.test', username: 'test', password: 'synthetic', fromAddress: 'crm@example.test' };
  async function deliver(channel, clientId, input, user) {
    calls.push(copy({ channel, clientId, input, actorId: user.id }));
    if (providerGate) await providerGate;
    const outcome = outcomes[channel];
    if (outcome === 'BUSY') {
      assert.equal(channel, 'EMAIL');
      return { status: 'PENDING' }; // A different UUID owns the email lock.
    }
    const attemptId = `attempt-${calls.length}`;
    if (outcome !== 'NO_ATTEMPT') state.attempts.push({ id: attemptId, clientRequestId: input.clientRequestId,
      conversationId: channel === 'EMAIL' ? 'mail-1' : 'chat-1',
      status: outcome === 'PENDING_RESERVED' ? 'PENDING' : outcome, messageId: outcome === 'SENT' ? `message-${calls.length}` : null,
      message: outcome === 'SENT' ? { sentAt: new Date('2026-10-27T10:00:00Z') } : null });
    if (outcome === 'PENDING_RESERVED') return { status: 'PENDING', attemptId };
    if (outcome !== 'SENT') throw new Error(`synthetic ${outcome}`);
    return { status: 'SENT', attemptId };
  }
  const service = new ShipmentNotificationService(db, {
    sendShipmentChat: (...args) => deliver('CHAT', ...args),
    sendShipmentEmail: (...args) => deliver('EMAIL', ...args),
    shipmentChatwootAvailable: async (...args) => { chatwoot.calls.push(copy(args)); return chatwoot.available; },
  }, { settings: async () => copy(smtp) });
  return { service, state, calls, locks, outcomes, smtp, chatwoot,
    beforeTransaction(fn) { beforeTransaction = fn; },
    holdProviders(promise) { providerGate = promise; },
    onAttemptRead(fn) { onAttemptRead = fn; },
    async input(overrides = {}) {
      const preview = await service.preview({ ...selection, ...overrides }, actor);
      return { ...selection, ...preview, sendChat: true, sendEmail: true, confirmClientEmail: false, ...overrides };
    },
  };
}

function configureMeta(h, channel) {
  const receiver = { FACEBOOK: 'page-1', INSTAGRAM: 'ig-1', WHATSAPP: 'wa-1' }[channel];
  const values = { instagramAccountId: 'ig-1', instagramAccessTokenEncrypted: 'synthetic',
    whatsappPhoneNumberId: 'wa-1', whatsappAccessTokenEncrypted: 'synthetic' };
  for (const [key, value] of Object.entries(values)) {
    if (!h.state.settings.some(s => s.section === 'integration.meta' && s.key === key))
      h.state.settings.push({ section: 'integration.meta', key, value, updatedAt: new Date() });
  }
  Object.assign(h.state.conversations[0], { channel, externalId: `${receiver}:recipient-1` });
  Object.assign(h.state.messages[0].metadata, { receiverId: receiver, accountId: receiver });
  return receiver;
}

function configureChatwoot(h, available) {
  Object.assign(h.state.conversations[0], { channel: 'CHATWOOT', externalId: 'chatwoot-conversation-42' });
  h.state.settings.push(...Object.entries({ enabled: true, accessTokenEncrypted: 'synthetic-chatwoot-token' })
    .map(([key, value]) => ({ section: 'integration.chatwoot', key, value, updatedAt: new Date() })));
  h.chatwoot.available = available;
}

test('options lists all eligible orders and parcels, including completed orders, excluding archived/invalid/foreign candidates', async () => {
  const h = fixture(), result = await h.service.options(scope, actor);
  assert.deepEqual(sorted(result.orders.map(o => [o.id, o.shipments.map(s => s.id)])), [
    ['order-1', ['parcel-1', 'parcel-2']], ['order-2', ['parcel-3']],
  ]);
  assert.equal(result.chat.available, true);
  assert.equal(h.calls.length, 0);
});

test('options without an explicitly selected conversation never enables a unified inbox chat', async () => {
  const h = fixture();
  assert.equal((await h.service.options({ clientId: 'client-1' }, actor)).chat.available, false);
});

test('Chatwoot verified website capability uses the exact selected scope and cache-only checks inside the send transaction', async () => {
  const h = fixture(); configureChatwoot(h, true);
  const cwScope = { ...scope, channel: 'CHATWOOT' };
  assert.equal((await h.service.options(cwScope, actor)).chat.available, true);
  const input = await h.input({ channel: 'CHATWOOT', sendEmail: false });
  assert.equal(input.chatAvailable, true);
  const result = await h.service.send(input, actor);
  assert.equal(result.deliveries[0].status, 'SENT');
  assert.equal(result.deliveries[0].recipient, 'chatwoot-conversation-42');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].input.channel, 'CHATWOOT');
  assert.equal(h.calls[0].input.conversationId, 'chat-1');
  assert.equal(h.calls[0].input.externalId, 'chatwoot-conversation-42');
  assert.ok(h.chatwoot.calls.length >= 4);
  for (const args of h.chatwoot.calls) assert.deepEqual(args.slice(0, 3), ['client-1', 'chat-1', 'chatwoot-conversation-42']);
  assert.deepEqual(h.chatwoot.calls.map(args => args[3]), [true, true, true, false, true],
    'options, preview, preflight and dispatch may fetch; transaction may only read cached capability');
});

test('Chatwoot negative trusted capability overrides claimed WebWidget metadata and still permits email only', async () => {
  const h = fixture(); configureChatwoot(h, false);
  h.state.messages[0].metadata = { chatwootChannel: 'Channel::WebWidget' };
  assert.equal((await h.service.options({ ...scope, channel: 'CHATWOOT' }, actor)).chat.available, false);
  const input = await h.input({ channel: 'CHATWOOT', sendChat: false });
  assert.equal(input.chatAvailable, false); assert.equal(input.emailAvailable, true);
  await assert.rejects(h.service.send({ ...input, sendChat: true, sendEmail: false }, actor));
  assert.equal(h.calls.length + h.state.notifications.length, 0);
  const result = await h.service.send(input, actor);
  assert.equal(result.deliveries[0].status, 'SENT');
  assert.deepEqual(h.calls.map(call => call.channel), ['EMAIL']);
  for (const args of h.chatwoot.calls) assert.deepEqual(args.slice(0, 3), ['client-1', 'chat-1', 'chatwoot-conversation-42']);
});

test('Chatwoot capability is never queried for a conversation owned by a different client', async () => {
  const h = fixture(); configureChatwoot(h, true);
  h.state.conversations[1].channel = 'CHATWOOT';
  await assert.rejects(h.service.preview({ ...selection, conversationId: 'chat-2', channel: 'CHATWOOT' }, actor));
  assert.equal(h.chatwoot.calls.length + h.calls.length, 0);
});

for (const override of [
  { clientId: 'client-2' }, { orderId: 'order-2' }, { shipmentId: 'parcel-other' },
  { conversationId: 'chat-2' }, { channel: 'INSTAGRAM' },
  { shipmentId: 'parcel-archived' }, { shipmentId: 'parcel-old-order', orderId: 'order-archived' },
  { shipmentId: 'parcel-empty', orderId: 'order-2' }, { shipmentId: 'parcel-invalid', orderId: 'order-2' },
]) test(`preview and send reject mismatched or unusable selection ${JSON.stringify(override)}`, async () => {
  const h = fixture(), input = await h.input();
  await assert.rejects(h.service.preview({ ...selection, ...override }, actor));
  await assert.rejects(h.service.send({ ...input, ...override }, actor));
  assert.equal(h.calls.length, 0);
  assert.equal(h.state.notifications.length, 0);
});

test('preview uses order deliveryEmail before profile email and has no sending or history side effects', async () => {
  const h = fixture(), preview = await h.service.preview(selection, actor);
  assert.equal(preview.emailRecipient, 'order@example.test');
  assert.equal(preview.emailRequiresConfirmation, false);
  assert.equal(preview.orderNumber, 'YO-100');
  assert.match(preview.content, /https:\/\/novaposhtaglobal\.ua\/track\/\?Tracking_ID=PC0000020000072054NPG/);
  assert.equal(preview.subject, 'Your Yoleotard order YO-100 has been shipped');
  assert.equal(h.calls.length + h.state.notifications.length + h.state.activities.length + h.state.audits.length, 0);
});

test('profile email fallback needs explicit confirmation and failed confirmation rolls back the whole operation', async () => {
  const h = fixture(); h.state.orders[0].deliveryEmail = null;
  const input = await h.input();
  assert.equal(input.emailRecipient, 'profile@example.test');
  assert.equal(input.emailRequiresConfirmation, true);
  await assert.rejects(h.service.send(input, actor), /Подтвердите/);
  assert.equal(h.calls.length + h.state.notifications.length + h.state.deliveries.length + h.state.activities.length, 0);
  const result = await h.service.send({ ...input, confirmClientEmail: true }, actor);
  assert.equal(result.deliveries.find(d => d.channel === 'EMAIL').status, 'SENT');
});

test('missing email permits chat only; unavailable SMTP permits chat only', async () => {
  for (const missing of ['address', 'smtp']) {
    const h = fixture();
    if (missing === 'address') { h.state.orders[0].deliveryEmail = null; h.state.clients[0].email = null; }
    else h.smtp.enabled = false;
    const input = await h.input({ sendEmail: false });
    assert.equal(input.emailAvailable, false);
    const result = await h.service.send(input, actor);
    assert.deepEqual(sorted(result.deliveries.map(d => [d.channel, d.status])), [['CHAT', 'SENT']]);
    assert.equal(h.calls.length, 1);
  }
});

test('preview uses existing localized template without modifying it; unknown language falls back to English', async () => {
  const h = fixture();
  h.state.templates.push({ id: 'template-ru', name: 'Уведомление об отправке', archivedAt: null, language: 'ru', channel: null,
    content: 'Заказ {order_number}: {tracking_url}', updatedAt: new Date() });
  const before = copy(h.state.templates);
  const ru = await h.service.preview({ ...selection, language: 'ru' }, actor);
  assert.equal(ru.language, 'ru'); assert.match(ru.content, /^Заказ YO-100: https:/);
  assert.match(ru.subject, /YO-100/);
  const en = await h.service.preview({ ...selection, language: 'xx' }, actor);
  assert.equal(en.language, 'en'); assert.match(en.content, /^Your order has been shipped!/);
  assert.deepEqual(h.state.templates, before);
});

for (const [language, opening, subject] of [
  ['ru', 'Ваш заказ отправлен! 📦', 'Ваш заказ Yoleotard YO-100 отправлен'],
  ['uk', 'Ваше замовлення відправлено! 📦', 'Ваше замовлення Yoleotard YO-100 відправлено'],
]) test(`${language} built-in notification takes priority over an English-only saved template`, async () => {
  const h = fixture(); h.state.clients[0].language = language;
  h.state.templates.push({ id: 'template-en', name: 'Уведомление об отправке', archivedAt: null,
    language: 'en', channel: null, content: 'EN SAVED TEMPLATE {tracking_url}', updatedAt: new Date() });
  const templates = copy(h.state.templates);
  const input = await h.input({ sendChat: false });
  assert.equal(input.language, language);
  assert.ok(input.content.startsWith(opening));
  assert.ok(input.content.includes(input.trackingUrl));
  assert.equal(input.subject, subject);
  assert.equal(input.content.includes('EN SAVED TEMPLATE'), false);
  const result = await h.service.send(input, actor);
  assert.equal(result.language, language);
  assert.equal(h.calls[0].input.content, input.content);
  assert.equal(h.calls[0].input.subject, subject);
  assert.deepEqual(h.state.templates, templates);
});

for (const change of ['revision', 'recipient', 'conversation', 'template']) test(`stale preview rejects changed ${change} before provider dispatch`, async () => {
  const h = fixture(), input = await h.input();
  if (change === 'revision') h.state.parcels[0].trackingRevision++;
  if (change === 'recipient') h.state.orders[0].deliveryEmail = 'changed@example.test';
  if (change === 'conversation') h.state.conversations[0].externalId = 'changed-chat';
  if (change === 'template') h.state.templates.push({ id: 'new', name: 'Уведомление об отправке', archivedAt: null, language: 'en', channel: null, content: '{tracking_url}', updatedAt: new Date() });
  await assert.rejects(h.service.send(input, actor), /изменил|заново/);
  assert.equal(h.calls.length + h.state.notifications.length, 0);
});

test('scope is checked again under lock if a parcel changes after preflight', async () => {
  const h = fixture(), input = await h.input();
  h.beforeTransaction(() => { h.state.parcels[0].trackingRevision++; });
  await assert.rejects(h.service.send(input, actor), /изменил/);
  assert.equal(h.calls.length + h.state.notifications.length, 0);
  assert.equal(h.locks.length, 1);
});

test('independent channel outcomes preserve sent email and retry only failed chat with a fresh UUID', async () => {
  const h = fixture(); h.outcomes.CHAT = 'FAILED';
  const input = await h.input(), first = await h.service.send(input, actor);
  assert.deepEqual(sorted(first.deliveries.map(d => [d.channel, d.status])), [['CHAT', 'FAILED'], ['EMAIL', 'SENT']]);
  assert.match(first.emailAccountIdentity, /^[a-f0-9]{64}$/, 'confirmation must persist a nonempty mailbox identity snapshot');
  assert.equal(h.state.notifications[0].emailAccountIdentity, first.emailAccountIdentity);
  assert.equal(h.calls.find(c => c.channel === 'EMAIL').input.accountIdentity, first.emailAccountIdentity,
    'email dispatch must pass the confirmed mailbox snapshot to the adapter');
  const chat = first.deliveries.find(d => d.channel === 'CHAT'), email = first.deliveries.find(d => d.channel === 'EMAIL');
  assert.match(chat.clientRequestId, uuid); assert.match(email.clientRequestId, uuid);
  assert.notEqual(chat.clientRequestId, email.clientRequestId);
  h.outcomes.CHAT = 'SENT';
  const second = await h.service.send(input, actor);
  assert.equal(second.id, first.id);
  assert.equal(second.emailAccountIdentity, first.emailAccountIdentity, 'chat-only retry must retain the original email mailbox snapshot');
  assert.equal(second.deliveries.find(d => d.channel === 'CHAT').status, 'SENT');
  assert.notEqual(second.deliveries.find(d => d.channel === 'CHAT').clientRequestId, chat.clientRequestId);
  assert.equal(second.deliveries.find(d => d.channel === 'EMAIL').clientRequestId, email.clientRequestId);
  assert.equal(h.calls.filter(c => c.channel === 'EMAIL').length, 1);
  assert.equal(h.calls.filter(c => c.channel === 'CHAT').length, 2);
  assert.ok(h.state.activities.some(a => a.type === 'SHIPMENT_NOTIFICATION_RETRY'));
  assert.ok(h.state.audits.some(a => a.action === 'SHIPMENT_NOTIFICATION_RESULT'));
  assert.ok(h.calls.every(c => c.clientId === 'client-1' && c.actorId === actor.id && c.input.content === input.content));
});

test('concurrent doubleclick creates one operation and dispatches each channel once while provider is pending', async () => {
  const h = fixture(), input = await h.input();
  let release; h.holdProviders(new Promise(resolve => { release = resolve; }));
  const first = h.service.send(input, actor), second = h.service.send(input, actor);
  try {
    // Drain microtasks until both providers were entered; no timing-dependent sleeps.
    for (let i = 0; i < 500 && h.calls.length < 2; i++) await Promise.resolve();
    assert.equal(h.calls.length, 2);
  } finally { release(); }
  const results = await Promise.all([first, second]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(h.state.notifications.length, 1);
  assert.equal(h.state.deliveries.length, 2);
  assert.equal(h.calls.length, 2);
  assert.equal(h.locks.length, 2);
});

for (const outcome of ['UNCERTAIN', 'NO_ATTEMPT']) test(`${outcome} becomes UNKNOWN and repeated send/preview/status never resends it`, async () => {
  const h = fixture(); h.outcomes.EMAIL = outcome;
  const input = await h.input({ sendChat: false });
  const first = await h.service.send(input, actor);
  const preview = await h.service.preview(selection, actor);
  const polled = await h.service.status(first.id, actor);
  const second = await h.service.send(input, actor);
  assert.equal(second.deliveries[0].clientRequestId, first.deliveries[0].clientRequestId);
  assert.equal(h.calls.length, 1);
  assert.deepEqual([first, preview.previous, polled, second].map(n => n.deliveries[0].status),
    ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
});

test('email BUSY owned by a different UUID fails before reservation and allows only a manual email retry', async () => {
  const h = fixture(); h.outcomes.EMAIL = 'BUSY';
  const foreign = { id: 'foreign-mail-attempt', clientRequestId: 'foreign-mail-request', status: 'PENDING', conversationId: 'shared-email-conversation' };
  h.state.attempts.push(foreign);
  const input = await h.input(), first = await h.service.send(input, actor);
  const email = first.deliveries.find(d => d.channel === 'EMAIL');
  assert.equal(email.status, 'FAILED');
  assert.equal(first.deliveries.find(d => d.channel === 'CHAT').status, 'SENT');
  assert.equal(h.state.attempts.some(a => a.clientRequestId === email.clientRequestId), false);
  assert.equal((await h.service.status(first.id, actor)).deliveries.find(d => d.channel === 'EMAIL').status, 'FAILED');
  assert.equal((await h.service.preview(selection, actor)).previous.deliveries.find(d => d.channel === 'EMAIL').status, 'FAILED');
  assert.equal(h.calls.length, 2, 'polling/preview must not retry a BUSY rejection automatically');
  assert.ok(h.state.activities.some(a => a.type === 'SHIPMENT_NOTIFICATION_RESULT' && a.metadata.channel === 'EMAIL' && a.metadata.status === 'FAILED'));

  foreign.status = 'SENT'; h.outcomes.EMAIL = 'SENT';
  const retried = await h.service.send(input, actor);
  const sentEmail = retried.deliveries.find(d => d.channel === 'EMAIL');
  assert.equal(sentEmail.status, 'SENT');
  assert.notEqual(sentEmail.clientRequestId, email.clientRequestId);
  assert.equal(h.calls.filter(c => c.channel === 'CHAT').length, 1);
  assert.equal(h.calls.filter(c => c.channel === 'EMAIL').length, 2);
  assert.equal(h.state.attempts.find(a => a.clientRequestId === sentEmail.clientRequestId)?.status, 'SENT');
});

test('email PENDING with its own reserved attempt remains SENDING and cannot be retried as BUSY', async () => {
  const h = fixture(); h.outcomes.EMAIL = 'PENDING_RESERVED';
  const input = await h.input({ sendChat: false }), first = await h.service.send(input, actor);
  assert.equal(first.deliveries[0].status, 'SENDING');
  assert.equal(h.state.attempts[0].status, 'PENDING');
  assert.equal(h.state.attempts[0].clientRequestId, first.deliveries[0].clientRequestId);
  const repeated = await h.service.send(input, actor);
  assert.equal(repeated.deliveries[0].status, 'SENDING');
  assert.equal(repeated.deliveries[0].clientRequestId, first.deliveries[0].clientRequestId);
  assert.equal(h.calls.length, 1);
});

test('status reconciles an UNKNOWN delivery using the persisted SENT attempt/message without dispatch', async () => {
  const h = fixture(); h.outcomes.EMAIL = 'UNCERTAIN';
  const input = await h.input({ sendChat: false }), first = await h.service.send(input, actor);
  const attempt = h.state.attempts[0];
  Object.assign(attempt, { status: 'SENT', messageId: 'reconciled-message', message: { sentAt: new Date('2026-10-27T11:00:00Z') } });
  const result = await h.service.status(first.id, actor);
  assert.equal(result.deliveries[0].status, 'SENT');
  assert.equal(result.deliveries[0].messageId, 'reconciled-message');
  assert.equal(result.deliveries[0].sentAt.toISOString(), '2026-10-27T11:00:00.000Z');
  await h.service.send(input, actor);
  assert.equal(h.calls.length, 1);
});

test('late Sent proof overrides a manually resolved FAILED notification before any retry, retaining original message/date/UUID', async () => {
  const h = fixture(); h.outcomes.EMAIL = 'UNCERTAIN';
  const input = await h.input({ sendChat: false }), first = await h.service.send(input, actor);
  assert.equal(first.deliveries[0].status, 'UNKNOWN');
  const originalRequestId = first.deliveries[0].clientRequestId;
  const originalAttempt = h.state.attempts[0];
  originalAttempt.status = 'FAILED'; // Existing manual uncertainty resolution.
  assert.equal((await h.service.status(first.id, actor)).deliveries[0].status, 'FAILED');

  Object.assign(originalAttempt, { status: 'SENT', messageId: 'late-original-sent-message',
    message: { sentAt: new Date('2026-10-27T11:12:13.000Z') } });
  const reconciled = await h.service.status(first.id, actor);
  assert.equal(reconciled.deliveries[0].status, 'SENT');
  assert.equal(reconciled.deliveries[0].messageId, 'late-original-sent-message');
  assert.equal(reconciled.deliveries[0].sentAt.toISOString(), '2026-10-27T11:12:13.000Z');
  assert.equal(reconciled.deliveries[0].clientRequestId, originalRequestId);
  await h.service.send(input, actor);
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.attempts.length, 1);
  assert.equal(h.state.activities.some(a => a.type === 'SHIPMENT_NOTIFICATION_RETRY'), false);
});

test('late Sent arriving after retry preflight is reread under the original conversation lock before replacing its UUID', async () => {
  const h = fixture(); h.outcomes.EMAIL = 'UNCERTAIN';
  const input = await h.input({ sendChat: false }), first = await h.service.send(input, actor);
  const originalRequestId = first.deliveries[0].clientRequestId;
  const originalAttempt = h.state.attempts[0];
  originalAttempt.status = 'FAILED';
  assert.equal((await h.service.status(first.id, actor)).deliveries[0].status, 'FAILED');

  let raceExecuted = false;
  h.beforeTransaction(() => {
    raceExecuted = true;
    Object.assign(originalAttempt, { status: 'SENT', messageId: 'raced-original-sent-message',
      message: { sentAt: new Date('2026-10-27T11:14:15.000Z') } });
  });
  h.outcomes.EMAIL = 'SENT';
  const result = await h.service.send(input, actor);
  assert.equal(raceExecuted, true);
  assert.equal(h.calls.length, 1, 'late original Sent proof must prevent a second provider send');
  assert.equal(result.deliveries[0].status, 'SENT');
  assert.equal(result.deliveries[0].clientRequestId, originalRequestId);
  assert.equal(result.deliveries[0].messageId, 'raced-original-sent-message');
  assert.equal(result.deliveries[0].sentAt.toISOString(), '2026-10-27T11:14:15.000Z');
  assert.ok(h.locks.includes('message-send:mail-1'), 'retry must serialize with Sent reconciliation on the original attempt conversation');
  assert.equal(h.state.attempts.length, 1);
  assert.equal(h.state.activities.some(a => a.type === 'SHIPMENT_NOTIFICATION_RETRY'), false);
});

test('failed email can be retried without resending an already sent chat', async () => {
  const h = fixture(); h.outcomes.EMAIL = 'FAILED';
  const input = await h.input(), first = await h.service.send(input, actor);
  const email = first.deliveries.find(d => d.channel === 'EMAIL');
  assert.equal(email.status, 'FAILED');
  assert.equal(first.deliveries.find(d => d.channel === 'CHAT').status, 'SENT');
  h.outcomes.EMAIL = 'SENT';
  const second = await h.service.send(input, actor);
  assert.notEqual(second.deliveries.find(d => d.channel === 'EMAIL').clientRequestId, email.clientRequestId);
  assert.equal(h.calls.filter(c => c.channel === 'CHAT').length, 1);
  assert.equal(h.calls.filter(c => c.channel === 'EMAIL').length, 2);
});

test('late failure catch cannot overwrite a new retry UUID or append a stale result to history', { timeout: 10_000 }, async () => {
  const h = fixture(); h.outcomes.EMAIL = 'FAILED';
  const input = await h.input({ sendChat: false });
  let releaseOldCatch, reachedOldCatch, releaseRetry;
  const oldCatchGate = new Promise(resolve => { releaseOldCatch = resolve; });
  const oldCatchReached = new Promise(resolve => { reachedOldCatch = resolve; });
  const retryGate = new Promise(resolve => { releaseRetry = resolve; });
  let blocked = false;
  // Freeze only the old catch's DB read after the provider has durably recorded
  // FAILED. Status polling remains free to reconcile that same attempt.
  h.onAttemptRead(async (_query, result) => {
    if (!blocked && result?.status === 'FAILED') {
      blocked = true; reachedOldCatch(); await oldCatchGate;
    }
  });
  const firstSend = h.service.send(input, actor);
  let retrySend;
  try {
    await Promise.race([oldCatchReached, firstSend.then(() => {
      throw new Error('first send completed without pausing the failed attempt read');
    })]);
    assert.equal(h.state.attempts[0].status, 'FAILED');
    const id = h.state.notifications[0].id;
    const firstRequest = h.state.deliveries[0].clientRequestId;
    const polled = await h.service.status(id, actor);
    assert.equal(polled.deliveries[0].status, 'FAILED');

    h.outcomes.EMAIL = 'SENT'; h.holdProviders(retryGate);
    retrySend = h.service.send(input, actor);
    for (let i = 0; i < 500 && h.calls.length < 2; i++) await Promise.resolve();
    assert.equal(h.calls.length, 2, 'explicit manual retry must reach the provider');
    const retryRow = copy(h.state.deliveries[0]);
    assert.equal(retryRow.status, 'SENDING');
    assert.notEqual(retryRow.clientRequestId, firstRequest);
    assert.match(retryRow.clientRequestId, uuid);
    const activities = copy(h.state.activities), audits = copy(h.state.audits);

    releaseOldCatch();
    const oldResponse = await firstSend;
    assert.deepEqual(h.state.deliveries[0], retryRow, 'old failure must not mutate the new in-flight attempt');
    assert.equal(oldResponse.deliveries[0].status, 'SENDING');
    assert.equal(oldResponse.deliveries[0].clientRequestId, retryRow.clientRequestId);
    assert.deepEqual(h.state.activities, activities, 'stale catch must not append a contradictory Activity');
    assert.deepEqual(h.state.audits, audits, 'stale catch must not append a contradictory AuditLog');

    releaseRetry();
    const retried = await retrySend;
    assert.equal(retried.deliveries[0].status, 'SENT');
    assert.equal(retried.deliveries[0].clientRequestId, retryRow.clientRequestId);
    assert.equal(h.calls.length, 2);
  } finally {
    releaseOldCatch(); releaseRetry();
    await Promise.allSettled([firstSend, ...(retrySend ? [retrySend] : [])]);
  }
});

test('pending attempt remains SENDING until timeout, then UNKNOWN; polling never dispatches another send', async () => {
  const h = fixture();
  let release; h.holdProviders(new Promise(resolve => { release = resolve; }));
  const input = await h.input({ sendChat: false });
  const sending = h.service.send(input, actor);
  try {
    for (let i = 0; i < 500 && !h.calls.length; i++) await Promise.resolve();
    assert.equal(h.calls.length, 1);
    const id = h.state.notifications[0].id;
    assert.equal((await h.service.status(id, actor)).deliveries[0].status, 'SENDING');
    h.state.deliveries[0].startedAt = new Date(Date.now() - 121_000);
    assert.equal((await h.service.status(id, actor)).deliveries[0].status, 'UNKNOWN');
    await h.service.preview(selection, actor);
    await h.service.send(input, actor);
    assert.equal(h.calls.length, 1);
  } finally { release(); }
  const result = await sending;
  assert.equal(result.deliveries[0].status, 'SENT');
});

test('email-only notification works without a conversation and preserves the confirmed text on repeats', async () => {
  const h = fixture();
  const input = await h.input({ conversationId: undefined, channel: undefined, sendChat: false });
  const first = await h.service.send(input, actor);
  assert.equal(first.conversationId, null);
  assert.equal(first.deliveries[0].status, 'SENT');
  await assert.rejects(h.service.send({ ...input, content: `${input.content}\nChanged after confirmation` }, actor));
  await h.service.send(input, actor);
  assert.equal(h.calls.length, 1);
});

test('archived clients are rejected before options, preview or send can expose/dispatch a notification', async () => {
  const h = fixture(), input = await h.input(); h.state.clients[0].archivedAt = new Date();
  await assert.rejects(h.service.options(scope, actor));
  await assert.rejects(h.service.preview(selection, actor));
  await assert.rejects(h.service.send(input, actor));
  assert.equal(h.calls.length + h.state.notifications.length, 0);
});

test('a new tracking revision can be notified while preserving the previous operation and parcel isolation', async () => {
  const h = fixture(), first = await h.service.send(await h.input(), actor);
  h.state.parcels[0].trackingRevision = 2; h.state.parcels[0].trackingNumber = 'NEW123';
  const second = await h.service.send(await h.input(), actor);
  const sibling = await h.service.send(await h.input({ shipmentId: 'parcel-2' }), actor);
  assert.notEqual(first.id, second.id); assert.notEqual(second.id, sibling.id);
  assert.equal((await h.service.status(first.id, actor)).trackingNumber, 'PC0000020000072054NPG');
  assert.equal(second.trackingNumber, 'NEW123');
  assert.equal(sibling.trackingNumber, 'PC0000020000072055NPG');
  assert.equal(h.calls.length, 6);
});

for (const channel of ['FACEBOOK', 'INSTAGRAM', 'WHATSAPP']) test(`${channel} closed reply window blocks chat while email remains available`, async () => {
  const h = fixture(); configureMeta(h, channel);
  assert.equal((await h.service.preview({ ...selection, channel }, actor)).chatAvailable, true);
  h.state.messages[0].createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
  h.state.messages[0].receivedAt = h.state.messages[0].createdAt;
  const input = await h.input({ channel, sendChat: false });
  assert.equal(input.chatAvailable, false); assert.equal(input.emailAvailable, true);
  await assert.rejects(h.service.send({ ...input, sendChat: true, sendEmail: false }, actor));
  await h.service.send(input, actor);
  assert.deepEqual(h.calls.map(c => c.channel), ['EMAIL']);
});

for (const channel of ['FACEBOOK', 'INSTAGRAM', 'WHATSAPP']) {
  test(`${channel} scoped receiver/recipient reaches the selected conversation unchanged`, async () => {
    const h = fixture(), receiver = configureMeta(h, channel);
    const input = await h.input({ channel, sendEmail: false });
    assert.equal(input.chatAvailable, true);
    const result = await h.service.send(input, actor);
    assert.equal(result.deliveries[0].status, 'SENT');
    assert.equal(result.deliveries[0].recipient, `${receiver}:recipient-1`);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(sorted(h.calls[0]), { channel: 'CHAT', clientId: 'client-1', actorId: actor.id, input: {
      conversationId: 'chat-1', externalId: `${receiver}:recipient-1`, channel,
      content: input.content, clientRequestId: result.deliveries[0].clientRequestId,
    } });
  });
  for (const externalId of ['foreign-receiver:recipient-1', 'recipient-1', ''])
    test(`${channel} rejects mismatched/unscoped Meta externalId ${JSON.stringify(externalId)}`, async () => {
      const h = fixture(); configureMeta(h, channel);
      h.state.conversations[0].externalId = externalId;
      const input = await h.input({ channel, sendEmail: false });
      assert.equal(input.chatAvailable, false);
      await assert.rejects(h.service.send(input, actor));
      assert.equal(h.calls.length + h.state.notifications.length + h.state.deliveries.length, 0);
    });
  test(`${channel} rejects an empty recipient after the correct receiver prefix`, async () => {
    const h = fixture(), receiver = configureMeta(h, channel);
    h.state.conversations[0].externalId = `${receiver}:`;
    const input = await h.input({ channel, sendEmail: false });
    assert.equal(input.chatAvailable, false);
    await assert.rejects(h.service.send(input, actor));
    assert.equal(h.calls.length, 0);
  });
}

test('Instagram accepts the configured webhook receiver alias without accepting another account', async () => {
  const h = fixture(); configureMeta(h, 'INSTAGRAM');
  h.state.settings.push({ section: 'integration.meta', key: 'instagramWebhookReceiverId', value: 'ig-webhook', updatedAt: new Date() });
  h.state.conversations[0].externalId = 'ig-webhook:recipient-1';
  h.state.messages[0].metadata.receiverId = 'ig-webhook';
  const input = await h.input({ channel: 'INSTAGRAM', sendEmail: false });
  assert.equal(input.chatAvailable, true);
  assert.equal((await h.service.send(input, actor)).deliveries[0].status, 'SENT');
  assert.equal(h.calls[0].input.externalId, 'ig-webhook:recipient-1');
});

test('settings returned in a different physical order do not invalidate the same confirmation scope', async () => {
  const h = fixture(), input = await h.input();
  h.state.settings.reverse();
  const preview = await h.service.preview(selection, actor);
  assert.equal(preview.scopeToken, input.scopeToken);
  const result = await h.service.send(input, actor);
  assert.ok(result.deliveries.every(d => d.status === 'SENT'));
});

test('Meta reply window uses inbound receivedAt rather than a later import createdAt timestamp', async () => {
  const h = fixture();
  h.state.messages[0].receivedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
  const preview = await h.service.preview(selection, actor);
  assert.equal(preview.chatAvailable, false, 'recent DB insertion cannot reopen an expired provider reply window');
});

test('Meta reply window chooses the newest provider receivedAt when imported insertion order differs', async () => {
  const h = fixture();
  h.state.messages[0].receivedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
  h.state.messages.push({ conversationId: 'chat-1', direction: 'INBOUND', metadata: {},
    createdAt: new Date(Date.now() - 60 * 60 * 1000), receivedAt: new Date() });
  assert.equal((await h.service.preview(selection, actor)).chatAvailable, true);
});

for (const kind of ['comment', 'reaction', 'social_mention']) test(`recent Meta ${kind} cannot reopen the direct-message reply window`, async () => {
  const h = fixture();
  h.state.messages[0].receivedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
  h.state.messages.push({ conversationId: 'chat-1', direction: 'INBOUND', createdAt: new Date(), receivedAt: new Date(),
    metadata: { receiverId: 'page-1', ...(kind === 'social_mention' ? {} : { engagement: { kind } }) },
    messageType: kind === 'social_mention' ? 'social_mention' : 'text' });
  assert.equal((await h.service.preview(selection, actor)).chatAvailable, false);
});

test('missing or future authoritative inbound timestamps cannot enable Meta chat', async () => {
  for (const receivedAt of [null, new Date(Date.now() + 60 * 60 * 1000)]) {
    const h = fixture(); h.state.messages[0].receivedAt = receivedAt;
    assert.equal((await h.service.preview(selection, actor)).chatAvailable, false);
  }
});

test('UNKNOWN remains sticky when an attempt temporarily reports PENDING, but authoritative FAILED permits a fresh retry', async () => {
  const h = fixture(); h.outcomes.EMAIL = 'UNCERTAIN';
  const input = await h.input({ sendChat: false }), first = await h.service.send(input, actor);
  const requestId = first.deliveries[0].clientRequestId;
  h.state.attempts[0].status = 'PENDING';
  assert.equal((await h.service.status(first.id, actor)).deliveries[0].status, 'UNKNOWN');
  await h.service.send(input, actor);
  assert.equal(h.calls.length, 1);
  h.state.attempts[0].status = 'FAILED';
  assert.equal((await h.service.status(first.id, actor)).deliveries[0].status, 'FAILED');
  h.outcomes.EMAIL = 'SENT';
  const retried = await h.service.send(input, actor);
  assert.equal(retried.deliveries[0].status, 'SENT');
  assert.notEqual(retried.deliveries[0].clientRequestId, requestId);
  assert.equal(h.calls.length, 2);
});

test('invalid outgoing confirmation cannot send: no channel, removed tracking link, newline email subject', async () => {
  const h = fixture(), input = await h.input();
  for (const change of [{ sendChat: false, sendEmail: false }, { content: 'No tracking link' }, { subject: 'Subject\r\nBcc: attacker@example.test' }])
    await assert.rejects(h.service.send({ ...input, ...change }, actor));
  assert.equal(h.calls.length + h.state.notifications.length, 0);
});

for (const role of ['PRODUCTION', 'ACCOUNTANT', 'VIEWER']) test(`${role} cannot access options/preview/send/status even by direct service invocation`, async () => {
  const h = fixture(), input = await h.input(), denied = { id: 'denied', role };
  for (const invoke of [() => h.service.options(scope, denied), () => h.service.preview(selection, denied),
    () => h.service.send(input, denied), () => h.service.status('missing', denied)])
    await assert.rejects(invoke(), error => error.getStatus?.() === 403);
  assert.equal(h.calls.length + h.state.notifications.length, 0);
});


test('clearing a tracking identity is explicit, revision guarded and never removes history or money',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.service.clearTracking({orderId:'order-1',shipmentId:'parcel-1',trackingRevision:1},actor),/администратор/);
 await assert.rejects(()=>f.service.clearTracking({orderId:'order-1',shipmentId:'parcel-1',trackingRevision:999},{id:'owner',role:'OWNER'}),/изменились/);
});


test('language links reuse the persisted number and clearing only its primary legacy projections preserves delivery facts',async()=>{
 const f=fixture(),owner={id:'owner',role:'OWNER'},p=f.state.parcels[0],o=f.state.orders[0];
 Object.assign(p,{isPrimary:true,status:'DELIVERED',shippedAt:'2026-10-01',deliveredAt:'2026-10-10',atelierCostMinor:139600,customerChargeMinor:2200,currency:'EUR'});
 o.deliveryTrackingCode=p.trackingNumber;
 f.state.legacyShipments.push({orderId:o.id,trackingNumber:p.trackingNumber,costMinor:2200,currency:'EUR'});
 const options=await f.service.trackingOptions(o.id,p.id);
 assert.equal(options.options.length,2);assert.equal(f.state.audits.length,0);
 const saved=await f.service.saveTrackingUrl({orderId:o.id,shipmentId:p.id,trackingRevision:1,language:'en'},owner);
 assert.equal(saved.trackingUrl,`https://nova.global/en-ua/track/?Tracking_ID=${p.trackingNumber}`);
 const preview=await f.service.preview(selection,actor);assert.equal(preview.trackingUrl,saved.trackingUrl);
 const before=copy(p),notifications=copy(f.state.notifications);
 await f.service.clearTracking({orderId:o.id,shipmentId:p.id,trackingRevision:1},owner);
 assert.equal(p.trackingNumber,null);assert.equal(p.trackingUrl,null);assert.equal(o.deliveryTrackingCode,null);assert.equal(f.state.legacyShipments[0].trackingNumber,null);
 for(const key of ['status','shippedAt','deliveredAt','atelierCostMinor','customerChargeMinor','currency'])assert.equal(p[key],before[key],key);
 assert.deepEqual(f.state.notifications,notifications);assert.equal(f.calls.length,0);
 assert.equal(f.state.activities.at(-1).type,'SHIPMENT_TRACKING_CLEARED');assert.equal(f.state.audits.at(-1).before.trackingNumber,before.trackingNumber);
 await assert.rejects(()=>f.service.preview(selection,actor),/проверенной ссылкой/);
});

test('non-primary tracking removal preserves matching primary copies; hostile language and scope changes are rejected',async()=>{
 const f=fixture(),owner={id:'owner',role:'OWNER'},p=f.state.parcels[0],o=f.state.orders[0],n=p.trackingNumber;
 o.deliveryTrackingCode=n;f.state.legacyShipments.push({orderId:o.id,trackingNumber:n});
 await assert.rejects(()=>f.service.saveTrackingUrl({orderId:o.id,shipmentId:p.id,trackingRevision:1,language:'xx'},owner),/язык/);
 await assert.rejects(()=>f.service.saveTrackingUrl({orderId:o.id,shipmentId:p.id,trackingRevision:1,language:'en',trackingUrl:'https://evil.test'},owner),/язык/);
 await assert.rejects(()=>f.service.clearTracking({orderId:'order-2',shipmentId:p.id,trackingRevision:1},owner),/изменились/);
 await f.service.clearTracking({orderId:o.id,shipmentId:p.id,trackingRevision:1},owner);
 assert.equal(o.deliveryTrackingCode,n);assert.equal(f.state.legacyShipments[0].trackingNumber,n);
});

test('tracking options reject missing identifiers rather than querying an arbitrary parcel',async()=>{
 const f=fixture();
 for(const ids of [[undefined,'parcel-1'],['order-1',undefined],['','parcel-1'],['order-1','']])await assert.rejects(()=>f.service.trackingOptions(...ids),/Укажите заказ/);
});

test('tracking clear rolls back the identity and legacy copies when its audit cannot be written',async()=>{
 const f=fixture(),p=f.state.parcels[0],o=f.state.orders[0];Object.assign(p,{isPrimary:true});o.deliveryTrackingCode=p.trackingNumber;
 f.state.legacyShipments.push({orderId:o.id,trackingNumber:p.trackingNumber});const before=copy(f.state);
 f.service.p.auditLog.create=async()=>{throw Error('audit unavailable')};
 await assert.rejects(()=>f.service.clearTracking({orderId:o.id,shipmentId:p.id,trackingRevision:1},{id:'owner',role:'OWNER'}),/audit unavailable/);
 assert.deepEqual(f.state,before);
});

test('primary tracking clear leaves nonmatching legacy waybills untouched and archived parcels unavailable',async()=>{
 const f=fixture(),p=f.state.parcels[0],o=f.state.orders[0];p.isPrimary=true;o.deliveryTrackingCode='DIFFERENT';f.state.legacyShipments.push({orderId:o.id,trackingNumber:'DIFFERENT'});
 await f.service.clearTracking({orderId:o.id,shipmentId:p.id,trackingRevision:1},{id:'owner',role:'OWNER'});
 assert.equal(o.deliveryTrackingCode,'DIFFERENT');assert.equal(f.state.legacyShipments[0].trackingNumber,'DIFFERENT');
 await assert.rejects(()=>f.service.clearTracking({orderId:o.id,shipmentId:'parcel-archived',trackingRevision:1},{id:'owner',role:'OWNER'}),/изменились/);
});
