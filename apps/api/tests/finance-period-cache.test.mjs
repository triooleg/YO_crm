import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
// Same transpile-and-execute seam as finance-source-cache.test.mjs.
const filename = new URL('../src/finance/finance-period-cache.ts', import.meta.url);
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename: filename.pathname })(require, module, module.exports);
const { FinancePeriodCache, FinancePeriodCacheBusyError } = module.exports;

let pgModule = process.env.FINANCE_TEST_PGLITE_MODULE;
// Reuse the database workspace's declared test dependency, no API dependency added.
try { pgModule ??= createRequire(new URL('../../../packages/database/package.json', import.meta.url)).resolve('@electric-sql/pglite'); } catch { /* optional local engine */ }
const pgTest = (name, run) => test(name, { skip: !pgModule }, run);
const input = { period: '2026-10', scope: 'summary:UAH', dependencies: ['payments', 'orders'], calculationVersion: '1', taxPolicyVersion: '1', fxVersion: '1' };
async function fixture(t, options = {}) {
  const { PGlite } = await import(pathToFileURL(pgModule).href);
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`
    CREATE TABLE "FinanceReportRevision" (key text PRIMARY KEY, revision bigint NOT NULL);
    INSERT INTO "FinanceReportRevision" VALUES ('payments',1),('orders',1);
    CREATE TABLE coverage (enabled boolean); INSERT INTO coverage VALUES (true);
    CREATE FUNCTION yo_finance_cache_coverage() RETURNS boolean LANGUAGE sql AS 'SELECT enabled FROM coverage';
    CREATE TABLE "FinancePeriodSnapshot" (
      key text PRIMARY KEY, period text NOT NULL, scope text NOT NULL, "sourceRevision" text NOT NULL,
      "calculationVersion" text NOT NULL, "taxPolicyVersion" text NOT NULL, "fxVersion" text NOT NULL,
      "calculatedAt" timestamptz NOT NULL, status text NOT NULL, payload jsonb, checksum text,
      "leaseToken" text, "leaseUntil" timestamptz);
    CREATE TABLE "FinanceReportCacheRow" (
      "snapshotKey" text REFERENCES "FinancePeriodSnapshot"(key) ON DELETE CASCADE,
      kind text, id text, payload jsonb NOT NULL, ordinal int NOT NULL,
      PRIMARY KEY ("snapshotKey",kind,id));
    CREATE TABLE sources (amount int); INSERT INTO sources VALUES (2000);
  `);
  const client = db => ({ $queryRawUnsafe: async (sql, ...params) => (await db.query(sql, params)).rows });
  const prisma = { ...client(pg), $transaction: (run, opts) => {
    assert.equal(opts.isolationLevel, 'RepeatableRead');
    return pg.transaction(async tx => { await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); return run(client(tx)); });
  } };
  const cache = new FinancePeriodCache(prisma, { pollMs: 2, maxPolls: 100, ...options });
  let reads = 0, projects = 0;
  const read = async tx => { reads++; return (await tx.$queryRawUnsafe('SELECT amount FROM sources'))[0].amount; };
  const project = async amount => { projects++; return { payload: { amount, missing: null, incomplete: true }, rows: [{ kind: 'payment', id: 'p1', ordinal: 0, payload: { amount } }] }; };
  const get = (request = input, projector = project) => cache.read(request, read, projector);
  return { pg, prisma, cache, read, project, get, counts: () => ({ reads, projects }) };
}

pgTest('READY summary survives a new engine instance and retains null/incomplete without loading derivative rows', async t => {
  const f = await fixture(t);
  const first = await f.get();
  assert.equal(first.hit, false);
  assert.deepEqual(first.payload, { amount: 2000, missing: null, incomplete: true });
  first.payload.amount = 3;
  const restarted = new FinancePeriodCache(f.prisma);
  const second = await restarted.read(input, f.read, f.project);
  assert.equal(second.hit, true);
  assert.equal(second.payload.amount, 2000);
  assert.equal(second.sourceRevision, first.sourceRevision);
  assert.deepEqual(f.counts(), { reads: 1, projects: 1 });
  assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM "FinanceReportCacheRow"')).rows[0].n, 1);
});

pgTest('missing/disabled/failed coverage and missing revision keys bypass without reading business sources', async t => {
  const f = await fixture(t);
  await f.pg.exec('UPDATE coverage SET enabled=false');
  assert.equal(await f.get(), null);
  await f.pg.exec('UPDATE coverage SET enabled=true');
  assert.equal(await f.get({ ...input, dependencies: ['missing'] }), null);
  await f.pg.exec('DROP FUNCTION yo_finance_cache_coverage()');
  assert.equal(await f.get(), null);
  assert.deepEqual(f.counts(), { reads: 0, projects: 0 });
});

pgTest('revision changes and corrupt/non-READY payloads recompute, derivative rows are replaced', async t => {
  const f = await fixture(t);
  const first = await f.get();
  await f.pg.exec(`UPDATE sources SET amount=2500; UPDATE "FinanceReportRevision" SET revision=revision+1 WHERE key='payments'`);
  const next = await f.get();
  assert.equal(next.payload.amount, 2500);
  assert.notEqual(next.sourceRevision, first.sourceRevision);
  for (const change of ["payload='{\"amount\":42}'::jsonb", "checksum=NULL", "status='DIRTY'", "status='FAILED'", "\"calculatedAt\"='infinity'::timestamptz"]) {
    await f.pg.query(`UPDATE "FinancePeriodSnapshot" SET ${change} WHERE key=$1`, [next.key]);
    const repaired = await f.get();
    assert.equal(repaired.hit, false, change);
    assert.equal(repaired.payload.amount, 2500, change);
    assert.equal((await f.get()).hit, true);
  }
  assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM "FinanceReportCacheRow"')).rows[0].n, 2);
});

pgTest('calculation, tax, FX, scope, period and dependency identities do not alias', async t => {
  const f = await fixture(t);
  const keys = new Set([(await f.get()).key]);
  for (const variant of [{ calculationVersion: '2' }, { taxPolicyVersion: '2' }, { fxVersion: '2' }, { scope: 'summary:EUR' }, { period: '2026-09' }, { dependencies: ['orders'] }]) {
    const result = await f.get({ ...input, ...variant });
    assert.equal(result.hit, false);
    keys.add(result.key);
  }
  assert.equal(keys.size, 7);
  assert.equal((await f.get({ ...input, dependencies: ['orders', 'payments', 'orders'] })).hit, true);
});

pgTest('revision change during external projection discards result and retries sources in a fresh RR transaction', async t => {
  const f = await fixture(t); let calls = 0;
  const result = await f.get(input, async amount => {
    if (++calls === 1) await f.pg.exec(`UPDATE sources SET amount=3000; UPDATE "FinanceReportRevision" SET revision=2 WHERE key='payments'`);
    return { payload: { amount } };
  });
  assert.equal(result.payload.amount, 3000);
  assert.equal(calls, 2);
  assert.equal((await f.get()).payload.amount, 3000);
});

pgTest('continuous invalidation and lost coverage during projection are bounded bypasses', async t => {
  const f = await fixture(t, { maxRetries: 1 }); let calls = 0;
  assert.equal(await f.get(input, async amount => {
    calls++; await f.pg.exec('UPDATE "FinanceReportRevision" SET revision=revision+1');
    return { payload: { amount } };
  }), null);
  assert.equal(calls, 2);
  assert.equal(await f.get(input, async amount => {
    await f.pg.exec('UPDATE coverage SET enabled=false'); return { payload: { amount } };
  }), null);
  assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM "FinancePeriodSnapshot" WHERE status=\'READY\'')).rows[0].n, 0);
});

pgTest('independent concurrent engine instances wait for one DB winner with no duplicate calculation', async t => {
  const f = await fixture(t); let calls = 0;
  const project = async amount => { calls++; await new Promise(resolve => setTimeout(resolve, 25)); return { payload: { amount } }; };
  const results = await Promise.all(Array.from({ length: 8 }, () => new FinancePeriodCache(f.prisma, { pollMs: 2 }).read(input, f.read, project)));
  assert.equal(calls, 1);
  assert.equal(f.counts().reads, 1);
  assert.ok(results.every(result => result?.payload.amount === 2000));
  assert.equal(results.filter(result => !result.hit).length, 1);
});

pgTest('active crashed leases have bounded waits and expired leases recover', async t => {
  const f = await fixture(t, { maxPolls: 2 });
  const first = await f.get();
  await f.pg.query(`UPDATE "FinancePeriodSnapshot" SET status='CALCULATING',"leaseToken"='crashed',"leaseUntil"=clock_timestamp()+interval '1 hour' WHERE key=$1`, [first.key]);
  await assert.rejects(f.get(), error => error.code === 'FINANCE_PERIOD_CACHE_BUSY' && error.getStatus() === 503);
  assert.equal(f.counts().projects, 1);
  await f.pg.exec(`UPDATE "FinancePeriodSnapshot" SET "leaseUntil"=clock_timestamp()-interval '1 second'`);
  assert.equal((await f.get()).hit, false);
  assert.equal((await f.get()).hit, true);
});

pgTest('expired old owner cannot overwrite a newer owner or its derivative rows', async t => {
  const f = await fixture(t, { maxRetries: 0 });
  let started, resume;
  const entered = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { resume = resolve; });
  const old = f.get(input, async () => { started(); await blocked; return { payload: { owner: 'old' }, rows: [{ kind: 'x', id: 'old', payload: null, ordinal: 0 }] }; });
  await entered;
  await f.pg.exec(`UPDATE "FinancePeriodSnapshot" SET "leaseUntil"=clock_timestamp()-interval '1 second'`);
  const winner = await new FinancePeriodCache(f.prisma).read(input, f.read, async () => ({ payload: { owner: 'new' }, rows: [{ kind: 'x', id: 'new', payload: null, ordinal: 0 }] }));
  resume();
  assert.equal(await old, null);
  assert.equal(winner.payload.owner, 'new');
  assert.equal((await f.get()).payload.owner, 'new');
  assert.deepEqual((await f.pg.query('SELECT id FROM "FinanceReportCacheRow"')).rows, [{ id: 'new' }]);
});

pgTest('business/source/project failures propagate unchanged and release failed leases', async t => {
  const f = await fixture(t);
  for (const stage of ['source', 'project']) {
    const failure = new Error(`business ${stage}`);
    await assert.rejects(f.cache.read(input, stage === 'source' ? async () => { throw failure; } : f.read,
      stage === 'project' ? async () => { throw failure; } : f.project), error => error === failure);
    assert.equal((await f.pg.query('SELECT status FROM "FinancePeriodSnapshot"')).rows[0].status, 'FAILED');
  }
  assert.equal((await f.get()).payload.amount, 2000);
});

pgTest('cache SQL/callback failure bypasses, failed atomic row publication never leaves READY', async t => {
  const f = await fixture(t); let failCommit = true;
  const broken = new FinancePeriodCache({ ...f.prisma, $transaction: async (run, opts) => f.prisma.$transaction(async tx => {
    const result = await run(tx); if (failCommit) throw Error('commit failed'); return result;
  }, opts) });
  assert.equal(await broken.read(input, f.read, f.project), null);
  assert.equal(f.counts().reads, 0);
  failCommit = false;
  await f.pg.exec(`ALTER TABLE "FinanceReportCacheRow" ADD CONSTRAINT reject_rows CHECK (ordinal <> 0)`);
  assert.equal(await f.get(), null);
  assert.equal((await f.pg.query('SELECT status FROM "FinancePeriodSnapshot"')).rows[0].status, 'FAILED');
  await f.pg.exec('ALTER TABLE "FinanceReportCacheRow" DROP CONSTRAINT reject_rows');
  assert.equal((await f.get()).hit, false);
});

pgTest('strict JSON rejects BigInt, undefined, Date, NaN, accessors, cycles, symbols and sparse arrays', async t => {
  const f = await fixture(t); const cycle = {}; cycle.self = cycle;
  const accessorArray = []; Object.defineProperty(accessorArray, '0', { enumerable: true, get() { return 1; } });
  const hidden = {}; Object.defineProperty(hidden, 'ignored', { value: 3n });
  for (const payload of [1n, undefined, { dropped: undefined }, new Date(), NaN, Infinity, -0, cycle, Symbol('x'), () => {}, [, 1], new Map(), { [Symbol('x')]: 1 }, { get amount() { return 2; } }, accessorArray, hidden]) {
    await assert.rejects(f.get(input, async () => ({ payload })), TypeError);
  }
  assert.equal((await f.get()).payload.missing, null);
});

pgTest('uncacheable results retain null and return key=null, never a durable READY hit', async t => {
  const f = await fixture(t);
  for (let n = 0; n < 2; n++) {
    const result = await f.get(input, async () => ({ payload: null, cacheable: false }));
    assert.equal(result.key, null); assert.equal(result.payload, null); assert.equal(result.hit, false);
  }
  assert.equal((await f.get()).hit, false);
});

pgTest('key/period invalidation atomically revokes active owners and supports lazy rebuild', async t => {
  const f = await fixture(t);
  const first = await f.get();
  await f.get({ ...input, period: '2026-09' });
  assert.equal(await f.cache.invalidate({ key: first.key }), 1);
  assert.equal((await f.get()).hit, false);
  assert.equal((await f.get({ ...input, period: '2026-09' })).hit, true);
  assert.equal(await f.cache.invalidate({ period: '2026-10' }), 1);
  assert.equal(await f.cache.invalidate({ period: '2020-01' }), 0);
  assert.equal((await f.get()).hit, false);
  assert.equal((await f.pg.query('SELECT amount FROM sources')).rows[0].amount, 2000);
  assert.equal(f.cache.diagnostics().cache_invalidation, f.cache.diagnostics().invalidation);
  assert.ok(f.cache.diagnostics().cache_invalidation >= 2);
});

pgTest('diagnostic counters are numeric aggregates without keys, personal data or payloads', async t => {
  const f = await fixture(t);
  await f.get(); await f.get();
  const counters = f.cache.diagnostics();
  assert.deepEqual(Object.keys(counters).sort(), ['cache_hit','cache_miss','invalidation','cache_invalidation','recalculated_periods','report_duration_ms','sql_query_count','sql_duration_ms','cache_age','cache_revision','background_recalculation_errors'].sort());
  assert.equal(counters.cache_hit, 1); assert.equal(counters.cache_miss, 1); assert.equal(counters.recalculated_periods, 1);
  assert.ok(counters.sql_query_count > 0); assert.ok(counters.cache_revision > 0);
  assert.ok(Object.values(counters).every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0));
  counters.cache_hit = 100;
  assert.equal(f.cache.diagnostics().cache_hit, 1);
});

pgTest('serialization/deadlock conflicts retry whole cache transactions within a bounded limit', async t => {
  const f = await fixture(t); let attempts = 0;
  const conflicted = new FinancePeriodCache({ ...f.prisma, $transaction: async (run, opts) => {
    if (++attempts <= 2) throw Object.assign(new Error('serialization'), { code: 'P2034' });
    return f.prisma.$transaction(run, opts);
  } }, { pollMs: 1 });
  assert.equal((await conflicted.read(input, f.read, f.project)).payload.amount, 2000);
  assert.deepEqual(f.counts(), { reads: 1, projects: 1 });
  let failedAttempts = 0;
  const alwaysConflicted = new FinancePeriodCache({ ...f.prisma, $transaction: async () => {
    failedAttempts++; throw Object.assign(new Error('deadlock'), { code: '40P01' });
  } }, { pollMs: 1, maxRetries: 1 });
  assert.equal(await alwaysConflicted.read(input, f.read, f.project), null);
  assert.equal(failedAttempts, 2);
});

pgTest('revision vectors are independent of PostgreSQL collation and retain bigint precision', async t => {
  const f = await fixture(t);
  await f.pg.query('INSERT INTO "FinanceReportRevision" (key,revision) VALUES ($1,9007199254740993),($2,1)', ['😀', '\uE000']);
  const request = { ...input, dependencies: ['\uE000', '😀'] };
  const first = await f.get(request);
  assert.equal(first.hit, false);
  assert.equal((await f.get(request)).hit, true);
  await f.pg.query('UPDATE "FinanceReportRevision" SET revision=revision+1 WHERE key=$1', ['😀']);
  const second = await f.get(request);
  assert.equal(second.hit, false);
  assert.notEqual(second.sourceRevision, first.sourceRevision);
});

pgTest('sources bind to the fresh post-lease snapshot, not the initial miss probe', async t => {
  const f = await fixture(t); let transactions = 0;
  const cache = new FinancePeriodCache({ ...f.prisma, $transaction: async (run, opts) => {
    const result = await f.prisma.$transaction(run, opts);
    if (++transactions === 2) await f.pg.exec(`UPDATE sources SET amount=9000; UPDATE "FinanceReportRevision" SET revision=2`);
    return result;
  } });
  const result = await cache.read(input, f.read, f.project);
  assert.equal(result.payload.amount, 9000);
  assert.deepEqual(f.counts(), { reads: 1, projects: 1 });
  assert.equal((await f.get()).hit, true);
});

pgTest('invalidation during projection revokes the old lease token', async t => {
  const f = await fixture(t, { maxRetries: 0 });
  const result = await f.get(input, async amount => {
    assert.equal(await f.cache.invalidate({ period: input.period }), 1);
    return { payload: { amount } };
  });
  assert.equal(result, null);
  assert.equal((await f.get()).hit, false);
});

test('unavailable cache SQL fails closed without hiding or invoking business work', async () => {
  const unavailable = async () => { throw new Error('SQL unavailable'); };
  const cache = new FinancePeriodCache({ $queryRawUnsafe: unavailable, $transaction: unavailable });
  assert.equal(await cache.read(input, () => assert.fail('sources must not run'), () => assert.fail('project must not run')), null);
  assert.equal(await cache.invalidate({ period: '2026-10' }), null);
  assert.equal(cache.diagnostics().background_recalculation_errors, 2);
});

pgTest('transient source SQL conflicts retry fresh RR but exhausted source errors still propagate unchanged', async t => {
  const f = await fixture(t, { pollMs: 1, maxRetries: 1 });
  let reads = 0;
  const transient = Object.assign(new Error('source serialization'), { code: 'P2034' });
  const result = await f.cache.read(input, async tx => {
    if (++reads === 1) throw transient;
    return f.read(tx);
  }, f.project);
  assert.equal(result.payload.amount, 2000);
  assert.equal(reads, 2);
  await f.cache.invalidate({ period: input.period });
  reads = 0;
  await assert.rejects(f.cache.read(input, async () => { reads++; throw transient; }, f.project), error => error === transient);
  assert.equal(reads, 2);
});

pgTest('source capture enforces read-only and preserves attempted-write errors', async t => {
  const f = await fixture(t);
  await assert.rejects(f.cache.read(input, tx => tx.$queryRawUnsafe('UPDATE sources SET amount=1 RETURNING amount'), f.project),
    error => error.code === '25006');
  assert.equal((await f.pg.query('SELECT amount FROM sources')).rows[0].amount, 2000);
});

pgTest('a lease displaced before source capture never reads sources or runs projection', async t => {
  const f = await fixture(t); let transactions = 0;
  const cache = new FinancePeriodCache({ ...f.prisma, $transaction: async (run, opts) => {
    const result = await f.prisma.$transaction(run, opts);
    if (++transactions === 2) await f.pg.exec(`UPDATE "FinancePeriodSnapshot" SET "leaseToken"='replacement'`);
    return result;
  } });
  assert.equal(await cache.read(input, f.read, f.project), null);
  assert.deepEqual(f.counts(), { reads: 0, projects: 0 });
});

pgTest('lost publication COMMIT acknowledgement bypasses but does not erase the committed winner', async t => {
  const f = await fixture(t); let transactions = 0;
  const cache = new FinancePeriodCache({ ...f.prisma, $transaction: async (run, opts) => {
    const result = await f.prisma.$transaction(run, opts);
    if (++transactions === 4) throw Error('COMMIT acknowledgement lost');
    return result;
  } });
  assert.equal(await cache.read(input, f.read, f.project), null);
  assert.equal((await f.get()).hit, true);
  assert.deepEqual(f.counts(), { reads: 1, projects: 1 });
});

pgTest('revision-specific artifact keys keep an old summary bound to its old rows after a newer publication', async t => {
  const f = await fixture(t);
  const first = await f.get();
  await f.pg.exec(`UPDATE sources SET amount=4000; UPDATE "FinanceReportRevision" SET revision=2 WHERE key='payments'`);
  const second = await f.get();
  assert.notEqual(second.key, first.key);
  assert.equal(first.payload.amount, 2000);
  const oldRows = await f.pg.query('SELECT payload FROM "FinanceReportCacheRow" WHERE "snapshotKey"=$1', [first.key]);
  assert.deepEqual(oldRows.rows, [{ payload: { amount: 2000 } }]);
  assert.equal(await f.prisma.$transaction(tx => f.cache.verifyRows(tx, first.key, first), { isolationLevel: 'RepeatableRead' }), true);
});

pgTest('SQL rowset manifest detects missing, extra, changed payload, ordinal, id and kind without returning all rows', async t => {
  const f = await fixture(t);
  const result = await f.get();
  const verify = () => f.prisma.$transaction(tx => f.cache.verifyRows(tx, result.key, result), { isolationLevel: 'RepeatableRead' });
  assert.equal(await verify(), true);
  const [stored] = (await f.pg.query('SELECT payload FROM "FinancePeriodSnapshot" WHERE key=$1', [result.key])).rows;
  assert.deepEqual(stored.payload.data, result.payload);
  assert.equal(stored.payload._cacheRows.count, '1');
  assert.match(stored.payload._cacheRows.sha256, /^[a-f0-9]{64}$/);
  for (const mutation of [
    'DELETE FROM "FinanceReportCacheRow" WHERE "snapshotKey"=$1',
    `INSERT INTO "FinanceReportCacheRow" VALUES ($1,'extra','new','null',2)`,
    `UPDATE "FinanceReportCacheRow" SET payload='{"amount":999}' WHERE "snapshotKey"=$1`,
    'UPDATE "FinanceReportCacheRow" SET ordinal=10 WHERE "snapshotKey"=$1',
    `UPDATE "FinanceReportCacheRow" SET id='wrong' WHERE "snapshotKey"=$1`,
    `UPDATE "FinanceReportCacheRow" SET kind='wrong' WHERE "snapshotKey"=$1`,
  ]) {
    await f.pg.exec('BEGIN');
    try { await f.pg.query(mutation, [result.key]);
      // Already in RR fixture transaction is unnecessary for this isolated check.
      assert.equal(await f.cache.verifyRows(f.prisma, result.key, result), false, mutation);
    } finally { await f.pg.exec('ROLLBACK'); }
  }
  assert.equal(await verify(), true);
});

pgTest('empty/null/nested/unicode row manifests survive jsonb normalization and summary stays unwrapped', async t => {
  const f = await fixture(t);
  for (const rows of [[], [
    {kind:'я',id:'😀',ordinal:-1,payload:null},
    {kind:'A',id:'x',ordinal:1,payload:{ z:1e-7,a:[null,{nested:'é'}] }},
  ]]) {
    const result = await f.get({ ...input, scope: JSON.stringify(rows) }, async () => ({ payload: null, rows }));
    assert.equal(result.payload, null);
    assert.equal(await f.prisma.$transaction(tx => f.cache.verifyRows(tx, result.key, result), { isolationLevel: 'RepeatableRead' }), true);
    assert.equal((await f.get({ ...input, scope: JSON.stringify(rows) })).hit, true);
  }
});

pgTest('same-revision invalidation cannot replace an artifact with different summary or row content', async t => {
  const f = await fixture(t, { maxRetries: 0 });
  const first = await f.get();
  const checksum = (await f.pg.query('SELECT checksum FROM "FinancePeriodSnapshot" WHERE key=$1', [first.key])).rows[0].checksum;
  assert.equal(await f.cache.invalidate({ key: first.key }), 1);
  const different = async () => ({ payload: { amount: 999 }, rows: [{ kind: 'payment', id: 'p1', ordinal: 0, payload: { amount: 999 } }] });
  assert.equal(await f.get(input, different), null);
  assert.equal((await f.pg.query('SELECT checksum FROM "FinancePeriodSnapshot" WHERE key=$1', [first.key])).rows[0].checksum, checksum);
  assert.equal(await f.prisma.$transaction(tx => f.cache.verifyRows(tx, first.key, first), { isolationLevel: 'RepeatableRead' }), false);
  await f.pg.exec(`UPDATE "FinanceReportRevision" SET revision=2 WHERE key='payments'`);
  const next = await f.get(input, different);
  assert.notEqual(next.key, first.key);
  assert.equal(next.payload.amount, 999);
});

pgTest('verifyRows returns only an aggregate from the row table and binds caller summary in the page transaction', async t => {
  const f = await fixture(t);
  const result = await f.get(); let aggregates = 0;
  const verify = expected => f.prisma.$transaction(tx => f.cache.verifyRows({
    $queryRawUnsafe: async (sql, ...params) => {
      const rows = await tx.$queryRawUnsafe(sql, ...params);
      if (sql.includes('FROM "FinanceReportCacheRow"')) {
        aggregates++; assert.equal(rows.length, 1);
        assert.deepEqual(Object.keys(rows[0]).sort(), ['count','sha256']);
      }
      return rows;
    },
  }, result.key, expected), { isolationLevel: 'RepeatableRead' });
  assert.equal(await verify(result), true);
  assert.equal(aggregates, 1);
  for (const change of [{ payload: { amount: 7 } }, { sourceRevision: 'wrong' }, { calculatedAt: '2000-01-01T00:00:00.000Z' }]) {
    assert.equal(await verify({ ...result, ...change }), false);
  }
  const failure = new Error('domain page reader failed');
  await assert.rejects(f.prisma.$transaction(async tx => {
    assert.equal(await f.cache.verifyRows(tx, result.key, result), true);
    throw failure;
  }, { isolationLevel: 'RepeatableRead' }), error => error === failure);
  assert.equal(await f.cache.verifyRows({ $queryRawUnsafe: async () => { throw Error('storage failed'); } }, result.key), null);
});

pgTest('a revision change between probe and claim never acquires the old artifact for new sources', async t => {
  const f = await fixture(t); let transactions = 0;
  const cache = new FinancePeriodCache({ ...f.prisma, $transaction: async (run, opts) => {
    const result = await f.prisma.$transaction(run, opts);
    if (++transactions === 1) await f.pg.exec(`UPDATE sources SET amount=8000; UPDATE "FinanceReportRevision" SET revision=2`);
    return result;
  } });
  const result = await cache.read(input, f.read, f.project);
  assert.equal(result.payload.amount, 8000);
  assert.deepEqual(f.counts(), { reads: 1, projects: 1 });
  assert.equal((await f.get()).key, result.key);
  assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM "FinancePeriodSnapshot"')).rows[0].n, 1);
});

pgTest('row-verification storage failure rolls back its savepoint and leaves caller transaction usable', async t => {
  const f = await fixture(t);
  const result = await f.get();
  await f.pg.exec('ALTER TABLE "FinanceReportCacheRow" RENAME TO unavailable_rows');
  await f.prisma.$transaction(async tx => {
    assert.equal(await f.cache.verifyRows(tx, result.key, result), null);
    assert.equal((await tx.$queryRawUnsafe('SELECT amount FROM sources'))[0].amount, 2000);
  }, { isolationLevel: 'RepeatableRead' });
  await f.pg.exec('ALTER TABLE unavailable_rows RENAME TO "FinanceReportCacheRow"');
  assert.equal(await f.prisma.$transaction(tx => f.cache.verifyRows(tx, result.key), { isolationLevel: 'RepeatableRead' }), true);
});

pgTest('uncacheable retryable FX misses recover without revision changes and deterministic pending states have no TTL', async t => {
  const f = await fixture(t);
  const pending = await f.get(input, async () => ({ payload: { fiscal: { missing: [{ code: 'HISTORICAL_FX_UNAVAILABLE' }] } }, cacheable: false }));
  assert.equal(pending.key, null);
  const resolved = await f.get(input, async () => ({ payload: { fiscal: { missing: [{ code: 'RECEIPT_CONFIRMATION_REQUIRED' }] } } }));
  assert.notEqual(resolved.key, null);
  assert.equal(resolved.sourceRevision, pending.sourceRevision);
  await f.pg.query(`UPDATE "FinancePeriodSnapshot" SET "calculatedAt"='2000-01-01' WHERE key=$1`, [resolved.key]);
  const historical = await f.get(input, async () => assert.fail('deterministic pending state must not expire'));
  assert.equal(historical.hit, true);
  assert.equal(historical.payload.fiscal.missing[0].code, 'RECEIPT_CONFIRMATION_REQUIRED');
});

pgTest('outer RR revision expectation rejects stale raw sources before source read, project or publication', async t => {
  const f = await fixture(t);
  const expectedSourceRevision = await f.prisma.$transaction(tx => f.cache.revisionIn(tx, input.dependencies), { isolationLevel: 'RepeatableRead' });
  assert.match(expectedSourceRevision, /^[a-f0-9]{64}$/);
  await f.pg.exec(`UPDATE "FinanceReportRevision" SET revision=2 WHERE key='payments'`);
  assert.equal(await f.cache.read({ ...input, expectedSourceRevision },
    () => assert.fail('must not relabel old outer sources'), () => assert.fail('stale project must not run')), null);
  assert.deepEqual(f.counts(), { reads: 0, projects: 0 });
  assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM "FinancePeriodSnapshot"')).rows[0].n, 0);
  const latest = await f.get();
  assert.equal(await f.get({ ...input, expectedSourceRevision }, () => assert.fail('must not serve current cache for an old expected revision')), null);
  const currentRevision = await f.prisma.$transaction(tx => f.cache.revisionIn(tx, [...input.dependencies].reverse()), { isolationLevel: 'RepeatableRead' });
  assert.equal(currentRevision, latest.sourceRevision);
  assert.equal((await f.get({ ...input, expectedSourceRevision: currentRevision })).hit, true);
});

pgTest('a corrupted stored checksum recomputes once and the repaired artifact becomes a reusable hit', async t => {
  const f = await fixture(t, { maxRetries: 0 });
  const first = await f.get();
  await f.pg.query(`UPDATE "FinancePeriodSnapshot" SET checksum='broken' WHERE key=$1`, [first.key]);
  const repaired = await f.get();
  assert.notEqual(repaired, null);
  assert.equal(repaired.hit, false);
  assert.equal(repaired.key, first.key);
  assert.equal(repaired.sourceRevision, first.sourceRevision);
  assert.deepEqual(repaired.payload, first.payload);
  assert.ok(Date.parse(repaired.calculatedAt) > Date.parse(first.calculatedAt));
  assert.equal((await f.get()).hit, true);
  assert.deepEqual(f.counts(), { reads: 2, projects: 2 });
  await f.prisma.$transaction(async tx => {
    assert.equal(await f.cache.verifyRows(tx, first.key, first), false);
    assert.equal(await f.cache.verifyRows(tx, repaired.key, repaired), true);
  }, { isolationLevel: 'RepeatableRead' });
});

pgTest('a corrupted rowset is detected then rebuilt after parent invalidates the key outside its RR read', async t => {
  const f = await fixture(t, { maxRetries: 0 });
  const first = await f.get();
  await f.pg.query(`UPDATE "FinanceReportCacheRow" SET payload='{"amount":9}' WHERE "snapshotKey"=$1`, [first.key]);
  assert.equal(await f.prisma.$transaction(tx => f.cache.verifyRows(tx, first.key, first), { isolationLevel: 'RepeatableRead' }), false);
  assert.equal(await f.cache.invalidate({ key: first.key }), 1);
  const repaired = await f.get();
  assert.equal(repaired.hit, false);
  assert.equal((await f.get()).hit, true);
  assert.equal(await f.prisma.$transaction(tx => f.cache.verifyRows(tx, repaired.key, repaired), { isolationLevel: 'RepeatableRead' }), true);
});

pgTest('peekIn uses only the caller RR with no nested transaction or writes and exposes the exact miss revision', async t => {
  const f = await fixture(t);
  const engine = new FinancePeriodCache({ ...f.prisma, $transaction: async () => assert.fail('peek must not open a transaction') });
  const peek = request => f.prisma.$transaction(async tx => {
    const readOnly = { $queryRawUnsafe: async (sql, ...params) => {
      assert.match(sql.trim(), /^(SELECT|SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/);
      return tx.$queryRawUnsafe(sql, ...params);
    } };
    const result = await engine.peekIn(readOnly, request);
    assert.equal(result.revision, await f.cache.revisionIn(tx, request.dependencies));
    assert.equal((await tx.$queryRawUnsafe('SELECT amount FROM sources'))[0].amount, 2000);
    return result;
  }, { isolationLevel: 'RepeatableRead' });
  const miss = await peek(input);
  assert.match(miss.revision, /^[a-f0-9]{64}$/); assert.equal(miss.result, null);
  assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM "FinancePeriodSnapshot"')).rows[0].n, 0);
  const first = await f.get({ ...input, expectedSourceRevision: miss.revision });
  const hit = await peek({ ...input, dependencies: [...input.dependencies].reverse() });
  assert.equal(hit.result.hit, true); assert.equal(hit.result.key, first.key);
  assert.deepEqual(hit.result.payload, first.payload); assert.equal(engine.diagnostics().cache_hit, 1);
  assert.equal((await peek({ ...input, scope: 'different' })).result, null);
  assert.equal((await peek({ ...input, expectedSourceRevision: 'stale' })).result, null);
  await f.pg.exec(`UPDATE "FinanceReportRevision" SET revision=2 WHERE key='payments'`);
  const updated = await peek(input);
  assert.notEqual(updated.revision, miss.revision); assert.equal(updated.result, null);
  await f.pg.exec('UPDATE coverage SET enabled=false');
  assert.deepEqual(await peek(input), { revision: null, result: null });
  await f.pg.exec('DROP FUNCTION yo_finance_cache_coverage()');
  assert.deepEqual(await peek(input), { revision: null, result: null });
});

pgTest('a slow lease owner outlives poll budget: waiters get dedicated 503 without duplicate sources or project', async t => {
  const f = await fixture(t, { pollMs: 1, maxPolls: 3 });
  let entered, resume; const started = new Promise(resolve => { entered = resolve; });
  const paused = new Promise(resolve => { resume = resolve; });
  let ownerProjects = 0;
  const owner = f.get(input, async amount => { ownerProjects++; entered(); await paused; return { payload: { amount } }; });
  await started;
  try {
    const waiter = new FinancePeriodCache(f.prisma, { pollMs: 1, maxPolls: 3 });
    await assert.rejects(waiter.read(input, f.read, async () => assert.fail('waiter must not project')),
      error => error instanceof FinancePeriodCacheBusyError && error.code === 'FINANCE_PERIOD_CACHE_BUSY' && error.getStatus() === 503);
    assert.equal(f.counts().reads, 1); assert.equal(ownerProjects, 1);
    assert.equal(waiter.diagnostics().background_recalculation_errors, 0);
  } finally { resume(); }
  const result = await owner;
  assert.equal(result.hit, false); assert.equal((await f.get()).hit, true);
});

pgTest('expire CAS refreshes READY retryable FX without revisions and never expires a newer artifact or lease', async t => {
  const f = await fixture(t);
  const pending = await f.get(input, async () => ({ payload: { missing: ['HISTORICAL_FX_UNAVAILABLE'] },
    rows: [{ kind: 'fx', id: 'pending', ordinal: 0, payload: null }] }));
  assert.equal(await f.cache.expire({ ...pending, sourceRevision: 'wrong' }), false);
  assert.equal(await f.cache.expire({ ...pending, calculatedAt: '2000-01-01T00:00:00.000Z' }), false);
  assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM "FinanceReportCacheRow"')).rows[0].n, 1);
  assert.equal(await f.cache.expire(pending), true);
  assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM "FinanceReportCacheRow"')).rows[0].n, 0);
  assert.equal((await f.pg.query('SELECT checksum FROM "FinancePeriodSnapshot" WHERE key=$1', [pending.key])).rows[0].checksum, null);
  let entered, resume; const started = new Promise(resolve => { entered = resolve; });
  const paused = new Promise(resolve => { resume = resolve; });
  const calculation = f.get(input, async () => { entered(); await paused; return { payload: { missing: [] },
    rows: [{ kind: 'fx', id: 'resolved', ordinal: 0, payload: { rate: '50' } }] }; });
  await started;
  try { assert.equal(await f.cache.expire(pending), false); }
  finally { resume(); }
  const resolved = await calculation;
  assert.equal(resolved.key, pending.key); assert.equal(resolved.sourceRevision, pending.sourceRevision);
  assert.ok(Date.parse(resolved.calculatedAt) > Date.parse(pending.calculatedAt));
  assert.equal(await f.cache.expire(pending), false);
  assert.equal((await f.get()).hit, true);
  assert.deepEqual((await f.pg.query('SELECT id FROM "FinanceReportCacheRow"')).rows, [{ id: 'resolved' }]);
  await f.prisma.$transaction(async tx => {
    assert.equal(await f.cache.verifyRows(tx, pending.key, pending), false);
    assert.equal(await f.cache.verifyRows(tx, resolved.key, resolved), true);
  }, { isolationLevel: 'RepeatableRead' });
  assert.equal(await f.cache.expire({ ...resolved, key: null }), false);
  assert.equal(await new FinancePeriodCache({ ...f.prisma, $transaction: async () => { throw Error('storage unavailable'); } }).expire(resolved), false);
});
