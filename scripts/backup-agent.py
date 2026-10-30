#!/usr/bin/env python3
"""External Linux executor. stdlib + Docker CLI, no HTTP API/socket in CRM.

Run: python3 scripts/backup-agent.py --config /private/host-agent.json [--once]
Host-only config: project, composeFile, envFile, storageRoot, repositoryRoot;
consistent=false, writerServices=[], writersComplete=false, offlineImages=false;
allowAutomaticRetention=false; deletion also requires recovery.retention.enabled=true.
postgresImage must be an installed sha256:<64hex> for drills. pollSeconds=15.
The host config alone authorizes writer stops; DB settings cannot enable them.

Queue contract (existing Backup): metadata.job.kind BACKUP|IMPORT_VERIFY|DRILL;
IMPORT_VERIFY: metadata.quarantine={file,bytes,checksum} under storageRoot/quarantine,
sourceBackupId is returned from source manifest (never rewrite signed source).
DRILL: metadata.job.sourceBackupId points to COMPLETED storagePath directory.
Job fields: attempts, leaseOwner, leaseExpiresAt, heartbeatAt, nextAttemptAt,
progress, result. Existing string job=CreateBackupJob is treated as BACKUP.
AppSetting section=backups,key=recovery,value=recovery settings; existing
BackupSetting retains daily enabled/time/timezone. See schedule_slots for shape.
API must not write host paths or commands. Completed source rows never claimed.
Local JSON journal is crash-recovery evidence, not a second queue/database.
"""
import argparse
import contextlib
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
import uuid
from zoneinfo import ZoneInfo
from backup_archive import ID, digest, import_archive, read_json, require, validate_directory
from backup_runtime import atomic_json, fsync_directory, version_fields, drain_group, local_consistency
import backup_lease

maintenance_spec = importlib.util.spec_from_file_location('backup_maintenance', Path(__file__).with_name('backup-maintenance.py'))
maintenance = importlib.util.module_from_spec(maintenance_spec)
maintenance_spec.loader.exec_module(maintenance)

UTC = dt.timezone.utc


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def drill_notification(backup_id, source_id, report, job):
    slot = job.get('scheduleSlot')
    scheduled = isinstance(slot, str) and re.fullmatch(r'\d{4}-\d{2}', slot) is not None
    return dict(version=1, type='BACKUP_DRILL_RESULT',
                eventId=hashlib.sha256((backup_id+':'+report['finishedAt']+':'+report['status']).encode()).hexdigest(),
                backupId=backup_id, sourceBackupId=source_id, status=report['status'],
                severity='INFO' if report['status'] == 'PASS' else 'ERROR', finishedAt=report['finishedAt'],
                trigger='SCHEDULED' if scheduled else 'MANUAL', scheduleSlot=slot if scheduled else None,
                delivery='LOCAL_PENDING', externalDeliveryEnabled=False)


def validate_config(config):
    require(re.fullmatch(r'[a-z0-9][a-z0-9_-]{2,62}', config.get('project', '')), 'invalid source project')
    root = Path(config.get('storageRoot', ''))
    require(root.is_absolute() and root != Path(root.anchor), 'absolute private storage required')
    if config.get('consistent'):
        require(config.get('writersComplete') is True and config.get('writerServices') and
                'api' in config['writerServices'], 'explicit complete writers required')
    return config


def schedule_slots(settings, now):
    recovery = settings.get('recovery', {})
    if not settings.get('enabled') and not any(recovery.get(k, {}).get('enabled') for k in ('weeklyFull', 'monthlyDrill')):
        return []
    zone = settings.get('timezone', 'Europe/Kyiv')
    local = now.astimezone(ZoneInfo(zone))
    day = local.strftime('%Y-%m-%d')
    result = []
    def due(clock):
        require(re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d', clock), 'invalid schedule time')
        return local.strftime('%H:%M') >= clock
    if settings.get('enabled'):
        frequency = settings.get('frequency', 'DAILY')
        clock = settings.get('time', '03:00')
        clock_due = due(clock)  # Validate the same HH:mm contract for every frequency.
        slot = day+'T'+local.strftime('%H') if frequency == 'HOURLY' else day
        ready = local.minute >= int(clock[3:]) if frequency == 'HOURLY' else clock_due
        if ready and (frequency != 'WEEKLY' or (local.weekday()+1)%7 == 0):
            result.append(dict(id='schedule-data-'+slot.replace(':',''), kind='BACKUP', type=settings.get('backupType','DATA'), slot=slot))
    weekly = recovery.get('weeklyFull', {})
    if weekly.get('enabled') and (local.weekday()+1) % 7 == weekly.get('dayOfWeek', 0) and due(weekly.get('time','03:00')):
        result.append(dict(id='schedule-full-'+day, kind='BACKUP', type='FULL', slot=day))
    monthly = recovery.get('monthlyDrill', {})
    if monthly.get('enabled') and local.day == monthly.get('dayOfMonth', 1) and due(monthly.get('time','04:00')):
        result.append(dict(id='schedule-drill-'+day[:7], kind='DRILL', type='DATA', slot=day[:7]))
    return result


@contextlib.contextmanager
def host_lock(root):
    import fcntl  # Linux host only; scheduling/archive tests remain portable.
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = root/'.executor.lock'
    require(not path.is_symlink(), 'lock must not be a symlink')
    with path.open('a') as handle:
        os.chmod(path, 0o600)
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield handle.fileno()


class Agent:
    def __init__(self, config):
        self.config = validate_config(config)
        self.root = Path(config['storageRoot']).resolve()
        self.owner = uuid.uuid4().hex
        self.compose = ['docker', 'compose', '--env-file', config['envFile'], '-p', config['project'], '-f', config['composeFile']]
        self.repo = Path(config.get('repositoryRoot', Path(__file__).resolve().parents[1])).resolve()
        self.lease_lost = False
        self.lease_seconds = max(180, int(config.get('leaseSeconds', 180)))

    def sql(self, query):
        process = subprocess.run(self.compose + ['exec', '-T', '-e', 'PGAPPNAME=backup-host-agent', 'postgres',
            'sh', '-c', 'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -X -q -At -v ON_ERROR_STOP=1'],
            input=query, text=True, capture_output=True, cwd=self.repo, timeout=60)
        require(process.returncode == 0, 'executor database command failed')
        return process.stdout.strip()

    def event(self, event, backup_id=None, detail=None):
        # Deliberately exclude stderr, environment, credentials and command strings.
        value = dict(at=dt.datetime.now(UTC).isoformat(), event=event, backupId=backup_id, detail=detail)
        with (self.root/'executor-journal.jsonl').open('a', encoding='utf8') as out:
            out.write(json.dumps(value)+'\n')
            out.flush()
            os.fsync(out.fileno())
        self.sql('INSERT INTO "AuditLog" ("id","action","entityType","entityId","after","createdAt") VALUES (' +
                 ','.join([literal(uuid.uuid4().hex), literal(event), "'Backup'", literal(backup_id or 'executor'),
                           literal(json.dumps(value))+"::jsonb", 'CURRENT_TIMESTAMP'])+');')

    def schedule(self):
        raw = self.sql("SELECT row_to_json(s) FROM \"BackupSetting\" s WHERE id='default';")
        settings = json.loads(raw) if raw else dict(enabled=False)
        raw = self.sql("SELECT value FROM \"AppSetting\" WHERE section='backups' AND key='recovery';")
        settings['recovery'] = json.loads(raw) if raw else {}
        for slot in schedule_slots(settings, dt.datetime.now(UTC)):
            job = dict(kind=slot['kind'], scheduleSlot=slot['slot'], attempts=0)
            if slot['kind'] == 'DRILL':
                source = self.sql("SELECT id FROM \"Backup\" WHERE status='COMPLETED' AND \"archivedAt\" IS NULL AND COALESCE(metadata#>>'{job,kind}','BACKUP') IN ('BACKUP','IMPORT_VERIFY') ORDER BY \"completedAt\" DESC LIMIT 1;")
                if not source:
                    continue
                job['sourceBackupId'] = source
            self.sql('INSERT INTO "Backup" (id,type,status,"storageProvider",metadata,"createdAt","updatedAt") VALUES ('+
                     ','.join([literal(slot['id']), literal(slot['type'])+'::"BackupType"', "'PENDING'", "'LOCAL'",
                     literal(json.dumps(dict(job=job, requestedVia='SCHEDULE')))+'::jsonb', 'CURRENT_TIMESTAMP', 'CURRENT_TIMESTAMP'])+
                     ') ON CONFLICT(id) DO NOTHING;')

    def reconcile(self):
        # Never reclaim while the global flock is held elsewhere. A durable lease fences DB writers.
        backup_lease.reconcile(self.sql, self.owner)

    def claim(self):
        owner = literal(self.owner)
        job = "CASE WHEN jsonb_typeof(metadata->'job')='object' THEN metadata->'job' ELSE '{\"kind\":\"BACKUP\"}'::jsonb END"
        query = f'''WITH candidate AS (SELECT id FROM "Backup"
          WHERE status='PENDING' AND "archivedAt" IS NULL AND {backup_lease.fence(self.owner)}
          AND NOT EXISTS (SELECT 1 FROM \"Backup\" active WHERE active.status IN ('RUNNING','VERIFYING','RESTORING'))
          AND (metadata#>>'{{job,nextAttemptAt}}' IS NULL OR (metadata#>>'{{job,nextAttemptAt}}')::timestamptz<=CURRENT_TIMESTAMP)
          ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1)
        UPDATE "Backup" SET status='RUNNING',"startedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP,"errorMessage"=NULL,
          metadata=jsonb_set(COALESCE(metadata,'{{}}'::jsonb),'{{job}}', {job} || jsonb_build_object(
          'leaseOwner',{owner},'leaseExpiresAt',CURRENT_TIMESTAMP+interval '{self.lease_seconds} seconds',
          'heartbeatAt',CURRENT_TIMESTAMP,'attempts',COALESCE((metadata#>>'{{job,attempts}}')::int,0)+1,'progress',1))
        WHERE id IN (SELECT id FROM candidate) RETURNING row_to_json("Backup");'''
        raw = self.sql(query)
        return json.loads(raw) if raw else None

    def fenced_update(self, backup_id, fields, notification=None):
        update = 'UPDATE "Backup" SET '+fields+',"updatedAt"=CURRENT_TIMESTAMP WHERE id='+literal(backup_id)+\
                 " AND status IN ('RUNNING','VERIFYING') AND metadata#>>'{job,leaseOwner}'="+literal(self.owner)+\
                 " AND (metadata#>>'{job,leaseExpiresAt}')::timestamptz>CURRENT_TIMESTAMP AND "+backup_lease.fence(self.owner)+' RETURNING id'
        if notification is None:
            return self.sql(update+';')
        # One statement: no notification without the fenced result, and no
        # saved result without its local event. This is a latest-result slot;
        # the existing audit journal retains the history. No external delivery.
        return self.sql('WITH saved_result AS ('+update+') INSERT INTO "AppSetting" (id,section,key,value,"updatedAt") SELECT '+
                        literal(uuid.uuid4().hex)+",'backups','drillNotification',"+literal(json.dumps(notification))+"::jsonb,CURRENT_TIMESTAMP FROM saved_result WHERE true "+
                        'ON CONFLICT(section,key) DO UPDATE SET value=EXCLUDED.value,"updatedAt"=CURRENT_TIMESTAMP RETURNING value->>\'backupId\';')

    def heartbeat(self, backup_id):
        if not backup_lease.heartbeat(self.sql, self.owner, self.lease_seconds):
            return False
        return self.fenced_update(backup_id, "metadata=jsonb_set(jsonb_set(metadata,'{job,heartbeatAt}',to_jsonb(CURRENT_TIMESTAMP)),'{job,leaseExpiresAt}',to_jsonb(CURRENT_TIMESTAMP+interval '"+str(self.lease_seconds)+" seconds'))") == backup_id

    def public_heartbeat(self):
        # Long captures/imports keep this API-facing evidence fresh independently
        # of per-job progress. A lost global owner cannot advertise availability.
        fence = backup_lease.fence(self.owner)
        query = '''INSERT INTO "AppSetting" (id,section,key,value,"updatedAt")
          SELECT '''+literal(uuid.uuid4().hex)+''', 'backups', 'executor',
          jsonb_build_object('status','AVAILABLE','lastSeenAt',CURRENT_TIMESTAMP,'version','host-agent-v3'),CURRENT_TIMESTAMP
          WHERE '''+fence+''' ON CONFLICT(section,key) DO UPDATE
          SET value=EXCLUDED.value,"updatedAt"=CURRENT_TIMESTAMP WHERE '''+fence+''' RETURNING key;'''
        require(self.sql(query) == 'executor', 'public executor heartbeat ownership lost')

    def child(self, command, fd, backup_id):
        env = dict(os.environ, COMPOSE_PROJECT_NAME=self.config['project'], COMPOSE_FILE=self.config['composeFile'],
                   ENV_FILE=self.config['envFile'], BACKUP_STORAGE_PATH=str(self.root), BACKUP_LOCK_FD=str(fd),
                   BACKUP_AGENT_JOB=backup_id, BACKUP_AGENT_OWNER=self.owner, BACKUP_EXECUTION_OWNER=self.owner,
                   BACKUP_JOB_ID=backup_id, BACKUP_PROCESS_SESSION='1', BACKUP_PARENT_PID=str(os.getpid()),
                   BACKUP_CONSISTENT=str(bool(self.config.get('consistent'))).lower(),
                   BACKUP_WRITERS_COMPLETE=str(bool(self.config.get('writersComplete'))).lower(),
                   BACKUP_WRITER_SERVICES=json.dumps(self.config.get('writerServices', [])),
                   BACKUP_OFFLINE_IMAGES=str(bool(self.config.get('offlineImages'))).lower())
        if self.config.get('chatwootConfig'):
            env['BACKUP_CHATWOOT_CONFIG'] = self.config['chatwootConfig']
        # stdout may contain customer file paths; keep private local log, not API error text.
        with (self.root/('.job-'+backup_id+'.log')).open('ab') as log:
            process = subprocess.Popen(command, cwd=self.repo, env=env, pass_fds=(fd,), stdout=log, stderr=log, start_new_session=True)
            watchdog = subprocess.Popen([sys.executable, str(self.repo/'scripts/backup_runtime.py'), 'lease-watch', str(process.pid)],
                                        cwd=self.repo, env=env, stdout=log, stderr=log)
            try:
                while process.poll() is None:
                    try:
                        require(watchdog.poll() is None, 'independent watchdog exited')
                        require(not self.lease_lost and self.heartbeat(backup_id), 'lease ownership lost')
                    except Exception:
                        drain_group(process.pid)
                        raise
                    time.sleep(5)
                require(process.returncode == 0, 'host command failed; inspect private executor log')
            finally:
                drain_group(process.pid)
                process.wait(timeout=10)
                watchdog.terminate()
                watchdog.wait(timeout=20)

    def failed_drill(self, backup_id, source_id, output, job):
        # A nonzero child (including cleanup failure after PASS) must remain
        # visible to overview's latest metadata.drill query, even before retry.
        report_path = output/'drill-report.json'
        try:
            report = read_json(report_path)
            if not isinstance(report, dict):
                report = {}
        except (OSError, ValueError, TypeError):
            report = {}
        report.update(status='FAILED', sourceBackupId=source_id,
                      finishedAt=dt.datetime.now(UTC).isoformat(), errorCode='DRILL_EXECUTION_FAILED')
        try:
            output.mkdir(mode=0o700, exist_ok=True)
            atomic_json(report_path, report)
        except OSError:
            # Disk exhaustion must not also erase the API-visible failure.
            report['privateReportUnavailable'] = True
        fields = "metadata=jsonb_set(COALESCE(metadata,'{}'::jsonb),'{drill}',"+literal(json.dumps(report))+"::jsonb)"
        require(self.fenced_update(backup_id, fields, notification=drill_notification(backup_id, source_id, report, job)) == backup_id, 'drill failure ownership lost')
        self.event('BACKUP_DRILL_FAILED', backup_id, dict(sourceBackupId=source_id, status='FAILED'))

    def execute(self, row, fd):
        backup_id = row['id']
        require(ID.fullmatch(backup_id), 'invalid queue id')
        job = row['metadata']['job']
        kind = job.get('kind', 'BACKUP')
        quarantine_identity = None
        if kind == 'BACKUP':
            require(row['type'] != 'FULL' or self.config.get('consistent') is True,
                    'API FULL requires consistent capture and portable v3 artifacts')
            if self.config.get('consistent'):
                permission = self.sql("SELECT value FROM \"AppSetting\" WHERE section='backups' AND key='recovery';")
                require(permission and json.loads(permission).get('maintenance', {}).get('allowWriterPause') is True,
                        'API maintenance permission and explicit host writer configuration both required')
            # Completed artifacts after a crash are adopted, never overwritten.
            path = self.root/backup_id
            if path.exists() and (path/'archive.tar.gz').is_file():
                result = validate_directory(path, backup_id)
            else:
                require(not path.exists(), 'partial backup directory retained; operator review required')
                receipt_path = self.root/'.last-validation.json'
                receipt_path.unlink(missing_ok=True)
                self.child(['bash', 'scripts/backup.sh', row['type'].lower(), '--backup-id', backup_id,
                            '--output-dir', str(self.root)], fd, backup_id)
                result = validate_directory(path, backup_id)
            # Shared with CLI completion. Only BACKUP may consult host evidence
            # outside the archive; unsigned validation itself always stays false.
            consistency = local_consistency(path, result)
            require(row['type'] != 'FULL' or (result['formatVersion'] == 3 and consistency['verified'] and
                    'application.tar.gz' in result['manifest']['files']), 'API FULL requires verified portable v3 artifacts')
            metadata = dict(formatVersion=result['formatVersion'], consistent=consistency['verified'], archiveChecksum=digest(path/'archive.tar.gz'), archiveSizeBytes=(path/'archive.tar.gz').stat().st_size)
        elif kind == 'IMPORT_VERIFY':
            quarantined = row['metadata'].get('quarantine', {})
            name = quarantined.get('file', '')
            require(isinstance(name, str) and Path(name).name == name and name not in ('', '.', '..'), 'invalid quarantine filename')
            quarantine = self.root/'quarantine'
            source = quarantine/name
            require(not quarantine.is_symlink() and source.is_file() and not source.is_symlink(), 'invalid quarantine source')
            require(str(source.stat().st_size) == str(quarantined.get('bytes')) and digest(source) == quarantined.get('checksum'), 'quarantine integrity mismatch')
            quarantine_identity = source.stat()
            destination = self.root/backup_id
            if destination.exists():
                result = validate_directory(destination)
                result.update(sourceBackupId=result['manifest'].get('backup_id') or backup_id, storagePath=backup_id)
            else:
                result = import_archive(source, self.root, backup_id)
            import_type = 'DATA' if result['formatVersion'] == 1 else result['manifest'].get('type', '').upper()
            require(import_type == row['type'], 'import type mismatch')
            metadata = dict(formatVersion=result['formatVersion'], sourceBackupId=result.get('sourceBackupId'))
        elif kind == 'DRILL':
            source_id = job.get('sourceBackupId', '')
            require(ID.fullmatch(source_id), 'invalid drill source')
            raw = self.sql('SELECT row_to_json(b) FROM "Backup" b WHERE id='+literal(source_id)+" AND status='COMPLETED' AND \"archivedAt\" IS NULL;")
            require(raw, 'drill source not completed')
            source = json.loads(raw)
            storage_id = source.get('storagePath') or source_id
            require(ID.fullmatch(storage_id), 'invalid storage path')
            output = self.root/('.drill-'+backup_id+'-'+uuid.uuid4().hex[:8])
            try:
                self.child([sys.executable, 'scripts/recovery-drill.py', '--backup-dir', str(self.root/storage_id),
                    '--project', 'yo-recovery-'+uuid.uuid4().hex[:12], '--postgres-image', self.config.get('postgresImage', ''),
                    '--output-dir', str(output)], fd, backup_id)
                metadata = read_json(output/'drill-report.json')
                require(isinstance(metadata, dict) and metadata.get('status') == 'PASS', 'drill did not pass')
            except Exception:
                self.failed_drill(backup_id, source_id, output, job)
                raise
            result = dict(checksum=source.get('checksum'), sizeBytes=source.get('sizeBytes') or 0)
        else:
            raise ValueError('unsupported job kind')
        # Preserve job lease while merging result; source checksum is never repurposed.
        if kind in ('BACKUP', 'IMPORT_VERIFY'):
            # Manifest consistency is an unsigned claim. Only a fresh local CLI
            # pack attestation can establish quiescence, never an import/re-read.
            claimed = result.get('claimedConsistency', result['manifest'].get('consistency'))
            if kind == 'IMPORT_VERIFY':
                consistency = dict(verified=False, method='artifact-claim-unverified', trust='UNVERIFIED', claimed=claimed)
            consistent, trust = consistency['verified'], consistency['trust']
            metadata.update(consistent=consistent, consistencyTrust=trust, claimedConsistency=claimed)
        payload = dict(result=metadata, progress=100, phase='COMPLETED')
        root_metadata = {}
        if kind in ('BACKUP', 'IMPORT_VERIFY'):
            m = result['manifest']
            archive_path = self.root/backup_id/'archive.tar.gz'
            root_metadata = dict(sourceBackupId=result.get('sourceBackupId', m.get('backup_id')),
                coverage=result['coverage'], claimedCoverage=result.get('claimedCoverage'),
                consistency=consistency, consistencyTrust=trust, claimedConsistency=claimed,
                archive=dict(file='archive.tar.gz', checksum=digest(archive_path), bytes=str(archive_path.stat().st_size)),
                verification=dict(status='PASS', kind='INTEGRITY', verifiedAt=dt.datetime.now(UTC).isoformat()))
            atomic_json(self.root/backup_id/'.backup-owner', dict(owner='yo-backup-engine', backupId=backup_id))
            atomic_json(self.root/backup_id/'verification.json', dict(checksum=result['checksum'], verifiedAt=dt.datetime.now(UTC).isoformat()))
        else:
            root_metadata = dict(drill=dict(metadata, sourceBackupId=source_id, finishedAt=dt.datetime.now(UTC).isoformat()))
        fields = "status='COMPLETED',\"completedAt\"=CURRENT_TIMESTAMP,\"storagePath\"="+literal(backup_id)+',"checksum"='+literal(result['checksum'])+',"sizeBytes"='+str(int(result['sizeBytes']))+",metadata=jsonb_set(metadata,'{job}',metadata->'job'||"+literal(json.dumps(payload))+"::jsonb)||"+literal(json.dumps(root_metadata))+"::jsonb"
        if kind in ('BACKUP', 'IMPORT_VERIFY'):
            fields += version_fields(result['manifest'])
        notification = {'notification': drill_notification(backup_id, source_id, root_metadata['drill'], job)} if kind == 'DRILL' else {}
        require(self.fenced_update(backup_id, fields, **notification) == backup_id, 'completion lease lost')
        if quarantine_identity is not None:
            try:
                current = source.lstat()
                require(not source.is_symlink() and (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns) ==
                        (quarantine_identity.st_dev, quarantine_identity.st_ino, quarantine_identity.st_size, quarantine_identity.st_mtime_ns)
                        and digest(source) == quarantined['checksum'], 'quarantine ownership changed')
                source.unlink()
                fsync_directory(quarantine)
            except Exception:
                self.event('BACKUP_QUARANTINE_CLEANUP_FAILED', backup_id)
        self.event('BACKUP_EXECUTOR_COMPLETED', backup_id, dict(kind=kind))

    def automatic_retention(self):
        if self.config.get('allowAutomaticRetention') is not True:
            return
        def fence():
            require(not self.lease_lost and backup_lease.heartbeat(self.sql, self.owner, self.lease_seconds),
                    'retention global lease lost')
        return maintenance.online_retention(self, self.root, apply=True, automatic=True, fence=fence)

    def cycle(self):
        self.lease_lost = False
        with host_lock(self.root) as fd:
            if not backup_lease.acquire(self.sql, self.owner, self.lease_seconds):
                return
            stop_heartbeat = threading.Event()
            def renew():
                while not stop_heartbeat.wait(5):
                    try:
                        require(backup_lease.heartbeat(self.sql, self.owner, self.lease_seconds), 'global lease lost')
                        self.public_heartbeat()
                    except Exception:
                        self.lease_lost = True
                        return
            thread = threading.Thread(target=renew, daemon=True)
            thread.start()
            try:
                self.locked_cycle(fd)
            finally:
                stop_heartbeat.set()
                thread.join(timeout=65)
                backup_lease.release(self.sql, self.owner)

    def locked_cycle(self, fd):
        # Resume exact writer IDs left by a killed process before claiming another job.
        journal = self.root/'.quiescence.json'
        if journal.exists():
            env = dict(os.environ, COMPOSE_PROJECT_NAME=self.config['project'], COMPOSE_FILE=self.config['composeFile'],
                       ENV_FILE=self.config['envFile'], BACKUP_EXECUTION_OWNER=self.owner)
            env.pop('BACKUP_JOB_ID', None)
            subprocess.run([sys.executable, str(self.repo/'scripts/backup_runtime.py'), 'resume', str(journal)],
                           env=env, check=True, stdout=subprocess.DEVNULL)
        self.public_heartbeat()
        cw_journal = self.root/'.chatwoot-quiescence.json'
        if cw_journal.exists():
            require(self.config.get('chatwootConfig'), 'Chatwoot resume requires original host allowlist')
            env = dict(os.environ, BACKUP_CHATWOOT_CONFIG=self.config['chatwootConfig'],
                       COMPOSE_PROJECT_NAME=self.config['project'], COMPOSE_FILE=self.config['composeFile'],
                       ENV_FILE=self.config['envFile'], BACKUP_EXECUTION_OWNER=self.owner)
            env.pop('BACKUP_JOB_ID', None)
            subprocess.run([sys.executable,str(self.repo/'scripts/backup_chatwoot.py'),'resume',str(cw_journal)],env=env,check=True)
        self.reconcile()
        try:
            self.schedule()
        except (ValueError, KeyError, TypeError, AttributeError):
            self.event('BACKUP_SCHEDULE_INVALID')
        row = self.claim()
        if not row:
            return
        self.event('BACKUP_EXECUTOR_CLAIMED', row['id'])
        try:
            self.execute(row, fd)
        except Exception:
            attempts = row['metadata']['job']['attempts']
            status = 'FAILED' if attempts >= 3 else 'PENDING'
            retry = dict(nextAttemptAt=(dt.datetime.now(UTC)+dt.timedelta(seconds=60*2**attempts)).isoformat(), progress=0)
            self.fenced_update(row['id'], 'status='+literal(status)+",\"errorMessage\"='Host executor failed; inspect private journal',metadata=jsonb_set(metadata,'{job}',metadata->'job'||"+literal(json.dumps(retry))+"::jsonb)")
            self.event('BACKUP_EXECUTOR_FAILED', row['id'], dict(attempts=attempts))
            raise
        # Completion is durable before maintenance. Its failure must never enter
        # capture retry handling or rewrite completed-backup telemetry.
        job = row['metadata'].get('job', {})
        kind = job.get('kind', 'BACKUP') if isinstance(job, dict) else 'BACKUP'
        if kind == 'BACKUP':
            try:
                self.automatic_retention()
            except Exception:
                self.event('BACKUP_RETENTION_FAILED', row['id'])


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    agent = Agent(read_json(args.config))
    while True:
        try:
            agent.cycle()
        except Exception:
            print('Backup executor cycle failed; inspect private journal/configuration', file=sys.stderr)
            if args.once:
                raise SystemExit(1)
        if args.once:
            return
        time.sleep(max(5, int(agent.config.get('pollSeconds', 15))))


if __name__ == '__main__':
    main()
