"""Single durable cross-host execution fence in existing AppSetting, no schema changes."""
import datetime as dt
import json
import re
import uuid
import contextlib
import threading
from backup_archive import require


def owner_valid(owner):
    require(isinstance(owner, str) and re.fullmatch('[a-f0-9]{32}', owner), 'invalid global lease owner')


def acquire(execute, owner, seconds=180):
    owner_valid(owner)
    require(60 <= seconds <= 3600, 'invalid global lease duration')
    # Unique(section,key) serializes contenders across hosts and storage roots.
    query = f'''INSERT INTO "AppSetting" (id,section,key,value,"updatedAt")
      VALUES ('{uuid.uuid4().hex}','backups','execution-lease',
      jsonb_build_object('owner','{owner}','expiresAt',CURRENT_TIMESTAMP+interval '{seconds} seconds','heartbeatAt',CURRENT_TIMESTAMP),CURRENT_TIMESTAMP)
      ON CONFLICT(section,key) DO UPDATE SET value=EXCLUDED.value,"updatedAt"=CURRENT_TIMESTAMP
      WHERE ("AppSetting".value->>'expiresAt')::timestamptz<CURRENT_TIMESTAMP OR "AppSetting".value->>'owner'='{owner}'
      RETURNING value->>'owner';'''
    return execute(query) == owner


def heartbeat(execute, owner, seconds=180):
    owner_valid(owner)
    query = f'''UPDATE "AppSetting" SET value=jsonb_build_object('owner','{owner}',
      'expiresAt',CURRENT_TIMESTAMP+interval '{int(seconds)} seconds','heartbeatAt',CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP
      WHERE section='backups' AND key='execution-lease' AND value->>'owner'='{owner}'
      AND (value->>'expiresAt')::timestamptz>CURRENT_TIMESTAMP RETURNING value->>'owner';'''
    return execute(query) == owner


def release(execute, owner):
    owner_valid(owner)
    execute(f'''UPDATE "AppSetting" SET value=jsonb_build_object('owner',NULL,'expiresAt',CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP
      WHERE section='backups' AND key='execution-lease' AND value->>'owner'='{owner}';''')


def fence(owner):
    owner_valid(owner)
    return f'''EXISTS (SELECT 1 FROM "AppSetting" WHERE section='backups' AND key='execution-lease'
      AND value->>'owner'='{owner}' AND (value->>'expiresAt')::timestamptz>CURRENT_TIMESTAMP)'''


def job_fence(owner, backup_id):
    owner_valid(owner)
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{7,127}', backup_id), 'invalid lease job id')
    return f'''EXISTS (SELECT 1 FROM "Backup" WHERE id='{backup_id}'
      AND metadata#>>'{{job,leaseOwner}}'='{owner}'
      AND (metadata#>>'{{job,leaseExpiresAt}}')::timestamptz>CURRENT_TIMESTAMP)'''


def reconcile(execute, owner):
    execute('''UPDATE "Backup" SET status=CASE WHEN COALESCE((metadata#>>'{job,attempts}')::int,0)>=3
      THEN 'FAILED'::"BackupStatus" ELSE 'PENDING'::"BackupStatus" END,
      "updatedAt"=CURRENT_TIMESTAMP,"errorMessage"='Executor lease expired; safe retry pending',
      metadata=jsonb_set(metadata,'{job,leaseOwner}','null'::jsonb)
      WHERE status IN ('RUNNING','VERIFYING') AND jsonb_typeof(metadata->'job')='object'
      AND ((metadata#>>'{job,leaseExpiresAt}')::timestamptz<CURRENT_TIMESTAMP
        OR (metadata#>>'{job,leaseOwner}'='CLI' AND metadata#>>'{job,leaseExpiresAt}' IS NULL))
      AND '''+fence(owner)+';')


@contextlib.contextmanager
def hold(execute, owner):
    require(acquire(execute, owner), 'global execution lease busy')
    stop, lost = threading.Event(), threading.Event()
    def renew():
        while not stop.wait(5):
            try:
                if not heartbeat(execute, owner):
                    lost.set()
                    return
            except Exception:
                lost.set()
                return
    thread = threading.Thread(target=renew, daemon=True)
    thread.start()
    try:
        yield lambda: require(not lost.is_set() and heartbeat(execute, owner), 'global execution lease lost')
    finally:
        stop.set()
        thread.join(timeout=65)
        release(execute, owner)
