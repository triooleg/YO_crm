import importlib.util
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
spec = importlib.util.spec_from_file_location('backup_agent_target', Path(__file__).resolve().parents[1]/'backup-agent.py')
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)
TARGET = 'target-backup-12345'


class TargetClaimTests(unittest.TestCase):
    def worker(self):
        worker = object.__new__(agent.Agent)
        worker.owner, worker.lease_seconds = 'a'*32, 180
        worker.sql = Mock(return_value=json.dumps({'id': TARGET}))
        return worker

    def test_claim_adds_exact_target_predicate_without_replacing_existing_fences(self):
        worker = self.worker()
        self.assertEqual(worker.claim(TARGET), {'id': TARGET})
        worker.sql.assert_called_once()
        query = worker.sql.call_args.args[0]
        candidate = query.split('UPDATE "Backup" SET', 1)[0]
        self.assertIn('AND id='+agent.literal(TARGET), candidate)
        self.assertIn("WHERE status='PENDING'", candidate)
        self.assertIn('"archivedAt" IS NULL', candidate)
        self.assertIn(agent.backup_lease.fence(worker.owner), candidate)
        self.assertIn("active.status IN ('RUNNING','VERIFYING','RESTORING')", candidate)
        self.assertIn("{job,nextAttemptAt}", candidate)
        self.assertIn('<=CURRENT_TIMESTAMP', candidate)
        self.assertIn('FOR UPDATE SKIP LOCKED LIMIT 1', candidate)

    def test_normal_and_targeted_claim_differ_only_by_exact_id_filter(self):
        worker = self.worker()
        worker.claim()
        normal = worker.sql.call_args.args[0]
        worker.claim(TARGET)
        targeted = worker.sql.call_args.args[0]
        self.assertEqual(targeted.replace(' AND id='+agent.literal(TARGET), '', 1), normal)

    def test_empty_target_claim_does_not_fall_back_to_unrelated_pending_job(self):
        worker = self.worker()
        worker.sql.return_value = ''
        self.assertIsNone(worker.claim(TARGET))
        worker.sql.assert_called_once()
        self.assertIn(' AND id='+agent.literal(TARGET), worker.sql.call_args.args[0])

    def test_invalid_targets_cannot_reach_sql_or_host_entrypoints(self):
        bad = ['', 'short', 'x'*129, '../backup-id', '/backup-id', 'backup/id', 'backup\\id',
               "backup-id' OR TRUE--", 'backup-id\n', 'backup-id\t', ' backup-id', 'backup-id ',
               'backup-id;DROP TABLE Backup', 'backup-кириллица', 123, {}, True]
        worker = self.worker()
        with patch.object(agent, 'host_lock') as lock, patch.object(agent.backup_lease, 'acquire') as acquire:
            for value in bad:
                for call in [lambda: worker.claim(value), lambda: worker.cycle(value), lambda: worker.locked_cycle(7, value)]:
                    with self.subTest(value=value), self.assertRaises(ValueError):
                        call()
            worker.sql.assert_not_called()
            lock.assert_not_called()
            acquire.assert_not_called()

    def test_safe_id_bounds_and_punctuation_are_quoted_exactly(self):
        worker = self.worker()
        for value in ['Ab0._-12', 'a'*128, TARGET]:
            worker.claim(value)
            self.assertIn(' AND id='+agent.literal(value), worker.sql.call_args.args[0])


class TargetCycleTests(unittest.TestCase):
    def worker(self, root, row=None):
        worker = object.__new__(agent.Agent)
        worker.root, worker.repo = root, root
        worker.config = dict(project='synthetic-backups', composeFile='synthetic.yml', envFile='synthetic.env',
                             chatwootConfig='synthetic-chatwoot.json', allowAutomaticRetention=True)
        worker.owner, worker.lease_seconds, worker.lease_lost = 'a'*32, 180, False
        worker.sql = Mock(return_value='')
        worker.public_heartbeat, worker.reconcile = Mock(), Mock()
        worker.schedule, worker.automatic_retention = Mock(), Mock()
        worker.claim = Mock(return_value=row)
        worker.execute, worker.event, worker.fenced_update = Mock(), Mock(), Mock()
        return worker

    def row(self, kind='BACKUP', attempts=1):
        return dict(id=TARGET, metadata=dict(job=dict(kind=kind, attempts=attempts)))

    def test_targeted_cycle_executes_only_requested_claim_without_schedule_or_retention(self):
        with tempfile.TemporaryDirectory() as folder:
            worker = self.worker(Path(folder), self.row())
            worker.locked_cycle(7, TARGET)
            worker.claim.assert_called_once_with(TARGET)
            worker.execute.assert_called_once_with(worker.claim.return_value, 7)
            worker.public_heartbeat.assert_called_once_with()
            worker.reconcile.assert_called_once_with()
            worker.schedule.assert_not_called()
            worker.automatic_retention.assert_not_called()

    def test_missing_ineligible_or_completed_target_never_executes_other_queue_work(self):
        with tempfile.TemporaryDirectory() as folder:
            worker = self.worker(Path(folder))
            worker.locked_cycle(7, TARGET)
            worker.claim.assert_called_once_with(TARGET)
            worker.execute.assert_not_called()
            worker.schedule.assert_not_called()
            worker.automatic_retention.assert_not_called()

    def test_unexpected_row_cannot_execute_under_a_targeted_grant(self):
        with tempfile.TemporaryDirectory() as folder:
            worker = self.worker(Path(folder), dict(self.row(), id='other-backup-12345'))
            with self.assertRaisesRegex(ValueError, 'another backup job'):
                worker.locked_cycle(7, TARGET)
            worker.execute.assert_not_called()
            worker.event.assert_not_called()

    def test_targeted_cycle_keeps_original_host_and_global_lease_sequence(self):
        with tempfile.TemporaryDirectory() as folder:
            worker = self.worker(Path(folder), self.row())
            order = []
            @contextlib.contextmanager
            def lock(root):
                self.assertEqual(root, worker.root)
                order.append('flock')
                yield 7
                order.append('unlock')
            worker.execute = lambda row, fd: order.append('execute')
            with patch.object(agent, 'host_lock', lock), \
                 patch.object(agent.backup_lease, 'acquire', side_effect=lambda *a: order.append('acquire') or True), \
                 patch.object(agent.backup_lease, 'release', side_effect=lambda *a: order.append('release')):
                worker.cycle(TARGET)
            self.assertEqual(order, ['flock', 'acquire', 'execute', 'release', 'unlock'])
            worker.claim.assert_called_once_with(TARGET)
            worker.schedule.assert_not_called()
            worker.automatic_retention.assert_not_called()

    def test_active_global_lease_or_host_flock_never_forced(self):
        with tempfile.TemporaryDirectory() as folder:
            worker = self.worker(Path(folder), self.row())
            with patch.object(agent, 'host_lock', return_value=contextlib.nullcontext(7)), \
                 patch.object(agent.backup_lease, 'acquire', return_value=False), \
                 patch.object(agent.backup_lease, 'release') as release:
                worker.cycle(TARGET)
            worker.claim.assert_not_called()
            worker.execute.assert_not_called()
            release.assert_not_called()
            with patch.object(agent, 'host_lock', side_effect=BlockingIOError('busy')), \
                 patch.object(agent.backup_lease, 'acquire') as acquire:
                with self.assertRaises(BlockingIOError):
                    worker.cycle(TARGET)
            acquire.assert_not_called()

    def test_targeted_failure_keeps_fenced_retry_policy_and_attempt_limit(self):
        for attempts, status in [(1, 'PENDING'), (2, 'PENDING'), (3, 'FAILED')]:
            with self.subTest(attempts=attempts), tempfile.TemporaryDirectory() as folder:
                worker = self.worker(Path(folder), self.row(attempts=attempts))
                worker.execute.side_effect = ValueError('synthetic capture failure')
                with self.assertRaisesRegex(ValueError, 'synthetic capture failure'):
                    worker.locked_cycle(7, TARGET)
                worker.fenced_update.assert_called_once()
                bid, fields = worker.fenced_update.call_args.args
                self.assertEqual(bid, TARGET)
                self.assertIn("status='"+status+"'", fields)
                self.assertIn('nextAttemptAt', fields)
                worker.automatic_retention.assert_not_called()

    def test_targeted_cycle_resumes_both_original_journals_before_reconcile_and_claim(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in ['.quiescence.json', '.chatwoot-quiescence.json']:
                (root/name).write_text('{}')
            worker = self.worker(root)
            order = []
            worker.public_heartbeat.side_effect = lambda: order.append('heartbeat')
            worker.reconcile.side_effect = lambda: order.append('reconcile')
            worker.claim.side_effect = lambda target: order.append('claim')
            def resume(command, **kwargs):
                order.append(Path(command[1]).name)
                self.assertIn('resume', command)
                self.assertEqual(kwargs['env']['BACKUP_EXECUTION_OWNER'], worker.owner)
                self.assertNotIn('BACKUP_JOB_ID', kwargs['env'])
            with patch.object(agent.subprocess, 'run', side_effect=resume):
                worker.locked_cycle(7, TARGET)
            self.assertEqual(order, ['backup_runtime.py', 'heartbeat', 'backup_chatwoot.py', 'reconcile', 'claim'])

    def test_targeted_cycle_keeps_global_and_public_heartbeat_renewal(self):
        with tempfile.TemporaryDirectory() as folder:
            worker = self.worker(Path(folder))
            callbacks = []
            class InlineThread:
                def __init__(self, target, **kwargs):
                    callbacks.append(target)
                def start(self):
                    pass
                def join(self, **kwargs):
                    pass
            def busy_job(fd, target):
                self.assertEqual((fd, target), (7, TARGET))
                callbacks[0]()
            worker.locked_cycle = busy_job
            with patch.object(agent, 'host_lock', return_value=contextlib.nullcontext(7)), \
                 patch.object(agent.backup_lease, 'acquire', return_value=True), \
                 patch.object(agent.backup_lease, 'heartbeat', return_value=True) as heartbeat, \
                 patch.object(agent.backup_lease, 'release') as release, \
                 patch.object(agent.threading, 'Thread', InlineThread), \
                 patch.object(agent.threading, 'Event') as event:
                event.return_value.wait.side_effect = [False, True]
                worker.cycle(TARGET)
            heartbeat.assert_called_once_with(worker.sql, worker.owner, worker.lease_seconds)
            worker.public_heartbeat.assert_called_once_with()
            release.assert_called_once_with(worker.sql, worker.owner)

    def test_targeted_execution_failure_still_releases_global_lease(self):
        with tempfile.TemporaryDirectory() as folder:
            worker = self.worker(Path(folder), self.row())
            worker.execute.side_effect = ValueError('synthetic capture failure')
            with patch.object(agent, 'host_lock', return_value=contextlib.nullcontext(7)), \
                 patch.object(agent.backup_lease, 'acquire', return_value=True), \
                 patch.object(agent.backup_lease, 'release') as release:
                with self.assertRaisesRegex(ValueError, 'synthetic capture failure'):
                    worker.cycle(TARGET)
            release.assert_called_once_with(worker.sql, worker.owner)
            worker.automatic_retention.assert_not_called()

    def test_normal_mode_keeps_no_argument_claim_and_retention_call_shapes(self):
        with tempfile.TemporaryDirectory() as folder:
            worker = self.worker(Path(folder))
            worker.claim = lambda: self.row()
            worker.locked_cycle(7)
            worker.schedule.assert_called_once_with()
            worker.execute.assert_called_once()
            worker.automatic_retention.assert_called_once_with()


class TargetCliTests(unittest.TestCase):
    def invoke(self, argv):
        with patch.object(sys, 'argv', ['backup-agent.py', '--config', 'synthetic.json', *argv]), \
             contextlib.redirect_stderr(io.StringIO()):
            return agent.main()

    def test_cli_rejects_invalid_id_or_target_without_once_before_config_or_host_operations(self):
        with patch.object(agent, 'read_json') as read, patch.object(agent, 'Agent') as constructor, \
             patch.object(agent.os, 'umask') as umask:
            for argv in [['--job-id', TARGET], ['--once', '--job-id', "backup-id' OR TRUE--"], ['--once', '--job-id', 'short']]:
                with self.subTest(argv=argv), self.assertRaises(SystemExit) as raised:
                    self.invoke(argv)
                self.assertEqual(raised.exception.code, 2)
            read.assert_not_called()
            constructor.assert_not_called()
            umask.assert_not_called()

    def test_once_cli_passes_only_explicit_target_and_normal_once_keeps_no_argument_cycle(self):
        with patch.object(agent, 'read_json', return_value={}), patch.object(agent, 'Agent') as constructor, \
             patch.object(agent.os, 'umask'):
            self.invoke(['--once', '--job-id', TARGET])
            constructor.return_value.cycle.assert_called_once_with(TARGET)
            constructor.return_value.cycle.reset_mock()
            self.invoke(['--once'])
            constructor.return_value.cycle.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
