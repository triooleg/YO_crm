"""CLI tests. Set YO_NEW_HOST_DOCKER_TEST=1 for the local Docker round trip."""
import hashlib
import io
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import uuid
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from backup_archive import pack, scan_tar

CLI = [sys.executable, str(ROOT / 'scripts/new-host-restore.py')]
FILE = b'synthetic local upload\n'
# Synthetic account exists in the source dump so restore can never create it.
PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$Dq9PCAZTzu3iCy+UxFxBDQ$8EanoVCuIJNqqkOuktXj/z/IlCW/VPz1M9XA4WQGu5Q'
BROWSER = '''
const {chromium} = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  try {
    const origin = process.argv[1];
    const page = await browser.newPage();
    const canary = 'https://example.invalid/restore-egress';
    let canaryBlocked = false;
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(origin+'/')) return route.continue();
      if (url === canary) canaryBlocked = true;
      return route.abort();
    });
    page.setDefaultTimeout(45000);
    await page.goto(origin, {waitUntil: 'domcontentloaded', timeout: 45000});
    const blocked = await page.evaluate(url => fetch(url).then(() => false, () => true), canary);
    if (!blocked || !canaryBlocked) throw new Error('browser egress canary was not blocked');
    await page.locator('input[name=email]').fill('restore-fixture@example.invalid');
    await page.locator('input[name=password]').fill('synthetic-restore-only');
    const login = page.waitForResponse(r => r.url().endsWith('/api/auth/login'));
    await page.locator('form button[type=submit], form button:not([type])').click();
    if (!(await login).ok()) throw new Error('synthetic account could not sign in');
    const me = await page.evaluate(async () => (await fetch('/api/auth/me')).json());
    if (me.user?.id !== 'restored-user') throw new Error('restored browser session missing');
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exitCode=1;});
'''



def docker(*args, **kwargs):
    return subprocess.run(['docker', *map(str, args)], check=True, capture_output=True, **kwargs).stdout


def bundle(root, dump, kind, counts=None):
    source = root / 'source'
    source.mkdir()
    (source / 'postgres.dump').write_bytes(dump)
    with tarfile.open(source / 'uploads.tar.gz', 'w:gz') as tar:
        item = tarfile.TarInfo('communication-files/fixture.txt')
        item.size = len(FILE)
        tar.addfile(item, io.BytesIO(FILE))
    (source / 'inventory.json').write_text(json.dumps(scan_tar(source / 'uploads.tar.gz')))
    (source / 'table-counts.json').write_text(json.dumps(counts or {'public.restore_fixture': 1}))
    files = ['postgres.dump', 'uploads.tar.gz', 'inventory.json', 'table-counts.json']
    if kind == 'full':
        with tarfile.open(source / 'application.tar.gz', 'w:gz') as tar:
            item = tarfile.TarInfo('docker-compose.yml')
            content = b'archive compose must remain inert'
            item.size = len(content)
            tar.addfile(item, io.BytesIO(content))
        files.append('application.tar.gz')
    manifest = dict(format_version=3, backup_id='synthetic-fixture', type=kind,
                    storage_provider='local', app_version='test', git_commit='a'*40,
                    schema_version='fixture', database_version='16',
                    consistency={'verified': True}, files=files)
    (source / 'manifest.json').write_text(json.dumps(manifest))
    names = [*files, 'manifest.json']
    (source / 'SHA256SUMS').write_text(''.join(
        hashlib.sha256((source / name).read_bytes()).hexdigest() + '  ' + name + '\n' for name in names))
    pack(source)
    return source / 'archive.tar.gz'


def run_restore(archive, sha, target, images, *options):
    return subprocess.run([*CLI, '--archive', str(archive), '--sha256', sha, '--target', str(target),
                           *[arg for role, image in images.items() for arg in ('--'+role+'-image', image)], *options],
                          capture_output=True, text=True)


class NewHostRestore(unittest.TestCase):
    def test_wrong_trusted_checksum_fails_before_docker_or_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = bundle(root, b'PGDMPfake', 'data')
            target = root / 'restore'
            result = run_restore(archive, '0'*64, target, {})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('archive SHA-256 mismatch', result.stderr)
            self.assertFalse(target.exists())

    def test_matching_sha_does_not_bypass_archive_validation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / 'broken.tar.gz'
            archive.write_bytes(b'broken gzip')
            result = run_restore(archive, hashlib.sha256(archive.read_bytes()).hexdigest(), root/'restore', {})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('invalid or conflicting tar contents', result.stderr)

    def test_docker_preflight_binds_context_and_rejects_working_project_volume(self):
        spec = importlib.util.spec_from_file_location('new_host_restore', CLI[1])
        restore = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(restore)
        commands = []

        def docker_run(command, deadline, **kwargs):
            commands.append(command)
            output = 'production-volume' if 'volume' in command else ''
            return subprocess.CompletedProcess(command, 0, stdout=output)

        with patch.object(restore, 'local_context', return_value='fixture') as context, \
             patch.object(restore.drill, 'bounded_run', side_effect=docker_run):
            with self.assertRaisesRegex(restore.InvalidArchive, 'working CRM project resources'):
                restore.check_docker(1, 'fixture')
        context.assert_called_once_with(1, 'fixture')
        self.assertEqual([command[3] for command in commands], ['ps', 'volume'])
        for command in commands:
            self.assertEqual(command[:3], ['docker', '--context', 'fixture'])
            self.assertEqual(command[-2:], ['--filter', 'label=com.docker.compose.project=yoleotard-crm'])

    def test_api_mount_rejects_second_uploads_directory_before_start(self):
        spec = importlib.util.spec_from_file_location('new_host_restore', CLI[1])
        restore = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(restore)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            uploads = root/'expected'/'uploads'
            other = root/'other'/'uploads'
            uploads.mkdir(parents=True)
            other.mkdir(parents=True)
            project = 'yo-recovery-fixture'
            image = 'sha256:'+'b'*64
            info = dict(Image=image, Config={'Labels': {'com.docker.compose.project': project,
                        'com.docker.compose.service': 'api'}},
                        State={'Status': 'created'}, HostConfig={'Privileged': False},
                        Mounts=[dict(Type='bind', Source=str(other), Destination='/app/uploads', RW=True)])
            commands = []

            def docker_run(command, deadline, **kwargs):
                commands.append(command)
                if 'inspect' in command:
                    return subprocess.CompletedProcess(command, 0, stdout=json.dumps([info]))
                if 'ps' in command and 'api' in command:
                    return subprocess.CompletedProcess(command, 0, stdout='fixture-container')
                return subprocess.CompletedProcess(command, 0, stdout='')

            args = SimpleNamespace(sha256='a'*64, settings_key_file=None, docker_context=None,
                                   **{role+'_image': image for role in restore.ROLES})
            source = dict(inventory=[], formatVersion=3,
                          manifest=dict(backup_id='synthetic-fixture', type='data', git_commit='c'*40))
            with patch.object(restore, 'local_context', return_value='fixture'), \
                 patch.object(restore.secrets, 'token_hex', return_value='fixture'), \
                 patch.object(restore.drill, 'pinned_image', return_value={'Architecture': 'amd64'}), \
                 patch.object(restore.drill, 'project_guard'), \
                 patch.object(restore.drill, 'bounded_run', side_effect=docker_run):
                with self.assertRaisesRegex(restore.InvalidArchive, 'unexpected uploads mount'):
                    restore.start_runtime(args, root, root, uploads, source, 'fixture-key')
            self.assertTrue(any('create' in command for command in commands))
            self.assertFalse(any('start' in command or 'up' in command for command in commands))

    def test_compose_escape_keeps_dollar_in_uploads_path(self):
        spec = importlib.util.spec_from_file_location('new_host_restore', CLI[1])
        restore = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(restore)
        path = Path('restore-${OTHER}')/'uploads'
        config = restore.compose_config('yo-recovery-fixture', dict.fromkeys(restore.ROLES, 'image'), path, 'fixture')
        self.assertEqual(config['services']['api']['volumes'][0]['source'], str(path).replace('$', '$$'))

    def test_cleanup_timeout_preserves_original_failure_and_marks_receipt(self):
        spec = importlib.util.spec_from_file_location('new_host_restore', CLI[1])
        restore = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(restore)

        def docker_run(command, deadline, **kwargs):
            if 'create' in command:
                raise restore.InvalidArchive('synthetic original failure')
            if 'down' in command:
                raise subprocess.TimeoutExpired(command, 1)
            return subprocess.CompletedProcess(command, 0, stdout='')

        args = SimpleNamespace(sha256='a'*64, settings_key_file=None, docker_context=None,
                               **{role+'_image': 'sha256:'+'b'*64 for role in restore.ROLES})
        source = dict(inventory=[], formatVersion=3,
                      manifest=dict(backup_id='synthetic-fixture', type='data', git_commit='c'*40))
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            with patch.object(restore, 'local_context', return_value='fixture'), \
                 patch.object(restore.drill, 'pinned_image', return_value={'Architecture': 'amd64'}), \
                 patch.object(restore.drill, 'project_guard'), \
                 patch.object(restore.drill, 'bounded_run', side_effect=docker_run):
                with self.assertRaisesRegex(restore.InvalidArchive, 'synthetic original failure'):
                    restore.start_runtime(args, target, target, target/'uploads', source, 'fixture-key')
            report = json.loads((target/'restore-report.json').read_text(encoding='utf-8'))
            self.assertEqual(report['cleanup'], 'FAILED_OPERATOR_ACTION_REQUIRED')

    @unittest.skipUnless(os.name == 'posix', 'requires POSIX key file permissions')
    def test_owner_key_file_requires_mode_0600(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = bundle(root, b'PGDMPfake', 'data')
            sha = hashlib.sha256(archive.read_bytes()).hexdigest()
            target = root/'restore'
            key = root/'settings.key'
            value = 'synthetic-key-only-for-fixture-check-$0123456789'
            key.write_text(value+'\n')
            key.chmod(0o644)
            refused = run_restore(archive, sha, target, {}, '--settings-key-file', str(key))
            self.assertIn('private mode-0600 regular file', refused.stderr)
            self.assertFalse(target.exists())
            key.chmod(0o600)
            accepted = run_restore(archive, sha, target, {}, '--settings-key-file', str(key))
            self.assertIn('supply all four trusted image IDs', accepted.stderr)
            self.assertNotIn(value, accepted.stdout + accepted.stderr)

    @unittest.skipUnless(os.environ.get('YO_NEW_HOST_DOCKER_TEST') == '1', 'requires local Docker and pinned fixture images')
    def test_data_and_full_restore_and_survive_container_recreation(self):
        images = {role: os.environ['YO_TEST_'+role.upper()] for role in ('postgres','redis','api','web')}
        source_name = 'yo-restore-fixture-'+uuid.uuid4().hex[:12]
        docker('run', '-d', '--name', source_name, '--network', 'none', '--pull', 'never',
               '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', images['postgres'])
        try:
            docker('exec', source_name, 'sh', '-ec',
                   'for i in $(seq 1 60); do pg_isready -q -h 127.0.0.1 -U postgres && exit 0; sleep 1; done; exit 1')
            initial = ROOT/'packages/database/prisma/migrations/20260807120000_initial/migration.sql'
            initial_sql = initial.read_text(encoding='utf-8')
            account_schema = initial_sql[initial_sql.index('CREATE TABLE "User"'):
                                         initial_sql.index('CREATE TABLE "Client"')]
            fixture_sql = (
                "CREATE TYPE \"UserRole\" AS ENUM ('OWNER', 'ADMIN', 'MANAGER');\n" + account_schema +
                'CREATE UNIQUE INDEX ON "User" (email); CREATE UNIQUE INDEX ON "Session" ("tokenHash");\n'
                'ALTER TABLE "Session" ADD FOREIGN KEY ("userId") REFERENCES "User"(id);\n'
                'INSERT INTO "User" (id,email,"passwordHash","displayName",role,"updatedAt") '
                f"VALUES ('restored-user','restore-fixture@example.invalid','{PASSWORD_HASH}',"
                "'Restore fixture','OWNER',CURRENT_TIMESTAMP);\n"
                "CREATE TABLE restore_fixture(value text); INSERT INTO restore_fixture VALUES ('persisted');"
            )
            docker('exec', '-i', source_name, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
                   input=fixture_sql.encode('utf-8'))
            dump = docker('exec', source_name, 'pg_dump', '-U', 'postgres', '-Fc', 'postgres')
        finally:
            docker('rm', '-fv', source_name)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            # The archive is structurally valid, but its expected counts force
            # failure after PostgreSQL is created and pg_restore has succeeded.
            archive = bundle(root, dump, 'data', {'public.restore_fixture': 999})
            target = root/'restore'
            result = run_restore(archive, hashlib.sha256(archive.read_bytes()).hexdigest(), target, images)
            self.assertIn('restored table counts differ', result.stderr)
            receipt = json.loads((target/'restore-report.json').read_text(encoding='utf-8'))
            self.assertEqual(receipt['status'], 'FAILED')
            try:
                self.assertEqual(docker('volume', 'ls', '-q', '--filter',
                                        'name='+receipt['databaseVolume']).strip(), b'')
                self.assertEqual(receipt['cleanup'], 'PASS')
            finally:
                docker('compose', '--env-file', target/'compose.env', '-f', target/'compose.json',
                       'down', '--volumes')

        for kind in ('data', 'full'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                archive = bundle(root, dump, kind, {'public.restore_fixture': 1, 'public.User': 1,
                                                        'public.Session': 0})
                sha = hashlib.sha256(archive.read_bytes()).hexdigest()
                target = root / 'restore-${YO_TEST_UPLOADS_REDIRECT}'
                compose = ('compose', '--env-file', target/'compose.env', '-f', target/'compose.json')
                try:
                    result = run_restore(archive, sha, target, images)
                    self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                    receipt = json.loads((target/'restore-report.json').read_text(encoding='utf-8'))
                    self.assertEqual(receipt['status'], 'PASS')
                    self.assertEqual(receipt['sourceArchiveSha256'], sha)
                    self.assertEqual(receipt['sourceType'], kind)
                    self.assertEqual(receipt['fileCount'], 1)
                    self.assertFalse((target/'application.tar.gz').exists())
                    self.assertEqual(docker(*compose, 'exec', '-T', 'api', 'cat',
                                            '/app/uploads/communication-files/fixture.txt'), FILE)
                    self.assertNotEqual(run_restore(archive, sha, target, images).returncode, 0)
                    docker(*compose, 'down')
                    docker(*compose, 'up', '-d', '--wait', '--wait-timeout', '90')
                    self.assertEqual(docker(*compose, 'exec', '-T', 'postgres', 'psql', '-U',
                                            'yocrm_restore', '-Atd', 'yocrm', '-c', 'SELECT value FROM restore_fixture;').strip(),
                                     b'persisted')
                    self.assertEqual(docker(*compose, 'exec', '-T', 'api', 'cat',
                                            '/app/uploads/communication-files/fixture.txt'), FILE)
                    with subprocess.Popen([*CLI, '--open', '--target', str(target), '--port', '0'],
                                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) as tunnel:
                        try:
                            line = tunnel.stdout.readline()
                            self.assertTrue(line.startswith('http://127.0.0.1:'), line)
                            endpoint = line.split()[0]
                            with urlopen(endpoint+'/api/health', timeout=15) as response:
                                self.assertTrue(json.load(response)['ok'])
                            with urlopen(endpoint+'/', timeout=15) as response:
                                self.assertIn(b'<html', response.read())
                            if os.environ.get('YO_NEW_HOST_BROWSER_TEST') == '1':
                                browser = subprocess.run(['node', '-e', BROWSER, endpoint], cwd=ROOT/'apps/web',
                                                         capture_output=True, text=True, timeout=120)
                                self.assertEqual(browser.returncode, 0, browser.stderr)
                        finally:
                            tunnel.terminate()
                finally:
                    if (target/'compose.json').is_file():
                        docker(*compose, 'down', '--volumes')
