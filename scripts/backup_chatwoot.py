#!/usr/bin/env python3
"""Optional independent Chatwoot component capture; disabled unless host config set.

BACKUP_CHATWOOT_CONFIG=/private/allowlist.json explicitly supplies project,
webContainer, workerContainer, postgresContainer (full 64hex IDs), database,
storagePath=/app/storage, writersComplete=true. No discovery, passwords/ENV export
or production actions without installed operator configuration. Original
SECRET_KEY_BASE remains required separately. This is not a Chatwoot restore tool.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
from backup_archive import ID, read_json, require, scan_tar
from backup_runtime import atomic_json
import backup_runtime as runtime
import backup_lease


def inspect(cid):
    require(isinstance(cid, str) and re.fullmatch('[a-f0-9]{64}', cid), 'explicit full Chatwoot container ID required')
    return json.loads(subprocess.run(['docker', 'inspect', cid], check=True, capture_output=True, text=True, timeout=15).stdout)[0]


def configuration():
    path = os.environ.get('BACKUP_CHATWOOT_CONFIG')
    require(path and Path(path).is_absolute(), 'explicit Chatwoot host configuration required')
    config = read_json(Path(path))
    require(config.get('writersComplete') is True and config.get('storagePath') == '/app/storage', 'complete Chatwoot writer inventory required')
    require(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', config.get('database', '')), 'explicit database name required')
    infos = {key: inspect(config[key]) for key in ('webContainer', 'workerContainer', 'postgresContainer')}
    require(len({i['Id'] for i in infos.values()}) == 3, 'distinct Chatwoot containers required')
    for info in infos.values():
        require(info['Config']['Labels'].get('com.docker.compose.project') == config.get('project'), 'Chatwoot project allowlist mismatch')
    return config, infos


def resume(journal):
    if not journal.exists():
        return
    require(not journal.is_symlink(), 'Chatwoot journal link forbidden')
    state = read_json(journal)
    owner = os.environ.get('BACKUP_EXECUTION_OWNER', '')
    backup_lease.owner_valid(owner)
    require(runtime.sql('SELECT '+backup_lease.fence(owner)+';') == 't', 'Chatwoot resume execution ownership lost')
    job = state.get('jobId')
    require(isinstance(job, str) and ID.fullmatch(job), 'unbound Chatwoot journal requires operator review')
    own_job = os.environ.get('BACKUP_JOB_ID')
    if own_job:
        require(state.get('owner') == owner and job == own_job, 'Chatwoot journal belongs to another capture')
        runtime.require_execution(own_job)
    else:
        require(runtime.sql("SELECT NOT EXISTS (SELECT 1 FROM \"Backup\" WHERE id='"+job+"' AND status IN ('RUNNING','VERIFYING','RESTORING') AND (metadata#>>'{job,leaseExpiresAt}' IS NULL OR (metadata#>>'{job,leaseExpiresAt}')::timestamptz>CURRENT_TIMESTAMP));") == 't', 'Chatwoot journal belongs to active worker')
    config, infos = configuration()
    require(state.get('project') == config['project'], 'Chatwoot resume project mismatch')
    allowed = {config['webContainer'], config['workerContainer']}
    require(set(state['containers']).issubset(allowed), 'Chatwoot journal not in allowlist')
    state['owner'] = owner
    atomic_json(journal, state)
    for cid in state['containers']:
        require(backup_lease.heartbeat(runtime.sql, owner), 'Chatwoot resume execution ownership lost')
        if own_job:
            runtime.require_execution(own_job, margin=90)
        if not inspect(cid)['State']['Running']:
            subprocess.run(['docker', 'start', cid], check=True, stdout=subprocess.DEVNULL, timeout=60)
    journal.unlink()
    runtime.fsync_directory(journal.parent)


def capture(root, journal):
    require(not journal.exists(), 'unresolved Chatwoot journal')
    owner = os.environ.get('BACKUP_EXECUTION_OWNER', '')
    job = os.environ.get('BACKUP_JOB_ID', '')
    backup_lease.owner_valid(owner)
    require(ID.fullmatch(job) and root.name == job, 'Chatwoot capture job identity required')
    runtime.require_execution(job)
    config, infos = configuration()
    web = infos['webContainer']
    mounts = [m for m in web['Mounts'] if m['Destination'] == '/app/storage']
    require(len(mounts) == 1 and mounts[0]['Type'] == 'volume', 'explicit persistent Chatwoot storage volume required')
    mount = mounts[0]
    worker_mounts = [m for m in infos['workerContainer']['Mounts'] if m['Destination'] == '/app/storage']
    require(len(worker_mounts) == 1 and worker_mounts[0].get('Name') == mount['Name'], 'Chatwoot writers must share configured storage')
    state = dict(phase='STOPPING', project=config['project'], owner=owner, jobId=job,
                 containers=[infos[k]['Id'] for k in ('webContainer','workerContainer') if infos[k]['State']['Running']])
    runtime.require_execution(job)
    atomic_json(journal, state)
    try:
        for cid in state['containers']:
            runtime.require_execution(job, margin=90)
            subprocess.run(['docker', 'stop', '--time', '60', cid], check=True, stdout=subprocess.DEVNULL, timeout=75)
        require(all(not inspect(config[k])['State']['Running'] for k in ('webContainer','workerContainer')), 'Chatwoot writer did not stop')
        query = 'SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type=\'client backend\';'
        command = ['docker','exec','-i', config['postgresContainer'],'sh','-c',
                   'exec psql --username="${POSTGRES_USER:-postgres}" --dbname="$1" -X -q -At -v ON_ERROR_STOP=1','sh',config['database']]
        remaining = subprocess.run(command, input=query, check=True, capture_output=True, text=True, timeout=30).stdout.strip()
        require(remaining == '0', 'unaccounted Chatwoot database clients remain')
        runtime.require_execution(job)
        state.update(phase='QUIESCED', verified=True)
        atomic_json(journal, state)
        with (root/'chatwoot-postgres.dump').open('xb') as out:
            subprocess.run(['docker','exec',config['postgresContainer'],'sh','-c',
                            'exec pg_dump --username="${POSTGRES_USER:-postgres}" --dbname="$1" --format=custom','sh',config['database']], check=True, stdout=out, timeout=120)
        runtime.require_execution(job)
        with (root/'chatwoot-media.tar.gz').open('xb') as out:
            subprocess.run(['docker','run','--rm','--network','none','--read-only','--security-opt','no-new-privileges:true',
                '--mount','type=volume,source='+mount['Name']+',target=/capture,readonly','--entrypoint','tar',web['Image'],
                '-C','/capture','-czf','-','.'], check=True, stdout=out, timeout=120)
        inventory = scan_tar(root/'chatwoot-media.tar.gz')
        atomic_json(root/'chatwoot-inventory.json', inventory)
        runtime.require_execution(job)
        return dict(included=True, consistent=True, database=config['database'], mediaFiles=len(inventory),
                    imageIds={k:i['Image'] for k,i in infos.items()}, secretKeyBaseIncluded=False,
                    restoreVerified=False, scope='separate component snapshot; no cross-database atomicity claim')
    finally:
        resume(journal)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['capture','resume'])
    parser.add_argument('path', type=Path)
    parser.add_argument('--journal', type=Path)
    args = parser.parse_args()
    if args.command == 'resume':
        resume(args.path)
    else:
        print(json.dumps(capture(args.path, args.journal)))
