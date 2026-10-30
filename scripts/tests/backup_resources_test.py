"""Resource contracts at real archive/CLI boundaries; Docker host tests opt in."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
import secrets
import contextlib
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backup_archive as archive

spec = importlib.util.spec_from_file_location('recovery_drill', Path(__file__).resolve().parents[1]/'recovery-drill.py')
drill = importlib.util.module_from_spec(spec); spec.loader.exec_module(drill)

cw_path = Path(os.environ.get('BACKUP_CHATWOOT_TEST_SOURCE', Path(__file__).resolve().parents[1]/'backup_chatwoot.py'))
spec = importlib.util.spec_from_file_location('chatwoot_under_test', cw_path)
chatwoot = importlib.util.module_from_spec(spec); spec.loader.exec_module(chatwoot)


class ChatwootFenceTests(unittest.TestCase):
    def setUp(self):
        self.runtime = sys.modules['backup_runtime']
        external = os.environ.get('BACKUP_FENCED_RUNTIME_SOURCE')
        if external:
            def load(name):
                spec = importlib.util.spec_from_file_location('fenced_test_'+name, Path(external)/(name+'.py'))
                module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
                return module
            self.runtime = load('backup_runtime')
            self.runtime.backup_lease = load('backup_lease')
        if not hasattr(self.runtime, 'require_execution'):
            self.skipTest('requires integrated fenced runtime from MAIN')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)/'backup-fenced-12345678'; self.root.mkdir()
        self.journal = self.root.parent/'.chatwoot-quiescence.json'
        self.owner = 'a'*32; self.job = self.root.name; self.calls = []
        self.config = dict(project='cw-isolated', database='chatwoot', storagePath='/app/storage', writersComplete=True,
                           webContainer='1'*64, workerContainer='2'*64, postgresContainer='3'*64)
        path = self.root.parent/'cw.json'; path.write_text(json.dumps(self.config))
        self.env = patch.dict(os.environ, BACKUP_EXECUTION_OWNER=self.owner, BACKUP_JOB_ID=self.job, BACKUP_CHATWOOT_CONFIG=str(path))
        self.env.start(); self.addCleanup(self.env.stop)
        self.running = {self.config['webContainer']:True,self.config['workerContainer']:True,self.config['postgresContainer']:True}
        self.global_valid = self.job_valid = True
        self.lose_after_dump = self.active_original_job = False
        def sql(query):
            if query.startswith('UPDATE'):
                return self.owner if self.global_valid else ''
            if query.startswith('SELECT NOT EXISTS'):
                return 'f' if self.active_original_job else 't'
            if 'FROM "Backup"' in query:
                return 't' if self.job_valid and self.global_valid else 'f'
            return 't' if self.global_valid else 'f'
        def docker(args, **kwargs):
            self.calls.append(args)
            if args[1] == 'inspect':
                cid=args[2]
                body=[dict(Id=cid,Image='sha256:'+'f'*64,State={'Running':self.running[cid]},
                           Config={'Labels':{'com.docker.compose.project':'cw-isolated'}},
                           Mounts=[dict(Destination='/app/storage',Type='volume',Name='cw-isolated_storage')])]
                return subprocess.CompletedProcess(args,0,json.dumps(body),'')
            if args[1] in ('start','stop'):
                self.running[args[-1]]=args[1]=='start'
            if 'stdout' in kwargs and hasattr(kwargs['stdout'],'write'):
                kwargs['stdout'].write(tar_bytes([('media.txt',b'abc')]) if args[1]=='run' else b'PGDMPfixture')
                if self.lose_after_dump:
                    self.global_valid=False
            return subprocess.CompletedProcess(args,0,'0','')
        for change in (patch.object(chatwoot,'runtime',self.runtime,create=True),
                       patch.object(self.runtime,'sql',side_effect=sql),
                       patch.object(chatwoot.subprocess,'run',side_effect=docker)):
            change.start(); self.addCleanup(change.stop)

    def receipt(self, **changes):
        state=dict(owner=self.owner,jobId=self.job,project='cw-isolated',containers=[self.config['webContainer']])
        state.update(changes); self.journal.write_text(json.dumps(state))

    def test_resume_rejects_foreign_owner_without_starting_or_deleting_receipt(self):
        self.receipt(owner='b'*32)
        with self.assertRaisesRegex(archive.InvalidArchive,'another capture'):
            chatwoot.resume(self.journal)
        self.assertTrue(self.journal.exists())
        self.assertFalse(any(c[1] in ('start','stop') for c in self.calls))

    def test_capture_with_expired_job_never_stops_writers_or_claims_inclusion(self):
        self.job_valid=False
        with self.assertRaisesRegex(archive.InvalidArchive,'lease lost'):
            chatwoot.capture(self.root,self.journal)
        self.assertFalse(any(c[1]=='stop' for c in self.calls))
        self.assertFalse(self.journal.exists())

    def test_capture_journal_binds_owner_job_and_requires_fence_before_resume(self):
        saved=[]
        atomic=chatwoot.atomic_json
        def record(path, value):
            if path == self.journal:
                saved.append(dict(value))
            atomic(path,value)
        with patch.object(chatwoot,'atomic_json',side_effect=record):
            result=chatwoot.capture(self.root,self.journal)
        self.assertTrue(result['included'])
        self.assertTrue(all(s['owner']==self.owner and s['jobId']==self.job and s['project']=='cw-isolated' for s in saved))
        self.assertTrue(any(s.get('phase')=='QUIESCED' and s.get('verified') for s in saved))
        self.assertTrue(all(self.running.values()))
        self.assertFalse(self.journal.exists())

    def test_lease_loss_during_dump_retains_journal_and_cannot_claim_inclusion(self):
        self.lose_after_dump=True
        with self.assertRaisesRegex(archive.InvalidArchive,'ownership lost'):
            chatwoot.capture(self.root,self.journal)
        self.assertTrue(self.journal.exists())
        self.assertFalse(any(c[1]=='start' for c in self.calls))

    def test_replacement_cannot_adopt_another_live_chatwoot_job(self):
        self.receipt(owner='b'*32)
        os.environ.pop('BACKUP_JOB_ID')
        self.active_original_job=True
        with self.assertRaisesRegex(archive.InvalidArchive,'active worker'):
            chatwoot.resume(self.journal)
        self.assertTrue(self.journal.exists())
        self.assertFalse(any(c[1]=='start' for c in self.calls))

    def test_replacement_adopts_only_expired_allowlisted_journal(self):
        self.receipt(owner='b'*32)
        self.running[self.config['webContainer']]=False
        os.environ.pop('BACKUP_JOB_ID')
        chatwoot.resume(self.journal)
        self.assertFalse(self.journal.exists())
        self.assertTrue(self.running[self.config['webContainer']])


class ProcessResourceTests(unittest.TestCase):
    def test_process_wallclock_terminates_a_real_stalled_child(self):
        started = time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired):
            drill.bounded_run([sys.executable, '-c', 'import time;time.sleep(30)'], deadline=started+0.2)
        self.assertLess(time.monotonic()-started, 3)

    def test_process_output_cannot_exhaust_host_memory_or_disk(self):
        with self.assertRaisesRegex(archive.InvalidArchive, 'output budget'):
            drill.bounded_run([sys.executable, '-c', 'import sys;sys.stdout.buffer.write(b"x"*2000000)'],
                              deadline=time.monotonic()+5, capture_output=True, max_output=1024)

    def test_unenforced_container_limits_fail_closed(self):
        with self.assertRaisesRegex(archive.InvalidArchive, 'resource'):
            drill.enforce_resources({'HostConfig': {}, 'Mounts': []})



def tar_bytes(entries):
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode='w:gz') as tar:
        for name, body in entries:
            entry = tarfile.TarInfo(name); entry.size = len(body)
            tar.addfile(entry, io.BytesIO(body))
    return data.getvalue()


class ArchiveResourceTests(unittest.TestCase):
    def test_import_refuses_low_space_before_writing_quarantine(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); storage = root/'store'; storage.mkdir()
            source = root/'archive.tar.gz'; source.write_bytes(tar_bytes([('postgres.dump', b'PGDMPx')]))
            usage = type('Usage', (), {'free': 1})()
            with patch.object(archive.shutil, 'disk_usage', return_value=usage):
                with self.assertRaisesRegex(archive.InvalidArchive, 'free space'):
                    archive.import_archive(source, storage, 'import-12345678')
            self.assertEqual(list(storage.iterdir()), [])

    def test_nested_expansion_is_preflighted_before_outer_extraction(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); storage = root/'store'; storage.mkdir()
            inner = tar_bytes([('huge', b'a'*200000)])
            source = root/'archive.tar.gz'; source.write_bytes(tar_bytes([('uploads.tar.gz', inner)]))
            with self.assertRaisesRegex(archive.InvalidArchive, 'expanded byte limit'):
                archive.import_archive(source, storage, 'import-12345678', max_bytes=10000)
            self.assertEqual(list(storage.iterdir()), [])

    def test_tar_deadline_and_member_budget_are_enforced(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary)/'data.tar.gz'
            source.write_bytes(tar_bytes([('a', b'a'), ('b', b'b')]))
            with self.assertRaisesRegex(archive.InvalidArchive, 'deadline'):
                archive.scan_tar(source, deadline=time.monotonic()-1)
            with self.assertRaisesRegex(archive.InvalidArchive, 'entries'):
                archive.scan_tar(source, max_members=1)

    def test_oversized_pax_metadata_is_rejected_before_allocation(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary)/'data.tar'
            entry = tarfile.TarInfo('pax'); entry.type = tarfile.XHDTYPE; entry.size = 1024*1024
            source.write_bytes(entry.tobuf())
            with self.assertRaisesRegex(archive.InvalidArchive, 'oversized archive metadata'):
                archive.scan_tar(source)

    def test_import_cannot_supply_local_drill_or_ownership_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); storage = root/'store'; storage.mkdir()
            for name in ('.backup-owner', 'verification.json', 'drill-report.json'):
                source = root/'archive.tar.gz'; source.write_bytes(tar_bytes([(name, b'{}')]))
                with self.assertRaisesRegex(archive.InvalidArchive, 'local evidence'):
                    archive.import_archive(source, storage, 'import-12345678')


@unittest.skipUnless(os.environ.get('BACKUP_RESOURCE_TEST_IMAGE') and os.name == 'posix',
                     'explicit installed PostgreSQL image and Linux Docker host required')
class DockerHostResourceTests(unittest.TestCase):
    """Only fresh yo-recovery-* projects, synthetic data, no existing DB/mounts."""
    @contextlib.contextmanager
    def postgres(self):
        image = os.environ['BACKUP_RESOURCE_TEST_IMAGE']
        project = 'yo-recovery-limits-'+secrets.token_hex(6)
        drill.pinned_image(image)
        drill.project_guard(project)
        with tempfile.TemporaryDirectory(prefix='yo-resource-test-') as temporary:
            root = Path(temporary)
            env = root/'test.env'
            env.write_text('RECOVERY_POSTGRES_IMAGE='+image+'\nRECOVERY_PASSWORD='+secrets.token_hex(32)+'\n')
            env.chmod(0o600)
            compose = ['docker','compose','--env-file',str(env),'-p',project,'-f',str(Path(__file__).resolve().parents[2]/'docker-compose.recovery-drill.yml')]
            try:
                drill.bounded_run(compose+['up','-d','--wait','--wait-timeout','90'],time.monotonic()+100)
                cid = drill.bounded_run(compose+['ps','-q','postgres'],time.monotonic()+10,capture_output=True,text=True).stdout.strip()
                info = json.loads(drill.bounded_run(['docker','inspect',cid],time.monotonic()+10,capture_output=True,text=True).stdout)[0]
                drill.enforce_resources(info)
                yield root, compose, cid
            finally:
                drill.bounded_run(compose+['down','--volumes','--timeout','5'],time.monotonic()+30)

    def sql(self, compose, query, timeout_ms=30000):
        return drill.bounded_run(compose+['exec','-T','-e','PGOPTIONS=-c statement_timeout='+str(timeout_ms),'postgres',
            'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','backup_test','-d','recovery_control'],
            time.monotonic()+40,input=query,capture_output=True,text=True)

    def test_kernel_limits_storage_statement_timeout_and_real_restore(self):
        with self.postgres() as (root, compose, cid):
            def read(path):
                return drill.bounded_run(['docker','exec',cid,'cat',path],time.monotonic()+10,capture_output=True,text=True).stdout.strip()
            self.assertEqual(read('/sys/fs/cgroup/memory.max'),str(768*1024**2))
            self.assertEqual(read('/sys/fs/cgroup/pids.max'),'128')
            self.assertEqual(read('/sys/fs/cgroup/cpu.max'),'100000 100000')
            with self.assertRaises(subprocess.CalledProcessError):
                self.sql(compose,'SELECT pg_sleep(2);',200)
            # Superuser COPY PROGRAM is arbitrary code from a malicious dump.
            # Both /tmp and PGDATA exhaust within tmpfs, never the host disk.
            for path, megabytes in [('/tmp/hostile-fill',32),('/var/lib/postgresql/data/hostile-fill',600)]:
                with self.assertRaises(subprocess.CalledProcessError):
                    self.sql(compose,"COPY (SELECT 'x') TO PROGRAM 'dd if=/dev/zero of="+path+' bs=1M count='+str(megabytes)+"';")
                drill.bounded_run(['docker','exec',cid,'rm','-f',path],time.monotonic()+10)
            self.sql(compose,'CREATE TABLE probe(id integer PRIMARY KEY); INSERT INTO probe VALUES(7);')
            backup = root/'backup-resource-12345678'; backup.mkdir()
            with (backup/'postgres.dump').open('wb') as destination:
                drill.bounded_run(compose+['exec','-T','postgres','pg_dump','-U','backup_test','-d','recovery_control','-Fc'],
                                  time.monotonic()+30,stdout=destination)
            (backup/'uploads.tar.gz').write_bytes(tar_bytes([('probe.txt',b'abc')]))
            (backup/'manifest.txt').write_text('format_version=1\ncompose_project=yoleotard-crm\n')
            (backup/'SHA256SUMS').write_text(''.join(archive.digest(backup/n)+'  '+n+'\n' for n in ('postgres.dump','uploads.tar.gz')))
            report = drill.drill(backup,'yo-recovery-roundtrip-'+secrets.token_hex(6),os.environ['BACKUP_RESOURCE_TEST_IMAGE'],root/'restored')
            self.assertEqual(report['status'],'PASS')
            self.assertEqual(report['tableCounts']['public.probe'],1)
            self.assertEqual(report['cleanup'],'PASS')
            self.assertGreater(report['elapsedSeconds'], 0)
            self.assertLess(report['elapsedSeconds'], drill.WALL_SECONDS+30)
            self.assertLess(report['startedAt'], report['finishedAt'])
            self.assertEqual(archive.read_json(backup/'drill-report.json')['references']['sourceArtifactChecksum'],archive.digest(backup/'SHA256SUMS'))
            type(self).lastDrillReport = report
            retained_project = 'yo-recovery-retained-'+secrets.token_hex(6)
            retained = drill.drill(backup,retained_project,os.environ['BACKUP_RESOURCE_TEST_IMAGE'],root/'retained',retain=True)
            retained_cmd = ['docker','compose','--env-file',retained['envFile'],'-p',retained_project,'-f',retained['composeFile']]
            try:
                self.assertTrue(retained['volatile'])
                self.assertEqual(retained['targetMode'],'QUARANTINED_VOLATILE')
                self.assertFalse(retained['postgresStopped'])
                self.assertFalse(retained['prepared'])
                cid = drill.bounded_run(retained_cmd+['ps','-q','postgres'],time.monotonic()+10,capture_output=True,text=True).stdout.strip()
                info = json.loads(drill.bounded_run(['docker','inspect',cid],time.monotonic()+10,capture_output=True,text=True).stdout)[0]
                self.assertTrue(info['State']['Running'])
                self.assertEqual(drill.bounded_run(retained_cmd+['exec','-T','postgres','psql','-X','-At','-U','backup_test','-d','recovery_target','-c','SELECT id FROM probe;'],time.monotonic()+10,capture_output=True,text=True).stdout.strip(),'7')
            finally:
                drill.bounded_run(retained_cmd+['down','--volumes','--timeout','5'],time.monotonic()+30)

    def test_memory_exhaustion_is_confined_to_cgroup(self):
        with self.postgres() as (root, compose, cid):
            before = drill.bounded_run(['docker','exec',cid,'cat','/sys/fs/cgroup/memory.events'],time.monotonic()+10,capture_output=True,text=True).stdout
            with self.assertRaises(subprocess.CalledProcessError):
                self.sql(compose,"SELECT length(repeat('x',800000000));")
            after = drill.bounded_run(['docker','exec',cid,'cat','/sys/fs/cgroup/memory.events'],time.monotonic()+10,capture_output=True,text=True).stdout
            def kills(value):
                return int(next(line.split()[1] for line in value.splitlines() if line.startswith('oom_kill ')))
            self.assertGreater(kills(after),kills(before))


if __name__ == '__main__':
    unittest.main()
