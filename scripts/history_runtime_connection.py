"""Host-only, dependency-free persistent psql connection for ManagedRuntimeGate.

Wire connect_runtime_database directly as the gate's connection factory. It has
no configuration/CLI/HTTP surface. The fixed local Docker daemon resolves exactly
one running CRM postgres service; its existing container environment supplies the
local role/database. No password/environment export or API container is used.

One psql process owns one autocommit backend for the entire connection lifetime.
Only exact guard SELECTs are accepted. CSV keeps duplicate column positions.
Any transport, protocol, query, timeout or size failure poisons the connection;
there is deliberately no reconnect. close() ends this session and its locks.
"""
import csv
import io
import os
from pathlib import Path
import queue
import re
import subprocess
import threading
import time
import uuid


class RuntimeConnectionError(RuntimeError):
    pass


_KEY = "hashtextextended('history-runtime-deployment',0)"
# Exact immutable query surface from history_runtime_guard.py. A guard query
# change must explicitly extend this contract and its owned integration test.
_QUERIES = {
    'SELECT pg_backend_pid()': ((int,), 1, 1),
    f'SELECT pg_try_advisory_lock({_KEY})': ((bool,), 1, 1),
    f'SELECT pg_advisory_unlock({_KEY})': ((bool,), 1, 1),
    ("SELECT pg_backend_pid(), EXISTS (SELECT 1 FROM pg_locks "
     "WHERE locktype='advisory' AND pid=pg_backend_pid() "
     "AND mode='ExclusiveLock' AND granted "
     f"AND classid=(({_KEY} >> 32) & 4294967295)::oid "
     f"AND objid=({_KEY} & 4294967295)::oid AND objsubid=1)"): ((int, bool), 1, 1),
    ('SELECT migration_name, checksum, finished_at IS NOT NULL, '
     'rolled_back_at IS NOT NULL FROM public._prisma_migrations'): ((str, str, bool, bool), 1000, 1),
    ("SELECT tablename FROM pg_tables WHERE schemaname='public' "
     "AND tablename LIKE 'HistoryMigration%'"): ((str,), 8, 0),
    ("SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n "
     "ON n.oid=c.relnamespace WHERE n.nspname='public' "
     "AND c.relname='HistoryMigrationPilotRun' AND c.relrowsecurity)"): ((bool,), 1, 1),
    ("SELECT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a "
     "ON a.attrelid=c.conrelid AND a.attname='environment' "
     "WHERE c.conrelid='public.\"HistoryMigrationPilotRun\"'::regclass "
     "AND c.conname='HistoryMigrationPilotRun_environment_check' AND c.contype='c' "
     "AND c.convalidated AND NOT c.connoinherit AND a.attnotnull AND NOT a.attisdropped "
     "AND a.atttypid='text'::regtype "
     "AND pg_get_expr(c.conbin,c.conrelid)='(environment = ''ISOLATED_WASM''::text)')"): ((bool,), 1, 1),
    ('SELECT count(*) FILTER (WHERE "environment"=\'OPERATIONAL_NATIVE\'), '
     'count(*) FILTER (WHERE "environment" IS DISTINCT FROM \'ISOLATED_WASM\') '
     'FROM public."HistoryMigrationPilotRun"'): ((int, int), 1, 1),
    ('SELECT count(*) FILTER (WHERE "environment"=\'OPERATIONAL_NATIVE\'), '
     'count(*) FILTER (WHERE "environment" IS NULL OR '
     '"environment" NOT IN (\'OPERATIONAL_NATIVE\',\'ISOLATED_WASM\') OR '
     '("environment"=\'OPERATIONAL_NATIVE\' AND '
     '("nativeConversationId" IS NULL OR "nativeAccountId" IS NULL OR '
     '"nativeCustomerId" IS NULL OR btrim("nativeAccountId")=\'\' OR '
     'btrim("nativeCustomerId")=\'\'))) FROM public."HistoryMigrationPilotRun"'): ((int, int), 1, 1),
}
_DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
_MAX_BYTES = 1048576


def _local_environment():
    # Do not inherit DOCKER_HOST/CONTEXT/TLS, PG*, PSQL*, provider secrets or
    # NODE_OPTIONS. The production connector is for the existing Linux host.
    return {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
            'LANG': 'C.UTF-8'}


def connect_runtime_database():
    """Fixed local CRM factory; pass this callable to ManagedRuntimeGate."""
    env = _local_environment()
    try:
        result = subprocess.run(_DOCKER + ['ps', '--no-trunc',
            '--filter=label=com.docker.compose.project=yoleotard-crm',
            '--filter=label=com.docker.compose.service=postgres', '--format={{.ID}}'],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=5, check=True, env=env)
        ids = result.stdout.decode('ascii', errors='strict').splitlines()
        if len(ids) != 1 or not re.fullmatch(r'[a-f0-9]{64}', ids[0]):
            raise RuntimeConnectionError('Require exactly one running local CRM postgres container')
        argv = _DOCKER + ['exec', '-i', ids[0], 'sh', '-c',
            'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" '
            '-XqAtw -v ON_ERROR_STOP=1']
        return _PsqlConnection(argv, env)
    except RuntimeConnectionError:
        raise
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        raise RuntimeConnectionError('Cannot open local CRM PostgreSQL session') from exc


def _connect_owned_test(argv, env):
    """Private test-only loopback fixture seam, never deployed configuration.

    Requires the existing Windows PG16 fixture executable, a generated fixture
    database and a fresh synthetic login. Only generated PGPASSWORD is accepted.
    No arbitrary remote host, production URL or existing credential is accepted.
    """
    if (os.name != 'nt' or not isinstance(argv, list) or len(argv) != 12
            or not str(Path(argv[0])).replace('\\', '/').endswith(
                '/phase-c12/deps/postgresql16/pgsql/bin/psql.exe')
            or argv[1:3] != ['-h', '127.0.0.1'] or argv[3] != '-p'
            or not re.fullmatch(r'[1-9][0-9]{0,4}', argv[4]) or int(argv[4]) > 65535
            or argv[5:8] != ['-U', 'runtime_psql_fixture', '-d']
            or not re.fullmatch(r'history_[a-f0-9]{24}', argv[8])
            or argv[9:] != ['-XqAtw', '-v', 'ON_ERROR_STOP=1']
            or set(env) != {'PGPASSWORD'} or not re.fullmatch(r'[a-f0-9]{64}', env['PGPASSWORD'])):
        raise RuntimeConnectionError('Only the owned Windows PostgreSQL fixture is accepted')
    minimal = {key: os.environ[key] for key in ('SystemRoot', 'WINDIR', 'TEMP', 'TMP') if key in os.environ}
    minimal.update(env)
    return _PsqlConnection(argv, minimal)


class _PsqlConnection:
    autocommit = True

    def __init__(self, argv, env):
        self._closed = False
        self._failed = threading.Event()
        self._busy = threading.Lock()
        self._output = queue.Queue(maxsize=64)
        self._timeout = 10
        self._process = None
        try:
            self._process = subprocess.Popen(argv, stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0,
                env=env, shell=False, **({'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}))
            self._readers = [threading.Thread(target=self._read, args=(False,), daemon=True),
                             threading.Thread(target=self._read, args=(True,), daemon=True)]
            for reader in self._readers:
                reader.start()
            startup = ("\\set AUTOCOMMIT on\nSET statement_timeout='5s';\n"
                       "SET lock_timeout='5s';\nSET client_encoding='UTF8';\n"
                       "SET default_transaction_read_only=on;\n")
            if self._exchange(startup):
                raise RuntimeConnectionError('Unexpected PostgreSQL startup output')
            cursor = self.cursor()
            cursor.execute('SELECT pg_backend_pid()')
            self.backend_pid = cursor.fetchone()[0]
            cursor.close()
        except Exception as exc:
            self.close()
            if isinstance(exc, RuntimeConnectionError):
                raise
            raise RuntimeConnectionError('Persistent PostgreSQL session could not start') from exc

    def _read(self, stderr):
        stream = self._process.stderr if stderr else self._process.stdout
        try:
            while not self._closed:
                data = os.read(stream.fileno(), 4096)
                if stderr:
                    if not data:
                        return
                    # Never retain/echo database error text or connection details.
                    self._failed.set()
                    continue
                try:
                    self._output.put(data or None, timeout=0.2)
                except queue.Full:
                    self._failed.set()
                    return
                if not data:
                    return
        except (OSError, ValueError):
            self._failed.set()

    def _exchange(self, command):
        if self._closed or self._failed.is_set() or self._process.poll() is not None:
            raise RuntimeConnectionError('PostgreSQL session is unavailable; reconnect forbidden')
        marker = ('__YO_HISTORY_GUARD_' + uuid.uuid4().hex + '__').encode('ascii')
        payload = command.encode('utf-8') + b'\\echo ' + marker + b'\n'
        if len(payload) > 4096:
            raise RuntimeConnectionError('Query transport limit exceeded')
        deadline = time.monotonic() + self._timeout
        written = threading.Event()
        def write():
            try:
                self._process.stdin.write(payload)
                self._process.stdin.flush()
            except (OSError, ValueError):
                self._failed.set()
            finally:
                written.set()
        writer = threading.Thread(target=write, daemon=True)
        writer.start()
        output = bytearray()
        try:
            if not written.wait(max(0, deadline-time.monotonic())):
                raise RuntimeConnectionError('PostgreSQL write deadline exceeded')
            while True:
                if self._failed.is_set():
                    raise RuntimeConnectionError('PostgreSQL query/transport error')
                remaining = deadline-time.monotonic()
                if remaining <= 0:
                    raise RuntimeConnectionError('PostgreSQL read deadline exceeded')
                try:
                    block = self._output.get(timeout=min(remaining, 0.1))
                except queue.Empty:
                    continue
                if block is None:
                    raise RuntimeConnectionError('PostgreSQL session ended unexpectedly')
                output.extend(block)
                if len(output) > _MAX_BYTES:
                    raise RuntimeConnectionError('PostgreSQL output limit exceeded')
                # A fresh unguessable whole-line marker frames each response;
                # csv.reader below retains quoted newlines/commas and positions.
                lines = output.splitlines(keepends=True)
                if lines and lines[-1].rstrip(b'\r\n') == marker and lines[-1].endswith(b'\n'):
                    if self._failed.is_set():
                        raise RuntimeConnectionError('PostgreSQL error before response completion')
                    return bytes(output[:-len(lines[-1])]).decode('utf-8', errors='strict')
        except Exception as exc:
            self._failed.set()
            self.close()
            if isinstance(exc, RuntimeConnectionError):
                raise
            raise RuntimeConnectionError('Invalid PostgreSQL response') from exc
        finally:
            writer.join(timeout=0.2)

    def cursor(self):
        if self._closed or self._failed.is_set():
            raise RuntimeConnectionError('PostgreSQL session is closed/poisoned')
        return _Cursor(self)

    def close(self):
        if self._closed:
            return
        self._closed = True
        process = self._process
        if process is None:
            return
        # Closing stdin gives psql EOF even when Docker/API service replacement
        # is occurring. Statement timeout bounds an outstanding server query.
        try:
            process.stdin.close()
        except (OSError, ValueError):
            pass
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            process.kill()
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                pass
        for stream in (process.stdout, process.stderr):
            try:
                stream.close()
            except (OSError, ValueError):
                pass


class _Cursor:
    def __init__(self, connection):
        self._connection, self._closed, self._rows = connection, False, None
        self._position = 0

    def execute(self, sql):
        if self._closed or not isinstance(sql, str) or sql not in _QUERIES:
            raise RuntimeConnectionError('Only exact managed history guard queries are allowed')
        if not self._connection._busy.acquire(blocking=False):
            raise RuntimeConnectionError('Concurrent session queries are forbidden')
        try:
            types, maximum, minimum = _QUERIES[sql]
            text = self._connection._exchange('\\copy (' + sql + ') TO STDOUT WITH (FORMAT csv, FORCE_QUOTE *)\n')
            rows = list(csv.reader(io.StringIO(text, newline=''), strict=True))
            if not minimum <= len(rows) <= maximum or any(len(row) != len(types) for row in rows):
                raise RuntimeConnectionError('Unexpected PostgreSQL row shape/count')
            def typed(value, kind):
                if kind is bool:
                    if value not in ('t', 'f'):
                        raise RuntimeConnectionError('Invalid PostgreSQL boolean')
                    return value == 't'
                if kind is int:
                    if not re.fullmatch(r'0|[1-9][0-9]{0,18}', value) or int(value) > 9223372036854775807:
                        raise RuntimeConnectionError('Invalid PostgreSQL integer')
                    return int(value)
                return value
            self._rows = [tuple(typed(value, kind) for value, kind in zip(row, types)) for row in rows]
            self._position = 0
            return self
        except Exception as exc:
            self._connection._failed.set()
            self._connection.close()
            if isinstance(exc, RuntimeConnectionError):
                raise
            raise RuntimeConnectionError('Invalid PostgreSQL CSV response') from exc
        finally:
            self._connection._busy.release()

    def fetchone(self):
        if self._closed or self._rows is None:
            raise RuntimeConnectionError('Cursor has no result')
        if self._position >= len(self._rows):
            return None
        row = self._rows[self._position]
        self._position += 1
        return row

    def fetchall(self):
        if self._closed or self._rows is None:
            raise RuntimeConnectionError('Cursor has no result')
        rows = self._rows[self._position:]
        self._position = len(self._rows)
        return rows

    def close(self):
        self._closed = True
        self._rows = None
