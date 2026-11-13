"""Managed host-gate tests: fake Docker and pinned DB sessions, never real servers."""
import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from history_runtime_guard import (ManagedRuntimeGate, RuntimeArtifact, SchemaContract,
                                  RuntimeGuardError, RuntimeVerificationRequired,
                                  migration_set_digest)
from history_runtime_guard import _PROBE, _docker

OLD, NEW, OTHER = ('sha256:' + c * 64 for c in 'abc')
CONTAINER = 'd' * 64
MIGRATIONS = [('initial', '1' * 64)]
SCHEMA = SchemaContract(migration_set_digest(MIGRATIONS), 'NATIVE_V1')
LEGACY_SCHEMA = SchemaContract(migration_set_digest(MIGRATIONS), 'ABSENT')
NATIVE_TABLES = ['HistoryMigrationBatch', 'HistoryMigrationIdentity', 'HistoryMigrationJob',
                 'HistoryMigrationNativeReview', 'HistoryMigrationNativeWindow',
                 'HistoryMigrationOrigin', 'HistoryMigrationPilotRun', 'HistoryMigrationTarget']
OLD_ARTIFACT = RuntimeArtifact(OLD, '2' * 64, None)
NEW_ARTIFACT = RuntimeArtifact(NEW, '3' * 64, '4' * 64)


class Database:
    def __init__(self):
        self.condition = threading.Condition()
        self.exclusive = None
        self.readers = 0
        self.runs = 0
        self.invalid = 0
        self.tables = NATIVE_TABLES[:]
        self.queries = []
        self.next_pid = 10
        self.failure = False
        self.rls = False
        self.incomplete = False
        self.migration_rows = None
        self.planning_environment = True

    def connect(self):
        self.next_pid += 1
        return Connection(self, self.next_pid)

    def native_import(self, entered, finish):
        with self.condition:
            while self.exclusive is not None:
                self.condition.wait(timeout=1)
            self.readers += 1
        entered.set()
        try:
            finish.wait(timeout=3)
            self.runs += 1
        finally:
            with self.condition:
                self.readers -= 1
                self.condition.notify_all()


class Connection:
    autocommit = True

    def __init__(self, database, pid):
        self.database, self.pid, self.closed = database, pid, False
        self.pid_changed = False

    def cursor(self):
        return Cursor(self)

    def close(self):
        self.closed = True
        with self.database.condition:
            if self.database.exclusive == self.pid:
                self.database.exclusive = None
                self.database.condition.notify_all()


class Cursor:
    def __init__(self, connection):
        self.c = connection

    def execute(self, sql):
        db = self.c.database
        db.queries.append(sql)
        if db.failure or self.c.closed:
            raise RuntimeError('Synthetic database failure')
        if 'pg_try_advisory_lock' in sql:
            with db.condition:
                ok = db.exclusive is None and db.readers == 0
                if ok:
                    db.exclusive = self.c.pid
                self.rows = [(ok,)]
        elif 'pg_advisory_unlock' in sql:
            with db.condition:
                ok = db.exclusive == self.c.pid
                if ok:
                    db.exclusive = None
                    db.condition.notify_all()
                self.rows = [(ok,)]
        elif 'pg_locks' in sql:
            self.rows = [(self.c.pid + int(self.c.pid_changed), db.exclusive == self.c.pid)]
        elif 'pg_backend_pid()' in sql:
            self.rows = [(self.c.pid,)]
        elif '_prisma_migrations' in sql:
            self.rows = db.migration_rows if db.migration_rows is not None else [(name, checksum, not db.incomplete, False) for name, checksum in MIGRATIONS]
        elif 'pg_tables' in sql:
            self.rows = [(name,) for name in db.tables]
        elif 'pg_class' in sql:
            self.rows = [(db.rls,)]
        elif 'pg_constraint' in sql:
            self.rows = [(db.planning_environment,)]
        elif 'HistoryMigrationPilotRun' in sql:
            self.rows = [(db.runs, db.invalid)]
        else:
            raise AssertionError('Unexpected SQL in gate')

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows

    def close(self):
        pass


class Docker:
    def __init__(self):
        self.calls = []
        self.installed_image = NEW
        self.mounts = []
        self.running = True
        self.bad_capability = False
        self.bad_module = False

    def __call__(self, argv):
        self.calls.append(tuple(argv))
        if argv[1] == 'inspect':
            return json.dumps(dict(id=CONTAINER, image=self.installed_image,
                                   running=self.running, mounts=self.mounts))
        if OLD in argv:
            return '{"present":false}'
        return json.dumps(dict(present=True, moduleSha256=('f' if self.bad_module else '4') * 64,
                               capability={'historicalIngressGuard': True if self.bad_capability else 1}))


class RuntimeGuardTests(unittest.TestCase):
    def test_known_intake_and_wasm_planning_prefixes_allow_only_authoritative_zero(self):
        for shape,names in [('INTAKE_V1',['HistoryMigrationJob','HistoryMigrationBatch']),
                            ('PLANNING_V1',[n for n in NATIVE_TABLES if n not in ['HistoryMigrationNativeReview','HistoryMigrationNativeWindow']])]:
            self.setUp();self.db.tables=names
            contract=SchemaContract(migration_set_digest(MIGRATIONS),shape)
            with self.gate(OLD_ARTIFACT,(contract,)):pass
            if shape=='PLANNING_V1':
                for field,value in [('planning_environment',False),('runs',1),('invalid',1),('rls',True)]:
                    setattr(self.db,field,value)
                    with self.assertRaises(RuntimeGuardError):
                        with self.gate(OLD_ARTIFACT,(contract,)):pass
                    setattr(self.db,field,True if field=='planning_environment' else 0 if field in ('runs','invalid') else False)

    def test_exact_new_rolled_back_attempt_can_coexist_with_one_successful_retry(self):
        name='20261101010000_history_operational_native';pair=(name,'e'*64)
        contract=SchemaContract(migration_set_digest(MIGRATIONS),'NATIVE_V1',allowed_rolled_back_migrations=(pair,))
        self.db.migration_rows=[(*r,True,False) for r in MIGRATIONS]+[(*pair,False,True)]
        with self.gate(schemas=(contract,)):pass
        self.db.migration_rows.append((*pair,True,False))
        retried=SchemaContract(migration_set_digest(MIGRATIONS+[pair]),'NATIVE_V1',allowed_rolled_back_migrations=(pair,))
        with self.gate(schemas=(retried,)):pass
        for bad in [(*pair,False,False),('unknown','e'*64,False,True),(name,'f'*64,False,True),(*pair,False,True),(*pair,True,False)]:
            self.db.migration_rows.append(bad)
            with self.assertRaises(RuntimeGuardError):
                with self.gate(schemas=(retried,)):pass
            self.db.migration_rows.pop()
        with self.assertRaises(RuntimeGuardError):
            SchemaContract(migration_set_digest(MIGRATIONS),'NATIVE_V1',allowed_rolled_back_migrations=(('initial','e'*64),))

    def test_actual_docker_runner_ignores_hostile_ambient_daemon_and_tls(self):
        hostile=dict(DOCKER_HOST='tcp://other.invalid:2376',DOCKER_CONTEXT='other',
                     DOCKER_TLS_VERIFY='1',DOCKER_CERT_PATH='private',DOCKER_CONFIG='other',
                     DOCKER_API_VERSION='1.1',NODE_OPTIONS='--require=hostile')
        with patch.dict(os.environ,hostile), patch('history_runtime_guard.subprocess.run') as run:
            run.return_value.stdout=b'{"present":false}'
            for operation in ('run','inspect'):
                self.assertEqual(_docker(['docker',operation,'synthetic']),'{"present":false}')
                args,options=run.call_args
                self.assertEqual(args[0][:3],['docker','--host=unix:///var/run/docker.sock',operation])
                self.assertFalse(set(hostile)&set(options['env']))

    def test_default_gate_cannot_release_local_fence_using_other_daemon_proof(self):
        self.db.runs=1
        def local_command(argv,**options):
            self.assertEqual(argv[:2],['docker','--host=unix:///var/run/docker.sock'])
            self.assertFalse(any(key.startswith('DOCKER_') for key in options['env']))
            result=self.docker([argv[0],*argv[2:]])
            return subprocess.CompletedProcess(argv,0,result.encode('utf-8'))
        with patch.dict(os.environ,DOCKER_HOST='tcp://other.invalid:2376',DOCKER_CONTEXT='other'), \
             patch('history_runtime_guard.subprocess.run',side_effect=local_command):
            with ManagedRuntimeGate(self.db.connect,NEW_ARTIFACT,(SCHEMA,)) as gate:
                gate.run(lambda:CONTAINER)
                self.assertIsNotNone(self.db.exclusive)
        self.assertIsNone(self.db.exclusive)

    def setUp(self):
        self.db, self.docker = Database(), Docker()

    def gate(self, artifact=NEW_ARTIFACT, schemas=(SCHEMA,)):
        return ManagedRuntimeGate(self.db.connect, artifact, schemas, docker=self.docker)

    def test_exact_guarded_image_holds_session_through_action_and_installed_proof(self):
        with self.gate() as gate:
            self.assertIsNotNone(self.db.exclusive)
            receipt = gate.run(lambda: CONTAINER)
            self.assertEqual(receipt.image_id, NEW)
            self.assertEqual(receipt.source_snapshot_sha256, '3' * 64)
            self.assertIsNotNone(self.db.exclusive)
        self.assertIsNone(self.db.exclusive)
        command = next(c for c in self.docker.calls if c[1] == 'run')
        prefix = command[:command.index(NEW)]
        self.assertIn('--network=none', prefix)
        self.assertIn('--read-only', prefix)
        self.assertIn('--entrypoint=node', prefix)
        self.assertFalse(any(x.startswith(('--mount', '--volume', '--env')) or x == '-v' for x in prefix))
        self.assertIn("hashtextextended('history-runtime-deployment',0)", '\n'.join(self.db.queries))

    def test_old_image_only_when_no_operational_runs_and_known_schema(self):
        self.docker.installed_image = OLD
        with self.gate(OLD_ARTIFACT) as gate:
            self.assertEqual(gate.run(lambda: CONTAINER).historical_ingress_guard, None)
        self.db.tables = []
        with self.gate(OLD_ARTIFACT, (LEGACY_SCHEMA,)) as gate:
            gate.run(lambda: CONTAINER)

    def test_any_operational_run_including_rolled_back_blocks_old_image(self):
        for count in (1, 5):
            self.db.runs = count
            with self.assertRaises(RuntimeGuardError):
                with self.gate(OLD_ARTIFACT):
                    self.fail('Old runtime must never reach managed action')
            self.assertIsNone(self.db.exclusive)
        query = next(q for q in self.db.queries if 'count(*)' in q)
        self.assertNotIn('status', query.lower())

    def test_unknown_schema_permissions_and_bad_rows_fail_closed(self):
        for change in (lambda: setattr(self.db, 'tables', ['HistoryMigrationPilotRun']),
                       lambda: setattr(self.db, 'invalid', 1),
                       lambda: setattr(self.db, 'rls', True),
                       lambda: setattr(self.db, 'incomplete', True),
                       lambda: setattr(self.db, 'failure', True)):
            self.setUp(); change()
            with self.assertRaises(RuntimeGuardError):
                with self.gate():
                    self.fail('Unknown state cannot authorize an action')
        self.setUp()
        with self.assertRaises(RuntimeGuardError):
            with self.gate(schemas=(SchemaContract('f' * 64, 'NATIVE_V1'),)):
                pass

    def test_tag_bad_artifact_capability_or_blob_cannot_claim_support(self):
        with self.assertRaises(RuntimeGuardError):
            RuntimeArtifact('latest', '3' * 64, '4' * 64)
        for field in ('bad_capability', 'bad_module'):
            self.setUp(); setattr(self.docker, field, True)
            with self.assertRaises(RuntimeGuardError):
                with self.gate():
                    self.fail('Artifact mismatch cannot authorize action')

    def test_installed_mismatch_keeps_fence_until_recovery_is_verified(self):
        gate = self.gate()
        with gate:
            self.docker.installed_image = OTHER
            with self.assertRaises(RuntimeGuardError):
                gate.run(lambda: CONTAINER)
            self.assertIsNotNone(self.db.exclusive)
            self.docker.installed_image = NEW
            gate.run(lambda: CONTAINER)
        self.assertIsNone(self.db.exclusive)

    def test_unhandled_unverified_action_never_releases_fence_as_success(self):
        gate = self.gate()
        self.docker.installed_image = OTHER
        with self.assertRaises(RuntimeVerificationRequired):
            with gate:
                gate.run(lambda: CONTAINER)
        self.assertIsNotNone(self.db.exclusive)
        # Recover using the still-held object; only verified recovery allows exit.
        self.docker.installed_image = NEW
        gate.run(lambda: CONTAINER)
        gate.__exit__(None, None, None)
        self.assertIsNone(self.db.exclusive)

    def test_runtime_mounts_and_lost_session_refuse_installed_proof(self):
        with self.gate() as gate:
            self.docker.mounts = ['/app/apps/api/dist/main.js']
            with self.assertRaises(RuntimeGuardError):
                gate.run(lambda: CONTAINER)
            self.docker.mounts = ['/app/uploads']
            gate.run(lambda: CONTAINER)
        with self.gate() as gate:
            gate._connection.pid_changed = True
            with self.assertRaises(RuntimeGuardError):
                gate.run(lambda: CONTAINER)
            gate._connection.pid_changed = False

    def test_import_already_shared_fenced_cannot_race_old_runtime_admission(self):
        entered, finish = threading.Event(), threading.Event()
        worker = threading.Thread(target=self.db.native_import, args=(entered, finish))
        worker.start(); self.assertTrue(entered.wait(1))
        try:
            with self.assertRaises(RuntimeGuardError):
                with self.gate(OLD_ARTIFACT):
                    self.fail('Host may not check while import can commit')
        finally:
            finish.set(); worker.join(2)
        self.assertEqual(self.db.runs, 1)
        with self.assertRaises(RuntimeGuardError):
            with self.gate(OLD_ARTIFACT):
                pass

    def test_callback_exception_requires_verified_recovery(self):
        with self.gate() as gate:
            def failed_cutover():
                raise ValueError('private failure details')
            with self.assertRaises(RuntimeGuardError):
                gate.run(failed_cutover)
            self.assertIsNotNone(self.db.exclusive)
            gate.run(lambda: CONTAINER)

    def test_nonrunning_container_and_bad_id_cannot_finish_cutover(self):
        with self.gate() as gate:
            with self.assertRaises(RuntimeGuardError):
                gate.run(lambda: 'short-id')
            self.docker.running = False
            with self.assertRaises(RuntimeGuardError):
                gate.run(lambda: CONTAINER)
            self.docker.running = True
            gate.run(lambda: CONTAINER)

    def test_duplicate_json_cannot_claim_embedded_capability(self):
        with self.assertRaises(RuntimeGuardError):
            with ManagedRuntimeGate(self.db.connect, OLD_ARTIFACT, (SCHEMA,),
                                    docker=lambda _: '{"present":true,"present":false}'):
                self.fail('Ambiguous JSON cannot establish capability')

    def test_exact_probe_javascript_checks_hash_frozen_value_and_missing_legacy(self):
        # Execute the real sandbox probe in a local Node vm with fake fs/module;
        # no Docker, arbitrary filesystem paths, network or deployed code runs.
        blob = 'reviewed compiled artifact'
        digest = hashlib.sha256(blob.encode()).hexdigest()
        harness = r'''
const vm = require('node:vm'), crypto = require('node:crypto');
const input = JSON.parse(process.argv[1]);
let output = '';
const value = input.kind === 'mutable' ? {historicalIngressGuard:1} :
  Object.freeze({historicalIngressGuard:input.kind === 'bool' ? true : 1});
const context = {require(name) {
  if (name === 'node:fs') return {readFileSync() {
    if (input.kind === 'missing') { const e = Error(); e.code='ENOENT'; throw e; }
    return Buffer.from(input.blob);
  }};
  if (name === 'node:crypto') return crypto;
  if (name === '/app/apps/api/dist/history-migration/history-runtime-capability.js')
    return {HISTORY_RUNTIME_CAPABILITY:value};
  throw Error('Unexpected dependency');
}, process:{argv:['node',input.expected],stdout:{write(s){output+=s;}},
  exit(code){throw {stopped:true,code};}}};
try {vm.runInNewContext(input.probe,context,{timeout:1000});}
catch(e) {if (!e.stopped || e.code !== 0) process.exit(2);}
process.stdout.write(output);
'''
        for kind, expected, ok in [('guarded', digest, True), ('missing', 'ABSENT', True),
                                   ('mutable', digest, False), ('bool', digest, False),
                                   ('guarded', 'f' * 64, False), ('missing', digest, False),
                                   ('guarded', 'ABSENT', False)]:
            with self.subTest(kind=kind, expected=expected):
                result = subprocess.run(['node', '-e', harness, json.dumps(dict(
                    probe=_PROBE, kind=kind, expected=expected, blob=blob))],
                    capture_output=True, timeout=10)
                self.assertEqual(result.returncode == 0, ok)
                if ok:
                    self.assertEqual(json.loads(result.stdout)['present'], kind != 'missing')
    def test_import_waits_until_cutover_and_installed_verification_release_fence(self):
        entered, finish = threading.Event(), threading.Event()
        worker = threading.Thread(target=self.db.native_import, args=(entered, finish))
        with self.gate() as gate:
            worker.start()
            try:
                self.assertFalse(entered.wait(.05))
                gate.run(lambda: CONTAINER)
                self.assertFalse(entered.is_set())
            finally:
                finish.set()
        self.assertTrue(entered.wait(1)); worker.join(2)
        self.assertEqual(self.db.runs, 1)


if __name__ == '__main__':
    unittest.main()
