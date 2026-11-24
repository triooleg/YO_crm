import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const source = new URL('../src/communications/inbox-first-email.ts', import.meta.url);
function helper() {
  const module = { exports: {} };
  const js = ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', js)(require, module, module.exports);
  return module.exports.prepareFirstInboxEmail;
}

function fixture({ email = ' Buyer@example.test ', conversation = null, otherMapping = null, duplicate = null, redirect = null, previousInbound = null } = {}) {
  const writes = [];
  const lockKeys = [];
  const tx = {
    $executeRaw: async (_query, key) => lockKeys.push(key),
    $queryRaw: async (query) => query.join('').includes('FOR SHARE') ? [{email}] : otherMapping || duplicate || redirect || previousInbound ? [] : [{clientId:'buyer'}],
    client: { findFirst: async ({where}) => where.id === 'buyer' ? { email } : duplicate },
    conversation: {
      findUnique: async () => conversation,
      findFirst: async () => otherMapping,
      create: async ({data}) => { writes.push(['create', data]); return {id:'email-thread'}; },
      update: async ({where,data}) => { writes.push(['update', where, data]); return {id:where.id}; },
    },
    clientMergeRedirect: { findFirst: async () => redirect },
    message: { findFirst: async () => previousInbound },
    auditLog: { create: async ({data}) => writes.push(['audit', data]) },
  };
  return { writes, lockKeys, db: { $transaction: run => run(tx) } };
}
const recipient = 'buyer@example.test';
const start = (db) => db.$transaction(tx => helper()(tx, 'buyer', recipient, 'operator', recipient));

test('first Inbox email creates a canonical conversation on the existing buyer, then audits without sending', async () => {
  const {db,writes,lockKeys} = fixture();
  assert.deepEqual(await start(db), {id:'email-thread',linked:true});
  assert.deepEqual(writes[0], ['create',{clientId:'buyer',channel:'EMAIL',externalId:recipient}]);
  assert.equal(writes[1][1].actorId, 'operator');
  assert.equal(writes[1][1].entityId, 'email-thread');
  assert.equal(JSON.stringify(writes[1]).includes(recipient), false);
  assert.deepEqual(lockKeys, ['inbound:EMAIL:'+recipient, 'client-merge-global', 'client-merge:buyer']);
});

test('a draft-only email conversation gains the address and retains its identity', async () => {
  const {db,writes} = fixture({conversation:{id:'draft-thread',externalId:null,archivedAt:null}});
  assert.deepEqual(await start(db), {id:'draft-thread',linked:true});
  assert.deepEqual(writes[0], ['update',{id:'draft-thread'},{externalId:recipient}]);
});

test('existing exact mapping is reused without rewriting or creating history', async () => {
  const {db,writes} = fixture({conversation:{id:'linked',externalId:'Buyer@example.test',archivedAt:null},duplicate:{id:'other'}});
  assert.deepEqual(await start(db), {id:'linked',linked:false});
  assert.deepEqual(writes, []);
});

test('first email refuses changed address, archived or differently mapped threads and ambiguous ownership', async () => {
  for (const options of [
    {email:'changed@example.test'},
    {conversation:{id:'archived',externalId:recipient,archivedAt:new Date()}},
    {conversation:{id:'old',externalId:'old@example.test',archivedAt:null}},
    {otherMapping:{id:'foreign-thread'}},
    {duplicate:{id:'other-client'}},
    {redirect:{targetClientId:'merged-other'}},
    {conversation:{id:'ambiguous-history',externalId:null,archivedAt:null},previousInbound:{id:'inbound'}},
  ]) {
    const {db,writes}=fixture(options);
    await assert.rejects(start(db), {status:409});
    assert.deepEqual(writes, []);
  }
});
