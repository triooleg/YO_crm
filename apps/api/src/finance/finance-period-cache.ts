import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { ServiceUnavailableException } from '@nestjs/common';

/** Contention is not a legacy-fallback signal: let the existing owner finish. */
export class FinancePeriodCacheBusyError extends ServiceUnavailableException {
  readonly code = 'FINANCE_PERIOD_CACHE_BUSY';
  constructor() {
    super({ statusCode: 503, code: 'FINANCE_PERIOD_CACHE_BUSY', message: 'Финансовый отчёт рассчитывается. Повторите запрос.' });
  }
}

/** Structural Prisma boundary: no dependency on generated cache-table delegates. */
export interface FinanceCacheSql {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}
export interface FinancePeriodDatabase<Tx extends FinanceCacheSql> extends FinanceCacheSql {
  $transaction<R>(run: (tx: Tx) => Promise<R>, options: {
    isolationLevel: 'RepeatableRead'; timeout: number; maxWait: number;
  }): Promise<R>;
}
export interface FinancePeriodRequest {
  period: string;
  scope: string;
  dependencies: string[];
  calculationVersion: string;
  taxPolicyVersion: string;
  fxVersion: string;
  /** Bind externally captured sources to their exact outer RR revision vector. */
  expectedSourceRevision?: string;
}
export interface FinancePeriodRow { kind: string; id: string; payload: unknown; ordinal: number }
export interface FinancePeriodProjection<T> { payload: T; rows?: FinancePeriodRow[]; cacheable?: boolean }
export interface FinancePeriodResult<T> {
  payload: T; key: string | null; sourceRevision: string; calculatedAt: string; hit: boolean;
}
interface Snapshot {
  key: string; status: string; sourceRevision: string; calculatedAt: Date | string;
  payload: unknown; checksum: string | null; leaseToken: string | null;
}
interface Revision { covered: boolean; value: string }
interface RowsManifest { version: 1; count: string; sha256: string }
interface Envelope { data: unknown; _cacheRows: RowsManifest }

// Core PostgreSQL SHA256, no pgcrypto/schema helper needed. Fixed-width row
// hashes include the complete JSONB payload, identity and ordinal. Explicit C
// ordering makes the aggregate independent of database/application collation.
const ROWS_DIGEST = `count(*)::text AS count,
  encode(sha256(convert_to(COALESCE(string_agg(
    encode(sha256(convert_to(jsonb_build_array(kind,id,ordinal,payload)::text,'UTF8')),'hex'),
    '' ORDER BY kind COLLATE "C",id COLLATE "C"),''),'UTF8')),'hex') AS sha256`;
class StorageFailure extends Error {
  constructor(readonly retryable = false) { super('Finance cache storage unavailable'); }
}
class SourceFailure extends Error { constructor(readonly cause: unknown) { super('Finance source/projection failed'); } }

function serializationFailure(error: unknown): boolean {
  const failure = error as { code?: string; meta?: { code?: string } } | null;
  return failure?.code === '40001' || failure?.code === '40P01' || failure?.code === 'P2034'
    || failure?.meta?.code === '40001' || failure?.meta?.code === '40P01';
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

/** Canonical strict JSON: never silently drops undefined or converts BigInt/Date/NaN.
 * Sorting keys also makes integrity independent of PostgreSQL jsonb key ordering.
 */
function json(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (typeof value !== 'object' || ancestors.has(value)) throw new TypeError('Finance cache requires strict JSON');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new TypeError('Finance cache requires plain JSON objects');
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError('Finance cache rejects symbol properties');
  ancestors.add(value);
  try {
    const keys = Object.keys(value);
    const ownKeys = Object.getOwnPropertyNames(value).filter(key => !Array.isArray(value) || key !== 'length');
    if (ownKeys.length !== keys.length) throw new TypeError('Finance cache rejects non-enumerable properties');
    for (const key of keys) {
      if (!('value' in Object.getOwnPropertyDescriptor(value, key)!)) throw new TypeError('Finance cache rejects JSON accessors');
    }
    if (Array.isArray(value)) {
      if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) throw new TypeError('Finance cache rejects sparse or extended arrays');
      return `[${value.map(item => json(item, ancestors)).join(',')}]`;
    }
    return `{${keys.sort().map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in descriptor)) throw new TypeError('Finance cache rejects JSON accessors');
      return `${JSON.stringify(key)}:${json(descriptor.value, ancestors)}`;
    }).join(',')}}`;
  } finally { ancestors.delete(value); }
}

/** Durable finished summaries only; FinanceSourceCache remains a separate raw-read cache.
 * No process-local results/promises. Polls observe the DB winner across API instances.
 * Caller owns authorization, complete dependency selection and version identities.
 */
export class FinancePeriodCache<Tx extends FinanceCacheSql = Prisma.TransactionClient> {
  private readonly options: { leaseMs: number; pollMs: number; maxPolls: number; maxRetries: number; transactionMs: number };
  private readonly counters = {
    cache_hit: 0, cache_miss: 0, invalidation: 0, recalculated_periods: 0,
    report_duration_ms: 0, sql_query_count: 0, sql_duration_ms: 0,
    cache_age: 0, cache_revision: 0, background_recalculation_errors: 0,
  };

  constructor(private readonly prisma: FinancePeriodDatabase<Tx>, options: Partial<FinancePeriodCache<Tx>['options']> = {}) {
    const leaseMs = options.leaseMs ?? 120_000, pollMs = options.pollMs ?? 50;
    this.options = { leaseMs, pollMs, maxPolls: Math.ceil(leaseMs / pollMs) + 1, maxRetries: 2, transactionMs: 30_000, ...options };
    for (const [name, value] of Object.entries(this.options)) {
      if (!Number.isSafeInteger(value) || value < (name === 'maxRetries' ? 0 : 1)) throw new TypeError('Invalid finance cache timing/bound');
    }
  }

  /** Numeric aggregates only. Age is last hit age in ms; revision counts verified vectors.
   * SQL metrics cover cache SQL, not queries performed inside caller-owned readSources.
   */
  diagnostics() { return { ...this.counters, cache_invalidation: this.counters.invalidation }; }

  private identity(request: FinancePeriodRequest) {
    const dependencies = [...new Set(request.dependencies)].sort();
    if (!dependencies.length) throw new TypeError('Finance cache requires revision dependencies');
    const identity = hash(json(['finance-period-cache-v2', request.period, request.scope, dependencies, request.calculationVersion, request.taxPolicyVersion, request.fxVersion]));
    return { dependencies, identity };
  }

  private async query<R>(db: FinanceCacheSql, sql: string, ...params: unknown[]): Promise<R[]> {
    const start = performance.now(); this.counters.sql_query_count++;
    try { return await db.$queryRawUnsafe<R[]>(sql, ...params); }
    catch (error) { throw new StorageFailure(serializationFailure(error)); }
    finally { this.counters.sql_duration_ms += performance.now() - start; }
  }

  private async transaction<R>(run: (tx: Tx) => Promise<R>): Promise<R> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(run, { isolationLevel: 'RepeatableRead', timeout: this.options.transactionMs, maxWait: this.options.transactionMs });
      } catch (error) {
        if (error instanceof SourceFailure) {
          if (!serializationFailure(error.cause) || attempt >= this.options.maxRetries) throw error;
          await new Promise<void>(resolve => setTimeout(resolve, this.options.pollMs));
          continue;
        }
        const failure = error instanceof StorageFailure ? error : new StorageFailure(serializationFailure(error));
        if (!failure.retryable || attempt >= this.options.maxRetries) throw failure;
        await new Promise<void>(resolve => setTimeout(resolve, this.options.pollMs));
      }
    }
  }

  private async revision(tx: Tx, dependencies: string[], lock = false): Promise<Revision> {
    // Missing revision keys are not implicitly zero: that would hide missing coverage.
    // The schema/DDL owner must fence trigger reconfiguration (e.g. within the
    // coverage helper). A boolean recheck cannot itself serialize administrator DDL.
    const coverage = await this.query<{ covered: boolean }>(tx, 'SELECT yo_finance_cache_coverage() AS covered');
    if (coverage[0]?.covered !== true) return { covered: false, value: '' };
    const rows = await this.query<{ key: string; revision: bigint | string }>(tx,
      `SELECT key, revision::text AS revision FROM "FinanceReportRevision" WHERE key = ANY($1::text[]) ORDER BY key${lock ? ' FOR SHARE' : ''}`, dependencies);
    const revisions = new Map(rows.map(row => [row.key, String(row.revision)]));
    if (revisions.size !== dependencies.length || dependencies.some(key => !/^\d+$/.test(revisions.get(key) ?? ''))) return { covered: false, value: '' };
    this.counters.cache_revision++;
    // PostgreSQL collation and JS string sorting need not agree (Unicode/case).
    return { covered: true, value: hash(json(dependencies.map(key => [key, revisions.get(key)!]))) };
  }

  /** Capture this vector alongside raw sources in the caller's RR transaction.
   * Coverage/cache-query failures return null and recover their savepoint; caller
   * business/source reads remain outside this method and are never swallowed.
   */
  async revisionIn(tx: Tx, dependencies: string[]): Promise<string | null> {
    const keys = [...new Set(dependencies)].sort();
    if (!keys.length) throw new TypeError('Finance cache requires revision dependencies');
    let savepoint = false;
    try {
      await this.query(tx, 'SAVEPOINT finance_period_revision'); savepoint = true;
      const revision = await this.revision(tx, keys);
      await this.query(tx, 'RELEASE SAVEPOINT finance_period_revision'); savepoint = false;
      return revision.covered ? revision.value : null;
    } catch (error) {
      if (savepoint) {
        try {
          await this.query(tx, 'ROLLBACK TO SAVEPOINT finance_period_revision');
          await this.query(tx, 'RELEASE SAVEPOINT finance_period_revision');
        } catch { /* disconnected transaction cannot be recovered */ }
      }
      if (!(error instanceof StorageFailure)) throw error;
      this.counters.background_recalculation_errors++; return null;
    }
  }

  /** Read-only lookup in the caller's RR snapshot. Never opens a transaction,
   * claims a lease or calculates. A covered miss returns its exact revision so
   * sources can be read here and published after COMMIT with expectedSourceRevision.
   */
  async peekIn<T>(tx: Tx, request: FinancePeriodRequest): Promise<{ revision: string | null; result: FinancePeriodResult<T> | null }> {
    const { dependencies, identity } = this.identity(request);
    let savepoint = false;
    try {
      await this.query(tx, 'SAVEPOINT finance_period_peek'); savepoint = true;
      const revision = await this.revision(tx, dependencies);
      let result: FinancePeriodResult<T> | null = null;
      if (revision.covered && (request.expectedSourceRevision === undefined || revision.value === request.expectedSourceRevision)) {
        const key = hash(json([identity, revision.value]));
        const [row] = await this.query<Snapshot>(tx, 'SELECT * FROM "FinancePeriodSnapshot" WHERE key=$1', key);
        result = this.ready<T>(row, revision.value);
      }
      await this.query(tx, 'RELEASE SAVEPOINT finance_period_peek'); savepoint = false;
      if (result) this.hit(result);
      else if (revision.covered) this.counters.cache_miss++;
      return { revision: revision.covered ? revision.value : null, result };
    } catch (error) {
      if (savepoint) {
        try {
          await this.query(tx, 'ROLLBACK TO SAVEPOINT finance_period_peek');
          await this.query(tx, 'RELEASE SAVEPOINT finance_period_peek');
        } catch { /* disconnected transaction cannot be recovered */ }
      }
      if (!(error instanceof StorageFailure)) throw error;
      this.counters.background_recalculation_errors++;
      return { revision: null, result: null };
    }
  }

  private ready<T>(row: Snapshot | undefined, revision: string): FinancePeriodResult<T> | null {
    if (!row || row.status !== 'READY' || row.sourceRevision !== revision || !row.checksum) return null;
    try {
      const text = json(row.payload);
      const calculatedAt = new Date(row.calculatedAt).toISOString();
      if (hash(text) !== row.checksum) return null;
      const envelope = JSON.parse(text) as Envelope;
      if (!envelope || typeof envelope !== 'object' || !Object.hasOwn(envelope, 'data') ||
        Object.keys(envelope).length !== 2 || envelope._cacheRows?.version !== 1 ||
        typeof envelope._cacheRows.count !== 'string' || !/^\d+$/.test(envelope._cacheRows.count) ||
        typeof envelope._cacheRows.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(envelope._cacheRows.sha256)) return null;
      return { key: row.key, payload: envelope.data as T, sourceRevision: revision, calculatedAt, hit: true };
    } catch { return null; }
  }

  private hit<T>(result: FinancePeriodResult<T>) {
    this.counters.cache_hit++;
    this.counters.cache_age = Math.max(0, Date.now() - Date.parse(result.calculatedAt));
    return result;
  }

  private async release(key: string, token: string, status: 'DIRTY' | 'FAILED') {
    await this.query(this.prisma, `UPDATE "FinancePeriodSnapshot" SET status='${status}', "leaseToken"=NULL, "leaseUntil"=NULL
      WHERE key=$1 AND "leaseToken"=$2`, key, token);
  }

  /** Verify the COMPLETE rowset in PostgreSQL, returning only count+digest to API.
   * Call this and read the selected page in the SAME RepeatableRead transaction.
   * Passing the read() result also binds the caller's exact summary across repair
   * or manual invalidation. false = invalid artifact; null = cache SQL unavailable.
   * A savepoint recovers cache-query errors without poisoning the page transaction.
   * On null, return from this transaction and use legacy fallback outside it; do
   * not catch unrelated/domain row-reader errors as cache storage failures.
   */
  async verifyRows(tx: FinanceCacheSql, key: string, expected?: FinancePeriodResult<unknown>): Promise<boolean | null> {
    let savepoint = false;
    try {
      await this.query(tx, 'SAVEPOINT finance_period_rows_verify'); savepoint = true;
      const valid = await (async () => {
        const [row] = await this.query<Snapshot>(tx, 'SELECT * FROM "FinancePeriodSnapshot" WHERE key=$1', key);
        if (!row) return false;
        const result = this.ready<unknown>(row, row.sourceRevision);
        if (!result) return false;
        if (expected && (expected.key !== key || expected.sourceRevision !== result.sourceRevision ||
          expected.calculatedAt !== result.calculatedAt || json(expected.payload) !== json(result.payload))) return false;
        const envelope = row.payload as Envelope;
        const [actual] = await this.query<Omit<RowsManifest, 'version'>>(tx,
          `SELECT ${ROWS_DIGEST} FROM "FinanceReportCacheRow" WHERE "snapshotKey"=$1`, key);
        return !!actual && actual.count === envelope._cacheRows.count && actual.sha256 === envelope._cacheRows.sha256;
      })();
      await this.query(tx, 'RELEASE SAVEPOINT finance_period_rows_verify'); savepoint = false;
      return valid;
    } catch (error) {
      if (savepoint) {
        try {
          await this.query(tx, 'ROLLBACK TO SAVEPOINT finance_period_rows_verify');
          await this.query(tx, 'RELEASE SAVEPOINT finance_period_rows_verify');
        } catch { /* disconnected transaction cannot be recovered */ }
      }
      if (!(error instanceof StorageFailure)) throw error;
      this.counters.background_recalculation_errors++; return null;
    }
  }

  async read<S, T>(request: FinancePeriodRequest, readSources: (tx: Tx) => Promise<S>,
    project: (sources: S) => Promise<FinancePeriodProjection<T>>): Promise<FinancePeriodResult<T> | null> {
    const start = performance.now();
    const { dependencies, identity } = this.identity(request);
    let key = '';
    let owned: string | null = null;
    try {
      let polls = 0;
      for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
        const probe = await this.transaction(async tx => {
          const revision = await this.revision(tx, dependencies);
          if (!revision.covered || (request.expectedSourceRevision !== undefined && revision.value !== request.expectedSourceRevision)) return { revision, key: '', row: undefined };
          // Derive key and read summary in the SAME revision-query snapshot.
          const artifactKey = hash(json([identity, revision.value]));
          const [row] = await this.query<Snapshot>(tx, 'SELECT * FROM "FinancePeriodSnapshot" WHERE key=$1', artifactKey);
          return { revision, key: artifactKey, row };
        });
        if (!probe.revision.covered) return null;
        if (request.expectedSourceRevision !== undefined && probe.revision.value !== request.expectedSourceRevision) return null;
        key = probe.key;
        const cached = this.ready<T>(probe.row, probe.revision.value);
        if (cached) return this.hit(cached);
        if (attempt === 0 && polls === 0) this.counters.cache_miss++;
        if (probe.row?.status === 'READY') this.counters.invalidation++;
        const token = randomUUID();
        // Lock and re-read before claiming: a winner may have published since probe.
        const claim = await this.transaction(async tx => {
          const revision = await this.revision(tx, dependencies);
          if (!revision.covered) return { bypass: true };
          if (request.expectedSourceRevision !== undefined && revision.value !== request.expectedSourceRevision) return { bypass: true };
          if (revision.value !== probe.revision.value) return { changed: true };
          const [row] = await this.query<Snapshot>(tx, 'SELECT * FROM "FinancePeriodSnapshot" WHERE key=$1 FOR UPDATE', key);
          const result = this.ready<T>(row, revision.value);
          if (result) return { result };
          // Only a proven payload/checksum mismatch permits resetting the guard.
          // DIRTY/FAILED status alone must not unlock a different valid artifact.
          // The row remains locked, and only the successful lease claim clears it.
          let damagedChecksum = false;
          if (row && row.checksum !== null) {
            try { damagedChecksum = hash(json(row.payload)) !== row.checksum; }
            catch { damagedChecksum = true; }
          }
          const claimed = await this.query<{ key: string }>(tx, `INSERT INTO "FinancePeriodSnapshot"
            (key,period,scope,"sourceRevision","calculationVersion","taxPolicyVersion","fxVersion","calculatedAt",status,"leaseToken","leaseUntil")
            VALUES ($1,$2,$3,$4,$5,$6,$7,clock_timestamp(),'CALCULATING',$8,clock_timestamp()+$9::int * interval '1 millisecond')
            ON CONFLICT (key) DO UPDATE SET status='CALCULATING',"leaseToken"=EXCLUDED."leaseToken", "leaseUntil"=EXCLUDED."leaseUntil",
              checksum=CASE WHEN $10::boolean THEN NULL ELSE "FinancePeriodSnapshot".checksum END
            WHERE "FinancePeriodSnapshot"."leaseUntil" IS NULL OR "FinancePeriodSnapshot"."leaseUntil"<=clock_timestamp()
            RETURNING key`, key, request.period, request.scope, revision.value, request.calculationVersion, request.taxPolicyVersion, request.fxVersion, token, this.options.leaseMs, damagedChecksum);
          return { acquired: claimed.length === 1 };
        });
        if (claim.bypass) return null;
        if (claim.changed) { this.counters.invalidation++; continue; }
        if (claim.result) return this.hit(claim.result);
        if (!claim.acquired) {
          if (++polls >= this.options.maxPolls) throw new FinancePeriodCacheBusyError();
          await new Promise<void>(resolve => setTimeout(resolve, this.options.pollMs));
          attempt--; continue;
        }
        owned = token;
        // Only the lease winner reads sources. A fresh RR snapshot binds revision
        // and sources; external FX/project is deliberately outside this transaction.
        const captured = await this.transaction(async tx => {
          await this.query(tx, 'SET TRANSACTION READ ONLY');
          const lease = await this.query<{ key: string }>(tx, `SELECT key FROM "FinancePeriodSnapshot"
            WHERE key=$1 AND "leaseToken"=$2 AND status='CALCULATING' AND "leaseUntil">clock_timestamp()`, key, token);
          if (!lease.length) return null;
          const revision = await this.revision(tx, dependencies);
          if (!revision.covered) return null;
          if (request.expectedSourceRevision !== undefined && revision.value !== request.expectedSourceRevision) return null;
          if (revision.value !== probe.revision.value) return { changed: true as const };
          try { return { changed: false as const, revision: revision.value, sources: await readSources(tx) }; }
          catch (error) { throw new SourceFailure(error); }
        });
        if (!captured) { await this.release(key, token, 'DIRTY'); owned = null; return null; }
        if (captured.changed) {
          this.counters.invalidation++; await this.release(key, token, 'DIRTY'); owned = null; continue;
        }
        let projected: FinancePeriodProjection<T>;
        try { projected = await project(captured.sources); }
        catch (error) { throw new SourceFailure(error); }
        let payload: string, rows: Array<FinancePeriodRow & { encoded: string }>;
        try {
          payload = json(projected.payload);
          const seen = new Set<string>();
          rows = (projected.rows ?? []).map(row => {
            const identity = json([row.kind, row.id]);
            if (typeof row.kind !== 'string' || typeof row.id !== 'string' || !Number.isInteger(row.ordinal) || row.ordinal < -2147483648 || row.ordinal > 2147483647 || seen.has(identity)) throw new TypeError('Invalid finance derivative row');
            seen.add(identity);
            return { ...row, encoded: json(row.payload) };
          });
        } catch (error) { throw new SourceFailure(error); }
        if (projected.cacheable === false) {
          await this.release(key, token, 'DIRTY'); owned = null;
          return { payload: JSON.parse(payload) as T, key: null, sourceRevision: captured.revision, calculatedAt: new Date().toISOString(), hit: false };
        }
        const published = await this.transaction(async tx => {
          // SHARE locks prevent a trigger increment between this recheck and COMMIT.
          // A concurrent increment since RR started fails serialization, never publishes.
          const revision = await this.revision(tx, dependencies, true);
          if (!revision.covered || revision.value !== captured.revision) return null;
          const encodedRows = `[${rows.map(row => `{"kind":${json(row.kind)},"id":${json(row.id)},"payload":${row.encoded},"ordinal":${row.ordinal}}`).join(',')}]`;
          // Compute expected digest from PROJECTED input, not from possibly corrupt
          // persisted rows. Both use PostgreSQL's exact same JSONB normalization.
          const [manifest] = await this.query<Omit<RowsManifest, 'version'>>(tx, `SELECT ${ROWS_DIGEST} FROM
            (SELECT r->>'kind' AS kind,r->>'id' AS id,(r->>'ordinal')::int AS ordinal,r->'payload' AS payload
             FROM jsonb_array_elements($1::jsonb) AS r) AS projected`, encodedRows);
          if (!manifest) throw new StorageFailure();
          const storedPayload = json({ data: JSON.parse(payload) as unknown, _cacheRows: { version: 1, ...manifest } });
          const checksum = hash(storedPayload);
          const updated = await this.query<{ calculatedAt: Date | string }>(tx, `UPDATE "FinancePeriodSnapshot" SET
            status='READY',payload=$3::jsonb,checksum=$4,"sourceRevision"=$5,
            "calculatedAt"=CASE WHEN isfinite("calculatedAt") THEN GREATEST(clock_timestamp(),"calculatedAt"+interval '1 millisecond') ELSE clock_timestamp() END,
            "leaseToken"=NULL,"leaseUntil"=NULL
            WHERE key=$1 AND "leaseToken"=$2 AND status='CALCULATING' AND "leaseUntil">clock_timestamp()
              AND (checksum IS NULL OR checksum=$4) RETURNING "calculatedAt"`,
          key, token, storedPayload, checksum, captured.revision);
          if (!updated[0]) return null;
          await this.query(tx, 'DELETE FROM "FinanceReportCacheRow" WHERE "snapshotKey"=$1', key);
          // One parameterized batch; detailed rows do not enter finished-summary payload.
          if (rows.length) await this.query(tx, `INSERT INTO "FinanceReportCacheRow" ("snapshotKey",kind,id,payload,ordinal)
            SELECT $1,r->>'kind',r->>'id',r->'payload',(r->>'ordinal')::int FROM jsonb_array_elements($2::jsonb) AS r`,
          key, encodedRows);
          return new Date(updated[0].calculatedAt).toISOString();
        });
        if (published) {
          owned = null; this.counters.recalculated_periods++;
          return { payload: JSON.parse(payload) as T, key, sourceRevision: captured.revision, calculatedAt: published, hit: false };
        }
        this.counters.invalidation++;
        await this.release(key, token, 'DIRTY'); owned = null;
      }
      return null;
    } catch (error) {
      const busy = error instanceof FinancePeriodCacheBusyError || error instanceof SourceFailure && error.cause instanceof FinancePeriodCacheBusyError;
      if (!busy) this.counters.background_recalculation_errors++;
      if (owned) { try { await this.release(key, owned, 'FAILED'); } catch { /* expiry recovers failed storage */ } }
      if (error instanceof SourceFailure) throw error.cause;
      if (error instanceof StorageFailure) return null;
      throw error;
    } finally { this.counters.report_duration_ms += performance.now() - start; }
  }

  /** Explicit caller-selected expiry (e.g. retryable FX after 30s), never a TTL
   * for complete/deterministic pending results. CAS cannot revoke a newer owner.
   * Match the millisecond timestamp exposed by read(), also on PG columns with
   * finer precision. Monotonic publication timestamps distinguish replacements.
   */
  async expire(expected: FinancePeriodResult<unknown>): Promise<boolean> {
    if (!expected.key || !Number.isFinite(Date.parse(expected.calculatedAt))) return false;
    try {
      const expired = await this.transaction(async tx => {
        const updated = await this.query<{ key: string }>(tx, `UPDATE "FinancePeriodSnapshot" SET status='DIRTY',checksum=NULL
          WHERE key=$1 AND "sourceRevision"=$2 AND date_trunc('milliseconds',"calculatedAt")=$3::timestamptz
            AND status='READY' AND "leaseToken" IS NULL RETURNING key`,
        expected.key, expected.sourceRevision, expected.calculatedAt);
        if (!updated.length) return false;
        await this.query(tx, 'DELETE FROM "FinanceReportCacheRow" WHERE "snapshotKey"=$1', expected.key);
        return true;
      });
      if (expired) this.counters.invalidation++;
      return expired;
    } catch (error) {
      if (!(error instanceof StorageFailure)) throw error;
      this.counters.background_recalculation_errors++; return false;
    }
  }

  /** Lazy rebuild: invalidate durable derivatives and revoke outstanding owners.
   * No financial records are modified; the next read recomputes on demand.
   */
  async invalidate(target: { key: string } | { period: string }): Promise<number | null> {
    if (('key' in target ? target.key : target.period).length === 0) throw new TypeError('Invalid finance cache target');
    try {
      const count = await this.transaction(async tx => {
        const keys = await this.query<{ key: string }>(tx, `UPDATE "FinancePeriodSnapshot"
          SET status='DIRTY',"leaseToken"=NULL,"leaseUntil"=NULL
          WHERE ${'key' in target ? 'key' : 'period'}=$1 RETURNING key`, 'key' in target ? target.key : target.period);
        if (keys.length) await this.query(tx, 'DELETE FROM "FinanceReportCacheRow" WHERE "snapshotKey"=ANY($1::text[])', keys.map(row => row.key));
        return keys.length;
      });
      this.counters.invalidation += count; return count;
    } catch (error) {
      if (!(error instanceof StorageFailure)) throw error;
      this.counters.background_recalculation_errors++; return null;
    }
  }
}
