"""Host-only managed deployment fence. No CLI, HTTP entry point or deploy commands.

The caller supplies a dedicated direct PostgreSQL connection, root-reviewed
artifact/schema contracts and one trusted Python cutover callback. A callback
returns the full installed API container ID. Failed cutovers retain the session
fence until the caller verifies recovery with run(); see the accompanying plan.
"""
from dataclasses import dataclass
import hashlib
import json
import re
import subprocess


class RuntimeGuardError(RuntimeError):
    pass


class RuntimeVerificationRequired(RuntimeGuardError):
    pass


def _sha(value):
    return isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value) is not None


@dataclass(frozen=True)
class RuntimeArtifact:
    image_id: str
    source_snapshot_sha256: str
    capability_module_sha256: str | None

    def __post_init__(self):
        if (not isinstance(self.image_id, str) or not self.image_id.startswith('sha256:')
                or not _sha(self.image_id[7:]) or not _sha(self.source_snapshot_sha256)
                or (self.capability_module_sha256 is not None
                    and not _sha(self.capability_module_sha256))):
            raise RuntimeGuardError('Require exact reviewed image/source/module hashes')


@dataclass(frozen=True)
class SchemaContract:
    migration_set_sha256: str
    history_shape: str
    allowed_rolled_back_migrations: tuple[tuple[str, str], ...] = ()

    def __post_init__(self):
        if not _sha(self.migration_set_sha256) or self.history_shape not in ('ABSENT', 'INTAKE_V1', 'PLANNING_V1', 'NATIVE_V1'):
            raise RuntimeGuardError('Invalid reviewed schema contract')
        allowed = self.allowed_rolled_back_migrations
        if (not isinstance(allowed, tuple) or any(not isinstance(pair, tuple) or len(pair) != 2
                or pair[0] not in _NEW_MIGRATIONS or not _sha(pair[1]) for pair in allowed)
                or len({pair[0] for pair in allowed}) != len(allowed)):
            raise RuntimeGuardError('Only exact reviewed new history rollback attempts are allowed')


@dataclass(frozen=True)
class RuntimeReceipt:
    image_id: str
    source_snapshot_sha256: str
    historical_ingress_guard: int | None
    container_id: str
    operational_runs: int


def migration_set_digest(rows):
    """Fingerprint exact completed migration names/checksums, not just their count."""
    pairs = list(rows)
    if (any(not isinstance(row, (list, tuple)) or len(row) != 2
            or not isinstance(row[0], str) or not row[0] or not _sha(row[1]) for row in pairs)
            or len({row[0] for row in pairs}) != len(pairs)):
        raise RuntimeGuardError('Invalid migration inventory')
    encoded = json.dumps(sorted([list(row) for row in pairs]), ensure_ascii=True,
                         separators=(',', ':')).encode('ascii')
    return hashlib.sha256(encoded).hexdigest()


_KEY = "hashtextextended('history-runtime-deployment',0)"
_NEW_MIGRATIONS = frozenset(('20261029150000_history_migration_staging',
                            '20261029160000_history_migration_planning',
                            '20261101010000_history_operational_native'))
_TABLES = frozenset(('HistoryMigrationBatch', 'HistoryMigrationIdentity',
                     'HistoryMigrationJob', 'HistoryMigrationNativeReview',
                     'HistoryMigrationNativeWindow', 'HistoryMigrationOrigin',
                     'HistoryMigrationPilotRun', 'HistoryMigrationTarget'))
_INTAKE_TABLES = frozenset(('HistoryMigrationJob', 'HistoryMigrationBatch'))
_PLANNING_TABLES = _TABLES - {'HistoryMigrationNativeReview', 'HistoryMigrationNativeWindow'}
_PLANNING_ENV_SQL = ("SELECT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a "
    "ON a.attrelid=c.conrelid AND a.attname='environment' "
    "WHERE c.conrelid='public.\"HistoryMigrationPilotRun\"'::regclass "
    "AND c.conname='HistoryMigrationPilotRun_environment_check' AND c.contype='c' "
    "AND c.convalidated AND NOT c.connoinherit AND a.attnotnull AND NOT a.attisdropped "
    "AND a.atttypid='text'::regtype "
    "AND pg_get_expr(c.conbin,c.conrelid)='(environment = ''ISOLATED_WASM''::text)')")
_PLANNING_RUNS_SQL = ('SELECT count(*) FILTER (WHERE "environment"=\'OPERATIONAL_NATIVE\'), '
    'count(*) FILTER (WHERE "environment" IS DISTINCT FROM \'ISOLATED_WASM\') '
    'FROM public."HistoryMigrationPilotRun"')
_PROBE = r"""
const fs = require('node:fs'), crypto = require('node:crypto');
const path = '/app/apps/api/dist/history-migration/history-runtime-capability.js';
const expected = process.argv[1];
let blob;
try { blob = fs.readFileSync(path); }
catch (e) {
  if (e.code === 'ENOENT' && expected === 'ABSENT') {
    process.stdout.write(JSON.stringify({present:false})); process.exit(0);
  }
  throw Error('Capability file unavailable');
}
const hash = crypto.createHash('sha256').update(blob).digest('hex');
if (hash !== expected) throw Error('Capability artifact mismatch');
const value = require(path).HISTORY_RUNTIME_CAPABILITY;
const descriptor = value && Object.getOwnPropertyDescriptor(value, 'historicalIngressGuard');
if (!value || !Object.isFrozen(value) || Reflect.ownKeys(value).length !== 1 ||
    !descriptor || !('value' in descriptor) || descriptor.value !== 1) {
  throw Error('Invalid embedded capability');
}
process.stdout.write(JSON.stringify({present:true,moduleSha256:hash,
  capability:{historicalIngressGuard:1}}));
"""


def _docker(argv):
    # Fixed argv constructed below; no shell and no provider credentials supplied.
    from history_runtime_connection import _local_environment
    if not isinstance(argv, list) or len(argv) < 2 or argv[0] != 'docker' or argv[1] not in ('run', 'inspect'):
        raise RuntimeGuardError('Only local runtime capability commands are accepted')
    command = ['docker', '--host=unix:///var/run/docker.sock', *argv[1:]]
    try:
        result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=30, check=True,
                                env=_local_environment())
        if len(result.stdout) > 65536:
            raise RuntimeGuardError('Docker result too large')
        return result.stdout.decode('utf-8', errors='strict')
    except (OSError, subprocess.SubprocessError, UnicodeError) as exc:
        raise RuntimeGuardError('Docker verification failed') from exc


def _json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate JSON key')
            result[key] = value
        return result
    try:
        if not isinstance(raw, str) or len(raw) > 65536:
            raise ValueError('Invalid output size')
        return json.loads(raw, object_pairs_hook=unique,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
    except (ValueError, TypeError, RecursionError) as exc:
        raise RuntimeGuardError('Invalid Docker verification response') from exc


class ManagedRuntimeGate:
    """Single-use host fence; never use transaction-pooling/reconnecting sessions.

    run(action) may be retried for recovery while the original fence is held.
    On an unverified cutover __exit__ deliberately retains the connection and
    raises RuntimeVerificationRequired, even if the callback raised first.
    """

    def __init__(self, connect, artifact, schemas, *, docker=_docker):
        if not isinstance(artifact, RuntimeArtifact):
            raise RuntimeGuardError('A reviewed artifact contract is required')
        self._connect, self._artifact, self._docker = connect, artifact, docker
        self._schemas = tuple(schemas)
        if not self._schemas or any(not isinstance(s, SchemaContract) for s in self._schemas):
            raise RuntimeGuardError('Reviewed schema contracts required')
        self._connection = None
        self._pid = None
        self._held = False
        self._dirty = False
        self._used = False

    def _query(self, sql, *, many=False):
        try:
            cursor = self._connection.cursor()
            try:
                cursor.execute(sql)
                return cursor.fetchall() if many else cursor.fetchone()
            finally:
                cursor.close()
        except Exception as exc:
            raise RuntimeGuardError('Database fence/schema verification failed') from exc

    def _assert_fence(self):
        if not self._held:
            raise RuntimeGuardError('Managed deployment fence is not held')
        row = self._query("SELECT pg_backend_pid(), EXISTS (SELECT 1 FROM pg_locks "
                          "WHERE locktype='advisory' AND pid=pg_backend_pid() "
                          "AND mode='ExclusiveLock' AND granted "
                          f"AND classid=(({_KEY} >> 32) & 4294967295)::oid "
                          f"AND objid=({_KEY} & 4294967295)::oid AND objsubid=1)")
        if not row or row[0] != self._pid or row[1] is not True:
            raise RuntimeGuardError('Dedicated session or exclusive fence lost')

    def _runs(self):
        self._assert_fence()
        rows = self._query('SELECT migration_name, checksum, finished_at IS NOT NULL, '
                           'rolled_back_at IS NOT NULL FROM public._prisma_migrations', many=True)
        if not rows or any(len(r) != 4 or type(r[2]) is not bool or type(r[3]) is not bool
                           or (not r[2] and not r[3]) or (r[2] and r[3]) for r in rows):
            raise RuntimeGuardError('Incomplete/unknown migration inventory')
        completed = [(r[0], r[1]) for r in rows if r[2]]
        rolled_back = [(r[0], r[1]) for r in rows if r[3]]
        if any(not isinstance(name, str) or not _sha(checksum) for name, checksum in rolled_back):
            raise RuntimeGuardError('Invalid rolled-back migration attempt')
        if len(set(rolled_back)) != len(rolled_back) or len({p[0] for p in rolled_back}) != len(rolled_back):
            raise RuntimeGuardError('Duplicate rolled-back migration attempts')
        digest = migration_set_digest(completed)
        tables = self._query("SELECT tablename FROM pg_tables WHERE schemaname='public' "
                             "AND tablename LIKE 'HistoryMigration%'", many=True)
        names = frozenset(r[0] for r in tables)
        shape = ('ABSENT' if not names else 'INTAKE_V1' if names == _INTAKE_TABLES
                 else 'PLANNING_V1' if names == _PLANNING_TABLES else 'NATIVE_V1' if names == _TABLES else None)
        if not any(s.migration_set_sha256 == digest and s.history_shape == shape
                   and set(rolled_back).issubset(s.allowed_rolled_back_migrations) for s in self._schemas):
            raise RuntimeGuardError('Schema not in root-reviewed compatibility inventory')
        if shape in ('ABSENT', 'INTAKE_V1'):
            return 0
        # A successful COUNT through row-level security is not proof of no runs.
        security = self._query("SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n "
                               "ON n.oid=c.relnamespace WHERE n.nspname='public' "
                               "AND c.relname='HistoryMigrationPilotRun' AND c.relrowsecurity)")
        if not security or security[0] is not False:
            raise RuntimeGuardError('Operational run visibility is not authoritative')
        if shape == 'PLANNING_V1':
            environment = self._query(_PLANNING_ENV_SQL)
            if not environment or environment[0] is not True:
                raise RuntimeGuardError('Planning prefix lacks validated WASM-only environment authority')
            counts = self._query(_PLANNING_RUNS_SQL)
            if not counts or len(counts) != 2 or any(type(n) is not int or n != 0 for n in counts):
                raise RuntimeGuardError('Planning prefix contains operational/unknown environments')
            return 0
        row = self._query('SELECT count(*) FILTER (WHERE "environment"=\'OPERATIONAL_NATIVE\'), '
                          'count(*) FILTER (WHERE "environment" IS NULL OR '
                          '"environment" NOT IN (\'OPERATIONAL_NATIVE\',\'ISOLATED_WASM\') OR '
                          '("environment"=\'OPERATIONAL_NATIVE\' AND '
                          '("nativeConversationId" IS NULL OR "nativeAccountId" IS NULL OR '
                          '"nativeCustomerId" IS NULL OR btrim("nativeAccountId")=\'\' OR '
                          'btrim("nativeCustomerId")=\'\'))) FROM public."HistoryMigrationPilotRun"')
        if (not row or len(row) != 2 or type(row[0]) is not int or row[0] < 0
                or type(row[1]) is not int or row[1] != 0):
            raise RuntimeGuardError('Unknown operational run binding')
        return row[0]

    def _capability(self, artifact):
        result = _json(self._docker([
            'docker', 'run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL',
            '--security-opt=no-new-privileges', '--pids-limit=32', '--memory=64m',
            '--cpus=0.5', '--user=65534:65534', '--entrypoint=node', artifact.image_id,
            '-e', _PROBE, artifact.capability_module_sha256 or 'ABSENT']))
        if artifact.capability_module_sha256 is None:
            if (not isinstance(result, dict) or result != {'present': False}
                    or type(result.get('present')) is not bool):
                raise RuntimeGuardError('Legacy capability artifact mismatch')
            return None
        if (not isinstance(result, dict) or set(result) != {'present', 'moduleSha256', 'capability'}
                or result['present'] is not True
                or result['moduleSha256'] != artifact.capability_module_sha256
                or not isinstance(result['capability'], dict)
                or set(result['capability']) != {'historicalIngressGuard'}
                or type(result['capability']['historicalIngressGuard']) is not int
                or result['capability']['historicalIngressGuard'] != 1):
            raise RuntimeGuardError('Embedded capability verification failed')
        return 1

    def _preflight(self, artifact):
        count = self._runs()
        capability = self._capability(artifact)
        self._assert_fence()
        if count and capability != 1:
            raise RuntimeGuardError('Operational custody requires historical ingress guard 1')
        return count, capability

    def __enter__(self):
        if self._used:
            raise RuntimeGuardError('Gate objects are single-use')
        self._used = True
        try:
            self._connection = self._connect()
            if self._connection.autocommit is not True:
                raise RuntimeGuardError('Dedicated autocommit session required')
            self._pid = self._query('SELECT pg_backend_pid()')[0]
            row = self._query(f'SELECT pg_try_advisory_lock({_KEY})')
            if not row or row[0] is not True:
                raise RuntimeGuardError('Deployment/import fence busy; retry whole managed operation')
            self._held = True
            self._preflight(self._artifact)
            return self
        except Exception as exc:
            if self._connection is not None:
                self._connection.close()
            self._held = False
            if isinstance(exc, RuntimeGuardError):
                raise
            raise RuntimeGuardError('Cannot establish managed runtime fence') from exc

    def run(self, action, *, artifact=None):
        """Execute trusted host code; recovery can specify another reviewed artifact."""
        artifact = artifact or self._artifact
        if not callable(action) or not isinstance(artifact, RuntimeArtifact):
            raise RuntimeGuardError('Trusted callback and reviewed artifact required')
        count, capability = self._preflight(artifact)
        self._dirty = True
        try:
            container = action()
            self._assert_fence()
            if not _sha(container):
                raise RuntimeGuardError('Callback must return full installed container ID')
            result = _json(self._docker([
                'docker', 'inspect', '--type=container', '--format',
                '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},'
                '"mounts":{{json .Mounts}}}', container]))
            if (not isinstance(result, dict) or result.get('id') != container
                    or result.get('image') != artifact.image_id or result.get('running') is not True
                    or not isinstance(result.get('mounts'), list)):
                raise RuntimeGuardError('Installed API image does not match reviewed candidate')
            for mount in result['mounts']:
                destination = mount.get('Destination') if isinstance(mount, dict) else mount
                if not isinstance(destination, str) or not destination.startswith('/'):
                    raise RuntimeGuardError('Invalid installed mount inventory')
                destination = destination.rstrip('/') or '/'
                target = '/app/apps/api/dist'
                if (destination == '/' or destination == target or target.startswith(destination + '/')
                        or destination.startswith(target + '/')):
                    raise RuntimeGuardError('Installed mounts shadow verified runtime artifact')
            if self._capability(artifact) != capability:
                raise RuntimeGuardError('Installed capability mismatch')
            # Callback may apply migrations; re-evaluate the approved post-cutover schema.
            installed_count = self._runs()
            if installed_count and capability != 1:
                raise RuntimeGuardError('Installed runtime cannot serve operational custody')
            self._assert_fence()
            self._dirty = False
            return RuntimeReceipt(artifact.image_id, artifact.source_snapshot_sha256,
                                  capability, container, max(count, installed_count))
        except RuntimeGuardError:
            raise
        except Exception as exc:
            raise RuntimeGuardError('Managed action failed; verified recovery required') from exc

    def __exit__(self, exc_type, exc, traceback):
        if self._dirty:
            raise RuntimeVerificationRequired('Cutover unverified: fence retained; recover using this gate') from exc
        self._assert_fence()
        row = self._query(f'SELECT pg_advisory_unlock({_KEY})')
        if not row or row[0] is not True:
            raise RuntimeGuardError('Exclusive fence release failed')
        self._held = False
        self._connection.close()
        return False
