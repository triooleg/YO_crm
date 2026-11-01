"""Drill source trust comes from existing host capture receipt, never archive flags."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
spec=importlib.util.spec_from_file_location('recovery_drill',Path(__file__).resolve().parents[1]/'recovery-drill.py')
drill=importlib.util.module_from_spec(spec);spec.loader.exec_module(drill)

class DrillSourceConsistencyTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/'local-capture';self.root.mkdir()
        env=patch.dict(os.environ,BACKUP_EXECUTION_OWNER='a'*32,BACKUP_JOB_ID='drill-job-12345678',BACKUP_STORAGE_PATH=self.temp.name)
        env.start();self.addCleanup(env.stop)
        lease=patch.object(drill,'require_execution');self.lease=lease.start();self.addCleanup(lease.stop)
        binding=patch.object(drill,'host_sql',return_value='t');self.binding=binding.start();self.addCleanup(binding.stop)
        self.result=dict(formatVersion=3,consistent=False,checksum='a'*64,sizeBytes=123,
                         manifest=dict(backup_id=self.root.name,consistency=dict(verified=True,method='stopped-writers')))
    def receipt(self,**changes):
        value=dict(self.result,consistent=True,consistencyTrust='VERIFIED_LOCAL_QUIESCENCE');value.update(changes)
        (self.root.parent/'.last-validation.json').write_text(json.dumps(value),encoding='utf-8')
    def test_offline_fabricated_matching_sidecar_stays_unverified(self):
        self.receipt()
        with patch.dict(os.environ,BACKUP_EXECUTION_OWNER='',BACKUP_JOB_ID=''):
            self.assertFalse(drill.source_report_fields(self.root,self.result)['sourceConsistent'])
        self.lease.assert_not_called();self.binding.assert_not_called()
    def test_forged_execution_environment_without_live_lease_aborts(self):
        self.receipt();self.lease.side_effect=ValueError('lease lost')
        with self.assertRaisesRegex(ValueError,'lease lost'):
            drill.source_report_fields(self.root,self.result)
        self.binding.assert_not_called()
    def test_wrong_live_source_binding_stays_unverified(self):
        self.receipt();self.binding.return_value='f'
        self.assertFalse(drill.source_report_fields(self.root,self.result)['sourceConsistent'])
    def test_source_outside_host_storage_aborts(self):
        self.receipt()
        with patch.dict(os.environ,BACKUP_STORAGE_PATH=str(self.root)):
            with self.assertRaisesRegex(ValueError,'outside host storage'):
                drill.source_report_fields(self.root,self.result)
    def test_real_local_capture_is_not_reported_unverified(self):
        self.receipt()
        self.assertTrue(drill.source_report_fields(self.root,self.result)['sourceConsistent'])
    def test_archive_claim_without_host_receipt_stays_unverified(self):
        self.result['consistent']=True
        self.assertFalse(drill.source_report_fields(self.root,self.result)['sourceConsistent'])
    def test_mismatched_receipt_never_grants_consistency(self):
        for change in ({'checksum':'b'*64},{'sizeBytes':124},{'consistencyTrust':'UNVERIFIED'},
                       {'manifest':{'backup_id':'other'}},{'consistent':False},{'formatVersion':2}):
            with self.subTest(change=change):
                self.receipt(**change)
                self.assertFalse(drill.source_report_fields(self.root,self.result)['sourceConsistent'])
    def test_emitted_report_uses_verified_host_receipt(self):
        self.receipt();self.result['inventory']=[]
        output=self.root.parent/'drill-output'
        with patch.object(drill,'validate_directory',return_value=self.result), \
             patch.object(drill,'pinned_image',return_value={'Id':'sha256:'+'c'*64}), \
             patch.object(drill,'project_guard'),patch.object(drill,'disk_budget'), \
             patch.object(drill,'digest',return_value='d'*64), \
             patch.object(drill,'bounded_run',side_effect=RuntimeError('synthetic stop before Docker')):
            with self.assertRaisesRegex(RuntimeError,'synthetic stop'):
                drill.drill(self.root,'yo-recovery-synthetic','sha256:'+'c'*64,output)
        report=json.loads((output/'drill-report.json').read_text(encoding='utf-8'))
        self.assertTrue(report['sourceConsistent'])
        self.assertEqual(report['status'],'FAILED')
        self.assertFalse((self.root/'drill-report.json').exists())
    def test_symlink_receipt_never_grants_consistency(self):
        self.receipt();receipt=self.root.parent/'.last-validation.json'
        target=self.root.parent/'receipt-target';receipt.rename(target)
        try:receipt.symlink_to(target)
        except OSError:self.skipTest('local OS does not permit symlinks')
        self.assertFalse(drill.source_report_fields(self.root,self.result)['sourceConsistent'])
    def test_invalid_receipt_stays_unverified(self):
        (self.root.parent/'.last-validation.json').write_text('{',encoding='utf-8')
        self.assertFalse(drill.source_report_fields(self.root,self.result)['sourceConsistent'])

if __name__=='__main__':unittest.main()
