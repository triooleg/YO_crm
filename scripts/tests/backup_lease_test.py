"""Real PostgreSQL contention test, opt-in on an isolated source only.

BACKUP_LEASE_TEST_CONFIG=/private/isolated-host-agent.json python3 -m unittest
 discover -s scripts/tests -p backup_lease_test.py
"""
import concurrent.futures
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import uuid
from unittest.mock import patch
import backup_runtime
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import backup_lease


@unittest.skipUnless(os.environ.get('BACKUP_LEASE_TEST_CONFIG'),'isolated PostgreSQL configuration not available locally')
class GlobalLeaseTests(unittest.TestCase):
    def test_cli_heartbeat_expiry_and_reconcile_are_durable(self):
        spec=importlib.util.spec_from_file_location('backup_agent',Path(__file__).resolve().parents[1]/'backup-agent.py')
        agent=importlib.util.module_from_spec(spec); spec.loader.exec_module(agent)
        config=json.loads(Path(os.environ['BACKUP_LEASE_TEST_CONFIG']).read_text())
        self.assertTrue(config['project'].startswith(('yocrm-drill-','yo-recovery-','yoleotard-crm-backup-drill')))
        worker=agent.Agent(config); owner=uuid.uuid4().hex; backup_id='cli-lease-test-'+uuid.uuid4().hex
        try:
            self.assertTrue(backup_lease.acquire(worker.sql,owner))
            with patch.dict(os.environ, BACKUP_EXECUTION_OWNER=owner, BACKUP_AGENT_OWNER='', BACKUP_TYPE='data'), patch.object(backup_runtime,'sql',worker.sql):
                backup_runtime.claim_cli(backup_id)
                backup_runtime.lease_tick(backup_id)
                self.assertEqual(worker.sql('SELECT '+backup_lease.job_fence(owner,backup_id)+';'),'t')
                worker.sql('UPDATE "Backup" SET metadata=jsonb_set(metadata,\'{job,leaseExpiresAt}\',to_jsonb(CURRENT_TIMESTAMP-interval \'1 second\')) WHERE id=\''+backup_id+'\';')
                with self.assertRaises(ValueError):
                    backup_runtime.lease_tick(backup_id)
                backup_lease.reconcile(worker.sql,owner)
                self.assertEqual(worker.sql('SELECT status FROM "Backup" WHERE id=\''+backup_id+'\';'),'PENDING')
        finally:
            worker.sql('DELETE FROM "Backup" WHERE id=\''+backup_id+'\';')
            backup_lease.release(worker.sql,owner)

    def test_two_different_storage_roots_cannot_execute_together_and_lost_owner_is_fenced(self):
        spec=importlib.util.spec_from_file_location('backup_agent',Path(__file__).resolve().parents[1]/'backup-agent.py')
        agent=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(agent)
        config=json.loads(Path(os.environ['BACKUP_LEASE_TEST_CONFIG']).read_text())
        self.assertTrue(config['project'].startswith(('yocrm-drill-','yo-recovery-','yoleotard-crm-backup-drill')))
        with tempfile.TemporaryDirectory() as temporary:
            first=agent.Agent(dict(config,storageRoot=str(Path(temporary)/'one')))
            second=agent.Agent(dict(config,storageRoot=str(Path(temporary)/'two')))
            owners=[uuid.uuid4().hex,uuid.uuid4().hex]
            try:
                with concurrent.futures.ThreadPoolExecutor(2) as pool:
                    results=list(pool.map(lambda pair:backup_lease.acquire(pair[0].sql,pair[1]),zip((first,second),owners)))
                self.assertEqual(sorted(results),[False,True])
                winner=results.index(True)
                loser=1-winner
                self.assertFalse(backup_lease.heartbeat(first.sql,owners[loser]))
                # Simulated crash expiry; old owner cannot renew after expiration.
                first.sql("UPDATE \"AppSetting\" SET value=jsonb_set(value,'{expiresAt}',to_jsonb(CURRENT_TIMESTAMP-interval '1 second')) WHERE section='backups' AND key='execution-lease';")
                self.assertFalse(backup_lease.heartbeat(first.sql,owners[winner]))
                self.assertTrue(backup_lease.acquire(second.sql,owners[loser]))
                self.assertEqual(first.sql('SELECT '+backup_lease.fence(owners[winner])+';'),'f')
            finally:
                for owner in owners:
                    backup_lease.release(first.sql,owner)


if __name__=='__main__':
    unittest.main()
