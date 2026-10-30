"""Legacy restore resource gate and supervisor at the Docker/process boundary."""
import json
import importlib.util
import contextlib
import io
import os
from pathlib import Path
import subprocess
import shutil
import sys
import time
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backup_runtime as runtime


def sandbox():
    return dict(Id='a'*64, Config={'Labels': {
        'com.docker.compose.project': 'yo-recovery-legacy-test',
        'com.docker.compose.service': 'postgres'}},
        HostConfig=dict(Memory=768*1024**2, MemorySwap=768*1024**2,
                        NanoCpus=1000000000, PidsLimit=128, ReadonlyRootfs=True,
                        Privileged=False, LogConfig={'Type': 'none'}, ShmSize=16*1024**2,
                        Tmpfs={p: 'rw,noexec,nosuid,nodev,size='+s for p, s in (
                            ('/var/lib/postgresql/data', '512m'),
                            ('/var/run/postgresql', '16m'), ('/tmp', '16m'))}),
        Mounts=[dict(Type='tmpfs', Destination='/var/lib/postgresql/data')],
        NetworkSettings={'Networks': {'isolated': {'NetworkID': 'network-id'}}})


class LegacyResourcesTests(unittest.TestCase):
    def setUp(self):
        self.info = sandbox()
        self.calls = []
        self.child = 'pass'
        self.child_env = None
        self.lease_busy = False
        self.lease_short = False
        real_popen = subprocess.Popen

        def popen(command, **kwargs):
            self.calls.append(command)
            if command[0] == 'bash':
                body = self.child
                self.child_env = kwargs.get('env')
            elif command[:2] == ['docker', 'inspect']:
                body = 'print('+repr(json.dumps([self.info]))+')'
            elif command[:3] == ['docker', 'network', 'inspect']:
                body = 'print('+repr(json.dumps([dict(Internal=True, Labels={
                    'com.docker.compose.project': 'yo-recovery-legacy-test'})]))+')'
            elif command[:2] == ['docker', 'kill']:
                body = 'pass'
            elif command[:2] == ['docker', 'exec']:
                self.assertIn('PGAPPNAME=backup-host-agent', command)
                body = '''import sys,re
query=sys.stdin.read()
if query.startswith('INSERT'):
    owner=re.search("'owner','([a-f0-9]{32})'",query)[1]
    print('' if BUSY else owner)
elif query.startswith('SELECT'):
    print('f' if BUSY or (SHORT and "interval '" in query) else 't')
'''.replace('BUSY', repr(self.lease_busy)).replace('SHORT', repr(self.lease_short))
            else:
                self.assertIn('ps', command)
                body = 'print('+repr('a'*64)+')'
            return real_popen([sys.executable, '-c', body], **kwargs)

        changes = (patch.dict(os.environ, COMPOSE_PROJECT_NAME='yo-recovery-legacy-test',
                              BACKUP_OFFLINE_RECOVERY='true', BACKUP_EXECUTION_OWNER=''),
                   patch.object(subprocess, 'Popen', side_effect=popen))
        for change in changes:
            change.start()
            self.addCleanup(change.stop)

    def test_named_volume_unbounded_postgres_rejected_before_any_sql(self):
        self.info['HostConfig'] = {}
        self.info['Mounts'][0]['Type'] = 'volume'
        with self.assertRaisesRegex(ValueError, 'resource'):
            runtime.bounded_legacy_restore('SELECT hostile SQL')
        self.assertFalse(any(c[0] == 'bash' or c[:2] == ['docker', 'kill'] for c in self.calls))
        self.assertFalse(any(c[:2] == ['docker', 'exec'] for c in self.calls))

    def test_bounded_tmpfs_target_accepts_legacy_stage(self):
        runtime.bounded_legacy_restore('legacy stage')
        self.assertTrue(any(c[0] == 'bash' for c in self.calls))
        self.assertFalse(any(c[:2] == ['docker', 'kill'] for c in self.calls))
        self.assertFalse(any(c[:2] == ['docker', 'exec'] for c in self.calls))

    def test_standalone_lease_covers_deadline_and_is_released_without_job_watch(self):
        with patch.dict(os.environ, BACKUP_OFFLINE_RECOVERY='false'), \
             patch.object(runtime.backup_lease, 'acquire', wraps=runtime.backup_lease.acquire) as acquire, \
             patch.object(runtime.backup_lease, 'release', wraps=runtime.backup_lease.release) as release:
            runtime.bounded_legacy_restore('standalone SQL')
        self.assertEqual(acquire.call_args.kwargs['seconds'], 360)
        owner = acquire.call_args.args[1]
        self.assertEqual(self.child_env['BACKUP_EXECUTION_OWNER'], owner)
        self.assertNotIn('BACKUP_JOB_ID', self.child_env)
        self.assertEqual(release.call_args.args[1], owner)
        self.assertFalse(any('lease-watch' in c for c in self.calls))

    def test_busy_global_lease_cannot_start_sql_or_kill_other_execution(self):
        self.lease_busy = True
        with patch.dict(os.environ, BACKUP_OFFLINE_RECOVERY='false'):
            with self.assertRaisesRegex(ValueError, 'lease busy'):
                runtime.bounded_legacy_restore('must not run SQL')
        self.assertIsNone(self.child_env)
        self.assertFalse(any(c[:2] == ['docker', 'kill'] for c in self.calls))

    def test_failed_standalone_sql_kills_sandbox_without_releasing_dead_control_db(self):
        self.child = 'raise SystemExit(2)'
        with patch.dict(os.environ, BACKUP_OFFLINE_RECOVERY='false'), \
             patch.object(runtime.backup_lease, 'release', wraps=runtime.backup_lease.release) as release:
            with self.assertRaises(subprocess.CalledProcessError):
                runtime.bounded_legacy_restore('failed SQL')
        release.assert_not_called()
        self.assertEqual(self.calls[-1], ['docker', 'kill', 'a'*64])

    def test_inherited_owner_is_fenced_but_never_acquired_or_released(self):
        with patch.dict(os.environ, BACKUP_OFFLINE_RECOVERY='false', BACKUP_EXECUTION_OWNER='b'*32), \
             patch.object(runtime.backup_lease, 'acquire') as acquire, \
             patch.object(runtime.backup_lease, 'release') as release:
            runtime.bounded_legacy_restore('agent SQL')
        acquire.assert_not_called()
        release.assert_not_called()
        self.assertEqual(self.child_env['BACKUP_EXECUTION_OWNER'], 'b'*32)
        self.assertTrue(any(c[:2] == ['docker', 'exec'] for c in self.calls))

    def test_expired_inherited_owner_cannot_execute_or_kill(self):
        self.lease_busy = True
        with patch.dict(os.environ, BACKUP_OFFLINE_RECOVERY='false', BACKUP_EXECUTION_OWNER='b'*32):
            with self.assertRaisesRegex(ValueError, 'lease lost'):
                runtime.bounded_legacy_restore('must not run SQL')
        self.assertIsNone(self.child_env)
        self.assertFalse(any(c[:2] == ['docker', 'kill'] for c in self.calls))

    def test_short_inherited_lease_cannot_outlive_the_restore_budget(self):
        self.lease_short = True
        with patch.dict(os.environ, BACKUP_OFFLINE_RECOVERY='false', BACKUP_EXECUTION_OWNER='b'*32):
            with self.assertRaisesRegex(ValueError, 'lease lost|lease lifetime'):
                runtime.bounded_legacy_restore('must not run SQL under a short lease')
        self.assertIsNone(self.child_env)
        self.assertFalse(any(c[:2] == ['docker', 'kill'] for c in self.calls))

    def test_timeout_kills_only_guarded_container_after_draining_local_child(self):
        self.child = 'import time; time.sleep(30)'
        runner = runtime.legacy_resource_runner()
        runner.WALL_SECONDS = 3
        started = time.monotonic()
        with patch.object(runtime, 'legacy_resource_runner', return_value=runner):
            with self.assertRaises(subprocess.TimeoutExpired):
                runtime.bounded_legacy_restore('slow SQL')
        self.assertLess(time.monotonic()-started, 8)
        self.assertEqual([c for c in self.calls if c[:2] == ['docker', 'kill']],
                         [['docker', 'kill', 'a'*64]])

    def test_failed_sql_also_kills_server_side_children(self):
        self.child = 'raise SystemExit(2)'
        with self.assertRaises(subprocess.CalledProcessError):
            runtime.bounded_legacy_restore('failed SQL')
        self.assertEqual(self.calls[-1], ['docker', 'kill', 'a'*64])

    def test_guard_rejects_missing_limits_writable_mounts_and_foreign_identity(self):
        for key, value in [('MemorySwap', -1), ('NanoCpus', 0), ('PidsLimit', 0),
                           ('ReadonlyRootfs', False), ('Binds', ['/host:/tmp']),
                           ('Tmpfs', {}), ('PortBindings', {'5432/tcp': []})]:
            with self.subTest(key=key):
                self.info = sandbox()
                self.info['HostConfig'][key] = value
                self.calls.clear()
                with self.assertRaises(ValueError):
                    runtime.bounded_legacy_restore('SQL')
                self.assertFalse(any(c[0] == 'bash' or c[:2] == ['docker', 'kill'] for c in self.calls))
        self.info = sandbox()
        self.info['Config']['Labels']['com.docker.compose.project'] = 'production'
        with self.assertRaisesRegex(ValueError, 'identity'):
            runtime.bounded_legacy_restore('SQL')


class ControlConnectionTests(unittest.TestCase):
    def test_runtime_sql_marks_only_its_control_connection(self):
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 't\n', '')) as command:
            self.assertEqual(runtime.sql('SELECT true;'), 't')
        args = command.call_args.args[0]
        self.assertIn('PGAPPNAME=backup-host-agent', args)
        self.assertEqual(args[args.index('exec')+1:args.index('postgres')],
                         ['-T', '-e', 'PGAPPNAME=backup-host-agent'])
        self.assertEqual(command.call_args.kwargs['input'], 'SELECT true;')

    def test_complete_cli_stores_validated_coverage_and_separate_claim(self):
        # This isolated checkout may have MAIN's runtime but older unowned lease
        # helpers. Read an explicitly supplied integration dependency, never copy it.
        external = os.environ.get('BACKUP_LEGACY_LEASE_SOURCE')
        lease = runtime.backup_lease
        if external:
            spec = importlib.util.spec_from_file_location('legacy_test_lease', external)
            lease = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(lease)
        if not hasattr(lease, 'job_fence'):
            self.skipTest('integrated MAIN backup_lease.job_fence required; set BACKUP_LEGACY_LEASE_SOURCE')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)/'legacy-12345678'
            root.mkdir()
            (root/'archive.tar.gz').write_bytes(b'archive')
            result = dict(formatVersion=2, checksum='a'*64, sizeBytes=7,
                          manifest={'coverage': {'chatwoot': True}},
                          coverage={'postgresql': True, 'uploads': True, 'chatwoot': False},
                          claimedCoverage={'chatwoot': True})
            def sql(args, **kwargs):
                query = kwargs['input']
                encoded = query.split("decode('")[1].split("'")[0]
                metadata = json.loads(bytes.fromhex(encoded))
                self.assertFalse(metadata['coverage']['chatwoot'])
                self.assertTrue(metadata['claimedCoverage']['chatwoot'])
                self.assertEqual(metadata['consistency']['trust'], 'UNVERIFIED')
                return subprocess.CompletedProcess(args, 0, root.name, '')
            with patch.object(runtime, 'validate_directory', return_value=result), \
                 patch.object(runtime, 'backup_lease', lease), \
                 patch.object(subprocess, 'run', side_effect=sql), \
                 patch.dict(os.environ, BACKUP_EXECUTION_OWNER='b'*32):
                runtime.complete_cli(root)


@unittest.skipUnless(sys.platform.startswith('linux') and shutil.which('bash') and shutil.which('cat'),
                     'Linux with real Bash and cat required')
class LegacyProgramStdinTests(unittest.TestCase):
    def test_stdin_draining_command_cannot_swallow_remaining_restore_program(self):
        # Reproduce docker compose exec -T consuming its inherited stdin. With
        # bash -s/input=script, cat eats the remaining commands and Bash exits 0
        # without executing them. Exercise the actual supervisor, bounded_run,
        # Popen and Bash; only the Docker isolation gate is substituted.
        output = io.StringIO()
        script = "set -Eeuo pipefail\ncat >/dev/null\nprintf '%s\\n' 'RESTORE_SQL_STAGE_REACHED'\n"
        with patch.object(runtime, 'guard_isolated', return_value=sandbox()), \
             patch.dict(os.environ, BACKUP_OFFLINE_RECOVERY='true', BACKUP_EXECUTION_OWNER=''), \
             contextlib.redirect_stdout(output):
            runtime.bounded_legacy_restore(script)
        self.assertEqual(output.getvalue(), 'RESTORE_SQL_STAGE_REACHED\n')


class LegacyComposeTests(unittest.TestCase):
    def test_postgres_matches_recovery_profile_and_api_remains_idle_helper(self):
        import yaml
        root = Path(__file__).resolve().parents[2]
        legacy = yaml.safe_load((root/'docker-compose.backup-test.yml').read_text())
        trusted = yaml.safe_load((root/'docker-compose.recovery-drill.yml').read_text())
        for key in ('read_only', 'mem_limit', 'memswap_limit', 'cpus', 'pids_limit',
                    'shm_size', 'tmpfs', 'logging', 'cap_drop', 'cap_add', 'ulimits',
                    'command', 'security_opt'):
            self.assertEqual(legacy['services']['postgres'][key], trusted['services']['postgres'][key], key)
        self.assertNotIn('volumes', legacy['services']['postgres'])
        self.assertNotIn('ports', legacy['services']['postgres'])
        self.assertTrue(legacy['networks']['isolated']['internal'])
        self.assertIn('migrate deploy', legacy['services']['api']['command'])
        self.assertIn('tail -f /dev/null', legacy['services']['api']['command'])

    def test_every_legacy_sql_step_is_inside_supervised_stage(self):
        source = (Path(__file__).resolve().parents[1]/'restore.sh').read_text()
        before, stage = source.split("<<'BOUNDED_LEGACY_SQL'\n", 1)
        self.assertIn('bounded-legacy-restore', before)
        self.assertNotIn('psql', before)
        self.assertNotIn('pg_restore', before)
        self.assertNotIn('lease-watch', stage)
        for line in stage.splitlines():
            if 'exec -T' in line:
                self.assertIn('PGOPTIONS=-c statement_timeout=30000 -c lock_timeout=10000', line)


if __name__ == '__main__':
    unittest.main()
