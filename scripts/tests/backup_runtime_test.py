import json
import io
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backup_runtime as runtime
import backup_archive as archive


class RuntimeTests(unittest.TestCase):
    def test_failed_recovery_binding_never_starts_writers(self):
        with tempfile.TemporaryDirectory() as temporary:
            journal = Path(temporary)/'.quiescence.json'
            runtime.atomic_json(journal, dict(project='test-project', owner='b'*32, jobId='backup-other-12345', containers=['container1']))
            with patch.dict(os.environ, COMPOSE_PROJECT_NAME='test-project', BACKUP_EXECUTION_OWNER='a'*32, BACKUP_JOB_ID=''), patch.object(runtime, 'sql', return_value='t'), patch.object(runtime.os, 'replace', side_effect=OSError('simulated crash')), patch.object(runtime, 'run') as docker:
                with self.assertRaises(OSError):
                    runtime.resume(journal)
                docker.assert_not_called()
            self.assertEqual(json.loads(journal.read_text())['owner'], 'b'*32)

    def test_cli_watchdog_renews_global_and_durable_job_lease(self):
        queries = []
        def sql(query):
            queries.append(query)
            return 't' if query.startswith('SELECT') else 'a'*32 if 'UPDATE "AppSetting"' in query else 'backup-cli-12345'
        with patch.dict(os.environ, BACKUP_EXECUTION_OWNER='a'*32, BACKUP_AGENT_OWNER=''), patch.object(runtime, 'sql', sql):
            runtime.lease_tick('backup-cli-12345')
        self.assertEqual(len(queries), 3)
        self.assertIn('leaseExpiresAt', queries[-1])
        self.assertIn('heartbeatAt', queries[-1])

    def test_expired_job_stops_watchdog_without_renewing_either_lease(self):
        queries = []
        with patch.dict(os.environ, BACKUP_EXECUTION_OWNER='a'*32, BACKUP_AGENT_OWNER=''), patch.object(runtime, 'sql', side_effect=lambda q: queries.append(q) or 'f'):
            with self.assertRaises(ValueError):
                runtime.lease_tick('backup-cli-12345')
        self.assertEqual(len(queries), 1)
        self.assertTrue(queries[0].startswith('SELECT'))

    def test_full_release_without_git_contains_runbooks_and_excludes_test_artifacts(self):
        with tempfile.TemporaryDirectory() as temporary:
            repository = Path(temporary)/'source'; repository.mkdir()
            (repository/'packages/database/prisma/migrations').mkdir(parents=True)
            (repository/'docs').mkdir()
            (repository/'.env.example').write_text('DATABASE_URL=postgresql://user:CHANGE_ME@postgres:5432/crm\n')
            for name in ['BACKUP_RESTORE.md','BACKUP_RECOVERY_RUNBOOK.md']:
                (repository/'docs'/name).write_text('recovery instructions')
            (repository/'apps/test-results').mkdir(parents=True)
            (repository/'apps/test-results/private.txt').write_text('must not package')
            output = Path(temporary)/'output'; output.mkdir()
            manifest = dict(git_commit='a'*40, files=[])
            with patch.object(runtime.Path, 'cwd', return_value=repository), patch.object(runtime, 'run') as docker, patch.dict(os.environ, BACKUP_OFFLINE_IMAGES='false'):
                docker.return_value.stdout = ''
                runtime.portable(output, manifest)
            with tarfile.open(output/'application.tar.gz') as tar:
                names = tar.getnames()
            self.assertIn('docs/BACKUP_RESTORE.md', names)
            self.assertIn('docs/BACKUP_RECOVERY_RUNBOOK.md', names)
            self.assertIn('.env.example', names)
            self.assertFalse(any('test-results' in n for n in names))
            self.assertIsNone(manifest['source_snapshot']['dirty'])

    @unittest.skipUnless(os.name == 'posix', 'Linux watchdog sessions required')
    def test_independent_watchdog_drains_capture_after_agent_sigkill(self):
        import signal
        import subprocess
        import time
        supervisor = subprocess.Popen(['sleep', '120'])
        capture = subprocess.Popen(['sh', '-c', 'sleep 120 & wait'], start_new_session=True)
        environment = dict(os.environ, BACKUP_EXECUTION_OWNER='a'*32, BACKUP_AGENT_OWNER='a'*32,
                           BACKUP_JOB_ID='backup-watchdog-12345', BACKUP_PARENT_PID=str(supervisor.pid))
        code = 'import backup_runtime as r; r.sql=lambda q:"t"; r.lease_watch('+str(capture.pid)+')'
        watchdog = subprocess.Popen([sys.executable, '-c', code], cwd=Path(runtime.__file__).parent, env=environment)
        try:
            time.sleep(.3)
            supervisor.kill(); supervisor.wait(timeout=5)
            capture.wait(timeout=10)
            watchdog.wait(timeout=10)
            self.assertIsNotNone(capture.returncode)
            self.assertEqual(watchdog.returncode, 0)
        finally:
            runtime.drain_group(capture.pid, grace=.1)
            for process in (supervisor, capture, watchdog):
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=5)

    def test_agent_watchdog_checks_both_leases_without_extending_them(self):
        queries = []
        with patch.dict(os.environ, BACKUP_EXECUTION_OWNER='a'*32, BACKUP_AGENT_OWNER='a'*32), patch.object(runtime, 'sql', side_effect=lambda q: queries.append(q) or 't'):
            runtime.lease_tick('backup-agent-12345')
        self.assertEqual(len(queries), 1)
        self.assertIn('execution-lease', queries[0])
        self.assertIn('leaseExpiresAt', queries[0])
        self.assertIn("interval '45 seconds'", queries[0])
        self.assertNotIn('UPDATE', queries[0])

    def test_current_global_owner_cannot_resume_another_active_job(self):
        with tempfile.TemporaryDirectory() as temporary:
            journal = Path(temporary)/'.quiescence.json'
            runtime.atomic_json(journal, dict(project='test-project', owner='b'*32, jobId='backup-other-12345', containers=['container1']))
            with patch.dict(os.environ, COMPOSE_PROJECT_NAME='test-project', BACKUP_EXECUTION_OWNER='a'*32, BACKUP_JOB_ID='backup-own-12345'), patch.object(runtime, 'sql', return_value='t'), patch.object(runtime, 'run') as docker:
                with self.assertRaises(ValueError):
                    runtime.resume(journal)
                docker.assert_not_called()
            self.assertEqual(json.loads(journal.read_text())['owner'], 'b'*32)

    @unittest.skipUnless(os.name == 'posix', 'Linux process groups required')
    def test_drain_group_kills_descendant_after_shell_sigkill(self):
        import signal
        import subprocess
        import time
        with tempfile.TemporaryDirectory() as temporary:
            pid_file = Path(temporary)/'child'
            parent = subprocess.Popen(['sh', '-c', 'sleep 120 & echo $! > "$1"; wait', 'sh', str(pid_file)], start_new_session=True)
            try:
                for _ in range(100):
                    if pid_file.exists():
                        break
                    time.sleep(.02)
                child = int(pid_file.read_text())
                os.kill(parent.pid, signal.SIGKILL)
                parent.wait(timeout=5)
                runtime.drain_group(parent.pid, grace=.2)
                for _ in range(100):
                    stat = Path('/proc')/str(child)/'stat'
                    if not stat.exists() or stat.read_text().split()[2] == 'Z':
                        break
                    time.sleep(.02)
                else:
                    self.fail('orphan capture process is still running')
            finally:
                runtime.drain_group(parent.pid, grace=.1)
                parent.wait(timeout=5)

    def fixture(self, root, count=1):
        (root/'postgres.dump').write_bytes(b'PGDMPsynthetic')
        with tarfile.open(root/'uploads.tar.gz', 'w:gz') as tar:
            for index in range(count):
                member = tarfile.TarInfo('files/'+str(index)+'.txt'); member.size = 1
                tar.addfile(member, io.BytesIO(b'x'))
        manifest = dict(format_version=2, backup_id=root.name, type='data', storage_provider='local',
                        app_version='0.10.0', git_commit='a'*40, database_version='16.15', schema_version='migration48',
                        files=['postgres.dump', 'uploads.tar.gz'])
        runtime.atomic_json(root/'manifest.json', manifest)
        return manifest

    def test_v2_finalize_validate_roundtrip_with_5000_files_has_small_manifest_and_four_core_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)/'backup-fixture'; root.mkdir()
            self.fixture(root, 5000)
            with patch.object(runtime, 'sql', return_value=''), patch.object(runtime, 'table_counts', return_value={}), patch.object(runtime, 'fingerprints', return_value={}):
                runtime.finalize(root, root.parent/'.quiescence.json')
            self.assertEqual({p.name for p in root.iterdir()}, {'postgres.dump','uploads.tar.gz','manifest.json','SHA256SUMS'})
            self.assertLess((root/'manifest.json').stat().st_size, 4096)
            result = archive.validate_directory(root)
            self.assertEqual(len(result['inventory']), 5000)
            self.assertEqual(result['manifest']['files'], ['postgres.dump','uploads.tar.gz'])
            api_root = os.environ.get('BACKUP_API_TEST_ROOT')
            if api_root:
                import subprocess
                code = r'''
const fs = require('node:fs'), path = require('node:path');
const localRequire = require('node:module').createRequire(path.join(process.env.BACKUP_API_TEST_ROOT, 'apps/api/package.json'));
const ts = localRequire('typescript'); localRequire('reflect-metadata');
const cache = new Map();
function load(filename) {
  if(cache.has(filename)) return cache.get(filename).exports;
  const mod = {exports:{}}; cache.set(filename, mod);
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',js)(name => name.startsWith('.') ? load(path.resolve(path.dirname(filename),name+'.ts')) : localRequire(name), mod, mod.exports);
  return mod.exports;
}
const {LocalBackupStorage} = load(path.join(process.env.BACKUP_API_TEST_ROOT,'apps/api/src/backups/backup.storage.ts'));
new LocalBackupStorage().verify(process.env.BACKUP_TEST_ID).then(result => console.log(JSON.stringify(result,(_,v) => typeof v === 'bigint' ? String(v) : v))).catch(error => { console.error(error); process.exitCode=1; });
'''
                environment = dict(os.environ, BACKUP_STORAGE_PATH=str(root.parent), BACKUP_TEST_ID=root.name)
                verified = subprocess.run(['node', '-e', code], env=environment, capture_output=True, text=True, timeout=60, check=True)
                api = json.loads(verified.stdout)
                self.assertEqual(api['checksum'], result['checksum'])
                self.assertEqual(int(api['sizeBytes']), result['sizeBytes'])
            archive.pack(root)
            destination = root.parent/'imported-fixture'
            imported = archive.import_archive(root/'archive.tar.gz', root.parent, destination.name)
            self.assertEqual(imported['checksum'], result['checksum'])
            self.assertEqual(imported['sizeBytes'], result['sizeBytes'])

    def test_cli_claim_persists_expiring_owner_and_heartbeat(self):
        queries = []
        def sql(query):
            queries.append(query)
            return 't' if query.startswith('SELECT EXISTS') else '0' if query.startswith('SELECT count') else 'backup-cli-12345'
        with patch.dict(os.environ, BACKUP_EXECUTION_OWNER='a'*32, BACKUP_AGENT_OWNER='', BACKUP_TYPE='data'), patch.object(runtime, 'sql', sql):
            runtime.claim_cli('backup-cli-12345')
        self.assertIn('leaseExpiresAt', queries[-1])
        self.assertIn('heartbeatAt', queries[-1])
        self.assertIn('a'*32, queries[-1])

    def test_cli_completion_restores_legacy_version_columns(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)/'backup-fixture'; root.mkdir()
            manifest = self.fixture(root)
            with patch.object(runtime, 'table_counts', return_value={}), patch.object(runtime, 'fingerprints', return_value={}):
                runtime.finalize(root, root.parent/'.quiescence.json')
            archive.pack(root)
            queries = []
            with patch.dict(os.environ, BACKUP_EXECUTION_OWNER='a'*32), patch.object(runtime, 'sql', side_effect=lambda q: queries.append(q) or root.name):
                runtime.complete_cli(root)
            for column, value in [('appVersion','0.10.0'),('gitCommit','a'*40),('databaseVersion','16.15'),('schemaVersion','migration48')]:
                self.assertIn('"'+column+'"', queries[0])
                self.assertIn(value, queries[0])

    def test_local_consistency_requires_exact_external_capture_receipt(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)/'backup-fixture'; root.mkdir()
            result = dict(checksum='a'*64, sizeBytes=123, formatVersion=3,
                          manifest=dict(backup_id=root.name, consistency=dict(verified=True, method='stopped-writers')))
            self.assertFalse(runtime.local_consistency(root, result)['verified'])
            receipt = dict(result, consistent=True, consistencyTrust='VERIFIED_LOCAL_QUIESCENCE')
            runtime.atomic_json(root.parent/'.last-validation.json', receipt)
            self.assertTrue(runtime.local_consistency(root, result)['verified'])
            receipt['checksum'] = 'b'*64
            runtime.atomic_json(root.parent/'.last-validation.json', receipt)
            self.assertFalse(runtime.local_consistency(root, result)['verified'])

    def test_stale_owner_cannot_resume_journal_or_remove_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            journal = Path(temporary)/'.quiescence.json'
            runtime.atomic_json(journal, dict(project='test-project', owner='b'*32, jobId='backup-other-12345', containers=['container1']))
            with patch.dict(os.environ, COMPOSE_PROJECT_NAME='test-project', BACKUP_EXECUTION_OWNER='a'*32), patch.object(runtime, 'sql', return_value='f'), patch.object(runtime, 'run') as docker:
                with self.assertRaises(ValueError):
                    runtime.resume(journal)
                docker.assert_not_called()
            self.assertTrue(journal.exists())


if __name__ == '__main__':
    unittest.main()
