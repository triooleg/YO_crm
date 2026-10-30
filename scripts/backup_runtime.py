#!/usr/bin/env python3
"""Host-only capture helpers for existing backup.sh. No credentials in output."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import time
import signal
import uuid
import backup_lease
from backup_archive import ID, digest, read_json, require, scan_tar, secret_path, validate_directory


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def atomic_json(path, value):
    path = Path(path)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with temp.open('x', encoding='utf8') as out:
        os.chmod(temp, 0o600)
        json.dump(value, out)
        out.flush()
        os.fsync(out.fileno())
    os.replace(temp, path)
    fsync_directory(path.parent)


def fsync_directory(path):
    if os.name != 'posix':
        return
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def version_fields(manifest):
    return ''.join(',"'+column+'"=\''+str(manifest[key]).replace("'", "''")+"'"
                   for column, key in [('appVersion','app_version'), ('gitCommit','git_commit'),
                                       ('databaseVersion','database_version'), ('schemaVersion','schema_version')]
                   if manifest.get(key) is not None)


def compose():
    return ['docker', 'compose', '--env-file', os.environ.get('ENV_FILE', '.env'),
            '-p', os.environ.get('COMPOSE_PROJECT_NAME', 'yoleotard-crm'),
            '-f', os.environ.get('COMPOSE_FILE', 'docker-compose.portainer.yml')]


def sql(query):
    return run(compose()+['exec', '-T', '-e', 'PGAPPNAME=backup-host-agent', 'postgres', 'sh', '-c',
        'exec psql --username="$POSTGRES_USER" --dbname="${1:-$POSTGRES_DB}" -X -q -At -v ON_ERROR_STOP=1',
        'sh', os.environ.get('BACKUP_DATABASE_OVERRIDE', '')],
        input=query, text=True, capture_output=True, timeout=15).stdout.strip()


def container(service):
    ids = run(compose()+['ps', '-a', '-q', service], text=True, capture_output=True).stdout.split()
    require(len(ids) == 1, 'service must have exactly one configured container: '+service)
    info = json.loads(run(['docker', 'inspect', ids[0]], text=True, capture_output=True).stdout)[0]
    require(info['Config']['Labels'].get('com.docker.compose.project') == os.environ.get('COMPOSE_PROJECT_NAME', 'yoleotard-crm'), 'container project mismatch')
    return info


def quiesce(journal):
    services = json.loads(os.environ.get('BACKUP_WRITER_SERVICES', '[]'))
    require(isinstance(services, list) and services and 'api' in services and
            all(isinstance(s, str) and re.fullmatch('[a-zA-Z0-9_-]+', s) and s not in ('postgres', 'redis') for s in services),
            'Explicit complete writer service set including api is required')
    require(os.environ.get('BACKUP_WRITERS_COMPLETE') == 'true', 'Writer inventory must be explicitly attested complete')
    require(not journal.exists(), 'unresolved quiescence journal; resume it first')
    infos = [container(s) for s in services]
    # Persist exact pre-state before the first stop. Only initially running IDs resume.
    state = dict(phase='STOPPING', project=os.environ.get('COMPOSE_PROJECT_NAME', 'yoleotard-crm'),
                 owner=os.environ['BACKUP_EXECUTION_OWNER'], jobId=os.environ['BACKUP_JOB_ID'],
                 containers=[i['Id'] for i in infos if i['State']['Running']])
    require_execution(state['jobId'])
    atomic_json(journal, state)
    for cid in state['containers']:
        require_execution(state['jobId'], margin=90)
        run(['docker', 'stop', '--time', '60', cid], stdout=subprocess.DEVNULL, timeout=75)
    for service in services:
        require(not container(service)['State']['Running'], 'writer did not stop')
    # Refuse even idle unaccounted database clients. Agent's own psql is excluded.
    require(sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend' AND application_name<>'backup-host-agent';") == '0', 'unaccounted database writers/readers remain')
    state.update(phase='QUIESCED', services=services, verified=True)
    atomic_json(journal, state)


def resume(journal):
    if not journal.exists():
        return
    state = read_json(journal)
    project = os.environ.get('COMPOSE_PROJECT_NAME', 'yoleotard-crm')
    require(state.get('project') == project, 'resume project mismatch')
    owner = os.environ.get('BACKUP_EXECUTION_OWNER', '')
    backup_lease.owner_valid(owner)
    require(sql('SELECT '+backup_lease.fence(owner)+';') == 't', 'resume execution ownership lost')
    own_job = os.environ.get('BACKUP_JOB_ID')
    if own_job:
        require(state.get('owner') == owner and state.get('jobId') == own_job, 'journal belongs to another capture')
        require_execution(own_job)
    else:
        # A replacement may adopt only an expired job, never another live worker.
        job = state.get('jobId')
        require(isinstance(job, str) and ID.fullmatch(job), 'unbound legacy journal requires operator review')
        require(sql("SELECT NOT EXISTS (SELECT 1 FROM \"Backup\" WHERE id='"+job+"' AND status IN ('RUNNING','VERIFYING','RESTORING') AND (metadata#>>'{job,leaseExpiresAt}' IS NULL OR (metadata#>>'{job,leaseExpiresAt}')::timestamptz>CURRENT_TIMESTAMP));") == 't', 'journal belongs to active worker')
        state['owner'] = owner
        atomic_json(journal, state)
    for cid in state['containers']:
        # Renew before each bounded Docker action. An expired owner cannot renew.
        require(backup_lease.heartbeat(sql, owner), 'resume execution ownership lost')
        if own_job:
            require_execution(own_job, margin=90)
        info = json.loads(run(['docker', 'inspect', cid], text=True, capture_output=True, timeout=15).stdout)[0]
        require(info['Config']['Labels'].get('com.docker.compose.project') == project, 'resume container mismatch')
        if not info['State']['Running']:
            run(['docker', 'start', cid], stdout=subprocess.DEVNULL, timeout=60)
    journal.unlink()
    fsync_directory(journal.parent)


def table_counts():
    # quote_ident from PostgreSQL, not interpolation of untrusted identifiers.
    statements = sql("SELECT 'SELECT json_build_object(' || quote_literal(schemaname||'.'||tablename) || ', count(*)) FROM ' || quote_ident(schemaname)||'.'||quote_ident(tablename)||';' FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,tablename;")
    result = {}
    for line in sql(statements).splitlines():
        result.update(json.loads(line))
    return result


def fingerprints(execute=sql):
    tables = execute("SELECT json_build_object('schema',schemaname,'table',tablename) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,tablename;")
    result = {}
    quote = lambda name: '"'+name.replace('"','""')+'"'
    for line in tables.splitlines():
        item = json.loads(line)
        schema, table = item['schema'], item['table']
        if table == 'Backup':
            continue
        where = " WHERE action NOT LIKE 'BACKUP%'" if table == 'AuditLog' else " WHERE section <> 'backups'" if table == 'AppSetting' else ''
        query = 'SELECT json_build_object(\'count\',count(*),\'md5\',md5(COALESCE(string_agg(h,\'\' ORDER BY h),\'\'))) FROM (SELECT md5(to_jsonb(t)::text) h FROM '+quote(schema)+'.'+quote(table)+' t'+where+') rows;'
        result[schema+'.'+table] = json.loads(execute(query))
    return dict(algorithm='md5-sorted-row-jsonb', excluded=['Backup','AuditLog.action BACKUP%','AppSetting.section backups'], tables=result)


def capture_uploads(destination):
    info = container('api')
    require(not info['State']['Running'], 'consistent file capture requires stopped API')
    mounts = [m for m in info['Mounts'] if m['Destination'] == '/app/uploads']
    require(len(mounts) == 1, 'exact persistent uploads mount required')
    mount = mounts[0]
    require(mount['Type'] in ('volume', 'bind'), 'unsupported uploads mount')
    source = mount.get('Name') if mount['Type'] == 'volume' else mount.get('Source')
    require(isinstance(source, str) and source and ',' not in source, 'unsafe mount source')
    # Use exact API runtime image as a tar-only helper, with no API ENV/command.
    image = info['Image']
    require(re.fullmatch('sha256:[a-f0-9]{64}', image), 'exact helper image required')
    with destination.open('xb') as out:
        run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
             '--cap-add', 'DAC_OVERRIDE', '--security-opt', 'no-new-privileges:true',
             '--mount', 'type='+mount['Type']+',source='+source+',target=/capture,readonly',
             '--entrypoint', 'tar', image, '-C', '/capture', '-czf', '-', '.'], stdout=out)


def space_preflight(root):
    import shutil
    database_bytes = int(sql('SELECT pg_database_size(current_database());'))
    file_bytes = int(run(compose()+['exec','-T','api','sh','-c','du -sk /app/uploads | cut -f1'],
                         capture_output=True, text=True).stdout.strip())*1024
    require(shutil.disk_usage(root).free > database_bytes*2+file_bytes*2+128*1024**2,
            'insufficient disk space for database/files/archive')


def legacy_resource_runner():
    # Lazy import avoids recovery-drill's existing import of this module.
    import importlib.util
    spec = importlib.util.spec_from_file_location('legacy_recovery_drill', Path(__file__).with_name('recovery-drill.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def guard_isolated(deadline=None, runner=None):
    runner = runner or legacy_resource_runner()
    deadline = deadline or time.monotonic()+30
    def call(args):
        return runner.bounded_run(args, deadline, capture_output=True, text=True).stdout

    project = os.environ.get('COMPOSE_PROJECT_NAME', '')
    require(re.match(r'^(yo-recovery-|yocrm-drill-|yoleotard-crm-backup-drill)', project), 'isolated project name required')
    ids = call(compose()+['ps', '-a', '-q', 'postgres']).split()
    require(len(ids) == 1, 'exactly one isolated PostgreSQL container required')
    info = json.loads(call(['docker', 'inspect', ids[0]]))[0]
    require(re.fullmatch('[a-f0-9]{64}', info['Id']) is not None
            and info['Config']['Labels'].get('com.docker.compose.project') == project
            and info['Config']['Labels'].get('com.docker.compose.service') == 'postgres',
            'isolated PostgreSQL identity mismatch')
    runner.enforce_resources(info)
    require(not info['HostConfig'].get('PortBindings'), 'isolated PostgreSQL must not publish ports')
    networks = info['NetworkSettings']['Networks']
    require(networks, 'explicit isolated network required')
    for network in networks.values():
        actual = json.loads(call(['docker','network','inspect',network['NetworkID']]))[0]
        require(actual.get('Internal') is True and actual.get('Labels', {}).get('com.docker.compose.project') == project,
                'isolated project network required; egress forbidden')
    return info


def bounded_legacy_restore(script):
    """One wall budget for every legacy SQL step; kill server-side children on failure."""
    runner = legacy_resource_runner()
    deadline = time.monotonic()+runner.WALL_SECONDS
    # No SQL and no cleanup authority until all identity/resource/network gates pass.
    info = guard_isolated(deadline, runner)
    def control_sql(query):
        return runner.bounded_run(['docker', 'exec', '-i', '-e', 'PGAPPNAME=backup-host-agent',
            '-e', 'PGOPTIONS=-c statement_timeout=30000 -c lock_timeout=10000', info['Id'], 'sh', '-c',
            'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -X -q -At -v ON_ERROR_STOP=1'],
            deadline, input=query, capture_output=True, text=True).stdout.strip()

    environment = os.environ.copy()
    owner = environment.get('BACKUP_EXECUTION_OWNER', '')
    acquired = False
    owns_sandbox = False
    def interrupted(signum, frame):
        raise SystemExit(128+signum)
    handlers = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGTERM, signal.SIGINT)}
    try:
        if environment.get('BACKUP_OFFLINE_RECOVERY') != 'true':
            if owner:
                condition = backup_lease.fence(owner)
                seconds = runner.WALL_SECONDS+60
                condition += f''' AND EXISTS (SELECT 1 FROM "AppSetting" WHERE section='backups'
                    AND key='execution-lease' AND value->>'owner'='{owner}'
                    AND (value->>'expiresAt')::timestamptz>=CURRENT_TIMESTAMP+interval '{seconds} seconds')'''
                job = environment.get('BACKUP_JOB_ID') or environment.get('BACKUP_AGENT_JOB')
                if job:
                    condition += ' AND '+backup_lease.job_fence(owner, job)
                    condition += f''' AND EXISTS (SELECT 1 FROM "Backup" WHERE id='{job}'
                        AND (metadata#>>'{{job,leaseExpiresAt}}')::timestamptz>=CURRENT_TIMESTAMP+interval '{seconds} seconds')'''
                require(control_sql('SELECT '+condition+';') == 't', 'inherited execution lease lost or lease lifetime too short')
            else:
                owner = uuid.uuid4().hex
                # No job/watchdog needed: fixed TTL outlasts the entire hard
                # deadline and cleanup. Atomic acquisition serializes contenders.
                seconds = min(3600, runner.WALL_SECONDS+60)
                require(seconds >= runner.WALL_SECONDS+60, 'legacy wall budget exceeds lease limit')
                require(backup_lease.acquire(control_sql, owner, seconds=seconds), 'global execution lease busy')
                acquired = True
                environment['BACKUP_EXECUTION_OWNER'] = owner
        owns_sandbox = True
        # Docker exec attaches stdin even for commands such as printenv. Keep
        # the program out of that stream so a client cannot swallow later SQL.
        result = runner.bounded_run(['bash', '-c', script], deadline,
                                    stdin=subprocess.DEVNULL, capture_output=True,
                                    text=True, env=environment)
        if acquired:
            backup_lease.release(control_sql, owner)
        owns_sandbox = False
        print(result.stdout, end='')
    except BaseException:
        # Killing docker exec alone leaves PostgreSQL/COPY PROGRAM alive. Never
        # stop a project by name: only the exact fully guarded sandbox ID.
        if owns_sandbox:
            runner.bounded_run(['docker', 'kill', info['Id']], time.monotonic()+15,
                               capture_output=True, text=True)
        raise
    finally:
        for sig, handler in handlers.items():
            signal.signal(sig, handler)


def finalize(root, journal):
    m = read_json(root/'manifest.json')
    inventory = scan_tar(root/'uploads.tar.gz')
    # v2 has exactly two payloads. Keep its manifest bounded for the API reader.
    m.update(consistency=dict(verified=False, method='online-sequential'),
             coverage=dict(postgresql=True, uploads=True, chatwoot=False,
                           remoteMedia='external-pointers-only', secrets=False, redis=False))
    if not journal.exists():
        m.pop('inventory', None)
        m.update(file_count=len(inventory), file_bytes=sum(i['sizeBytes'] for i in inventory),
                 inventory_sha256=__import__('hashlib').sha256(json.dumps(inventory, sort_keys=True).encode()).hexdigest())
    if journal.exists():
        state = read_json(journal)
        require(state.get('owner') == os.environ.get('BACKUP_EXECUTION_OWNER') and
                state.get('jobId') == os.environ.get('BACKUP_JOB_ID'), 'quiescence ownership mismatch')
        require_execution(state['jobId'])
        require(state.get('verified') is True and state.get('phase') == 'QUIESCED', 'unverified quiescence')
        m.update(format_version=3, consistency=dict(verified=True, method='stopped-writers', services=state['services']))
        atomic_json(root/'inventory.json', inventory)
        atomic_json(root/'table-counts.json', table_counts())
        atomic_json(root/'table-fingerprints.json', fingerprints())
        from backup_references import check
        references = check(sql, {i['path'] for i in inventory})
        atomic_json(root/'file-references.json', references)
        require(references['status'] == 'PASS', 'missing known domain local-file references; source needs review')
        m['files'] += ['inventory.json', 'table-counts.json', 'table-fingerprints.json', 'file-references.json']
        if m['type'] == 'full':
            portable(root, m)
        if os.environ.get('BACKUP_CHATWOOT_CONFIG'):
            from backup_chatwoot import capture
            component = capture(root, journal.with_name('.chatwoot-quiescence.json'))
            m['coverage']['chatwoot'] = True
            m['chatwoot'] = component
            m['files'] += ['chatwoot-postgres.dump', 'chatwoot-media.tar.gz', 'chatwoot-inventory.json']
    atomic_json(root/'manifest.json', m)
    names = m['files'] + ['manifest.json']
    (root/'SHA256SUMS').write_text(''.join(digest(root/n)+'  '+n+'\n' for n in names))


def portable(root, manifest):
    repository = Path.cwd()
    # A release without .git is a byte-addressed source snapshot with its release
    # commit marker. Never falsely claim an uncommitted tree equals that commit.
    git = run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True) if (repository/'.git').exists() else None
    if git:
        paths = run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], capture_output=True).stdout.decode().split('\0')
        dirty = bool(run(['git', 'status', '--porcelain'], capture_output=True, text=True).stdout.strip())
    else:
        paths = []
        excluded = {'node_modules','dist','.next','.git','.local','coverage','__pycache__'}
        for base in ('apps','packages','scripts','docker'):
            for directory, dirs, files in os.walk(repository/base, followlinks=False):
                dirs[:] = [d for d in dirs if d not in excluded and not (Path(directory)/d).is_symlink()]
                paths += [str((Path(directory)/n).relative_to(repository)).replace('\\','/') for n in files
                          if not n.endswith(('.pyc','.log','.dump','.tar.gz'))]
        paths += [p.name for pattern in ('package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig*.json','docker-compose*.yml','.env.example','.release-commit','.deployed-commit') for p in repository.glob(pattern)]
        paths += [str(p.relative_to(repository)).replace('\\','/') for name in
                  ('docs/BACKUP_RESTORE.md', 'docs/BACKUP_RECOVERY_RUNBOOK.md') if (p := repository/name).is_file()]
        dirty = None
    paths += [str(p.relative_to(repository)).replace('\\','/') for pattern in ('scripts/backup*.py','scripts/backup*.sh','scripts/recovery*.py','scripts/recovery*.sh','docker-compose.recovery*.yml') for p in repository.glob(pattern)]
    paths = sorted(set(paths))
    require(manifest['git_commit'] != 'unknown', 'FULL v3 requires exact base/release commit')
    require((repository/'packages/database/prisma/migrations').is_dir(), 'portable migration sources missing')
    with tarfile.open(root/'application.tar.gz', 'w:gz') as tar:
        for name in paths:
            if not name or secret_path(name):
                continue
            path = repository/name
            require(path.is_file() and not path.is_symlink(), 'nonregular source file')
            tar.add(path, arcname=name, recursive=False)
    manifest['source_snapshot'] = dict(base_commit=manifest['git_commit'], dirty=dirty,
                                       archive_sha256=digest(root/'application.tar.gz'))
    services = run(compose()+['config', '--services'], capture_output=True, text=True).stdout.split()
    images = {}
    for service in services:
        info = container(service)
        image = json.loads(run(['docker', 'image', 'inspect', info['Image']], capture_output=True, text=True).stdout)[0]
        images[service] = dict(id=image['Id'], repoDigests=image.get('RepoDigests', []), architecture=image['Architecture'], os=image['Os'])
    atomic_json(root/'runtime-images.json', images)
    manifest['files'] += ['application.tar.gz', 'runtime-images.json']
    if os.environ.get('BACKUP_OFFLINE_IMAGES') == 'true':
        with (root/'runtime-images.tar').open('wb') as out:
            run(['docker', 'image', 'save']+sorted(set(i['id'] for i in images.values())), stdout=out)
        manifest['files'].append('runtime-images.tar')


def claim_cli(backup_id):
    require(ID.fullmatch(backup_id), 'invalid backup id')
    owner = os.environ.get('BACKUP_AGENT_OWNER', '')
    require(not owner or re.fullmatch('[a-f0-9]{32}', owner), 'invalid executor owner')
    kind = os.environ.get('BACKUP_TYPE', 'data').upper()
    require(kind in ('DATA', 'FULL'), 'invalid backup type')
    execution_owner = os.environ.get('BACKUP_EXECUTION_OWNER', '')
    backup_lease.owner_valid(execution_owner)
    require(sql('SELECT '+backup_lease.fence(execution_owner)+';') == 't', 'global execution lease required')
    # The shared host lock is already held. Never overwrite completed or active rows.
    if owner:
        query = f'''SELECT id FROM "Backup" WHERE id='{backup_id}' AND status='RUNNING' AND {backup_lease.job_fence(owner, backup_id)};'''
    else:
        backup_lease.reconcile(sql, execution_owner)
        require(sql("SELECT count(*) FROM \"Backup\" WHERE status IN ('RUNNING','VERIFYING','RESTORING');") == '0', 'another active job requires reconciliation')
        lease = f'''jsonb_build_object('kind','BACKUP','leaseOwner','{execution_owner}',
          'leaseExpiresAt',CURRENT_TIMESTAMP+interval '180 seconds','heartbeatAt',CURRENT_TIMESTAMP,'attempts',1)'''
        query = f'''INSERT INTO "Backup" (id,type,status,"storageProvider","storagePath","startedAt","createdAt","updatedAt",metadata)
         VALUES ('{backup_id}','{kind}','RUNNING','LOCAL','{backup_id}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,
         jsonb_build_object('job',{lease},'requestedVia','CLI'))
         ON CONFLICT(id) DO UPDATE SET status='RUNNING',"startedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP,
         metadata=jsonb_set(COALESCE("Backup".metadata,'{{}}'::jsonb),'{{job}}',{lease})
         WHERE "Backup".status='PENDING' AND "Backup".type='{kind}'
         AND COALESCE("Backup".metadata#>>'{{job,kind}}','BACKUP')='BACKUP' RETURNING id;'''
    print(sql(query))


def local_consistency(root, result):
    """Only a host-written receipt outside the archive can attest local capture."""
    fallback = dict(verified=False, method='artifact-claim-unverified', trust='UNVERIFIED',
                    claimed=result['manifest'].get('consistency'))
    receipt_path = root.parent/'.last-validation.json'
    if not receipt_path.is_file() or receipt_path.is_symlink():
        return fallback
    try:
        receipt = read_json(receipt_path)
        if (result['formatVersion'] == 3 and receipt.get('formatVersion') == 3
                and receipt.get('checksum') == result['checksum']
                and receipt.get('sizeBytes') == result['sizeBytes']
                and receipt.get('manifest', {}).get('backup_id') == root.name
                and receipt.get('consistent') is True
                and receipt.get('consistencyTrust') == 'VERIFIED_LOCAL_QUIESCENCE'):
            return dict(verified=True, method='stopped-writers', trust='VERIFIED_LOCAL_QUIESCENCE')
    except (ValueError, OSError, TypeError, AttributeError):
        pass
    return fallback


def complete_cli(root):
    result = validate_directory(root)
    m = result['manifest']
    archive = root/'archive.tar.gz'
    consistency = local_consistency(root, result)
    metadata = dict(coverage=result['coverage'], claimedCoverage=result.get('claimedCoverage'), consistency=consistency,
                    archive=dict(file='archive.tar.gz', checksum=digest(archive), bytes=str(archive.stat().st_size)),
                    verification=dict(status='PASS', kind='INTEGRITY', consistent=consistency['verified'], verifiedAt=__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()))
    # JSON encoded as hex avoids shell/SQL quoting of manifest strings.
    payload = json.dumps(metadata).encode().hex()
    query = f'''UPDATE "Backup" SET status='COMPLETED',"checksum"='{result['checksum']}',"sizeBytes"={result['sizeBytes']},
      "storagePath"='{root.name}',"completedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP{version_fields(m)},
      metadata=COALESCE(metadata,'{{}}'::jsonb)||convert_from(decode('{payload}','hex'),'UTF8')::jsonb
      WHERE id='{root.name}' AND status='RUNNING' AND {backup_lease.job_fence(os.environ['BACKUP_EXECUTION_OWNER'], root.name)}
      AND {backup_lease.fence(os.environ['BACKUP_EXECUTION_OWNER'])} RETURNING id;'''
    require(sql(query) == root.name, 'CLI completion ownership lost')
    import datetime as dt
    atomic_json(root/'.backup-owner',dict(owner='yo-backup-engine',backupId=root.name))
    atomic_json(root/'verification.json',dict(checksum=result['checksum'],verifiedAt=dt.datetime.now(dt.timezone.utc).isoformat()))


def require_execution(backup_id, margin=0):
    owner = os.environ['BACKUP_EXECUTION_OWNER']
    fence = backup_lease.fence(owner)+' AND '+backup_lease.job_fence(owner, backup_id)
    if margin:
        fence = fence.replace('>CURRENT_TIMESTAMP', ">CURRENT_TIMESTAMP+interval '"+str(int(margin))+" seconds'")
    require(sql('SELECT '+fence+';') == 't',
            'execution or job lease lost')


def drain_group(group, grace=5):
    """Kill descendants even when the group leader has already exited."""
    try:
        os.killpg(group, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic()+grace
    while time.monotonic() < deadline:
        try:
            os.killpg(group, 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)
    try:
        os.killpg(group, signal.SIGKILL)
    except ProcessLookupError:
        pass


def lease_tick(backup_id):
    owner = os.environ['BACKUP_EXECUTION_OWNER']
    # Drain before expiry, allowing bounded SQL/poll/drain time before takeover.
    require_execution(backup_id, margin=45)
    if not os.environ.get('BACKUP_AGENT_OWNER'):
        require(backup_lease.heartbeat(sql, owner), 'global lease lost')
        require(sql(f'''UPDATE "Backup" SET metadata=metadata||jsonb_build_object('job',metadata->'job'||
          jsonb_build_object('heartbeatAt',CURRENT_TIMESTAMP,'leaseExpiresAt',CURRENT_TIMESTAMP+interval '180 seconds'))
          WHERE id='{backup_id}' AND {backup_lease.fence(owner)} AND {backup_lease.job_fence(owner, backup_id)} RETURNING id;''') == backup_id,
          'CLI job lease lost')


def lease_watch(parent):
    # Independent of both shell and agent; never renew an agent's job on its behalf.
    os.setsid()
    fd = os.environ.get('BACKUP_LOCK_FD')
    if fd:
        try:
            os.close(int(fd))
        except OSError:
            pass
    backup_id = os.environ['BACKUP_JOB_ID']
    def identity(pid):
        # kill(pid,0) alone also succeeds for zombies and reused PIDs.
        stat = (Path('/proc')/str(pid)/'stat').read_text().rsplit(')', 1)[1].split()
        require(stat[0] != 'Z', 'capture supervisor exited')
        return stat[19]
    try:
        parent_identity = identity(parent)
        agent_pid = os.environ.get('BACKUP_PARENT_PID')
        agent_identity = identity(int(agent_pid)) if agent_pid else None
    except Exception:
        drain_group(parent)
        return
    while True:
        try:
            require(identity(parent) == parent_identity, 'capture PID changed')
            if agent_pid:
                require(identity(int(agent_pid)) == agent_identity, 'agent PID changed')
            lease_tick(backup_id)
        except Exception:
            drain_group(parent)
            return
        time.sleep(2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['quiesce', 'resume', 'finalize', 'counts', 'fingerprints', 'claim-cli', 'complete-cli', 'capture-uploads', 'space-preflight', 'guard-isolated', 'bounded-legacy-restore', 'lease-acquire', 'lease-release', 'lease-watch'])
    parser.add_argument('path', type=Path)
    parser.add_argument('--journal', type=Path)
    args = parser.parse_args()
    if args.command == 'quiesce':
        quiesce(args.path)
    elif args.command == 'resume':
        resume(args.path)
    elif args.command == 'counts':
        atomic_json(args.path, table_counts())
    elif args.command == 'fingerprints':
        atomic_json(args.path, fingerprints())
    elif args.command == 'claim-cli':
        claim_cli(str(args.path))
    elif args.command == 'complete-cli':
        complete_cli(args.path)
    elif args.command == 'capture-uploads':
        capture_uploads(args.path)
    elif args.command == 'space-preflight':
        space_preflight(args.path)
    elif args.command == 'guard-isolated':
        guard_isolated()
    elif args.command == 'bounded-legacy-restore':
        import sys
        bounded_legacy_restore(sys.stdin.read(1024*1024))
    elif args.command == 'lease-acquire':
        require(backup_lease.acquire(sql, os.environ['BACKUP_EXECUTION_OWNER']), 'another executor owns the global database lease')
    elif args.command == 'lease-release':
        backup_lease.release(sql, os.environ['BACKUP_EXECUTION_OWNER'])
    elif args.command == 'lease-watch':
        lease_watch(int(str(args.path)))
    else:
        finalize(args.path, args.journal)


if __name__ == '__main__':
    main()
