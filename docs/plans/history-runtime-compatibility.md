# Managed history runtime compatibility

This scope adds a build-time capability constant, a host-only managed deployment
gate, a dependency-free persistent psql connector and tests. It does not itself
wire deployment, register an executor, change ingress, apply production migrations,
authorize import, or establish release readiness. The initial worker base is
`32bf6411695f98450769de7f1142cde172bdf6e4`; later owned tests use the canonical
operational core and the existing Windows PostgreSQL fixture.

## Contract and ownership

`HISTORY_RUNTIME_CAPABILITY` is the immutable, unconditional value
`Object.freeze({ historicalIngressGuard: 1 })`. Its presence is an attestation by
the reviewed build, not a feature flag and not independent proof that all ingress
paths are guarded. INTEGRATOR must only ship it with the corresponding guarded
runtime and complete ingress tests. There is no environment override.

`scripts/history_runtime_guard.py` has no CLI or HTTP surface. Root-reviewed,
immutable host configuration supplies:

- `RuntimeArtifact(image_id, source_snapshot_sha256, capability_module_sha256)`.
  Image identity is the full local Docker content ID `sha256:<64 lowercase hex>`,
  not a tag or registry manifest digest. The source snapshot SHA and exact compiled
  capability module SHA must be recorded against that image by the reviewed build.
  `None` for module SHA means an explicitly reviewed legacy image with no module.
- `SchemaContract(migration_set_sha256, history_shape,
  allowed_rolled_back_migrations=())` entries for the exact
  permitted pre/post-cutover schemas. Compute the digest with
  `migration_set_digest([(migration_name, checksum), ...])` from the independently
  reviewed migration inventory, never auto-approve the live query's result.
  No hardcoded migration count substitutes for the names/checksums fingerprint.
- `connect_runtime_database` from `scripts/history_runtime_connection.py` opens a
  fresh dedicated autocommit PostgreSQL session from the host, outside the API
  container. It takes no arguments and uses persistent `docker exec -i ... psql`
  against the single running service with fixed Compose labels
  `com.docker.compose.project=yoleotard-crm` and
  `com.docker.compose.service=postgres`. Its existing container environment supplies
  the local role/database; no host credential is read or exported. No psycopg
  dependency, transaction pool, reconnection, shared connection, automatic context
  cleanup, or closing that connection behind the gate. It must survive API
  container replacement. Receipts contain no credentials.
- One trusted Python cutover/recovery callback. It returns the full installed API
  container ID and follows the reviewed service configuration. It must stop/drain
  replaced writers and preserve delivery/retry semantics. There is no execution of
  arbitrary command JSON or user-supplied HTTP callbacks.

The parent private frozen deploy helper uses the context manager around the actual
managed action. A standalone successful check is not authorization or a reusable
deployment permit. The source SHA is a trusted build mapping; the library cannot
derive repository provenance from an image on its own.

The four accepted schema shapes require both their exact reviewed completed
migration fingerprint and their exact history table names:

| Shape | Known prefix | History tables | Operational authority |
| --- | --- | --- | --- |
| `ABSENT` | 49 | none | No run table exists. |
| `INTAKE_V1` | 50 | Job, Batch | No run table exists. |
| `PLANNING_V1` | 51 | Job, Batch, Target, PilotRun, Origin, Identity | Validated WASM-only environment constraint, no RLS, zero operational/unknown environment rows. |
| `NATIVE_V1` | 52 | Previous six plus NativeWindow, NativeReview | Authoritative count of all native runs, independent of status. |

Names in the table have the `HistoryMigration` prefix. Planning authority checks
the named `HistoryMigrationPilotRun_environment_check`, its validated expression
`(environment = 'ISOLATED_WASM'::text)`, and the non-null text environment column.
Missing/changed/unvalidated constraints refuse admission. No history flag or
unknown-catalog exception authorizes a prefix.

`allowed_rolled_back_migrations` is an immutable tuple of exact root-reviewed
`(migration_name, checksum)` tuples. The default is empty. Only these three names
can be supplied, with at most one approved checksum per name:

- `20261029150000_history_migration_staging`
- `20261029160000_history_migration_planning`
- `20261101010000_history_operational_native`

Approve the final SQL checksums after the parent's atomic BEGIN/COMMIT wrappers
are finalized. Preserve the existing first 49 migration bytes. An allowed pair
authorizes recognition of an already resolved failed attempt; it is not permission
to resolve a failure, ignore unfinished SQL, or infer atomicity from metadata.

## Session fence and verification

The gate obtains an exclusive **session** advisory lock using
`hashtextextended('history-runtime-deployment',0)` before reading schema or runs.
It tries once and refuses a busy fence; retry the whole managed operation after
the importer finishes. It pins backend PID and checks the precise exclusive lock
through `pg_locks` before and after relevant operations.

Parent runtime integration must acquire the matching **shared transaction** lock
before every native `withJob` lock, in that order, for apply/replay/rollback and
other native jobs. Thus a native transaction either commits before host preflight
or waits through cutover and installed verification. All managed deploy/rollback
entry points must use the host gate. This library alone does not wire those locks.

Under the fence the gate requires the reviewed completed migration inventory and
exact history table names. Unfinished migrations, unknown schema, query/permission
failure and row-level security on the run table refuse the action. The count
includes **every** `OPERATIONAL_NATIVE` run, regardless of status, including
`ROLLED_BACK`. Unknown/missing native bindings also refuse. Missing history tables
are accepted only for the reviewed absent/intake prefix. Planning requires the
additional WASM-only authority described above. The gate is a managed
schema compatibility check, not a comprehensive database tamper detector.

The ledger query remains unfiltered so resolved attempts cannot hide an unfinished
or unknown attempt:

```sql
SELECT migration_name, checksum, finished_at IS NOT NULL,
       rolled_back_at IS NOT NULL FROM public._prisma_migrations
```

The completed fingerprint uses only rows with finished=true and rolled-back=false.
Unfinished rows, both timestamps populated, duplicate completed names, duplicate
rolled-back names/pairs, unknown resolved names/checksums and unapproved resolved
attempts refuse. One approved resolved attempt may coexist with one completed
retry of the same migration; the retry belongs in the completed fingerprint.
Multiple failed attempts for one migration remain unsupported and fail closed.

The capability probe invokes fixed Docker argv against the exact image ID with
network disabled, no supplied env/mounts, read-only filesystem, unprivileged user,
resource limits and `node` entrypoint. It hashes the exact compiled file at
`/app/apps/api/dist/history-migration/history-runtime-capability.js` before requiring
it, verifies a frozen single-value object and emits bounded strict JSON. A legacy
artifact must actually lack that file; malformed/unreadable files are not absence.
Docker tags, labels, health output and environment values are not capability proof.

Database discovery/exec and the default capability run/inspect subprocesses all
pin `--host=unix:///var/run/docker.sock` and use the same minimal environment.
Ambient `DOCKER_HOST`, `DOCKER_CONTEXT`, Docker TLS/config/API overrides and
`NODE_OPTIONS` are not inherited. This closes the mismatch in which a local
database fence could be released using image proof from another daemon. The
trusted test-only Docker injection seam is not a production configuration surface.

The connector accepts only ten exact guard SELECTs, including the two planning
authority queries. It uses CSV positional rows, strict booleans/integers, unique
response markers, a 1 MiB response limit, a 10-second client query deadline and
5-second PostgreSQL statement/lock timeouts. Any query/transport/protocol failure
poisons the session; no automatic reconnect can silently replace its backend PID.
The private Windows test seam accepts only loopback fixture coordinates and a
fresh generated synthetic login, not a production URL or remote configuration.

After callback completion, inspect the full returned container ID, require it is
running the exact reviewed image, reject mounts shadowing compiled API code,
repeat the exact-image capability probe, recheck post-cutover schema/run count,
and recheck the session fence. Only then return the immutable `RuntimeReceipt` and
allow normal context exit to release the fence. Health verification and confirming
that this is the service receiving traffic belong to the trusted parent helper;
the library does not infer service identity from an arbitrary container ID.

Old images are eligible only while the authoritative operational count is zero.
Once any native run exists, even after selective import rollback, runtime guard 1
is mandatory. Selective rollback retains custody/window/run history. Retaining five
old image releases does not make those images eligible for runtime rollback.
Restoring a pre-import database is a separately approved emergency procedure.

## Failure and recovery

Before action, refusal closes the dedicated connection and releases any acquired
session lock. Once an action starts, any exception, invalid container, schema drift,
image/capability mismatch or unverified installed result leaves the gate dirty.
`__exit__` raises `RuntimeVerificationRequired` and deliberately retains the
connection/fence. The caller must keep this gate alive and execute a reviewed
recovery callback through `gate.run(recovery, artifact=reviewed_artifact)`, then
exit normally only after successful installed verification. It must not close the
connection or exit its process on this failure path. The library cannot prevent
the host process from terminating; losing the database session releases its lock.

For a new migration failure during a managed action, retain this same session
fence. Unfinished ledger rows still prevent `gate.run()` recovery preflight.
The parent helper must independently verify the exact new name/checksum and
known atomic SQL prefix before its narrowly reviewed `prisma migrate resolve
--rolled-back` action. Verify the current fence around that action. The connector
remains read-only; it provides no UPDATE/DDL or resolver escape hatch. After
resolution, `gate.run(reviewed_legacy_recovery)` can verify a reviewed prefix with
zero operational runs and the exact installed legacy artifact. Only that verified
recovery permits normal fence release. Do not turn missing/unknown catalog state
or an unreviewed failed checksum into a recovery allowance.

This is a scoped managed-admin workflow, not an infrastructure safeguard against
manual Portainer force, direct Docker commands, host/process death, unguarded
writers, runtime filesystem tampering or privileged database changes. Those bypasses
are unsupported; do not claim they are prevented. No database delivery-blocking
trigger or inherited DB connection marker is introduced.

## Parent integration and acceptance gates

Before operational import or release acceptance:

1. Preserve the parent's shared transaction fence before native job locks. The
   owned native test exercises the actual operational service's `beforeJobLock`
   path and actual repository transaction, including the job-row lock order.
   Preserve this coverage when the integrated runtime changes.
2. Bind exact source/image/module hashes and approved pre/post schema contracts in
   the private reviewed deploy helper. Hold its connection across real cutover,
   health/service verification, installed proof and verified recovery on failure.
   Parent owns the three atomic SQL wrappers, the narrowly verified Prisma resolver
   and core context handling of legitimate resolved attempts. Those changes are
   outside this worker's runtime patch.
3. Exercise actual sandbox Docker probing and deployed container verification in
   an authorized environment. This worker does not run Docker or touch servers.
4. Version guardian/handoff must preserve this minimum runtime requirement for all
   future managed deploys and rollbacks. Complete independent compatibility,
   regression, business/security and release reviews for the final integrated
   artifact. No UI changed; visual paths are outside this worker scope.

## Local evidence and remaining proof limits

`python -m unittest discover -s scripts/tests -p 'history_runtime*_test.py'`:
24 PASS (18 gate and six connector tests). Includes hostile ambient Docker settings
through the default full gate, exact local subprocess argv/environment, CSV
positions/types, bounds/timeouts and poisoned-session refusal. The probe JavaScript
also runs locally in Node with fake filesystem/module inputs.

With `YO_HISTORY_NATIVE=1`, run
`node --test apps/api/tests/history-runtime-guard-native.test.mjs`:
1 PASS, 0 FAIL, 0 SKIP, 40.81 seconds, ten checkpoints. Uses the actual persistent
psql connector, dedicated sessions, owned Windows PostgreSQL 16 and actual core
lock path. Confirms both fence orderings, a lockable job row while core waits,
SQL permission refusal, RLS refusal and persistent native/ROLLED_BACK custody.

A separate empty database in the same owned cluster receives the unchanged first
49 SQL files. Each new migration then fails inside a transaction; a whole-schema
snapshot proves rollback leaves the known prefix unchanged. Resolved metadata
permits legacy recovery under the retained fence, followed by successful retries
retaining all three approved resolved attempts. Removing the planning constraint
or adding old/unknown/duplicate/unfinished attempts refuses recovery.

The native test replaces only the downstream planning action with a synthetic
run/window transaction and uses synthetic Docker image output. The metadata
resolution step is owned test SQL modeling Prisma's resolved state; it does not
execute the actual Prisma resolver CLI. Its generated login exists only in the
owned fixture; no existing password, fixture source or production data is changed.
Docker is unavailable locally: real daemon discovery/exec, image probes, actual
API replacement, service traffic/health, production migration and full operational
import remain unproved here. Local passes do not establish deployment acceptance.

## Release helper handoff (Peirce) and independent review

Pass `connect_runtime_database` directly to `ManagedRuntimeGate`, supply all exact
approved pre/post prefix contracts and the approved resolved-attempt tuple, and
keep the callback/recovery inside the same held session. Keep the ledger query
unfiltered and validate all attempts before computing the completed-only digest;
do not hide unfinished/unknown rows with an SQL WHERE clause. The psql connector's
allowlist already includes the two planning authority queries. No driver dependency
or arbitrary connection/command configuration is required.

The runtime patch receipt is
`.local/history-runtime-compatibility/prefix-local-daemon-receipt.json` in the
worker; canonical native/unit logs are `.local/history-runtime-prefix-native-first.log`
and `.local/history-runtime-prefix-unit-final.log`. BUSINESS reviewer James must
independently close P1 against the exact runtime bytes, not this documentation:

- `scripts/history_runtime_guard.py` raw SHA256:
  `622d9f9ec586fa440f398eab7cc36c28d4e1bb5eed4dd5c33fb6349adc6aa232`
- `scripts/history_runtime_connection.py` raw SHA256:
  `c26df66b8fbc9c1ee67fa539acbc44d3cbe8009b758f3c4647a0eb98af3bd80f`

Passing the regressions is implementation evidence; it is not James's independent
closure or release authorization.
