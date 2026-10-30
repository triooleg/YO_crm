import datetime as dt
import importlib.util
from pathlib import Path
import sys
import unittest
import zoneinfo
import hashlib
import io
import json
import tarfile
import tempfile
import subprocess
from unittest.mock import patch
# Windows has no OS tzdb; use installed TZif test data without importing pytz.
tzdb = Path(sys.prefix)/'Lib/site-packages/pytz/zoneinfo'
if tzdb.is_dir():
    zoneinfo.reset_tzpath([str(tzdb)])

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
spec = importlib.util.spec_from_file_location('backup_agent', Path(__file__).resolve().parents[1]/'backup-agent.py')
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)
import backup_archive as archive


class AutomaticRetentionTests(unittest.TestCase):
    def worker(self, root, kind='BACKUP'):
        worker = object.__new__(agent.Agent)
        worker.root, worker.config = root, {'allowAutomaticRetention': True}
        worker.owner, worker.lease_seconds, worker.lease_lost = 'a'*32, 180, False
        worker.sql = lambda query: ''
        worker.public_heartbeat = worker.reconcile = worker.schedule = lambda: None
        worker.claim = lambda: dict(id='backup-completed-123', metadata=dict(job=dict(kind=kind, attempts=1)))
        worker.events, worker.writes = [], []
        worker.event = lambda *args: worker.events.append(args)
        worker.fenced_update = lambda *args: worker.writes.append(args)
        worker.execute = lambda row, fd: worker.events.append(('CAPTURE_COMPLETED', row['id']))
        return worker

    def test_retention_runs_after_capture_under_original_global_lease(self):
        with tempfile.TemporaryDirectory() as temporary:
            worker = self.worker(Path(temporary))
            order = []
            @agent.contextlib.contextmanager
            def lock(root):
                order.append('flock'); yield 7; order.append('unlock')
            worker.execute = lambda row, fd: order.append('completed')
            def maintenance():
                order.append('retention')
                self.assertNotIn('release', order)
            worker.automatic_retention = maintenance
            with patch.object(agent, 'host_lock', lock), patch.object(agent.backup_lease, 'acquire', side_effect=lambda *a: order.append('acquire') or True) as acquire, patch.object(agent.backup_lease, 'release', side_effect=lambda *a: order.append('release')):
                worker.cycle()
            self.assertEqual(order, ['flock', 'acquire', 'completed', 'retention', 'release', 'unlock'])
            self.assertEqual(acquire.call_count, 1)

    def test_retention_failure_never_retries_completed_capture(self):
        with tempfile.TemporaryDirectory() as temporary:
            worker = self.worker(Path(temporary))
            worker.automatic_retention = lambda: (_ for _ in ()).throw(ValueError('private maintenance error'))
            worker.locked_cycle(7)
            self.assertEqual(worker.writes, [])
            self.assertEqual([event[0] for event in worker.events],
                             ['BACKUP_EXECUTOR_CLAIMED', 'CAPTURE_COMPLETED', 'BACKUP_RETENTION_FAILED'])
            self.assertNotIn('private maintenance error', str(worker.events))

    def test_capture_failure_keeps_retry_contract_and_never_runs_retention(self):
        with tempfile.TemporaryDirectory() as temporary:
            worker = self.worker(Path(temporary))
            worker.execute = lambda *a: (_ for _ in ()).throw(ValueError('capture failed'))
            worker.automatic_retention = lambda: self.fail('retention before completion')
            with self.assertRaisesRegex(ValueError, 'capture failed'): worker.locked_cycle(7)
            self.assertEqual(len(worker.writes), 1)
            self.assertIn("status='PENDING'", worker.writes[0][1])
            self.assertEqual(worker.events[-1][0], 'BACKUP_EXECUTOR_FAILED')

    def test_host_default_never_reads_retention_configuration(self):
        with tempfile.TemporaryDirectory() as temporary:
            worker = self.worker(Path(temporary)); worker.config = {}
            worker.sql = lambda *a: self.fail('DB read with host automatic retention disabled')
            worker.automatic_retention()

    def test_agent_delegates_to_shared_policy_without_acquiring_another_lease(self):
        with tempfile.TemporaryDirectory() as temporary:
            worker = self.worker(Path(temporary))
            def policy(online, root, **kwargs):
                self.assertIs(online, worker)
                self.assertEqual(root, worker.root)
                self.assertTrue(kwargs['apply']); self.assertTrue(kwargs['automatic'])
                kwargs['fence']()
                return {'executed': True}
            with patch.object(agent.maintenance, 'online_retention', side_effect=policy), patch.object(agent.backup_lease, 'heartbeat', return_value=True) as heartbeat, patch.object(agent.backup_lease, 'acquire') as acquire:
                self.assertTrue(worker.automatic_retention()['executed'])
                heartbeat.assert_called_once_with(worker.sql, worker.owner, worker.lease_seconds)
                acquire.assert_not_called()

    def test_agent_retention_fence_rejects_expired_or_lost_lease(self):
        for lost in (False, True):
            with self.subTest(lost=lost), tempfile.TemporaryDirectory() as temporary:
                worker = self.worker(Path(temporary)); worker.lease_lost = lost
                def policy(online, root, **kwargs): kwargs['fence']()
                with patch.object(agent.maintenance, 'online_retention', side_effect=policy), patch.object(agent.backup_lease, 'heartbeat', return_value=False):
                    with self.assertRaisesRegex(ValueError, 'retention global lease lost'):
                        worker.automatic_retention()

    def test_retention_audit_failure_cannot_reenter_capture_retry_handler(self):
        with tempfile.TemporaryDirectory() as temporary:
            worker = self.worker(Path(temporary))
            worker.automatic_retention = lambda: (_ for _ in ()).throw(ValueError('maintenance failed'))
            events = worker.event
            def audit(*args):
                events(*args)
                if args[0] == 'BACKUP_RETENTION_FAILED': raise OSError('audit DB unavailable')
            worker.event = audit
            with self.assertRaisesRegex(OSError, 'audit DB unavailable'): worker.locked_cycle(7)
            self.assertEqual(worker.writes, [])
            self.assertNotIn('BACKUP_EXECUTOR_FAILED', [event[0] for event in worker.events])

    def test_non_backup_jobs_do_not_run_automatic_retention(self):
        for kind in ('DRILL', 'IMPORT_VERIFY'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                worker = self.worker(Path(temporary), kind)
                worker.automatic_retention = lambda: self.fail('retention after non-backup job')
                worker.locked_cycle(7)


class ScheduleTests(unittest.TestCase):
    def test_monthly_drill_success_saves_local_pending_result_without_external_delivery(self):
        with tempfile.TemporaryDirectory() as temporary:
            worker = object.__new__(agent.Agent); worker.root = Path(temporary); worker.config = {}
            worker.sql = lambda query: json.dumps(dict(storagePath='source-backup', checksum='a'*64, sizeBytes=10))
            worker.event = lambda *args: None
            writes, notifications = [], []
            worker.fenced_update = lambda bid, fields, **kwargs: writes.append(fields) or notifications.append(kwargs['notification']) or bid
            def drill(command, fd, backup_id):
                output = Path(command[command.index('--output-dir')+1]); output.mkdir()
                (output/'drill-report.json').write_text(json.dumps(dict(status='PASS', fileCount=3)))
            worker.child = drill
            row = dict(id='monthly-drill-12345', metadata=dict(job=dict(kind='DRILL', scheduleSlot='2026-10')))
            row['metadata']['job']['sourceBackupId'] = 'source-backup'
            worker.execute(row, 7)
            event = notifications[0]
            self.assertEqual(set(event), {'version','type','eventId','backupId','sourceBackupId','status','severity',
                                         'finishedAt','trigger','scheduleSlot','delivery','externalDeliveryEnabled'})
            self.assertEqual(event['type'], 'BACKUP_DRILL_RESULT')
            self.assertEqual(event['status'], 'PASS')
            self.assertEqual(event['severity'], 'INFO')
            self.assertEqual(event['trigger'], 'SCHEDULED')
            self.assertEqual(event['scheduleSlot'], '2026-10')
            self.assertEqual(event['delivery'], 'LOCAL_PENDING')
            self.assertFalse(event['externalDeliveryEnabled'])
            saved = json.loads(writes[0].split('::jsonb)||', 1)[1].split('::jsonb', 1)[0][1:-1])['drill']
            self.assertEqual(saved['finishedAt'], event['finishedAt'])
            self.assertEqual(saved['sourceBackupId'], event['sourceBackupId'])
            self.assertEqual(len(event['eventId']), 64)

    def test_drill_result_and_pending_event_share_one_fenced_sql_statement(self):
        worker = object.__new__(agent.Agent); worker.owner = 'a'*32
        queries = []; worker.sql = lambda query: queries.append(query) or 'monthly-drill-12345'
        event = agent.drill_notification('monthly-drill-12345', 'source-backup',
                    dict(status='FAILED', finishedAt='2026-10-26T12:00:00+00:00'), dict(scheduleSlot='2026-10'))
        self.assertEqual(worker.fenced_update('monthly-drill-12345', "metadata=metadata||'{}'::jsonb", notification=event), 'monthly-drill-12345')
        self.assertEqual(len(queries), 1)
        self.assertTrue(queries[0].startswith('WITH saved_result AS (UPDATE "Backup"'))
        self.assertIn(agent.backup_lease.fence(worker.owner), queries[0])
        self.assertIn("'{job,leaseOwner}'", queries[0])
        self.assertIn("'backups','drillNotification'", queries[0])
        self.assertIn('FROM saved_result WHERE true', queries[0])
        self.assertIn('ON CONFLICT(section,key) DO UPDATE', queries[0])
        self.assertEqual(event, agent.drill_notification('monthly-drill-12345', 'source-backup',
                    dict(status='FAILED', finishedAt='2026-10-26T12:00:00+00:00'), dict(scheduleSlot='2026-10')))

    def test_real_hardened_pack_full_completion_and_reimport_keep_distinct_trust(self):
        # Run with the integrated runtime/archive modules. Only Docker capture
        # and PostgreSQL writes are substituted, never validation or CLI pack.
        for quiesced in (True, False):
            with self.subTest(quiesced=quiesced), tempfile.TemporaryDirectory() as temporary:
                worker = object.__new__(agent.Agent); worker.root = Path(temporary)
                worker.config = dict(consistent=True)
                worker.sql = lambda query: json.dumps(dict(maintenance=dict(allowWriterPause=True)))
                worker.event = lambda *args: None
                backup_id = 'real-full-capture-12345'; directory = worker.root/backup_id
                writes = []; worker.fenced_update = lambda bid, fields: writes.append(fields) or bid
                raw_results = []
                def capture(*args):
                    directory.mkdir()
                    (directory/'postgres.dump').write_bytes(b'PGDMPsynthetic')
                    for name in ('uploads.tar.gz','application.tar.gz'):
                        with tarfile.open(directory/name, 'w:gz'): pass
                    (directory/'inventory.json').write_text('[]')
                    (directory/'table-counts.json').write_text('{}')
                    claim = dict(verified=True, method='stopped-writers', services=['api'])
                    names = ['postgres.dump','uploads.tar.gz','inventory.json','table-counts.json','application.tar.gz']
                    manifest = dict(format_version=3, backup_id=backup_id, type='full', storage_provider='local',
                                    app_version='0.10.0', git_commit='a'*40, schema_version='migration48', database_version='16',
                                    files=names, consistency=claim)
                    (directory/'manifest.json').write_text(json.dumps(manifest))
                    (directory/'SHA256SUMS').write_text(''.join(archive.digest(directory/n)+'  '+n+'\n' for n in names+['manifest.json']))
                    raw_results.append(archive.validate_directory(directory, backup_id))
                    if quiesced:
                        (worker.root/'.quiescence.json').write_text(json.dumps(dict(phase='QUIESCED', verified=True,
                                      project='test-backups', services=['api'], owner='a'*32, jobId=backup_id)))
                    env = dict(agent.os.environ, COMPOSE_PROJECT_NAME='test-backups', BACKUP_CONSISTENT='true')
                    packed = subprocess.run([sys.executable, '-B', str(Path(archive.__file__).resolve()), 'pack', str(directory)],
                                            env=env, check=True, capture_output=True, text=True, timeout=30)
                    (worker.root/'.last-validation.json').write_text(packed.stdout)
                worker.child = capture
                row = dict(id=backup_id, type='FULL', metadata=dict(job=dict(kind='BACKUP')))
                if not quiesced:
                    with self.assertRaisesRegex(ValueError, 'verified portable v3'): worker.execute(row, 7)
                    self.assertEqual(writes, [])
                    continue
                worker.execute(row, 7)
                self.assertFalse(raw_results[0]['consistent'])
                self.assertEqual(raw_results[0]['consistencyTrust'], 'UNVERIFIED')
                root = json.loads(writes[0].split('::jsonb)||', 1)[1].split('::jsonb', 1)[0][1:-1])
                self.assertTrue(root['consistency']['verified'])
                self.assertEqual(root['consistency']['trust'], 'VERIFIED_LOCAL_QUIESCENCE')
                self.assertFalse(archive.validate_directory(directory, backup_id)['consistent'])
                quarantine = worker.root/'quarantine'; quarantine.mkdir()
                uploaded = quarantine/'real.tar.gz'; uploaded.write_bytes((directory/'archive.tar.gz').read_bytes())
                imported = dict(id='real-full-import-12345', type='FULL', metadata=dict(job=dict(kind='IMPORT_VERIFY'),
                                quarantine=dict(file=uploaded.name, bytes=uploaded.stat().st_size, checksum=archive.digest(uploaded))))
                with patch.object(agent, 'local_consistency', side_effect=AssertionError('imports must not consult host receipt')):
                    worker.execute(imported, 7)
                root = json.loads(writes[1].split('::jsonb)||', 1)[1].split('::jsonb', 1)[0][1:-1])
                self.assertFalse(root['consistency']['verified'])
                self.assertEqual(root['consistencyTrust'], 'UNVERIFIED')
                self.assertTrue(root['claimedConsistency']['verified'])

    def test_fresh_local_full_uses_bound_pack_attestation_after_unsigned_revalidation(self):
        for mismatch in (False, True):
            with self.subTest(mismatch=mismatch), tempfile.TemporaryDirectory() as temporary:
                worker = object.__new__(agent.Agent); worker.root = Path(temporary)
                worker.config = dict(consistent=True)
                worker.sql = lambda query: json.dumps(dict(maintenance=dict(allowWriterPause=True)))
                backup_id = 'capture-trust-12345'
                claim = dict(verified=True, services=['api'])
                validated = dict(formatVersion=3, consistent=False, consistencyTrust='UNVERIFIED', claimedConsistency=claim,
                                 coverage=dict(postgresql=True, uploads=True, chatwoot=False),
                                 checksum='a'*64, sizeBytes=100, manifest=dict(backup_id=backup_id, type='full',
                                 consistency=claim, files=['postgres.dump','uploads.tar.gz','application.tar.gz']))
                receipt = worker.root/'.last-validation.json'; receipt.write_text('stale receipt')
                def capture(*args):
                    self.assertFalse(receipt.exists(), 'stale receipt must not attest new capture')
                    directory = worker.root/backup_id; directory.mkdir()
                    (directory/'archive.tar.gz').write_bytes(b'synthetic archive')
                    receipt.write_text(json.dumps(dict(validated, consistent=True, consistencyTrust='VERIFIED_LOCAL_QUIESCENCE',
                                                       checksum='b'*64 if mismatch else 'a'*64)))
                worker.child = capture
                writes = []; worker.fenced_update = lambda bid, fields: writes.append(fields) or bid
                worker.event = lambda *args: None
                row = dict(id=backup_id, type='FULL', metadata=dict(job=dict(kind='BACKUP')))
                with patch.object(agent, 'validate_directory', return_value=validated):
                    if mismatch:
                        with self.assertRaises(ValueError): worker.execute(row, 7)
                        self.assertEqual(writes, [])
                    else:
                        worker.execute(row, 7)
                        root = json.loads(writes[0].split('::jsonb)||', 1)[1].split('::jsonb', 1)[0][1:-1])
                        self.assertTrue(root['consistency']['verified'])
                        self.assertEqual(root['consistencyTrust'], 'VERIFIED_LOCAL_QUIESCENCE')

    def test_unsigned_import_never_promotes_manifest_consistency(self):
        with tempfile.TemporaryDirectory() as temporary:
            worker = object.__new__(agent.Agent); worker.root = Path(temporary)
            (worker.root/'quarantine').mkdir()
            source = worker.root/'quarantine/upload.tar.gz'; source.write_bytes(b'synthetic archive')
            destination = worker.root/'import-trust-12345'; destination.mkdir()
            (destination/'archive.tar.gz').write_bytes(b'synthetic imported archive')
            claim = dict(verified=True, method='stopped-writers', services=['api'])
            result = dict(formatVersion=3, consistent=False, consistencyTrust='UNVERIFIED', claimedConsistency=claim,
                          coverage=dict(postgresql=True, uploads=True, chatwoot=False), claimedCoverage=dict(chatwoot=True),
                          manifest=dict(backup_id='source-backup', type='data', consistency=claim), checksum='a'*64, sizeBytes=100)
            writes = []; worker.fenced_update = lambda bid, fields: writes.append(fields) or bid
            worker.event = lambda *args: None
            row = dict(id=destination.name, type='DATA', metadata=dict(job=dict(kind='IMPORT_VERIFY'),
                       quarantine=dict(file=source.name, bytes=source.stat().st_size, checksum=archive.digest(source))))
            with patch.object(agent, 'validate_directory', return_value=result):
                worker.execute(row, 7)
            root = json.loads(writes[0].split('::jsonb)||', 1)[1].split('::jsonb', 1)[0][1:-1])
            self.assertFalse(root['consistency']['verified'])
            self.assertFalse(root['coverage']['chatwoot'])
            self.assertTrue(root['claimedCoverage']['chatwoot'])
            self.assertEqual(root['consistencyTrust'], 'UNVERIFIED')
            self.assertEqual(root['claimedConsistency'], claim)

    def test_chatwoot_resume_gets_current_owner_and_source_compose_context(self):
        with tempfile.TemporaryDirectory() as temporary:
            worker = agent.Agent(dict(project='test-backups', storageRoot=temporary, envFile='source.env',
                                     composeFile='source.yml', chatwootConfig='chatwoot-private.json'))
            (worker.root/'.chatwoot-quiescence.json').write_text('{}')
            worker.public_heartbeat = lambda: None
            worker.reconcile = lambda: None; worker.schedule = lambda: None; worker.claim = lambda: None
            with patch.dict(agent.os.environ, BACKUP_JOB_ID='stale-job', BACKUP_EXECUTION_OWNER='stale-owner'), \
                 patch.object(agent.subprocess, 'run') as run:
                worker.locked_cycle(7)
            env = run.call_args.kwargs['env']
            self.assertEqual(env['BACKUP_EXECUTION_OWNER'], worker.owner)
            self.assertEqual(env['COMPOSE_PROJECT_NAME'], 'test-backups')
            self.assertEqual(env['COMPOSE_FILE'], 'source.yml')
            self.assertEqual(env['ENV_FILE'], 'source.env')
            self.assertEqual(env['BACKUP_CHATWOOT_CONFIG'], 'chatwoot-private.json')
            self.assertNotIn('BACKUP_JOB_ID', env)

    def test_failed_drill_without_valid_report_or_after_pass_never_loses_failure(self):
        for prior in (None, 'invalid JSON', json.dumps(dict(status='PASS', fileCount=3))):
            with self.subTest(prior=prior), tempfile.TemporaryDirectory() as temporary:
                worker = object.__new__(agent.Agent)
                worker.root = Path(temporary); worker.config = {}
                worker.sql = lambda query: json.dumps(dict(storagePath='source-backup', checksum='a'*64, sizeBytes=10))
                writes = []
                worker.fenced_update = lambda bid, fields, **kwargs: writes.append(fields) or bid
                worker.event = lambda *args: None
                def failed_child(command, fd, backup_id):
                    output = Path(command[command.index('--output-dir')+1])
                    if prior is not None:
                        output.mkdir(); (output/'drill-report.json').write_text(prior)
                    raise RuntimeError('synthetic child failure')
                worker.child = failed_child
                row = dict(id='drill-job-12345', metadata=dict(job=dict(kind='DRILL', sourceBackupId='source-backup')))
                with self.assertRaisesRegex(RuntimeError, 'synthetic child failure'):
                    worker.execute(row, 7)
                reports = list(worker.root.glob('.drill-*/drill-report.json'))
                self.assertEqual(len(reports), 1)
                report = json.loads(reports[0].read_text())
                self.assertEqual(report['status'], 'FAILED')
                self.assertEqual(report['errorCode'], 'DRILL_EXECUTION_FAILED')
                self.assertEqual(report['sourceBackupId'], 'source-backup')
                self.assertIn(agent.literal(json.dumps(report)), writes[0])

    def test_drill_failure_after_lease_loss_keeps_private_report_without_success_audit(self):
        with tempfile.TemporaryDirectory() as temporary:
            worker = object.__new__(agent.Agent)
            worker.root = Path(temporary); worker.config = {}
            worker.sql = lambda query: json.dumps(dict(storagePath='source-backup'))
            worker.fenced_update = lambda *args, **kwargs: ''
            events = []; worker.event = lambda *args: events.append(args)
            worker.child = lambda *args: (_ for _ in ()).throw(RuntimeError('lease lost'))
            with self.assertRaisesRegex(ValueError, 'drill failure ownership lost'):
                worker.execute(dict(id='drill-job-12345', metadata=dict(job=dict(kind='DRILL', sourceBackupId='source-backup'))), 7)
            report = json.loads(next(worker.root.glob('.drill-*/drill-report.json')).read_text())
            self.assertEqual(report['status'], 'FAILED')
            self.assertEqual(events, [])

    def test_failed_drill_disk_error_still_persists_public_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            worker = object.__new__(agent.Agent)
            worker.root = Path(temporary); worker.config = {}
            worker.sql = lambda query: json.dumps(dict(storagePath='source-backup'))
            writes = []; worker.fenced_update = lambda bid, fields, **kwargs: writes.append(fields) or bid
            worker.event = lambda *args: None
            worker.child = lambda *args: (_ for _ in ()).throw(RuntimeError('child failed'))
            with patch.object(agent, 'atomic_json', side_effect=OSError('disk full')), self.assertRaisesRegex(RuntimeError, 'child failed'):
                worker.execute(dict(id='drill-job-12345', metadata=dict(job=dict(kind='DRILL', sourceBackupId='source-backup'))), 7)
            self.assertIn('"status": "FAILED"', writes[0])
            self.assertIn('"privateReportUnavailable": true', writes[0])

    def test_failed_drill_persists_report_and_root_metadata_before_retry(self):
        with tempfile.TemporaryDirectory() as temporary:
            worker = object.__new__(agent.Agent)
            worker.root = Path(temporary)
            worker.config = dict(postgresImage='sha256:'+'1'*64)
            worker.sql = lambda query: json.dumps(dict(storagePath='source-backup', checksum='a'*64, sizeBytes=10))
            writes, events, reports, notifications = [], [], [], []
            worker.fenced_update = lambda bid, fields, **kwargs: notifications.append(kwargs.get('notification')) or writes.append(fields) or bid
            worker.event = lambda *args: events.append(args)
            def failed_child(command, fd, backup_id):
                output = Path(command[command.index('--output-dir')+1]); output.mkdir()
                reports.append(output/'drill-report.json')
                reports[-1].write_text(json.dumps(dict(status='FAILED', fileReferences=dict(status='FAILED', missing=['synthetic-hash']))))
                raise RuntimeError('private credential must never enter public metadata')
            worker.child = failed_child
            row = dict(id='drill-job-12345', metadata=dict(job=dict(kind='DRILL', sourceBackupId='source-backup')))
            with self.assertRaisesRegex(RuntimeError, 'private credential'):
                worker.execute(row, 7)
            self.assertEqual(len(writes), 1)
            self.assertIn("'{drill}'", writes[0])
            report = json.loads(reports[0].read_text())
            self.assertEqual(report['status'], 'FAILED')
            self.assertEqual(report['sourceBackupId'], 'source-backup')
            self.assertEqual(report['fileReferences']['missing'], ['synthetic-hash'])
            self.assertIn('finishedAt', report)
            self.assertIn(agent.literal(json.dumps(report)), writes[0])
            self.assertNotIn('private credential', writes[0])
            self.assertEqual(events[0][0], 'BACKUP_DRILL_FAILED')
            self.assertEqual(notifications[0]['status'], 'FAILED')
            self.assertEqual(notifications[0]['delivery'], 'LOCAL_PENDING')
            self.assertEqual(notifications[0]['sourceBackupId'], 'source-backup')
            self.assertFalse(notifications[0]['externalDeliveryEnabled'])
            self.assertNotIn('private credential', json.dumps(notifications))

    def test_global_lease_renewal_refreshes_public_executor_while_job_is_busy(self):
        worker = agent.Agent(dict(project='test-backups', storageRoot=str(Path(tempfile.gettempdir())), envFile='synthetic.env', composeFile='synthetic.yml'))
        writes = []
        worker.sql = lambda query: writes.append(query) or 'executor'
        callbacks = []
        class InlineThread:
            def __init__(self, target, **kwargs): callbacks.append(target)
            def start(self): pass
            def join(self, **kwargs): pass
        def busy_job(fd):
            callbacks[0]()
        worker.locked_cycle = busy_job
        with patch.object(agent, 'host_lock', return_value=agent.contextlib.nullcontext(7)), \
             patch.object(agent.backup_lease, 'acquire', return_value=True), \
             patch.object(agent.backup_lease, 'heartbeat', return_value=True), \
             patch.object(agent.backup_lease, 'release'), \
             patch.object(agent.threading, 'Thread', InlineThread), \
             patch.object(agent.threading, 'Event') as event:
            event.return_value.wait.side_effect = [False, True]
            worker.cycle()
        self.assertEqual(len(writes), 1)
        self.assertIn("'executor'", writes[0])
        self.assertIn("'lastSeenAt',CURRENT_TIMESTAMP", writes[0])
        self.assertIn(agent.backup_lease.fence(worker.owner), writes[0])

    def test_hourly_runs_before_configured_hour_using_only_minute(self):
        config = dict(enabled=True, frequency='HOURLY', time='03:30', timezone='Europe/London')
        self.assertEqual(agent.schedule_slots(config, dt.datetime(2026, 1, 1, 1, 29, tzinfo=dt.timezone.utc)), [])
        slots = agent.schedule_slots(config, dt.datetime(2026, 1, 1, 1, 45, tzinfo=dt.timezone.utc))
        self.assertEqual([slot['id'] for slot in slots], ['schedule-data-2026-01-01T01'])

    def test_api_full_without_consistency_fails_before_capture(self):
        worker = object.__new__(agent.Agent)
        worker.config = dict(consistent=False)
        worker.root = Path(tempfile.gettempdir())
        worker.child = lambda *args: self.fail('unconfirmed FULL must not launch capture')
        with self.assertRaisesRegex(ValueError, 'FULL'):
            worker.execute(dict(id='backup-full-12345', type='FULL', metadata=dict(job=dict(kind='BACKUP'))), 0)

    def test_london_hourly_keeps_minute_and_fold_has_one_slot(self):
        config = dict(enabled=True, frequency='HOURLY', time='03:30', timezone='Europe/London')
        self.assertEqual(agent.schedule_slots(config, dt.datetime(2026, 1, 1, 4, 0, tzinfo=dt.timezone.utc)), [])
        self.assertEqual(len(agent.schedule_slots(config, dt.datetime(2026, 1, 1, 4, 30, tzinfo=dt.timezone.utc))), 1)
        config['time'] = '00:30'
        first = agent.schedule_slots(config, dt.datetime(2026, 10, 25, 0, 40, tzinfo=dt.timezone.utc))
        folded = agent.schedule_slots(config, dt.datetime(2026, 10, 25, 1, 40, tzinfo=dt.timezone.utc))
        self.assertEqual(first, folded)

    def test_invalid_schedule_does_not_starve_manual_claim(self):
        worker = object.__new__(agent.Agent)
        with tempfile.TemporaryDirectory() as temporary:
            worker.root = Path(temporary)
            worker.sql = lambda query: 'executor' if 'RETURNING key' in query else ''
            worker.owner = 'a'*32
            worker.event = lambda *args: None
            worker.reconcile = lambda: None
            worker.schedule = lambda: agent.schedule_slots(dict(enabled=True, timezone='Bad/Zone'), dt.datetime.now(dt.timezone.utc))
            claimed = []
            worker.claim = lambda: claimed.append(True)
            worker.locked_cycle(0)
            self.assertEqual(claimed, [True])

    def test_five_sequential_imports_remove_only_completed_owned_upload(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = root/'original'; original.mkdir()
            (original/'postgres.dump').write_bytes(b'PGDMPsynthetic')
            with tarfile.open(original/'uploads.tar.gz', 'w:gz'):
                pass
            (original/'manifest.txt').write_text('format_version=1\ncompose_project=yoleotard-crm\n')
            (original/'SHA256SUMS').write_text(''.join(archive.digest(original/n)+'  '+n+'\n' for n in ['postgres.dump','uploads.tar.gz']))
            archive.pack(original)
            storage = root/'storage'; (storage/'quarantine').mkdir(parents=True)
            worker = object.__new__(agent.Agent); worker.root = storage
            worker.event = lambda *args: None
            for index in range(5):
                uploaded = storage/'quarantine'/('upload-'+str(index)+'.tar.gz')
                uploaded.write_bytes((original/'archive.tar.gz').read_bytes())
                worker.fenced_update = lambda backup_id, fields: self.assertTrue(uploaded.exists()) or backup_id
                worker.execute(dict(id='import-sequential-'+str(index), type='DATA', metadata=dict(job=dict(kind='IMPORT_VERIFY'), quarantine=dict(file=uploaded.name, bytes=uploaded.stat().st_size, checksum=archive.digest(uploaded)))), 0)
                self.assertEqual(list((storage/'quarantine').iterdir()), [])

    def test_agent_completion_restores_manifest_version_columns(self):
        import backup_runtime as runtime
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); backup_id = 'backup-version-12345'; destination = root/backup_id; destination.mkdir()
            (destination/'postgres.dump').write_bytes(b'PGDMPsynthetic')
            with tarfile.open(destination/'uploads.tar.gz', 'w:gz'):
                pass
            runtime.atomic_json(destination/'manifest.json', dict(format_version=2, backup_id=backup_id, type='data', storage_provider='local',
                app_version='0.10.0', git_commit='a'*40, schema_version='migration48', database_version='16.15', files=['postgres.dump','uploads.tar.gz']))
            runtime.finalize(destination, root/'.quiescence.json')
            archive.pack(destination)
            worker = object.__new__(agent.Agent); worker.root = root; worker.config = dict(consistent=False)
            fields = []; worker.fenced_update = lambda bid, f: fields.append(f) or bid; worker.event = lambda *args: None
            worker.execute(dict(id=backup_id, type='DATA', metadata=dict(job=dict(kind='BACKUP'))), 0)
            for column, value in [('appVersion','0.10.0'),('gitCommit','a'*40),('databaseVersion','16.15'),('schemaVersion','migration48')]:
                self.assertIn('"'+column+'"', fields[0]); self.assertIn(value, fields[0])

    def test_v1_import_completes_as_data_without_rewriting_unsigned_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = root/'original'; original.mkdir()
            (original/'postgres.dump').write_bytes(b'PGDMPsynthetic')
            with tarfile.open(original/'uploads.tar.gz', 'w:gz') as tar:
                member = tarfile.TarInfo('probe.txt'); member.size = 3
                tar.addfile(member, io.BytesIO(b'abc'))
            legacy = b'format_version=1\ncompose_project=yoleotard-crm\n'
            (original/'manifest.txt').write_bytes(legacy)
            (original/'SHA256SUMS').write_text(''.join(hashlib.sha256((original/n).read_bytes()).hexdigest()+'  '+n+'\n' for n in ['postgres.dump','uploads.tar.gz']))
            archive.pack(original)
            storage = root/'storage'; (storage/'quarantine').mkdir(parents=True)
            uploaded = storage/'quarantine/legacy.tar.gz'; uploaded.write_bytes((original/'archive.tar.gz').read_bytes())
            worker = object.__new__(agent.Agent); worker.root = storage
            worker.fenced_update = lambda backup_id, fields: backup_id
            worker.event = lambda *args: None
            job_id = 'import-legacy-12345'
            worker.execute({'id':job_id,'type':'DATA','metadata':{'job':{'kind':'IMPORT_VERIFY'},'quarantine':{'file':uploaded.name,'bytes':str(uploaded.stat().st_size),'checksum':hashlib.sha256(uploaded.read_bytes()).hexdigest()}}}, 0)
            self.assertEqual((storage/job_id/'manifest.txt').read_bytes(), legacy)
            self.assertFalse((storage/job_id/'manifest.json').exists())
    def test_kyiv_schedule_slots_stable_after_due_and_across_dst_fold(self):
        config = dict(enabled=True, time='03:00', timezone='Europe/Kyiv', recovery=dict(
            weeklyFull=dict(enabled=True, dayOfWeek=0), monthlyDrill=dict(enabled=True, dayOfMonth=25,time='03:00')))
        early = agent.schedule_slots(config, dt.datetime(2026, 10, 25, 0, 30, tzinfo=dt.timezone.utc))
        late = agent.schedule_slots(config, dt.datetime(2026, 10, 25, 2, 30, tzinfo=dt.timezone.utc))
        self.assertEqual([x['id'] for x in early], [x['id'] for x in late])
        self.assertEqual([x['kind'] for x in late], ['BACKUP', 'BACKUP', 'DRILL'])
        self.assertEqual([x['type'] for x in late[:2]], ['DATA', 'FULL'])
        self.assertEqual(agent.schedule_slots(dict(enabled=False), dt.datetime.now(dt.timezone.utc)), [])

    def test_configuration_rejects_production_drill_project_and_missing_writer_attestation(self):
        with self.assertRaises(ValueError):
            agent.validate_config(dict(project='yoleotard-crm', storageRoot='/tmp/backups',
                                       consistent=True, writerServices=[]))


if __name__ == '__main__':
    unittest.main()
