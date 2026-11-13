"""Persistent psql protocol tests; fake child only, never Docker or a database."""
import subprocess
import os
import sys
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import history_runtime_connection as connection

EMULATOR = r'''
import os,sys,time
mode=os.environ.get('TEST_MODE','ok')
copies=0
for line in sys.stdin:
    if line.startswith('\\copy'):
        copies+=1
        fault=mode if copies>1 else 'ok'
        if fault=='error': sys.stderr.write('private synthetic error');sys.stderr.flush();sys.exit(3)
        if fault=='hang': time.sleep(10);continue
        if fault=='oversize': print('x'*1100000,flush=True);continue
        if fault=='malformed': print('"unterminated',flush=True);continue
        if fault=='badbool': print('"true"',flush=True);continue
        if 'pg_backend_pid()' in line: print('"123"',flush=True)
        elif 'migration_name' in line: print('"quoted,"" Unicode 🧵","'+'a'*64+'","t","f"',flush=True)
        elif 'count(*)' in line: print('"2","0"',flush=True)
        else: print('"t"',flush=True)
    elif line.startswith('\\echo '):
        print(line.strip()[6:],flush=True)
    elif line.startswith('\\q'): break
'''


class ConnectionTests(unittest.TestCase):
    def setUp(self):
        self.calls=[]
        original=subprocess.Popen
        def spawn(argv, **options):
            self.calls.append((argv,options))
            return original([sys.executable,'-u','-c',EMULATOR], **options)
        self.process=patch.object(connection.subprocess,'Popen',side_effect=spawn)
        self.discovery=patch.object(connection.subprocess,'run',return_value=subprocess.CompletedProcess([],0,('a'*64+'\n').encode()))
        self.process.start();self.discovery.start()
        self.addCleanup(self.process.stop);self.addCleanup(self.discovery.stop)

    def open(self, mode='ok'):
        env={key:os.environ[key] for key in ('SystemRoot','WINDIR') if key in os.environ}
        env.update(TEST_MODE=mode,PYTHONIOENCODING='utf-8')
        with patch.object(connection,'_local_environment',return_value=env):
            db=connection.connect_runtime_database()
        self.addCleanup(db.close)
        return db

    def test_fixed_local_docker_and_persistent_session(self):
        db=self.open()
        for _ in range(3):
            cur=db.cursor();cur.execute('SELECT pg_backend_pid()');self.assertEqual(cur.fetchone(),(123,));cur.close()
        self.assertTrue(db.autocommit)
        self.assertEqual(len(self.calls),1)
        argv,options=self.calls[0]
        self.assertEqual(argv[:4],['docker','--host=unix:///var/run/docker.sock','exec','-i'])
        self.assertEqual(argv[4],'a'*64)
        self.assertNotIn('-e',argv)
        self.assertEqual(options['env']['TEST_MODE'],'ok')
        self.assertNotIn('DOCKER_HOST',options['env'])
        db.close();db.close()
        with self.assertRaises(connection.RuntimeConnectionError): db.cursor()

    def test_csv_duplicate_columns_bool_int_unicode_and_quotes(self):
        db=self.open();cur=db.cursor()
        query=next(sql for sql in connection._QUERIES if 'count(*)' in sql)
        cur.execute(query);self.assertEqual(cur.fetchall(),[(2,0)])
        query=next(sql for sql in connection._QUERIES if 'migration_name' in sql)
        cur.execute(query);self.assertEqual(cur.fetchall(),[('quoted," Unicode 🧵','a'*64,True,False)])
        cur.execute(next(sql for sql in connection._QUERIES if 'pg_try_advisory_lock' in sql))
        self.assertIs(cur.fetchone()[0],True)

    def test_unlisted_sql_is_rejected_before_transport(self):
        db=self.open();cur=db.cursor()
        for query in ['SELECT 1','SELECT pg_backend_pid(); DROP TABLE x','\\! whoami','SELECT pg_backend_pid()\n']:
            with self.assertRaises(connection.RuntimeConnectionError): cur.execute(query)
        cur.execute('SELECT pg_backend_pid()');self.assertEqual(cur.fetchone(),(123,))

    def test_errors_malformed_csv_wrong_types_and_bounds_poison_session(self):
        for mode in ['error','oversize','malformed','badbool']:
            with self.subTest(mode=mode):
                db=self.open(mode);cur=db.cursor()
                query=next(sql for sql in connection._QUERIES if 'pg_try_advisory_lock' in sql)
                with self.assertRaises(connection.RuntimeConnectionError): cur.execute(query)
                with self.assertRaises(connection.RuntimeConnectionError): cur.execute('SELECT pg_backend_pid()')

    def test_query_timeout_poison_and_close_are_bounded(self):
        db=self.open('hang');db._timeout=0.1
        with self.assertRaises(connection.RuntimeConnectionError): db.cursor().execute('SELECT pg_backend_pid()')
        self.assertIsNotNone(db._process.poll())

    def test_discovery_refuses_none_multiple_or_bad_container_ids(self):
        for raw in [b'',b'a'*64+b'\n'+b'b'*64,b'postgres',b'a'*65]:
            with patch.object(connection.subprocess,'run',return_value=subprocess.CompletedProcess([],0,raw)):
                with self.assertRaises(connection.RuntimeConnectionError): connection.connect_runtime_database()
        self.assertEqual(self.calls,[])


if __name__=='__main__': unittest.main()
