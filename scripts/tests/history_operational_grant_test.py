import datetime as dt
import base64
import hashlib
import json
import io
from contextlib import redirect_stdout, redirect_stderr
import tempfile
import os
import subprocess
import sys
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import history_operational_grant as grants

NOW = dt.datetime(2026, 11, 1, 12, tzinfo=dt.timezone.utc)
GRANT_ID = '72adefd1-0486-4ef7-b550-a1837019e350'

def context():
    return dict(jobId='0bdbec47-6703-4cfb-82a6-ad8cce42da95', actorId='owner', clientId='existing-client',
                sourceDigest='a'*64, previewDigest='b'*64, candidateSnapshot='c'*64,
                targetIdentity=dict(cluster='1234567890123456789', databaseName='crm', databaseOid=16384),
                migrationSetDigest='d'*64)

def evidence():
    return dict(backupId='20261101T110000Z-pilot', captureStartedAt='2026-11-01T11:00:00.000000+00:00',
                manifestSha256='e'*64, sha256sumsSha256='f'*64, archiveSha256='1'*64, archiveBytes='461463006',
                drillJobId='api-drill-synthetic', drillReportSha256='2'*64,
                drillFinishedAt='2026-11-01T11:10:00.000000+00:00')

def prepared():
    return grants.build_grant_payload(grants._record_verified_run(context(), evidence()), now=NOW, grant_id=GRANT_ID)

def synthetic_ciphertext():
    # Structural ciphertext fixture only; no claim of encryption/runtime sealing.
    encode = lambda b: base64.urlsafe_b64encode(b).rstrip(b'=').decode('ascii')
    return ('v1.'+encode(b'i'*12)+'.'+encode(b'not-a-real-sealed-payload')+'.'+encode(b't'*16)).encode('ascii')

class GrantPayloadTests(unittest.TestCase):
    def test_issuance_floors_only_issued_at_without_extending_capture_expiry_or_accepting_future_drill(self):
        clock = NOW.replace(microsecond=123999)
        facts = evidence()
        run = grants._record_verified_run(context(), facts)
        payload = grants.build_grant_payload(run, now=clock, grant_id=GRANT_ID).payload
        self.assertEqual(payload['issuedAt'], '2026-11-01T12:00:00.123000+00:00')
        self.assertEqual(payload['expiresAt'], '2026-11-01T12:10:00.123999+00:00')
        self.assertEqual(payload['captureStartedAt'], facts['captureStartedAt'])
        # Never move a drill timestamp backwards to manufacture valid ordering.
        facts['drillFinishedAt'] = '2026-11-01T12:00:00.123500+00:00'
        with self.assertRaises(grants.GrantError):
            grants.build_grant_payload(grants._record_verified_run(context(), facts), now=clock)
        facts['drillFinishedAt'] = '2026-11-01T12:00:00.124000+00:00'
        with self.assertRaises(grants.GrantError):
            grants.build_grant_payload(grants._record_verified_run(context(), facts), now=clock)

    def test_builds_detached_strict_payload_only_from_registered_owned_run(self):
        ctx, facts = context(), evidence()
        run = grants._record_verified_run(ctx, facts)
        prepared = grants.build_grant_payload(run, now=NOW, grant_id=GRANT_ID)
        expected = dict(**ctx, **facts, version=1, purpose='OPERATIONAL_NATIVE_BACKUP_GRANT_V1',
                        grantId=GRANT_ID, issuedAt='2026-11-01T12:00:00.000000+00:00',
                        expiresAt='2026-11-01T12:10:00.000000+00:00')
        self.assertEqual(prepared.payload, expected)
        ctx['targetIdentity']['databaseName'] = 'tampered'
        facts['archiveBytes'] = '1'
        output = prepared.payload; output['clientId'] = 'another'
        self.assertEqual(prepared.payload['targetIdentity']['databaseName'], 'crm')
        self.assertEqual(prepared.payload['archiveBytes'], '461463006')
        self.assertEqual(prepared.payload['clientId'], 'existing-client')
        self.assertEqual(len(expected), 22)
        self.assertEqual(len(grants.CONTEXT_KEYS), 8)
        self.assertEqual(len(grants.EVIDENCE_KEYS), 9)

    def test_raw_or_forged_reports_are_not_run_capabilities(self):
        for value in (None, {}, dict(verified=True, drillPassed=True), context(), evidence(), object.__new__(grants.VerifiedRun)):
            with self.subTest(value=type(value).__name__), self.assertRaises(grants.GrantError):
                grants.build_grant_payload(value, now=NOW)
        with self.assertRaises(grants.GrantError):
            grants.VerifiedRun()
        with self.assertRaises(grants.GrantError):
            grants.PreparedGrant()

    def test_runner_facts_have_exact_keys_types_and_digests(self):
        for target, changes in ((context, [('jobId', '../bad'), ('actorId', ''), ('clientId', 'a\n'),
                                         ('sourceDigest', 'A'*64), ('previewDigest', 'bad'), ('extra', True)]),
                                (evidence, [('archiveBytes', 123), ('archiveBytes', '0'), ('archiveBytes', '01'),
                                            ('archiveBytes', '18446744073709551616'), ('backupId', '../source'),
                                            ('drillJobId', 'https://bad'), ('archiveSha256', 'bad'), ('passed', True)])):
            for key, value in changes:
                changed = target(); changed[key] = value
                with self.subTest(key=key, value=value), self.assertRaises(grants.GrantError):
                    grants._record_verified_run(changed if target is context else context(), changed if target is evidence else evidence())
            for key in target():
                changed = target(); del changed[key]
                with self.subTest(missing=key), self.assertRaises(grants.GrantError):
                    grants._record_verified_run(changed if target is context else context(), changed if target is evidence else evidence())
        for key, value in [('cluster', '0'), ('databaseOid', True), ('databaseOid', 4294967296), ('extra', 'bad')]:
            changed = context(); changed['targetIdentity'][key] = value
            with self.assertRaises(grants.GrantError):
                grants._record_verified_run(changed, evidence())

    def test_capture_clock_age_and_expiry_are_conservative(self):
        run = grants._record_verified_run(context(), evidence())
        for current in (NOW-dt.timedelta(hours=2), NOW+dt.timedelta(hours=1), NOW.replace(tzinfo=None)):
            with self.subTest(current=current), self.assertRaises(grants.GrantError):
                grants.build_grant_payload(run, now=current)
        for limit in (True, 0, -1, 7201, float('nan'), float('inf'), '600'):
            with self.subTest(limit=limit), self.assertRaises(grants.GrantError):
                grants.build_grant_payload(run, now=NOW, lifetime_seconds=limit)
        near_expiry = grants.build_grant_payload(run, now=NOW+dt.timedelta(minutes=59, seconds=59), lifetime_seconds=600)
        self.assertEqual(near_expiry.payload['expiresAt'], '2026-11-01T13:00:00.000000+00:00')
        for value in ('2026-11-01', '2026-11-01T11:00:00', '2026-02-30T11:00:00Z', '2026-11-01T25:00:00Z', '2026-11-01T11:00:00+25:00', None, 0):
            facts = evidence(); facts['captureStartedAt'] = value
            with self.subTest(value=value), self.assertRaises(grants.GrantError):
                grants._record_verified_run(context(), facts)

    def test_grant_id_is_generated_internally_and_never_a_path(self):
        run = grants._record_verified_run(context(), evidence())
        first, second = grants.build_grant_payload(run, now=NOW), grants.build_grant_payload(run, now=NOW)
        self.assertNotEqual(first.payload['grantId'], second.payload['grantId'])
        for value in ('../bad', 'file:///tmp/a', '', False):
            with self.assertRaises(grants.GrantError):
                grants.build_grant_payload(run, now=NOW, grant_id=value)

@unittest.skipUnless(os.name == 'nt' or os.geteuid() == 0, 'Root-owned POSIX host fixture required')
class GrantPublicationTests(unittest.TestCase):
    def test_publishes_exact_sealed_bytes_without_overwriting_existing_grant(self):
        with tempfile.TemporaryDirectory(prefix='host-grant-') as root:
            publisher = grants.AtomicGrantPublisher(Path(root))
            ciphertext = synthetic_ciphertext()
            result = publisher.publish(prepared(), ciphertext, now=NOW)
            target = Path(root)/(GRANT_ID+'.grant')
            self.assertEqual(target.read_bytes(), ciphertext)
            self.assertEqual(result, dict(grantId=GRANT_ID, ciphertextSha256=hashlib.sha256(ciphertext).hexdigest(), bytes=len(ciphertext)))
            self.assertEqual(target.stat().st_nlink, 1)
            with self.assertRaises(FileExistsError):
                publisher.publish(prepared(), ciphertext, now=NOW)
            self.assertEqual(target.read_bytes(), ciphertext)
            self.assertEqual([p.name for p in Path(root).iterdir()], [GRANT_ID+'.grant'])

    def test_invalid_sealed_inputs_or_forged_preparation_cannot_publish(self):
        with tempfile.TemporaryDirectory(prefix='host-grant-') as root:
            publisher = grants.AtomicGrantPublisher(Path(root))
            for invalid in (b'', b'a'*65537, b'{}', b'v1.invalid.body.tag', synthetic_ciphertext()+b'.extra', 'not bytes'):
                with self.subTest(value=type(invalid).__name__), self.assertRaises(grants.GrantError):
                    publisher.publish(prepared(), invalid, now=NOW)
            for invalid in ({'grantId': GRANT_ID}, prepared().payload, object.__new__(grants.PreparedGrant)):
                with self.assertRaises(grants.GrantError):
                    publisher.publish(invalid, synthetic_ciphertext(), now=NOW)
            self.assertEqual(list(Path(root).iterdir()), [])

    def test_partial_write_failure_cleans_only_own_temp_and_never_publishes(self):
        with tempfile.TemporaryDirectory(prefix='host-grant-') as root:
            sentinel = Path(root)/'unrelated'; sentinel.write_bytes(b'preserve')
            publisher = grants.AtomicGrantPublisher(Path(root))
            for failure in (OSError('synthetic write failure'), 0):
                kwargs = {'side_effect': failure} if isinstance(failure, Exception) else {'return_value': failure}
                with patch.object(grants.os, 'write', **kwargs), self.assertRaises((OSError, grants.GrantError)):
                    publisher.publish(prepared(), synthetic_ciphertext(), now=NOW)
                self.assertEqual([p.name for p in Path(root).iterdir()], ['unrelated'])
                self.assertEqual(sentinel.read_bytes(), b'preserve')

    def test_replaced_final_is_refused_without_deleting_the_foreign_replacement(self):
        with tempfile.TemporaryDirectory(prefix='host-grant-') as root:
            publisher = grants.AtomicGrantPublisher(Path(root)); original_link = grants.os.link
            ciphertext = synthetic_ciphertext(); foreign = b'x'*len(ciphertext)
            target = Path(root)/(GRANT_ID+'.grant')
            def replace_after_link(*args, **kwargs):
                original_link(*args, **kwargs)
                target.unlink(); target.write_bytes(foreign)
            with patch.object(grants.os, 'link', side_effect=replace_after_link), self.assertRaises(grants.GrantError):
                publisher.publish(prepared(), ciphertext, now=NOW)
            self.assertEqual(target.read_bytes(), foreign)
            self.assertEqual(len(list(Path(root).iterdir())), 1)

    def test_no_traversal_or_relative_config_and_no_implicit_directory_creation(self):
        for path in ('relative', '.', 'https://example.test/grants', '//remote/grants'):
            with self.subTest(path=path), self.assertRaises(grants.GrantError):
                grants.AtomicGrantPublisher(path)
        with tempfile.TemporaryDirectory(prefix='host-grant-') as parent:
            root = Path(parent)/'missing'
            with self.assertRaises(FileNotFoundError):
                grants.AtomicGrantPublisher(root).publish(prepared(), synthetic_ciphertext(), now=NOW)
            self.assertFalse(root.exists())

    def test_linked_root_and_existing_linked_destination_are_not_followed(self):
        with tempfile.TemporaryDirectory(prefix='host-grant-') as parent:
            real, alias = Path(parent)/'real', Path(parent)/'alias'; real.mkdir()
            if os.name == 'nt':
                subprocess.run(['cmd', '/c', 'mklink', '/J', str(alias), str(real)], check=True,
                               capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
            else:
                alias.symlink_to(real, target_is_directory=True)
            with self.assertRaises(grants.GrantError):
                grants.AtomicGrantPublisher(alias).publish(prepared(), synthetic_ciphertext(), now=NOW)
            self.assertEqual(list(real.iterdir()), [])
            # A final pathname occupied by a directory is never overwritten.
            (real/(GRANT_ID+'.grant')).mkdir()
            with self.assertRaises(FileExistsError):
                grants.AtomicGrantPublisher(real).publish(prepared(), synthetic_ciphertext(), now=NOW)
            self.assertTrue((real/(GRANT_ID+'.grant')).is_dir())
            self.assertEqual(len(list(real.iterdir())), 1)

    def test_expired_preparation_or_future_clock_cannot_publish(self):
        with tempfile.TemporaryDirectory(prefix='host-grant-') as root:
            for current in (NOW-dt.timedelta(microseconds=1), NOW+dt.timedelta(minutes=10), NOW+dt.timedelta(hours=2)):
                with self.subTest(current=current), self.assertRaises(grants.GrantError):
                    grants.AtomicGrantPublisher(Path(root)).publish(prepared(), synthetic_ciphertext(), now=current)
            self.assertEqual(list(Path(root).iterdir()), [])

class CLIInputTests(unittest.TestCase):
    def test_entrypoint_rejects_caller_contexts_reports_and_paths_except_config(self):
        result = subprocess.run([sys.executable, '-B', str(Path(grants.__file__)), '--context', '{}', '--report', '{}'],
                                capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stderr.strip(), 'Operational backup grant issuance failed')
        self.assertEqual(result.stdout, '')
        self.assertFalse(grants.ISSUER_READY)

class FakeClock:
    def __init__(self):
        self.value = NOW
        self.elapsed = 0

    def utcnow(self):
        return self.value

    def monotonic(self):
        return self.elapsed

    def advance(self, seconds):
        self.value += dt.timedelta(seconds=seconds); self.elapsed += seconds

class FakeWire:
    def __init__(self, clock):
        self.clock = clock; self.operations = []; self.agent_calls = []
        self.backup_id = 'owned-data-backup'; self.drill_id = 'owned-isolated-drill'
        self.backup_status = 'PENDING'; self.drill_status = 'PENDING'; self.drill_created = False
        self.capture_started = None; self.sealed_payload = None

    def operation(self, operation, job_id, payload=None, grant_id=None, timeout=None):
        self.operations.append(operation)
        if operation == 'PREPARED_CONTEXT':
            return dict(context=context(), preview={'ready': 230, 'deferred': 7}, preparationDigest='3'*64)
        if operation == 'QUEUE_DATA':
            self.capture_started = self.clock.utcnow().isoformat(timespec='microseconds')
            return dict(backupId=self.backup_id, captureStartedAt=self.capture_started,
                        context=context(), preparationDigest='3'*64)
        if operation == 'QUEUE_DRILL':
            self.drill_created = True
            return dict(backupId=self.backup_id, drillJobId=self.drill_id)
        if operation == 'CAPTURE_STATUS':
            return dict(backupId=self.backup_id, backupStatus=self.backup_status,
                        drillJobId=self.drill_id if self.drill_created else None,
                        drillStatus=self.drill_status if self.drill_created else None)
        if operation == 'VERIFY_EVIDENCE':
            facts = evidence(); facts.update(backupId=self.backup_id, drillJobId=self.drill_id,
                captureStartedAt=self.capture_started, drillFinishedAt=self.clock.utcnow().isoformat(timespec='microseconds'))
            return dict(context=context(), evidence=facts)
        if operation == 'SEAL_GRANT':
            self.sealed_payload = payload
            ciphertext = synthetic_ciphertext()
            return dict(grantId=payload['grantId'], ciphertext=ciphertext.decode('ascii'), digest=hashlib.sha256(ciphertext).hexdigest())
        if operation == 'RECORD_GRANT':
            return dict(grantId=grant_id, expiresAt=self.sealed_payload['expiresAt'])
        raise AssertionError(operation)

    def run_target(self, job_id, timeout=None):
        self.agent_calls.append(job_id); self.clock.advance(1)
        if job_id == self.backup_id:
            self.backup_status = 'COMPLETED'
        elif job_id == self.drill_id:
            self.drill_status = 'COMPLETED'
        else:
            raise AssertionError('Unrelated job claimed')

class FakePublisher:
    def __init__(self):
        self.calls = []

    def publish(self, prepared, ciphertext, *, now=None):
        self.calls.append((prepared.payload, ciphertext))
        return dict(grantId=prepared.payload['grantId'], ciphertextSha256=hashlib.sha256(ciphertext).hexdigest(), bytes=len(ciphertext))

class OrchestrationTests(unittest.TestCase):
    def setup_issuer(self, **limits):
        clock = FakeClock(); wire = FakeWire(clock); publisher = FakePublisher()
        issuer = grants.IssueOrchestrator(wire, wire, publisher, clock=clock.utcnow,
            monotonic=clock.monotonic, sleep=clock.advance, **limits)
        return clock, wire, publisher, issuer

    def test_executes_only_its_data_then_drill_and_publishes_verified_sealed_payload(self):
        clock = FakeClock(); wire = FakeWire(clock); publisher = FakePublisher()
        issuer = grants.IssueOrchestrator(wire, wire, publisher, clock=clock.utcnow, monotonic=clock.monotonic, sleep=clock.advance)
        result = issuer.issue(context()['jobId'])
        self.assertEqual(wire.agent_calls, [wire.backup_id, wire.drill_id])
        self.assertEqual(wire.operations, ['PREPARED_CONTEXT', 'QUEUE_DATA', 'CAPTURE_STATUS', 'CAPTURE_STATUS',
            'QUEUE_DRILL', 'CAPTURE_STATUS', 'CAPTURE_STATUS', 'VERIFY_EVIDENCE', 'PREPARED_CONTEXT', 'SEAL_GRANT', 'RECORD_GRANT'])
        self.assertEqual(len(publisher.calls), 1)
        self.assertEqual(publisher.calls[0][0], wire.sealed_payload)
        self.assertEqual(result['grantId'], wire.sealed_payload['grantId'])

    def test_completed_owned_jobs_are_not_run_again(self):
        _, wire, publisher, issuer = self.setup_issuer()
        wire.backup_status = wire.drill_status = 'COMPLETED'
        issuer.issue(context()['jobId'])
        self.assertEqual(wire.agent_calls, [])
        self.assertEqual(len(publisher.calls), 1)

    def test_restart_reuses_only_same_preparation_completed_backup_with_original_capture_clock(self):
        _, wire, publisher, issuer = self.setup_issuer(); original = wire.operation
        wire.backup_status = wire.drill_status = 'COMPLETED'
        def old_completed(name, *args, **kwargs):
            result = original(name, *args, **kwargs)
            if name == 'QUEUE_DATA':
                wire.capture_started = (NOW-dt.timedelta(minutes=10)).isoformat(timespec='microseconds')
                result['captureStartedAt'] = wire.capture_started
            return result
        wire.operation = old_completed
        issuer.issue(context()['jobId'])
        self.assertEqual(wire.agent_calls, [])
        self.assertEqual(publisher.calls[0][0]['captureStartedAt'], '2026-11-01T11:50:00.000000+00:00')

    def test_context_preparation_ids_clock_and_seal_drift_never_publish(self):
        mutations = [
            ('QUEUE_DATA', lambda r:r['context'].update(clientId='different')),
            ('QUEUE_DATA', lambda r:r.update(preparationDigest='4'*64)),
            ('QUEUE_DATA', lambda r:r.update(captureStartedAt='2026-11-01T12:00:01Z')),
            ('CAPTURE_STATUS', lambda r:r.update(backupId='some-other-backup')),
            ('CAPTURE_STATUS', lambda r:r.update(error='private body must not be accepted')),
            ('QUEUE_DRILL', lambda r:r.update(backupId='some-other-backup')),
            ('VERIFY_EVIDENCE', lambda r:r['context'].update(candidateSnapshot='4'*64)),
            ('VERIFY_EVIDENCE', lambda r:r['evidence'].update(archiveSha256='bad')),
            ('VERIFY_EVIDENCE', lambda r:r['evidence'].update(backupId='some-other-backup')),
            ('VERIFY_EVIDENCE', lambda r:r['evidence'].update(drillJobId='some-other-drill')),
            ('VERIFY_EVIDENCE', lambda r:r['evidence'].update(captureStartedAt='2026-11-01T11:59:59Z')),
            ('SEAL_GRANT', lambda r:r.update(digest='4'*64)),
            ('SEAL_GRANT', lambda r:r.update(grantId=context()['jobId'])),
            ('SEAL_GRANT', lambda r:r.update(ciphertext='{}')),
        ]
        for operation, mutate in mutations:
            _, wire, publisher, issuer = self.setup_issuer()
            original = wire.operation
            def altered(name, *args, **kwargs):
                result = original(name, *args, **kwargs)
                if name == operation:
                    mutate(result)
                return result
            wire.operation = altered
            with self.subTest(operation=operation), self.assertRaises(grants.GrantError):
                issuer.issue(context()['jobId'])
            self.assertEqual(publisher.calls, [])
            self.assertNotIn('RECORD_GRANT', wire.operations)

    def test_fresh_preparation_is_checked_again_after_physical_verification(self):
        _, wire, publisher, issuer = self.setup_issuer(); original = wire.operation
        def changed(name, *args, **kwargs):
            value = original(name, *args, **kwargs)
            if name == 'PREPARED_CONTEXT' and wire.operations.count(name) == 2:
                value['preparationDigest'] = '4'*64
            return value
        wire.operation = changed
        with self.assertRaises(grants.GrantError):
            issuer.issue(context()['jobId'])
        self.assertEqual(publisher.calls, [])

    def test_agent_lease_failure_partial_backoff_and_failed_targets_never_publish(self):
        for failure in ('lease', 'partial', 'backoff', 'FAILED'):
            _, wire, publisher, issuer = self.setup_issuer()
            def failed_target(job_id, timeout=None):
                wire.agent_calls.append(job_id)
                if failure == 'lease':
                    raise grants.GrantError('Lease denied')
                wire.backup_status = 'FAILED' if failure == 'FAILED' else 'PENDING'
            wire.run_target = failed_target
            with self.subTest(failure=failure), self.assertRaises(grants.GrantError):
                issuer.issue(context()['jobId'])
            self.assertEqual(wire.agent_calls, [wire.backup_id])
            self.assertEqual(publisher.calls, [])
            self.assertNotIn('QUEUE_DRILL', wire.operations)

    def test_running_target_is_polled_boundedly_without_claiming_another_job(self):
        _, wire, publisher, issuer = self.setup_issuer(max_polls=3)
        wire.backup_status = 'RUNNING'
        with self.assertRaises(grants.GrantError):
            issuer.issue(context()['jobId'])
        self.assertEqual(wire.operations.count('CAPTURE_STATUS'), 3)
        self.assertEqual(wire.agent_calls, [])
        self.assertEqual(publisher.calls, [])

    def test_wall_deadline_never_continues_to_drill_or_publish(self):
        clock, wire, publisher, issuer = self.setup_issuer(max_seconds=5)
        original = wire.run_target
        def delayed(*args, **kwargs):
            original(*args, **kwargs); clock.advance(6)
        wire.run_target = delayed
        with self.assertRaises(grants.GrantError):
            issuer.issue(context()['jobId'])
        self.assertEqual(publisher.calls, [])
        self.assertNotIn('QUEUE_DRILL', wire.operations)

    def test_publisher_failure_prevents_record_operation(self):
        _, wire, publisher, issuer = self.setup_issuer()
        publisher.publish = lambda *args, **kwargs: (_ for _ in ()).throw(grants.GrantError('write failed'))
        with self.assertRaises(grants.GrantError):
            issuer.issue(context()['jobId'])
        self.assertNotIn('RECORD_GRANT', wire.operations)

    @unittest.skipUnless(os.name == 'nt' or os.geteuid() == 0, 'Root-owned POSIX host fixture required')
    def test_record_readonly_mount_failure_leaves_valid_published_file_intact(self):
        clock = FakeClock(); wire = FakeWire(clock); original = wire.operation
        def failed_record(name, *args, **kwargs):
            if name == 'RECORD_GRANT':
                wire.operations.append(name); raise grants.GrantError('API read-only mount unavailable')
            return original(name, *args, **kwargs)
        wire.operation = failed_record
        with tempfile.TemporaryDirectory(prefix='host-wire-record-') as root:
            issuer = grants.IssueOrchestrator(wire, wire, grants.AtomicGrantPublisher(Path(root)),
                clock=clock.utcnow, monotonic=clock.monotonic, sleep=clock.advance)
            with self.assertRaises(grants.GrantError):
                issuer.issue(context()['jobId'])
            files = list(Path(root).iterdir())
            self.assertEqual(len(files), 1)
            self.assertEqual(files[0].read_bytes(), synthetic_ciphertext())
            self.assertEqual(files[0].name, wire.sealed_payload['grantId']+'.grant')

class HostTransportTests(unittest.TestCase):
    def test_uses_only_fixed_linux_api_cli_and_targeted_agent_arguments(self):
        with tempfile.TemporaryDirectory(prefix='host-wire-') as root:
            cfg = dict(project='yoleotard-crm', repositoryRoot=root,
                       envFile=str(Path(root)/'.env'), composeFile=str(Path(root)/'compose.json'),
                       historyOperationalGrantsRoot=str(Path(root)/'grants'))
            calls = []
            def node_run(args, **kwargs):
                calls.append((args, kwargs))
                return SimpleNamespace(returncode=0, stdout=b'{"ok":true,"result":{"safe":true}}')
            def agent_start(args, **kwargs):
                calls.append((args, kwargs))
                return SimpleNamespace(wait=lambda timeout: 0)
            commands = grants.HostCommands(Path(root)/'agent.json', cfg, node_run=node_run, agent_start=agent_start)
            with patch.dict(os.environ, SETTINGS_ENCRYPTION_KEY='must-stay-in-api-runtime', HISTORY_OPERATIONAL_HOST_ENABLED='true'):
                self.assertEqual(commands.operation('PREPARED_CONTEXT', context()['jobId'], timeout=30), {'safe': True})
            args, options = calls[0]
            self.assertEqual(args[-11:], ['exec', '-T', '--user', '0', '--workdir', '/app/apps/api',
                '-e', 'HISTORY_OPERATIONAL_HOST_ENABLED=true', 'api', 'node', 'dist/history-migration/history-host-cli.js'])
            self.assertNotIn('HISTORY_OPERATIONAL_HOST_ENABLED', options['env'])
            self.assertNotIn('SETTINGS_ENCRYPTION_KEY', options['env'])
            self.assertEqual(json.loads(options['input']), {'operation':'PREPARED_CONTEXT', 'jobId':context()['jobId']})
            commands.run_target('owned-data-backup', timeout=30)
            args, options = calls[1]
            self.assertEqual(args[-5:], ['--config', str(Path(root)/'agent.json'), '--once', '--job-id', 'owned-data-backup'])
            self.assertNotIn('input', options)

    def config(self, root):
        return dict(project='yoleotard-crm', repositoryRoot=root, envFile=str(Path(root)/'.env'),
            composeFile=str(Path(root)/'compose.json'), historyOperationalGrantsRoot=str(Path(root)/'grants'))

    def test_wire_envelope_is_exact_one_bounded_json_without_duplicates_or_false_ok(self):
        failures = [b'log line\n{"ok":true,"result":{}}', b'{"ok":true,"result":{}} {}',
            b'{"ok":false,"result":{}}', b'{"ok":1,"result":{}}', b'{"ok":true,"result":{},"error":"private"}',
            b'{"ok":true,"ok":true,"result":{}}', b'{"ok":true,"result":{"x":NaN}}', b'{"ok":true,"result":{"x":1e309}}',
            b'{"ok":true,"result":null}', b'x'*(grants.MAX_WIRE_BYTES+1)]
        with tempfile.TemporaryDirectory(prefix='host-wire-') as root:
            for output in failures:
                commands = grants.HostCommands(Path(root)/'agent.json', self.config(root),
                    node_run=lambda *args, **kwargs:SimpleNamespace(returncode=0, stdout=output))
                with self.subTest(output=output[:40]), self.assertRaises(grants.GrantError):
                    commands.operation('CAPTURE_STATUS', context()['jobId'])

    def test_payload_is_only_for_seal_and_grant_id_only_for_record(self):
        with tempfile.TemporaryDirectory(prefix='host-wire-') as root:
            calls = []
            commands = grants.HostCommands(Path(root)/'agent.json', self.config(root),
                node_run=lambda *args, **kwargs:calls.append(kwargs) or SimpleNamespace(returncode=0, stdout=b'{"ok":true,"result":{}}'))
            for operation, kwargs in [('PREPARED_CONTEXT', {'payload':{}}), ('SEAL_GRANT', {}),
                                     ('RECORD_GRANT', {}), ('QUEUE_DATA', {'grant_id':GRANT_ID})]:
                with self.assertRaises(grants.GrantError):
                    commands.operation(operation, context()['jobId'], **kwargs)
            self.assertEqual(calls, [])
            commands.operation('RECORD_GRANT', context()['jobId'], grant_id=GRANT_ID)
            self.assertEqual(json.loads(calls[0]['input']), dict(operation='RECORD_GRANT', jobId=context()['jobId'], grantId=GRANT_ID))

    def test_worker_timeout_never_kills_a_possible_writer_pause_owner(self):
        with tempfile.TemporaryDirectory(prefix='host-wire-') as root:
            killed = []
            worker = SimpleNamespace(wait=lambda timeout:(_ for _ in ()).throw(subprocess.TimeoutExpired('agent', timeout)),
                kill=lambda:killed.append(True))
            commands = grants.HostCommands(Path(root)/'agent.json', self.config(root), agent_start=lambda *args, **kwargs:worker)
            with self.assertRaises(grants.GrantError):
                commands.run_target('owned-data-backup', timeout=1)
            self.assertEqual(killed, [])

class MainOutputTests(unittest.TestCase):
    def run_main(self, wire, publisher):
        wire.grants_root = Path(tempfile.gettempdir())
        out, err = io.StringIO(), io.StringIO()
        clock = wire.clock
        real_orchestrator = grants.IssueOrchestrator
        def construct(backend, runner, pub):
            return real_orchestrator(backend, runner, pub, clock=clock.utcnow, monotonic=clock.monotonic, sleep=clock.advance)
        with patch.object(grants.sys, 'platform', 'linux'), patch.object(grants.os, 'geteuid', return_value=0, create=True), \
             patch.object(grants, '_load_host_config', return_value={}), patch.object(grants, 'HostCommands', return_value=wire), \
             patch.object(grants, '_root_snapshot', return_value=[]), patch.object(grants, 'AtomicGrantPublisher', return_value=publisher), \
             patch.object(grants, 'IssueOrchestrator', side_effect=construct), redirect_stdout(out), redirect_stderr(err):
            result = grants.main(['--config', '/private/existing-agent.json', '--job-id', context()['jobId']])
        return result, out.getvalue(), err.getvalue()

    def test_success_stdout_is_one_sanitized_json_envelope(self):
        wire = FakeWire(FakeClock()); publisher = FakePublisher()
        code, out, err = self.run_main(wire, publisher)
        self.assertEqual(code, 0); self.assertEqual(err, ''); self.assertEqual(len(out.splitlines()), 1)
        value = json.loads(out)
        self.assertEqual(set(value), {'ok','result'}); self.assertIs(value['ok'], True)
        self.assertEqual(set(value['result']), {'grantId','ciphertextSha256','bytes','expiresAt'})
        self.assertNotIn('owner', out); self.assertNotIn('ciphertext"', out)

    def test_failure_stderr_is_generic_and_no_private_stdout(self):
        wire = FakeWire(FakeClock()); publisher = FakePublisher()
        wire.operation = lambda *args, **kwargs:(_ for _ in ()).throw(ValueError('private-token-and-source-body'))
        code, out, err = self.run_main(wire, publisher)
        self.assertEqual(code, 1); self.assertEqual(out, '')
        self.assertEqual(err, 'Operational backup grant issuance failed\n')
        self.assertEqual(publisher.calls, [])

if __name__ == '__main__':
    unittest.main(verbosity=2)
