import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import { setTimeout as delay } from "node:timers/promises";

// Opt-in only. Never accept DATABASE_URL, an application DB or a remote host.
const databaseUrl = process.env.CLIENT_MERGE_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const sourceRoot = process.env.CLIENT_MERGE_SOURCE_ROOT ?? fileURLToPath(new URL("../../../", import.meta.url));
const source = path => readFileSync(resolve(sourceRoot, path), "utf8");
const globalKey = "hashtextextended('client-merge-global',0)";
const globalLock = `locktype='advisory' AND objsubid=1
  AND classid::bigint=((${globalKey} >> 32) & 4294967295)
  AND objid::bigint=(${globalKey} & 4294967295)`;

test("native PostgreSQL shared upload and nested-FK merge races", { skip: !databaseUrl, timeout: 90000 }, async t => {
  const url = new URL(databaseUrl);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.equal(url.pathname, "/clients_merge_test");
  assert.equal([...url.searchParams].length, 0, "No host/socket/schema URL overrides");
  // Resolve with the selected source checkout (also supports isolated Windows
  // worktrees whose pnpm node_modules junction has relative package symlinks).
  const { PrismaClient } = createRequire(resolve(sourceRoot, "apps/api/package.json"))("@prisma/client");
  const schema = "merge_test_" + randomUUID().replaceAll("-", "");
  url.searchParams.set("schema", schema); url.searchParams.set("connection_limit", "2");
  const create = () => new PrismaClient({ datasources: { db: { url: url.href } } });
  const db = create(), first = create(), second = create();
  let createdSchema = false;
  const exec = (connection, sql, ...args) => connection.$executeRawUnsafe(sql, ...args);
  const query = (connection, sql, ...args) => connection.$queryRawUnsafe(sql, ...args);
  const options = { timeout: 12000, maxWait: 12000 };
  const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    promise.catch(() => {});
    return { promise, resolve, reject };
  };
  async function bounded(promise, label) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 5000); })]); }
    finally { clearTimeout(timer); }
  }
  async function observe(check, label) {
    const deadline = Date.now() + 5000;
    do { if (await check()) return; await delay(10); } while (Date.now() < deadline);
    assert.fail(label);
  }
  const pid = async tx => (await query(tx, "SELECT pg_backend_pid() AS pid"))[0].pid;
  const window = (tx, shared = false) => exec(tx, `SELECT pg_advisory_xact_lock${shared ? "_shared" : ""}(${globalKey})`);
  const orderLock = tx => exec(tx, "SELECT pg_advisory_xact_lock(hashtext('order'))");

  // Holder is parked only AFTER its SQL finishes. Waiter starts only AFTER that
  // barrier; release requires an observed native PostgreSQL blocking edge.
  async function race(holder, waiter, checkBlocked = async () => {}) {
    const ready = deferred(), attempt = deferred(), release = deferred();
    const holding = first.$transaction(async tx => {
      const holderPid = await pid(tx); await holder(tx); ready.resolve(holderPid); await release.promise;
    }, options);
    holding.catch(error => ready.reject(error));
    let waiting;
    try {
      const holderPid = await bounded(ready.promise, "holder did not reach SQL barrier");
      waiting = second.$transaction(async tx => { attempt.resolve(await pid(tx)); await waiter(tx); }, options);
      waiting.catch(error => attempt.reject(error));
      const waiterPid = await bounded(attempt.promise, "waiter did not start");
      await observe(async () => (await query(db, 'SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked', holderPid, waiterPid))[0].blocked,
        "Expected actual PostgreSQL blocking edge");
      const locks = await query(db, `SELECT mode, granted FROM pg_locks WHERE pid=$1 AND ${globalLock}`, waiterPid);
      assert.ok(locks.some(lock => !lock.granted), "wait is on the global window before any owner/order lock");
      await checkBlocked(holderPid, waiterPid);
      t.diagnostic(`pg_blocking_pids(${waiterPid}) includes ${holderPid}; waiting global lock ${locks.find(lock => !lock.granted).mode}`);
    } finally {
      release.resolve();
      const results = await Promise.allSettled([holding, ...(waiting ? [waiting] : [])]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
    }
  }

  // Both SQL bodies must finish while BOTH transactions are still open. A
  // serial implementation cannot reach this barrier. Inspect granted locks too.
  async function concurrent(left, right, inspect) {
    const release = deferred(), ready = [deferred(), deferred()];
    const running = [first, second].map((connection, i) => connection.$transaction(async tx => {
      const backendPid = await pid(tx); await [left, right][i](tx); ready[i].resolve(backendPid); await release.promise;
    }, options));
    running.forEach((promise, i) => promise.catch(error => ready[i].reject(error)));
    try {
      const pids = await bounded(Promise.all(ready.map(item => item.promise)), "concurrent SQL failed to finish before either transaction committed");
      assert.notEqual(pids[0], pids[1]);
      const blockers = await query(db, 'SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid IN ($1,$2)', ...pids);
      assert.equal(blockers.length, 2);
      assert.ok(blockers.every(row => row.blockers.length === 0));
      await inspect(pids);
    } finally {
      release.resolve();
      const results = await Promise.allSettled(running);
      for (const result of results) if (result.status === "rejected") throw result.reason;
    }
  }
  async function sharedPair(pids) {
    const locks = await query(db, `SELECT pid,mode,granted FROM pg_locks WHERE pid IN ($1,$2) AND ${globalLock}`, ...pids);
    assert.equal(locks.length, 2);
    assert.ok(locks.every(row => row.granted && row.mode === "ShareLock"));
    t.diagnostic(`simultaneously granted global ShareLock: ${pids.join(', ')}`);
  }
  const upload = async (tx, id) => {
    const [file] = await query(tx, 'INSERT INTO "ClientFile" VALUES ($1,\'source\',$1) RETURNING id,"clientId"', id);
    await exec(tx, 'INSERT INTO "Activity" VALUES ($1,\'source\')', id);
    await exec(tx, 'INSERT INTO "AuditLog" VALUES ($1,$2)', id, file.clientId);
  };
  const merge = async tx => {
    await window(tx);
    await query(tx, 'SELECT id FROM "Client" ORDER BY id FOR UPDATE');
    const files = await query(tx, 'SELECT id FROM "ClientFile" WHERE "clientId"=\'source\' ORDER BY id');
    for (const table of ["ClientFile", "Activity", "Conversation", "Order", "Athlete"])
      await exec(tx, `UPDATE "${table}" SET "clientId"='target' WHERE "clientId"='source'`);
    await exec(tx, 'INSERT INTO "ClientMergeRedirect" VALUES (\'source\',\'target\')');
    return files.map(row => row.id);
  };
  const split = async (tx, fileIds) => {
    await window(tx);
    await query(tx, 'SELECT id FROM "Client" ORDER BY id FOR UPDATE');
    await exec(tx, 'DELETE FROM "ClientMergeRedirect"');
    for (const id of fileIds) {
      await exec(tx, 'UPDATE "ClientFile" SET "clientId"=\'source\' WHERE id=$1 AND "clientId"=\'target\'', id);
      await exec(tx, 'UPDATE "Activity" SET "clientId"=\'source\' WHERE id=$1', id);
    }
    // Restore the recorded parents, never a frozen list of nested child IDs.
    for (const table of ["Conversation", "Order", "Athlete"])
      await exec(tx, `UPDATE "${table}" SET "clientId"='source' WHERE "clientId"='target'`);
  };
  const reset = async () => {
    for (const table of ["ClientFile", "Activity", "AuditLog", "ClientMergeRedirect", "Message", "Payment", "Measurement", "Order", "Conversation", "Athlete"])
      await exec(db, `DELETE FROM "${table}"`);
    await exec(db, 'INSERT INTO "Athlete" VALUES (\'athlete\',\'source\')');
    await exec(db, 'INSERT INTO "Order" VALUES (\'order\',\'source\',\'athlete\')');
    await exec(db, 'INSERT INTO "Conversation" VALUES (\'conversation\',\'source\')');
  };
  const children = [
    ["Message", "Conversation", "conversationId", "conversation"],
    ["Payment", "Order", "orderId", "order"],
    ["Measurement", "Athlete", "athleteId", "athlete"],
  ];
  const insertChild = (tx, table, parentId, id) => {
    const fk = children.find(([name]) => name === table)[2];
    return exec(tx, `INSERT INTO "${table}" (id,"${fk}") VALUES ($1,$2)`, id, parentId);
  };
  async function assertChildren(owner) {
    for (const [table, parent, fk, parentId] of children) {
      assert.deepEqual(await query(db, `SELECT c.id,c."${fk}" AS "parentId",p."clientId" FROM "${table}" c JOIN "${parent}" p ON p.id=c."${fk}" ORDER BY c.id`),
        ["early", "late"].map(id => ({ id: `${table}-${id}`, parentId, clientId: owner })));
    }
  }
  try {
    t.diagnostic((await query(db, "SELECT version() AS version"))[0].version);
    t.diagnostic(`migration source: ${sourceRoot}; isolated schema: ${schema}`);
    await exec(db, `CREATE SCHEMA "${schema}"`); createdSchema = true;
    // Minimal column projections, but the actual domain FK graph (not id-only
    // child stand-ins): Message->Conversation, Payment->Order, Measurement->Athlete.
    for (const sql of [
      'CREATE TABLE "Client" (id text PRIMARY KEY)',
      'CREATE TABLE "ClientMergeRedirect" ("sourceClientId" text PRIMARY KEY REFERENCES "Client"(id),"targetClientId" text NOT NULL REFERENCES "Client"(id))',
      'CREATE TABLE "ClientFile" (id text PRIMARY KEY,"clientId" text REFERENCES "Client"(id),path text UNIQUE)',
      'CREATE TABLE "Activity" (id text PRIMARY KEY,"clientId" text REFERENCES "Client"(id))',
      'CREATE TABLE "AuditLog" (id text PRIMARY KEY,"clientIdAtWrite" text)',
      'CREATE TABLE "Athlete" (id text PRIMARY KEY,"clientId" text NOT NULL REFERENCES "Client"(id) ON DELETE RESTRICT ON UPDATE CASCADE)',
      'CREATE TABLE "Order" (id text PRIMARY KEY,"clientId" text NOT NULL REFERENCES "Client"(id) ON DELETE RESTRICT ON UPDATE CASCADE,"athleteId" text REFERENCES "Athlete"(id) ON DELETE SET NULL ON UPDATE CASCADE)',
      'CREATE TABLE "Conversation" (id text PRIMARY KEY,"clientId" text NOT NULL REFERENCES "Client"(id) ON DELETE RESTRICT ON UPDATE CASCADE)',
      ...children.map(([table, parent, fk]) => `CREATE TABLE "${table}" (id text PRIMARY KEY,"${fk}" text NOT NULL REFERENCES "${parent}"(id) ON DELETE RESTRICT ON UPDATE CASCADE)`),
      'ALTER TABLE "Payment" ADD COLUMN "voidedAt" timestamp(3)',
      'INSERT INTO "Client" VALUES (\'source\'),(\'target\')',
    ]) await exec(db, sql);
    const original = source("packages/database/prisma/migrations/20260908070000_client_merge_redirect/migration.sql");
    await exec(db, original.slice(original.indexOf('CREATE FUNCTION "route_merged_client_owner"'), original.indexOf('CREATE TRIGGER "route_merged_client_owner"')));
    await exec(db, 'CREATE TRIGGER route_merged_client_owner BEFORE INSERT OR UPDATE ON "Activity" FOR EACH ROW EXECUTE FUNCTION route_merged_client_owner()');
    const migration = source("packages/database/prisma/migrations/20261103160000_client_file_merge_routing/migration.sql");
    const statements = migration.match(/CREATE (?:OR REPLACE )?FUNCTION[\s\S]*?\$\$ LANGUAGE plpgsql;|CREATE TRIGGER[\s\S]*?;/g);
    assert.ok(statements?.length, "Load the actual source migration, without synthesizing corrected triggers");
    for (const sql of statements) await exec(db, sql);

    await t.test("only ClientFile has the statement window; nested children have no merge trigger", async () => {
      const triggers = await query(db, `SELECT c.relname AS table,t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema() AND NOT t.tgisinternal AND c.relname IN ('ClientFile','Message','Payment','Measurement') ORDER BY c.relname,t.tgname`);
      assert.deepEqual(triggers, [{ table: "ClientFile", name: "client_file_merge_window" }, { table: "ClientFile", name: "route_merged_client_owner" }]);
    });
    const helperPath = resolve(sourceRoot, "apps/api/src/clients/client-merge-database-guards.ts");
    await t.test("installed native catalog passes the real database guard", { skip: !existsSync(helperPath) }, async () => {
      const module = { exports: {} };
      const require = createRequire(helperPath);
      const ts = require("typescript");
      vm.runInNewContext(ts.transpileModule(readFileSync(helperPath, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText, { module, exports: module.exports, require });
      await first.$transaction(tx => module.exports.assertClientMergeFileProtection(tx), options);
    });
    await t.test("upload wins: merge waits and records the committed file", async () => {
      await reset(); let moved;
      await race(tx => upload(tx, "early"), async tx => { moved = await merge(tx); });
      assert.deepEqual(moved, ["early"]);
      assert.deepEqual(await query(db, 'SELECT "clientId" FROM "ClientFile"'), [{ clientId: "target" }]);
      assert.deepEqual(await query(db, 'SELECT "clientId" FROM "Activity"'), [{ clientId: "target" }]);
    });
    await t.test("merge wins: stale upload routes canonically; split restores only recorded files", async () => {
      await reset(); await first.$transaction(tx => upload(tx, "recorded"), options); let moved;
      await race(async tx => { moved = await merge(tx); }, tx => upload(tx, "late"));
      assert.deepEqual(moved, ["recorded"]);
      await first.$transaction(tx => split(tx, moved), options);
      assert.deepEqual(await query(db, 'SELECT id,"clientId" FROM "ClientFile" ORDER BY id'), [{ id: "late", clientId: "target" }, { id: "recorded", clientId: "source" }]);
      assert.deepEqual(await query(db, 'SELECT "clientIdAtWrite" FROM "AuditLog" WHERE id=\'late\''), [{ clientIdAtWrite: "target" }]);
    });
    await t.test("split wins: stale source upload waits and uses restored ownership", async () => {
      await reset(); await first.$transaction(tx => upload(tx, "recorded"), options); await first.$transaction(merge, options);
      await race(tx => split(tx, ["recorded"]), tx => upload(tx, "after-split"));
      assert.ok((await query(db, 'SELECT "clientId" FROM "ClientFile"')).every(row => row.clientId === "source"));
      assert.deepEqual(await query(db, 'SELECT "clientIdAtWrite" FROM "AuditLog" WHERE id=\'after-split\''), [{ clientIdAtWrite: "source" }]);
    });
    await t.test("upload wins against split: later target file stays outside recorded provenance", async () => {
      await reset(); await first.$transaction(tx => upload(tx, "recorded"), options); await first.$transaction(merge, options);
      await race(tx => upload(tx, "before-split"), tx => split(tx, ["recorded"]));
      assert.deepEqual(await query(db, 'SELECT id,"clientId" FROM "ClientFile" ORDER BY id'), [{ id: "before-split", clientId: "target" }, { id: "recorded", clientId: "source" }]);
    });
    await t.test("independent uploads hold SHARED windows simultaneously", async () => {
      await reset(); await concurrent(tx => upload(tx, "upload-a"), tx => upload(tx, "upload-b"), sharedPair);
      assert.equal((await query(db, 'SELECT count(*)::int AS n FROM "ClientFile"'))[0].n, 2);
    });
    await t.test("two inbound transactions insert Message under SHARED windows without lock upgrade", async () => {
      await reset();
      const bothShared = deferred(); let acquired = 0;
      const inbound = id => async tx => {
        await window(tx, true);
        if (++acquired === 2) bothShared.resolve();
        await bounded(bothShared.promise, "both inbound windows must be SHARED before either insert");
        await insertChild(tx, "Message", "conversation", id);
      };
      await concurrent(inbound("inbound-a"), inbound("inbound-b"), sharedPair);
      assert.equal((await query(db, 'SELECT count(*)::int AS n FROM "Message"'))[0].n, 2);
    });
    const parentMeasurement = async tx => { await window(tx); await orderLock(tx); await insertChild(tx, "Measurement", "athlete", "measurement"); };
    for (const action of ["add", "void"]) for (const paymentFirst of [true, false]) await t.test(`global before order (${action} payment): ${paymentFirst ? "payment SHARED" : "parent measurement EXCLUSIVE"} wins`, async () => {
      await reset();
      if (action === "void") await insertChild(db, "Payment", "order", "payment");
      const payment = async tx => {
        await window(tx, true); await orderLock(tx);
        if (action === "add") await insertChild(tx, "Payment", "order", "payment");
        else await exec(tx, 'UPDATE "Payment" SET "voidedAt"=CURRENT_TIMESTAMP WHERE id=\'payment\'');
      };
      await race(paymentFirst ? payment : parentMeasurement, paymentFirst ? parentMeasurement : payment, async (_, waiterPid) => {
        const locks = await query(db, "SELECT mode FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND granted", waiterPid);
        assert.deepEqual(locks, [], "waiter has not acquired order lock ahead of global lock");
      });
      assert.equal((await query(db, 'SELECT count(*)::int AS n FROM "Payment"'))[0].n, 1);
      assert.equal((await query(db, 'SELECT count(*)::int AS n FROM "Measurement"'))[0].n, 1);
      assert.equal((await query(db, 'SELECT "voidedAt" IS NOT NULL AS voided FROM "Payment"'))[0].voided, action === "void");
    });
    for (const splitting of [false, true]) await t.test(`nested FK inserts finish during uncommitted parent-owner ${splitting ? "split" : "merge"}; no frozen child set`, async () => {
      await reset();
      for (const [table, , , parentId] of children) await insertChild(db, table, parentId, `${table}-early`);
      if (splitting) await first.$transaction(merge, options);
      const ownerChanged = deferred();
      await concurrent(async tx => {
        await (splitting ? split(tx, []) : merge(tx)); ownerChanged.resolve();
      }, async tx => {
        await bounded(ownerChanged.promise, "parent owner must change before new children are inserted");
        for (const [table, , , parentId] of children) await insertChild(tx, table, parentId, `${table}-late`);
      }, async pids => {
        const locks = await query(db, `SELECT pid,mode,granted FROM pg_locks WHERE pid IN ($1,$2) AND ${globalLock}`, ...pids);
        assert.ok(locks.some(row => row.pid === pids[0] && row.mode === "ExclusiveLock" && row.granted));
        assert.ok(locks.every(row => row.pid === pids[0] && row.granted), "nested writer takes no global lock");
        // Both transactions are still open, so this proves the children do not
        // need the merge window and their real FK checks allow non-key updates.
        t.diagnostic("all three nested FK inserts completed while parent-owner transaction remained uncommitted");
      });
      await assertChildren(splitting ? "source" : "target");
      await first.$transaction(tx => splitting ? merge(tx) : split(tx, []), options);
      await assertChildren(splitting ? "target" : "source");
    });
  } finally {
    await first.$disconnect(); await second.$disconnect();
    // Only the generated schema in the explicitly named loopback test DB.
    if (createdSchema) await exec(db, `DROP SCHEMA "${schema}" CASCADE`);
    await db.$disconnect();
  }
});
