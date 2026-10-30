import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch, Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
spec=importlib.util.spec_from_file_location('backup_maintenance',Path(__file__).resolve().parents[1]/'backup-maintenance.py')
maintenance=importlib.util.module_from_spec(spec)
spec.loader.exec_module(maintenance)
from backup_archive import digest


def backup_fixture(root):
    for number in range(6):
        path=root/('backup-1234567'+str(number))
        path.mkdir()
        (path/'postgres.dump').write_bytes(b'PGDMPtest')
        with tarfile.open(path/'uploads.tar.gz','w:gz') as tar:
            info=tarfile.TarInfo('a.txt');info.size=3;tar.addfile(info,io.BytesIO(b'abc'))
        manifest=dict(format_version=2,backup_id=path.name,type='full' if number==0 else 'data',
                      app_version='1',git_commit='a'*40,schema_version='migration',database_version='16',
                      storage_provider='local',files=['postgres.dump','uploads.tar.gz'],created_at=f'2026102{number}T000000Z')
        (path/'manifest.json').write_text(json.dumps(manifest))
        (path/'SHA256SUMS').write_text(''.join(digest(path/n)+'  '+n+'\n' for n in manifest['files']+['manifest.json']))
        (path/'.backup-owner').write_text(json.dumps(dict(owner='yo-backup-engine',backupId=path.name)))
        (path/'verification.json').write_text(json.dumps(dict(checksum=digest(path/'manifest.json'),verifiedAt=f'2026-10-2{number}T00:00:00Z')))
        if number in (1, 4):
            (path/'drill-report.json').write_text(json.dumps(dict(status='PASS', finishedAt=f'2026-10-2{number}T00:00:00Z',
                references=dict(sourceStoragePath=path.name, sourceChecksum=digest(path/'manifest.json'), sourceArtifactChecksum=digest(path/'SHA256SUMS')))))
    foreign=root/'production-storage';foreign.mkdir();(foreign/'data').write_text('preserve')


class RetentionTests(unittest.TestCase):
    def test_reservation_that_arrives_after_planning_prevents_filesystem_deletion(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); backup_fixture(root)
            reports = [json.loads((root/('backup-1234567'+str(n))/'drill-report.json').read_text()) for n in (1,4)]
            archived = Mock()
            result = maintenance.retention(root,1,True,dict(daily=0,weekly=0,monthly=0,minimumVerified=2),
                ['backup-12345673'],archived=archived,completed_drills=reports,claim=lambda _:False)
            self.assertTrue((root/'backup-12345672').is_dir())
            self.assertEqual(result['deleted'], [])
            self.assertEqual(result['skippedReserved'], ['backup-12345672'])
            archived.assert_not_called()

    def test_automatic_retention_requires_two_strict_boolean_opt_ins(self):
        for host in (None, False, 'true', 1, True):
            for enabled in (None, False, 'true', 1, True):
                with self.subTest(host=host, enabled=enabled):
                    online = Mock()
                    online.config = {'allowAutomaticRetention': host}
                    online.owner = 'a'*32
                    online.sql.return_value = json.dumps({'retention': {'enabled': enabled}})
                    with patch.object(maintenance, 'retention') as policy:
                        maintenance.online_retention(online, Path('/unused'), apply=True,
                                                     automatic=True, fence=Mock())
                    self.assertEqual(policy.call_count, int(host is True and enabled is True))

    def test_online_policy_uses_trusted_drills_pending_paths_and_fenced_archive(self):
        online = Mock()
        online.config = {'allowAutomaticRetention': True}
        online.owner = 'a'*32
        policy = dict(enabled=True, daily=3, weekly=2, monthly=1, minimumVerified=2)
        report = dict(status='PASS', finishedAt='2026-10-26', references={'sourceStoragePath':'drill-source'})
        queries, order = [], []
        def sql(query):
            queries.append(query)
            if query.startswith('BEGIN'):
                order.append('claim'); return 'database-backup-id'
            if 'SELECT value' in query: return json.dumps({'retention': policy})
            if 'sourceBackupId' in query: return 'pending-storage-path'
            if 'json_build_object' in query: return json.dumps(report)
            if query.startswith('UPDATE'): order.append('archive'); return 'database-backup-id'
            raise AssertionError(query)
        online.sql.side_effect = sql
        def run(root, keep, apply, tiers, protected, fence, archived, reports, claim):
            self.assertEqual((keep, apply, tiers, protected, reports),
                             (10, True, policy, ['pending-storage-path'], [report]))
            fence(); self.assertTrue(claim('deleted-storage-path')); order.append('delete'); archived('deleted-storage-path')
            return {'executed':True}
        fence = lambda: order.append('fence')
        with patch.object(maintenance, 'retention', side_effect=run):
            maintenance.online_retention(online, Path('/unused'), apply=True, automatic=True, fence=fence)
        self.assertEqual(order[-6:], ['fence','fence','claim','delete','fence','archive'])
        claim_query = next(q for q in queries if q.startswith('BEGIN'))
        self.assertIn("hashtext('backups-source:deleted-storage-path')", claim_query)
        self.assertLess(claim_query.index('pg_advisory_xact_lock'), claim_query.index('UPDATE'))
        archive_query = queries[-1]
        self.assertIn('"storagePath"', archive_query)
        self.assertIn(maintenance.backup_lease.fence(online.owner), archive_query)
        online.event.assert_called_once_with('BACKUP_RETENTION_APPLIED', 'database-backup-id')
        self.assertTrue(any('JOIN' in q and '"storagePath"' in q for q in queries))
        self.assertTrue(any("status='COMPLETED'" in q and "='PASS'" in q for q in queries))

    def test_automatic_policy_deletes_only_eligible_copy_and_archives_database_row(self):
        for drill_state in ('trusted', 'missing', 'stale'):
            with self.subTest(drill_state=drill_state), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                backup_fixture(root)
                online = Mock()
                online.config, online.owner = {'allowAutomaticRetention':True}, 'a'*32
                reports = [json.loads((root/('backup-1234567'+str(n))/'drill-report.json').read_text()) for n in (1,4)]
                if drill_state == 'missing': reports = []
                if drill_state == 'stale': reports[0]['references']['sourceArtifactChecksum'] = '0'*64
                archive_queries = []
                def sql(query):
                    if 'SELECT value' in query:
                        return json.dumps({'retention':dict(enabled=True, daily=0, weekly=0, monthly=0, minimumVerified=2)})
                    if 'sourceBackupId' in query: return 'backup-12345673'
                    if 'json_build_object' in query: return '\n'.join(json.dumps(r) for r in reports)
                    archive_queries.append(query)
                    self.assertFalse((root/'backup-12345672').exists())
                    return 'database-row-2'
                online.sql.side_effect = sql
                fence = Mock()
                result = maintenance.online_retention(online, root, apply=True, automatic=True, fence=fence)
                self.assertEqual(result['candidates'], ['backup-12345672'] if drill_state == 'trusted' else [])
                self.assertEqual(len(archive_queries), int(drill_state == 'trusted'))
                for n in (0,1,3,4,5): self.assertTrue((root/('backup-1234567'+str(n))).is_dir())
                self.assertEqual((root/'production-storage/data').read_text(), 'preserve')
                if drill_state == 'trusted':
                    self.assertEqual(fence.call_count, 3)
                    online.event.assert_called_once_with('BACKUP_RETENTION_APPLIED', 'database-row-2')
                else:
                    self.assertIn('restore', result['blockedReason'])
                    self.assertTrue((root/'backup-12345672').exists())
                    online.event.assert_not_called()

    def test_lost_fence_prevents_deletion_or_archive(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); backup_fixture(root)
            reports = [json.loads((root/('backup-1234567'+str(n))/'drill-report.json').read_text()) for n in (1,4)]
            archive = Mock()
            with self.assertRaisesRegex(ValueError, 'lease lost'):
                maintenance.retention(root, 1, True, dict(daily=0,weekly=0,monthly=0,minimumVerified=2),
                    ['backup-12345673'], fence=Mock(side_effect=ValueError('lease lost')), archived=archive, completed_drills=reports)
            self.assertTrue((root/'backup-12345672').exists())
            archive.assert_not_called()

    def test_single_copy_is_never_deleted_even_with_trusted_drill(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); backup_fixture(root)
            # Use a separate root containing only the oldest verified FULL.
            single = root/'single'; single.mkdir()
            (root/'backup-12345670').rename(single/'backup-12345670')
            path = single/'backup-12345670'
            report = dict(status='PASS', finishedAt='2026-10-26', references=dict(
                sourceStoragePath=path.name, sourceChecksum=digest(path/'manifest.json'), sourceArtifactChecksum=digest(path/'SHA256SUMS')))
            result = maintenance.retention(single, 1, True, dict(daily=0,weekly=0,monthly=0,minimumVerified=1), completed_drills=[report])
            self.assertEqual(result['candidates'], [])
            self.assertIsNone(result['blockedReason'])
            self.assertTrue(path.is_dir())

    def test_restic_integrity_does_not_attest_physical_offsite(self):
        with tempfile.TemporaryDirectory() as temporary:
            password = Path(temporary)/'password'; password.write_text('fixture')
            with patch.dict('os.environ', RESTIC_REPOSITORY=str(Path(temporary)/'repo'), RESTIC_PASSWORD_FILE=str(password)), patch.object(maintenance.shutil, 'which', return_value='restic'), patch.object(maintenance, 'validate_directory'), patch.object(maintenance.subprocess, 'run'):
                result = maintenance.offsite(Path(temporary), True)
            self.assertEqual(result['status'], 'PARTIAL')
            self.assertEqual(result['encryption']['status'], 'PASS')
            self.assertEqual(result['integrity']['status'], 'PASS')
            self.assertEqual(result['physicalIndependence']['status'], 'UNKNOWN')

    def test_dry_run_and_apply_preserve_last_full_minimum_and_pending_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            backup_fixture(root)
            foreign=root/'production-storage'
            policy=dict(daily=0,weekly=0,monthly=0,minimumVerified=2)
            result=maintenance.retention(root,1,False,policy,['backup-12345673'])
            self.assertEqual(result['candidates'],['backup-12345672'])
            self.assertTrue((root/'backup-12345671').exists())
            blocked_apply = maintenance.retention(root,1,True,policy,['backup-12345673'])
            self.assertEqual(blocked_apply['candidates'], [])
            self.assertTrue((root/'backup-12345672').exists())
            db_reports = [json.loads((root/('backup-1234567'+str(n))/'drill-report.json').read_text()) for n in (1,4)]
            maintenance.retention(root,1,True,policy,['backup-12345673'],completed_drills=db_reports)
            self.assertTrue((root/'backup-12345671').exists())
            self.assertTrue((root/'backup-12345670').exists())
            self.assertEqual((foreign/'data').read_text(),'preserve')
            # An integrity-only copy cannot satisfy minimumVerified. A stale
            # restore receipt cannot protect substituted artifact bytes.
            proof = root/'backup-12345671/drill-report.json'
            receipt = json.loads(proof.read_text())
            receipt['references']['sourceArtifactChecksum'] = '0'*64
            proof.write_text(json.dumps(receipt))
            blocked = maintenance.retention(root, 1, False, policy)
            self.assertEqual(blocked['candidates'], [])
            self.assertIn('restore', blocked['blockedReason'])


if __name__=='__main__':
    unittest.main()
