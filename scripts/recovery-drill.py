#!/usr/bin/env python3
"""Restore an untrusted backup only into a new, disposable, offline Docker project.

No uploaded Compose/scripts/images execute. PostgreSQL image is supplied by host
operator and must already exist by exact image ID. Outputs remain private.
"""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
import threading
import time
import datetime as dt
from backup_archive import digest, read_json, require, validate_directory, scan_tar, disk_budget
from backup_runtime import atomic_json, fingerprints

WALL_SECONDS = 300
MEMORY_BYTES = 768 * 1024**2
DATA_BYTES = 512 * 1024**2


def bounded_run(command, deadline, max_output=8*1024**2, **kwargs):
    """Wallclock and pipe budget without buffering arbitrary child output to disk."""
    remaining = deadline-time.monotonic()
    if remaining <= 0:
        raise subprocess.TimeoutExpired(command, 0)
    capture = kwargs.pop('capture_output', False)
    text = kwargs.pop('text', False)
    data = kwargs.pop('input', None)
    check = kwargs.pop('check', True)
    kwargs.setdefault('stdout', subprocess.PIPE if capture else subprocess.DEVNULL)
    kwargs.setdefault('stderr', subprocess.PIPE if capture else subprocess.DEVNULL)
    if data is not None:
        kwargs['stdin'] = subprocess.PIPE
        data = data.encode() if isinstance(data, str) else data
    process = subprocess.Popen(command, start_new_session=(os.name == 'posix'), **kwargs)
    exceeded, lock = threading.Event(), threading.Lock()
    used = 0
    outputs = [[], []]

    def kill():
        try:
            if os.name == 'posix':
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
        except ProcessLookupError:
            pass

    def read(stream, chunks):
        nonlocal used
        if stream is None:
            return
        try:
            for block in iter(lambda: stream.read(65536), b''):
                with lock:
                    used += len(block)
                    if used > max_output:
                        exceeded.set()
                        kill()
                        break
                    chunks.append(block)
        finally:
            stream.close()

    def write():
        try:
            process.stdin.write(data)
            process.stdin.flush()
        except (BrokenPipeError, OSError):
            pass
        finally:
            process.stdin.close()

    threads = [threading.Thread(target=read, args=(stream, chunks), daemon=True)
               for stream, chunks in zip((process.stdout, process.stderr), outputs)]
    if data is not None:
        threads.append(threading.Thread(target=write, daemon=True))
    for thread in threads:
        thread.start()
    try:
        process.wait(timeout=max(0.001, deadline-time.monotonic()))
    except BaseException:
        kill()
        process.wait(timeout=5)
        raise
    finally:
        for thread in threads:
            thread.join(timeout=max(0.001, min(1, deadline-time.monotonic())))
    require(not exceeded.is_set(), 'recovery child exceeded output budget')
    if any(thread.is_alive() for thread in threads):
        kill()
        raise subprocess.TimeoutExpired(command, max(0, remaining))
    values = [b''.join(chunks) for chunks in outputs]
    if text:
        values = [value.decode('utf8') for value in values]
    result = subprocess.CompletedProcess(command, process.returncode, *values)
    if check:
        result.check_returncode()
    return result


def enforce_resources(info):
    host = info['HostConfig']
    require(0 < host.get('Memory', 0) <= MEMORY_BYTES
            and host.get('MemorySwap') == host.get('Memory')
            and 0 < host.get('NanoCpus', 0) <= 1000000000
            and 0 < host.get('PidsLimit', 0) <= 128, 'PostgreSQL resource limits not enforced')
    require(host.get('ReadonlyRootfs') is True and host.get('Privileged') is False
            and host.get('LogConfig', {}).get('Type') == 'none'
            and not host.get('Binds') and not host.get('Devices')
            and not host.get('PidMode') and not host.get('IpcMode') == 'host', 'unsafe recovery writable host access')
    mounts = info.get('Mounts', [])
    require(all(m.get('Type') == 'tmpfs' for m in mounts), 'recovery storage must be bounded tmpfs only')
    configured = host.get('Tmpfs', {})
    limits = {'/var/lib/postgresql/data': DATA_BYTES, '/var/run/postgresql': 16*1024**2, '/tmp': 16*1024**2}
    require(set(configured) == set(limits), 'unexpected writable recovery storage')
    for path, maximum in limits.items():
        options = configured[path].split(',')
        size = next((v[5:] for v in options if v.startswith('size=')), '')
        match = re.fullmatch(r'(\d+)([kmg]?)', size.lower())
        require(match is not None, 'missing tmpfs storage budget')
        value = int(match[1]) * (1024**{'': 0, 'k': 1, 'm': 2, 'g': 3}[match[2]])
        require(0 < value <= maximum and all(v in options for v in ('noexec', 'nosuid', 'nodev')),
                'tmpfs storage budget not enforced')
    require(0 < host.get('ShmSize', 0) <= 16*1024**2, 'shared memory storage budget not enforced')


def project_guard(project, deadline=None):
    deadline = deadline or time.monotonic()+30
    require(re.fullmatch(r'yo-recovery-[a-z0-9-]{6,40}', project), 'new yo-recovery-* project required')
    for resource in ('container', 'volume', 'network'):
        args = ['docker', 'ps', '-aq'] if resource == 'container' else ['docker', resource, 'ls', '-q']
        output = bounded_run(args+['--filter', 'label=com.docker.compose.project='+project], deadline, check=True,
                                text=True, capture_output=True).stdout.strip()
        require(not output, 'recovery project already has resources')


def pinned_image(image, deadline=None):
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', image), 'installed exact PostgreSQL image ID required')
    info = json.loads(bounded_run(['docker', 'image', 'inspect', image], deadline or time.monotonic()+30, check=True, capture_output=True, text=True).stdout)[0]
    require(info['Id'] == image and info.get('Os') == 'linux', 'invalid image identity')
    # Operator supplies trusted PostgreSQL image, never imported archive image IDs.
    return info


def drill(backup, project, image, output, retain=False):
    os.umask(0o077)
    started_mono = time.monotonic()
    started_utc = dt.datetime.now(dt.timezone.utc).isoformat()
    deadline = started_mono+WALL_SECONDS
    result = validate_directory(backup, deadline=deadline)
    require(not output.exists() and output.is_absolute(), 'new absolute output directory required')
    image_info = pinned_image(image, deadline)
    project_guard(project, deadline)
    output.mkdir(mode=0o700, parents=True)
    disk_budget(output, sum(i['sizeBytes'] for i in result['inventory']), len(result['inventory']))
    env_file = output/'drill.env'
    env_file.write_text('RECOVERY_POSTGRES_IMAGE='+image+'\nRECOVERY_PASSWORD='+secrets.token_hex(32)+'\n')
    trusted_compose = Path(__file__).resolve().parents[1]/'docker-compose.recovery-drill.yml'
    compose_file = output/'recovery-compose.yml'
    compose_file.write_bytes(trusted_compose.read_bytes())
    compose = ['docker', 'compose', '--env-file', str(env_file), '-p', project, '-f', str(compose_file)]

    def call(args, **kwargs):
        return bounded_run(compose+args, deadline, check=True, **kwargs)

    def sql(query, database='recovery_target'):
        return call(['exec', '-T', '-e', 'PGOPTIONS=-c statement_timeout=30000 -c lock_timeout=10000', 'postgres', 'psql', '-U', 'backup_test', '-d', database, '-X', '-At', '-v', 'ON_ERROR_STOP=1'],
                    input=query, text=True, capture_output=True).stdout.strip()

    started = False
    report = dict(status='FAILED', project=project, outboundDisabled=True, workersStarted=False,
                  startedAt=started_utc, sourceCreatedAt=result['manifest'].get('created_at'),
                  measurement='ISOLATED_DRILL', productionRtoVerified=False,
                  sourceFormat=result['formatVersion'], sourceConsistent=result['consistent'], executionMode='agent-fenced' if os.environ.get('BACKUP_EXECUTION_OWNER') else 'offline-artifact-isolated')
    report.update(references=dict(sourceBackupId=result['manifest'].get('backup_id', backup.name),
                                 sourceStoragePath=backup.name, sourceChecksum=result['checksum'],
                                 sourceManifestChecksum=result['checksum'],
                                 archiveChecksum=digest(backup/'archive.tar.gz', deadline) if (backup/'archive.tar.gz').is_file() else None,
                                 sourceArtifactChecksum=digest(backup/'SHA256SUMS', deadline)),
                  resources=dict(memoryBytes=MEMORY_BYTES, dataBytes=DATA_BYTES, cpus=1, pids=128,
                                 wallSeconds=WALL_SECONDS, statementTimeoutMs=30000, volatile=True))
    try:
        # Inspect rendered trusted Compose: no ports, only postgres, internal network.
        config = json.loads(call(['config', '--format', 'json'], capture_output=True, text=True).stdout)
        require(set(config['services']) == {'postgres'} and not config['services']['postgres'].get('ports'), 'unsafe recovery services')
        require(all(n.get('internal') is True for n in config['networks'].values()), 'network must be internal')
        started = True
        call(['up', '-d', '--wait', '--wait-timeout', '90'], stdout=subprocess.DEVNULL)
        cid = call(['ps', '-q', 'postgres'], capture_output=True, text=True).stdout.strip()
        info = json.loads(bounded_run(['docker', 'inspect', cid], deadline, check=True, text=True, capture_output=True).stdout)[0]
        require(info.get('Config', {}).get('Labels', {}).get('com.docker.compose.project') == project, 'container project mismatch')
        enforce_resources(info)
        require(not info['HostConfig'].get('PortBindings') and len(info['NetworkSettings']['Networks']) == 1, 'unexpected network/ports')
        for network in info['NetworkSettings']['Networks'].values():
            actual = json.loads(bounded_run(['docker', 'network', 'inspect', network['NetworkID']], deadline, check=True, text=True, capture_output=True).stdout)[0]
            require(actual['Internal'] is True and actual['Labels'].get('com.docker.compose.project') == project, 'network isolation not enforced')
        sql('CREATE DATABASE recovery_target;', 'recovery_control')
        # The legacy restore.sh guard requires named volumes. This trusted drill
        # restores directly only after the stronger, actually inspected tmpfs gate.
        uploads = output/'uploads'
        uploads.mkdir(mode=0o700)
        with (backup/'postgres.dump').open('rb') as source:
            call(['exec', '-T', 'postgres', 'pg_restore', '--list'], stdin=source, stdout=subprocess.DEVNULL)
            source.seek(0)
            call(['exec', '-T', '-e', 'PGOPTIONS=-c statement_timeout=30000 -c lock_timeout=10000',
                  'postgres', 'pg_restore', '-U', 'backup_test', '-d', 'recovery_target',
                  '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction'],
                 stdin=source, stdout=subprocess.DEVNULL)
        if sql("SELECT to_regclass('public.\"Backup\"') IS NOT NULL;") == 't':
            sql('UPDATE "Backup" SET status=\'FAILED\',"errorMessage"=\'Nonterminal metadata reconciled after restore\',"updatedAt"=CURRENT_TIMESTAMP WHERE status IN (\'PENDING\',\'RUNNING\',\'VERIFYING\',\'RESTORING\');')
        scan_tar(backup/'uploads.tar.gz', target=uploads, deadline=deadline)
        statements = sql("SELECT 'SELECT json_build_object('||quote_literal(schemaname||'.'||tablename)||',count(*)) FROM '||quote_ident(schemaname)||'.'||quote_ident(tablename)||';' FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,tablename;")
        counts = {}
        for line in sql(statements).splitlines():
            counts.update(json.loads(line))
        if result['formatVersion'] == 3:
            require(counts == read_json(backup/'table-counts.json'), 'restored table counts differ')
        actual_fingerprints = fingerprints(sql)
        if (backup/'table-fingerprints.json').exists():
            require(actual_fingerprints == read_json(backup/'table-fingerprints.json'), 'restored business table fingerprints differ')
        for item in result['inventory']:
            path = uploads/item['path']
            require(path.is_file() and path.stat().st_size == item['sizeBytes'] and digest(path, deadline) == item['sha256'], 'restored file differs')
        # DB-native FK validation proves local relational constraints after restoration.
        unvalidated = sql("SELECT count(*) FROM pg_constraint WHERE contype='f' AND NOT convalidated;")
        require(unvalidated == '0', 'unvalidated foreign keys')
        from backup_references import check
        reference_report = check(sql, {i['path'] for i in result['inventory']})
        report['fileReferences'] = reference_report
        require(reference_report['status'] == 'PASS', 'missing known domain local-file references')
        current = validate_directory(backup, deadline=deadline)
        require(current['checksum'] == report['references']['sourceChecksum']
                and digest(backup/'SHA256SUMS', deadline) == report['references']['sourceArtifactChecksum'], 'drill source changed')
        report.update(status='PASS', tableCounts=counts, fileCount=len(result['inventory']),
                      fileBytes=sum(i['sizeBytes'] for i in result['inventory']),
                      fileReferences=reference_report,
                      foreignKeysValidated=True, tableFingerprints=actual_fingerprints, postgresImage=image_info['Id'])
        return report
    finally:
        if started and not (retain and report['status'] == 'PASS'):
            # Only this freshly guarded project's volumes may be removed.
            try:
                bounded_run(compose+['down', '--volumes', '--remove-orphans', '--timeout', '5'],
                            time.monotonic()+30, stdout=subprocess.DEVNULL)
                report['cleanup'] = 'PASS'
            except BaseException:
                report.update(status='FAILED', cleanup='FAILED_OPERATOR_ACTION_REQUIRED',
                              finishedAt=dt.datetime.now(dt.timezone.utc).isoformat(),
                              elapsedSeconds=round(time.monotonic()-started_mono, 6))
                atomic_json(output/'drill-report.json', report)
                raise
        elif started:
            report.update(prepared=False, targetMode='QUARANTINED_VOLATILE', postgresStopped=False,
                          volatile=True, dataLostOnStop=True, productionRestoreAllowed=False,
                          composeFile=str(compose_file), envFile=str(env_file), uploadsPath=str(output/'uploads'))
        report.update(finishedAt=dt.datetime.now(dt.timezone.utc).isoformat(),
                      elapsedSeconds=round(time.monotonic()-started_mono, 6))
        atomic_json(output/'drill-report.json', report)
        if report['status'] == 'PASS':
            # A source checksum binds the successful restore to these exact bytes.
            atomic_json(backup/'drill-report.json', report)
        if not (retain and report['status'] == 'PASS'):
            env_file.unlink(missing_ok=True)


def hashlib_sha(value):
    import hashlib
    return hashlib.sha256(value.encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup-dir', type=Path, required=True)
    parser.add_argument('--project', required=True)
    parser.add_argument('--postgres-image', required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--retain-target', action='store_true', help='Leave quarantined VOLATILE tmpfs PostgreSQL running on PASS; stopping destroys data')
    args = parser.parse_args()
    import importlib.util
    spec = importlib.util.spec_from_file_location('backup_agent', Path(__file__).with_name('backup-agent.py'))
    agent = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(agent)
    if os.environ.get('BACKUP_LOCK_FD'):
        result = drill(args.backup_dir.resolve(), args.project, args.postgres_image, args.output_dir, args.retain_target)
    else:
        with agent.host_lock(args.backup_dir.resolve().parent) as fd:
            os.environ['BACKUP_LOCK_FD'] = str(fd)
            result = drill(args.backup_dir.resolve(), args.project, args.postgres_image, args.output_dir, args.retain_target)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
