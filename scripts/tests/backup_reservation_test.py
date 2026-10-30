"""Opt-in real PostgreSQL/Prisma race test against an empty isolated source stack.

BACKUP_LEASE_TEST_CONFIG=/private/agent.json PYTHONPATH=scripts python3 -m unittest
 discover -s scripts/tests -p backup_reservation_test.py
The existing API image supplies Prisma/TypeScript; no application workers start.
"""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock
import uuid

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import backup_lease
import backup_runtime

def module(name, filename):
    spec=importlib.util.spec_from_file_location(name,SCRIPTS/filename)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result)
    return result

agent=module('reservation_agent','backup-agent.py')
maintenance=module('reservation_maintenance','backup-maintenance.py')


@unittest.skipUnless(os.name=='posix' and os.environ.get('BACKUP_LEASE_TEST_CONFIG'),
                     'explicit isolated Linux Docker source configuration required')
class ReservationConcurrencyTests(unittest.TestCase):
    def test_api_enqueue_and_deletion_claim_are_mutually_exclusive(self):
        config=json.loads(Path(os.environ['BACKUP_LEASE_TEST_CONFIG']).read_text())
        self.assertTrue(config['project'].startswith(('yo-recovery-','yocrm-drill-')))
        online=agent.Agent(config)
        environment=dict(os.environ,COMPOSE_PROJECT_NAME=config['project'],COMPOSE_FILE=config['composeFile'],ENV_FILE=config['envFile'])
        with unittest.mock.patch.dict(os.environ,environment):
            backup_runtime.guard_isolated()
        self.assertEqual(online.sql('SELECT count(*) FROM "Order";'),'0','synthetic empty source required')
        compose=online.compose
        def command(args):
            result=subprocess.run(args,text=True,capture_output=True,timeout=30)
            self.assertEqual(result.returncode,0,result.stderr[-500:])
            return result.stdout.strip()
        api=command(compose+['ps','-q','api'])
        info=json.loads(command(['docker','inspect',api]))[0]
        self.assertEqual(info['Config']['Labels']['com.docker.compose.project'],config['project'])
        self.assertFalse(info['HostConfig'].get('PortBindings'))
        prefix='reservation-'+uuid.uuid4().hex
        source_id,storage,owner_id=prefix+'-source',prefix+'-files',prefix+'-owner'
        container_source='/tmp/'+prefix
        jobs=[prefix+'-api-first',prefix+'-delete-first',prefix+'-alias-job']
        literal=agent.literal
        online.sql('INSERT INTO "User"(id,email,"displayName","passwordHash",role,"updatedAt") VALUES ('+
                   ','.join(map(literal,[owner_id,prefix+'@example.invalid','Synthetic recovery test','unused']))+",'OWNER',CURRENT_TIMESTAMP);")
        online.sql('INSERT INTO "Backup"(id,type,status,"storagePath",metadata,"updatedAt") VALUES ('+
                   literal(source_id)+",'DATA','COMPLETED',"+literal(storage)+",'{\"job\":{\"kind\":\"BACKUP\"}}',CURRENT_TIMESTAMP);")
        created=[source_id]+jobs+[prefix+'-alias']
        child=None;thread=None
        try:
            with tempfile.TemporaryDirectory(prefix=prefix) as temporary:
                source=Path(temporary)/'source';source.mkdir()
                repo=Path(config['repositoryRoot'])
                for file in list((repo/'apps/api/src/backups').glob('*.ts'))+[repo/'apps/api/src/prisma.service.ts']:
                    destination=source/file.relative_to(repo);destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(file,destination)
                shutil.copyfile(Path(__file__).with_name('backup-reservation-driver.cjs'),source/'driver.cjs')
                command(['docker','exec',api,'mkdir',container_source])
                command(['docker','cp',str(source)+'/.',api+':'+container_source])
                payload=Path(temporary)/storage;payload.mkdir();(payload/'archive').write_bytes(b'synthetic payload')
                with backup_lease.hold(online.sql,online.owner) as fence:
                    def node(job,hold=False,source_backup=source_id):
                        return subprocess.Popen(['docker','exec',api,'node',container_source+'/driver.cjs',job,
                            'hold' if hold else 'plain',source_backup,owner_id,container_source],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                    child=node(jobs[0],True)
                    self.assertEqual(child.stdout.readline().strip(),'SOURCE_LOCKED')
                    started=time.monotonic()
                    self.assertFalse(maintenance.claim_deletion(online,storage,fence))
                    self.assertGreater(time.monotonic()-started,.7)
                    out,error=child.communicate(timeout=20)
                    self.assertEqual(child.returncode,0,error)
                    self.assertTrue(json.loads(out)['accepted']);self.assertTrue(payload.is_dir())
                    online.sql('DELETE FROM "Backup" WHERE id='+literal(jobs[0])+';')
                    locked=threading.Event();original_sql=online.sql;answer={}
                    def paused(query):
                        if not query.startswith('BEGIN'):return original_sql(query)
                        query=query.replace('));\nUPDATE',"));\nSELECT pg_sleep(2);\nUPDATE",1)
                        with subprocess.Popen(compose+['exec','-T','postgres','sh','-c',
                            'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -q -At -v ON_ERROR_STOP=1'],
                            text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE) as process:
                            process.stdin.write(query);process.stdin.close()
                            first=process.stdout.readline();locked.set()
                            rest,error=process.stdout.read(),process.stderr.read();process.wait(timeout=20)
                            self.assertEqual(process.returncode,0,error)
                            return (first+rest).strip()
                    def deletion():
                        try:
                            with unittest.mock.patch.object(online,'sql',side_effect=paused):
                                answer['claimed']=maintenance.claim_deletion(online,storage,lambda:None)
                        except BaseException as error:answer['error']=str(error)
                    thread=threading.Thread(target=deletion);thread.start();self.assertTrue(locked.wait(10))
                    child=node(jobs[1]);out,error=child.communicate(timeout=20);thread.join(timeout=20)
                    self.assertFalse(thread.is_alive());self.assertEqual(answer,{'claimed':True})
                    self.assertEqual(child.returncode,0,error);self.assertEqual(json.loads(out),dict(accepted=False,status=409))
                    self.assertEqual(online.sql('SELECT count(*) FROM "Backup" WHERE id='+literal(jobs[1])+';'),'0')
                    shutil.rmtree(payload)
                    alias=prefix+'-alias'
                    online.sql('INSERT INTO "Backup"(id,type,status,"storagePath",metadata,"updatedAt") VALUES ('+
                        literal(alias)+",'DATA','COMPLETED',"+literal(storage)+",'{\"job\":{\"kind\":\"IMPORT_VERIFY\"}}',CURRENT_TIMESTAMP);")
                    child=node(jobs[2],source_backup=alias);out,error=child.communicate(timeout=20)
                    self.assertEqual(child.returncode,0,error);self.assertEqual(json.loads(out),dict(accepted=False,status=409))
        finally:
            if child and child.poll() is None:child.kill();child.wait(timeout=10)
            if child:
                for stream in (child.stdin,child.stdout,child.stderr):
                    if stream is not None:stream.close()
            if thread and thread.is_alive():thread.join(timeout=20)
            online.sql('DELETE FROM "AuditLog" WHERE "entityType"=\'Backup\' AND "entityId" IN ('+','.join(map(literal,created))+');')
            online.sql('DELETE FROM "Backup" WHERE id IN ('+','.join(map(literal,created))+');')
            online.sql('DELETE FROM "User" WHERE id='+literal(owner_id)+';')
            command(['docker','exec',api,'rm','-rf','--',container_source])
