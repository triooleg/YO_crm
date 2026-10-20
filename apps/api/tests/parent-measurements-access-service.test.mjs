import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url), ts = require('typescript');
require('reflect-metadata');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true,
  } }).outputText;
  new Function('require', 'module', 'exports', source)(name => {
    if (name.endsWith('/prisma.service')) return { PrismaService: class {} };
    const target = resolve(dirname(file), name + '.ts');
    return name.startsWith('.') && existsSync(target) ? load(target) : require(name);
  }, module, module.exports);
  return module.exports;
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src/parent-measurements');
const tokenFrom = url => {const p=new URLSearchParams(new URL(url).hash.slice(1));return p.get('invite')??p.get('recovery');};
test('issued language is carried in the safe fragment and used when a caller has no preference',async()=>{
 const {service}=fixture();const invite=await service.issue('order',{mode:'SHARED',days:7,locale:'fr'},'staff');
 const url=new URL(invite.url);assert.equal(url.search,'');assert.equal(new URLSearchParams(url.hash.slice(1)).get('lang'),'fr');
 assert.equal((await service.start(tokenFrom(invite.url),undefined,true)).session.locale,'fr');
});
const unavailable = error => error.getStatus?.() === 401 && error.message === 'Ссылка или сессия недоступна';

// Transactional Prisma boundary model: rollback + serial execution. It is NOT
// proof of PostgreSQL advisory/row locks; MAIN must run real database races.
function fixture() {
  const state = {
    user: [{ id: 'staff', role: 'MANAGER', active: true }, { id: 'production', role: 'PRODUCTION', active: true }],
    client: [{ id: 'client', archivedAt: null }, { id: 'other-client', archivedAt: null }],
    order: [{ id: 'order', clientId: 'client', number: 'PM-TEST', salesStatus: 'CONFIRMED', archivedAt: null }],
    measurementInvitation: [], measurementParticipant: [], measurementParticipantCredential: [],
    measurementParticipantChild: [], measurementSubmission: [], measurementPublicEvent: [], measurementDraftAsset: [], auditLog: [], activity: [],
  };
  let nextId = 0, failAudit = false, queue = Promise.resolve();
  const compare = (value, condition) => {
    if (condition instanceof Date) return value?.getTime() === condition.getTime();
    if (condition && typeof condition === 'object') return Object.entries(condition).every(([op, other]) => {
      if (op === 'in') return other.includes(value);
      if (op === 'not') return !compare(value, other);
      if (op === 'lt') return value < other;
      if (op === 'gt') return value > other;
      if (op === 'lte') return value <= other;
      return compare(value?.[op], other);
    });
    return value === condition;
  };
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(part => matches(row, part));
    if (key === 'AND') return value.every(part => matches(row, part));
    return compare(row[key], value);
  });
  const database = snapshot => {
    const db = {
      $executeRaw: async () => 1,
      $queryRaw: async strings => String(strings.join('')).includes('clock_timestamp') ? [{ now: new Date() }] : [],
    };
    for (const table of Object.keys(state)) {
      const rows = where => snapshot[table].filter(row => matches(row, where));
      db[table] = {
        findUnique: async ({ where }) => rows(where)[0] ?? null,
        findFirst: async ({ where, orderBy }) => {
          const found = rows(where);
          if (orderBy) { const [key, direction] = Object.entries(orderBy)[0]; found.sort((a, b) => (a[key] > b[key] ? 1 : -1) * (direction === 'desc' ? -1 : 1)); }
          return found[0] ?? null;
        },
        findMany: async ({ where, take = 10000 } = {}) => rows(where).slice(0, take),
        count: async ({ where } = {}) => rows(where).length,
        create: async ({ data }) => {
          if (table === 'auditLog' && failAudit) throw new Error('audit unavailable');
          const row = { id: `test-${++nextId}`, createdAt: new Date(), updatedAt: new Date(),
            revokedAt: null, consumedAt: null, archivedAt: null, rootId: null, admittedCount: 0, generation: 0,
            ...structuredClone(data) };
          snapshot[table].push(row); return row;
        },
        updateMany: async ({ where, data }) => {
          const found = rows(where);
          for (const row of found) for (const [key, value] of Object.entries(data)) {
            row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value;
          }
          return { count: found.length };
        },
        update: async ({ where, data }) => {
          const row = rows(where)[0]; if (!row) throw Error('missing');
          for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value;
          return row;
        },
      };
    }
    return db;
  };
  const prisma = database(state);
  prisma.$transaction = callback => {
    const operation = queue.then(async () => {
      const draft = structuredClone(state), result = await callback(database(draft));
      Object.assign(state, draft); return result;
    });
    queue = operation.catch(() => {}); return operation;
  };
  const { ParentMeasurementsAccessService } = load(resolve(root, 'parent-measurements-access.service.ts'));
  return { state, prisma, service: new ParentMeasurementsAccessService(prisma, async () => {}), failAudit: () => { failAudit = true; } };
}

test('three parents enter one invite with distinct secrets and read only their own drafts', async () => {
  const { service, state } = fixture();
  const invite = await service.issue('order', { mode: 'SHARED', days: 14, locale: 'en' }, 'staff');
  const parents = await Promise.all(Array.from({ length: 3 }, () => service.start(tokenFrom(invite.url), 'en', true)));
  assert.equal(new Set(parents.map(parent => parent.cookieToken)).size, 3);
  const contexts = await Promise.all(parents.map(parent => service.authenticate(parent.cookieToken)));
  for (let index = 0; index < 3; index++) state.measurementParticipantChild.push({ id: `child-${index}`, participantId: contexts[index].participantId, revision: 0, draft: { firstName: `Test ${index}` }, archivedAt: null });
  for (let index = 0; index < 3; index++) {
    const session = await service.session(contexts[index]);
    assert.deepEqual(session.children.map(child => child.id), [`child-${index}`]);
    assert.equal(session.orderNumber, 'PM-TEST');
    assert.equal(JSON.stringify(session).includes(parents[index].cookieToken), false);
  }
  const persisted = JSON.stringify(state);
  for (const secret of [tokenFrom(invite.url), ...parents.map(parent => parent.cookieToken)]) assert.equal(persisted.includes(secret), false);
  await assert.rejects(service.authenticate(tokenFrom(invite.url)), unavailable);
});

test('current owner, archive, closed order and credential generation are rechecked for existing contexts', async () => {
  const { service, state, prisma } = fixture();
  const invite = await service.issue('order', { mode: 'SHARED', days: 14 }, 'staff');
  const parent = await service.start(tokenFrom(invite.url), 'ru', true), context = await service.authenticate(parent.cookieToken);
  state.order[0].clientId = 'other-client';
  await assert.rejects(service.session(context), unavailable);
  state.order[0].clientId = 'client'; state.client[0].archivedAt = new Date();
  await assert.rejects(prisma.$transaction(tx => service.assertContext(tx, context)), unavailable);
  state.client[0].archivedAt = null; state.order[0].salesStatus = 'COMPLETED';
  await assert.rejects(service.authenticate(parent.cookieToken), unavailable);
  state.order[0].salesStatus = 'CONFIRMED'; state.measurementParticipant[0].generation++;
  await assert.rejects(service.session(context), unavailable);
});

test('root revocation closes nested share sessions and recovery; personal invites cannot expand', async () => {
  const { service } = fixture();
  const invite = await service.issue('order', { mode: 'SHARED', days: 14 }, 'staff');
  const parent = await service.start(tokenFrom(invite.url), 'en', true), context = await service.authenticate(parent.cookieToken);
  const share = await service.share(context);
  const child = await service.start(tokenFrom(share.url), 'fr', true), childContext = await service.authenticate(child.cookieToken);
  const nested = await service.share(childContext);
  const grandchild = await service.start(tokenFrom(nested.url), 'de', true);
  const recovery = await service.createRecovery(childContext);
  await service.revoke('order', share.id, 'staff');
  await assert.rejects(service.authenticate(child.cookieToken), unavailable);
  await assert.rejects(service.authenticate(grandchild.cookieToken), unavailable);
  await assert.rejects(service.recover(tokenFrom(recovery.url)), unavailable);
  // Revoking an intermediate link does not revoke its ancestor.
  assert.equal((await service.session(context)).children.length, 0);
  await service.revoke('order', invite.id, 'staff');
  await assert.rejects(service.session(context), unavailable);
  const personal = await service.issue('order', { mode: 'PERSONAL', days: 14 }, 'staff');
  const single = await service.start(tokenFrom(personal.url), 'en', true);
  await assert.rejects(service.share(await service.authenticate(single.cookieToken)), error => error.getStatus() === 403);
  await assert.rejects(service.start(tokenFrom(personal.url), 'en', true), unavailable);
});

test('recovery is one-use, rotates the session generation and retains the same private children', async () => {
  const { service, state } = fixture();
  const invite = await service.issue('order', { mode: 'SHARED', days: 14 }, 'staff');
  const parent = await service.start(tokenFrom(invite.url), 'it', true), context = await service.authenticate(parent.cookieToken);
  state.measurementParticipantChild.push({ id: 'own-child', participantId: context.participantId, revision: 2, draft: { firstName: 'Test child' }, archivedAt: null });
  const oldRecovery = await service.createRecovery(context), recovery = await service.createRecovery(context);
  await assert.rejects(service.recover(tokenFrom(oldRecovery.url)), unavailable);
  const results = await Promise.allSettled([service.recover(tokenFrom(recovery.url)), service.recover(tokenFrom(recovery.url))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const resumed = results.find(result => result.status === 'fulfilled').value;
  assert.notEqual(resumed.cookieToken, parent.cookieToken);
  assert.deepEqual(resumed.session.children.map(child => child.id), ['own-child']);
  await assert.rejects(service.authenticate(parent.cookieToken), unavailable);
  await assert.rejects(service.session(context), unavailable);
  await assert.rejects(service.authenticate(tokenFrom(recovery.url)), unavailable);
  await service.logout(await service.authenticate(resumed.cookieToken));
  await assert.rejects(service.authenticate(resumed.cookieToken), unavailable);
  assert.equal(JSON.stringify(state).includes(tokenFrom(recovery.url)), false);
});

test('sharing cannot amplify root admission budget and audit failure rolls back admission', async () => {
  const { service, state, failAudit } = fixture();
  const invite = await service.issue('order', { mode: 'SHARED', days: 14 }, 'staff');
  const parent = await service.start(tokenFrom(invite.url), 'en', true), context = await service.authenticate(parent.cookieToken);
  const share = await service.share(context);
  state.measurementInvitation.find(row => row.id === invite.id).admissionLimit = 2;
  await service.start(tokenFrom(share.url), 'en', true);
  await assert.rejects(service.start(tokenFrom(share.url), 'en', true), unavailable);
  state.measurementInvitation.find(row => row.id === invite.id).admissionLimit = 100;
  const before = structuredClone(state); failAudit();
  await assert.rejects(service.start(tokenFrom(share.url), 'en', true), /audit unavailable/);
  assert.deepEqual(state, before);
});

test('resume after revise does not mark the new draft as already submitted from an older revision', async () => {
  const { service, state } = fixture();
  const invite = await service.issue('order', { mode: 'SHARED', days: 14 }, 'staff');
  const parent = await service.start(tokenFrom(invite.url), 'en', true), context = await service.authenticate(parent.cookieToken);
  state.measurementParticipantChild.push({ id: 'child', participantId: context.participantId, revision: 2, draft: { firstName: 'Test' }, archivedAt: null });
  state.measurementSubmission.push({ id: 'old', participantId: context.participantId, childId: 'child', revision: 1, measurementId: 'old-measurement', reviewStatus: 'VERIFIED', submittedAt: new Date() });
  assert.equal((await service.session(context)).children[0].submitted, undefined);
  state.measurementSubmission.push({ id: 'current', participantId: context.participantId, childId: 'child', revision: 2, measurementId: 'current-measurement', reviewStatus: 'RECEIVED', submittedAt: new Date() });
  assert.deepEqual((await service.session(context)).children[0].submitted, { id: 'current', measurementId: 'current-measurement', reviewStatus: 'RECEIVED' });
});

test('expired ancestry and forged context identifiers fail uniformly without disclosing the order', async () => {
  const { service, state, prisma } = fixture();
  const invite = await service.issue('order', { mode: 'SHARED', days: 1 }, 'staff');
  const parent = await service.start(tokenFrom(invite.url), 'en', true), context = await service.authenticate(parent.cookieToken);
  assert.ok(parent.cookieExpiresAt <= invite.expiresAt);
  const another = await service.start(tokenFrom(invite.url), 'en', true), otherContext = await service.authenticate(another.cookieToken);
  await assert.rejects(prisma.$transaction(tx => service.assertContext(tx, { ...context, participantId: otherContext.participantId })), unavailable);
  for (const field of ['invitationId', 'clientIdAtIssue', 'credentialId', 'orderId']) {
    await assert.rejects(service.session({ ...context, [field]: 'unrelated-private-id' }), unavailable);
  }
  state.measurementInvitation[0].expiresAt = new Date(0);
  await assert.rejects(service.session(context), unavailable);
  await assert.rejects(service.start(tokenFrom(invite.url), 'en', true), unavailable);
});

test('staff authorization is independent of public capabilities; revoke is repeatable after closure', async () => {
  const { service, state } = fixture();
  await assert.rejects(service.issue('order', { mode: 'SHARED', days: 14 }, 'production'), error => error.getStatus() === 403);
  assert.equal(state.measurementInvitation.length, 0);
  const invite = await service.issue('order', { mode: 'SHARED', days: 14 }, 'staff');
  await assert.rejects(service.revoke('order', invite.id, 'production'), error => error.getStatus() === 403);
  state.order[0].salesStatus = 'COMPLETED';
  await service.revoke('order', invite.id, 'staff');
  const eventCount = state.measurementPublicEvent.length;
  await service.revoke('order', invite.id, 'staff');
  assert.equal(state.measurementPublicEvent.length, eventCount);
  assert.equal(state.measurementPublicEvent.at(-1).staffActorId, 'staff');
});

test('without Redis a default service never admits a participant or changes admission counts', async () => {
  const { service, state, prisma } = fixture();
  const invite = await service.issue('order', { mode: 'SHARED', days: 14 }, 'staff');
  const { ParentMeasurementsAccessService } = load(resolve(root, 'parent-measurements-access.service.ts'));
  const defaultService = new ParentMeasurementsAccessService(prisma), before = structuredClone(state);
  const previous = process.env.REDIS_URL;
  try {
    delete process.env.REDIS_URL;
    await assert.rejects(defaultService.start(tokenFrom(invite.url), 'en', true), error => error.getStatus() === 503);
    assert.deepEqual(state, before);
  } finally { if (previous === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previous; }
});

test('personal concurrent admission has one winner in the transactional boundary model', async () => {
  const { service } = fixture();
  const invite = await service.issue('order', { mode: 'PERSONAL', days: 14 }, 'staff');
  const results = await Promise.allSettled([service.start(tokenFrom(invite.url), 'en', true), service.start(tokenFrom(invite.url), 'fr', true)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && unavailable(result.reason)).length, 1);
});

test('shared-link issuance attributes the parent actor and records the new invitation ID, never its secret', async () => {
  const { service, state } = fixture();
  const invite = await service.issue('order', { mode: 'SHARED', days: 14 }, 'staff');
  const parent = await service.start(tokenFrom(invite.url), 'en', true), context = await service.authenticate(parent.cookieToken);
  const shared = await service.share(context), event = state.measurementPublicEvent.at(-1);
  assert.equal(event.actorType, 'PUBLIC_PARTICIPANT'); assert.equal(event.staffActorId, null);
  assert.equal(event.participantId, context.participantId);
  assert.equal(event.metadata.issuedInvitationId, shared.id);
  assert.equal(state.auditLog.at(-1).after.issuedInvitationId, shared.id);
  assert.equal(JSON.stringify(state).includes(tokenFrom(shared.url)), false);
});

test('session exposes a guarded photo URL only for an active asset scoped to its own child and participant', async () => {
  const { service, state } = fixture();
  const invite = await service.issue('order', { mode: 'SHARED', days: 14 }, 'staff');
  const parent = await service.start(tokenFrom(invite.url), 'en', true), context = await service.authenticate(parent.cookieToken);
  state.measurementParticipantChild.push({ id: 'child', participantId: context.participantId, revision: 0, draft: { firstName: 'Test' }, archivedAt: null });
  assert.equal('photoUrl' in (await service.session(context)).children[0], false);
  state.measurementDraftAsset.push(
    { id: 'foreign', childId: 'child', participantId: 'other-parent', archivedAt: null, storageKey: 'private-foreign-key' },
    { id: 'archived', childId: 'child', participantId: context.participantId, archivedAt: new Date(), storageKey: 'private-old-key' },
    { id: 'different-child', childId: 'other-child', participantId: context.participantId, archivedAt: null, storageKey: 'private-other-key' },
  );
  assert.equal('photoUrl' in (await service.session(context)).children[0], false);
  state.measurementDraftAsset.push({ id: 'own', childId: 'child', participantId: context.participantId, archivedAt: null, storageKey: 'private-current-key' });
  const session = await service.session(context);
  assert.equal(session.children[0].photoUrl, '/api/public/parent-measurements/photos/child');
  assert.equal(JSON.stringify(session).includes('private-'), false);
  assert.equal(JSON.stringify(session).includes('storageKey'), false);
});
