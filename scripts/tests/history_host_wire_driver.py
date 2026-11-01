"""Owned integration-test driver. No Docker, database, credentials or host config.

The parent Node test owns the actual HistoryHostHandler. JSON-line RPC replaces
only Docker transport, SQL/fences and physical agent execution, never issuer
schema validation, agent target selection or immutable grant publication.
"""
import contextlib
import datetime as dt
import importlib.util
import json
import re
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import history_operational_grant as issuer

spec = importlib.util.spec_from_file_location('owned_wire_backup_agent', Path(__file__).resolve().parents[1]/'backup-agent.py')
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


def rpc(kind, **fields):
    print(json.dumps(dict(kind=kind, **fields)), flush=True)
    line = sys.stdin.readline(issuer.MAX_WIRE_BYTES+1)
    if not line or len(line) > issuer.MAX_WIRE_BYTES:
        raise ValueError('Owned test RPC closed')
    return json.loads(line)


def main():
    root, job_id, scenario = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    if not root.is_absolute() or not root.name.startswith('history-host-wire-') or root.resolve().parent != Path(tempfile.gettempdir()).resolve():
        raise ValueError('Owned temporary fixture required')
    grants = root/'grants'
    config = dict(project='owned-wire-test', repositoryRoot=str(root), envFile=str(root/'synthetic.env'),
                  composeFile=str(root/'synthetic-compose.json'), storageRoot=str(root/'storage'),
                  historyOperationalGrantsRoot=str(grants))
    worker = object.__new__(agent.Agent)
    worker.root = root/'storage'; worker.root.mkdir(exist_ok=True)
    worker.repo = root; worker.config = config
    worker.owner, worker.lease_seconds, worker.lease_lost = 'a'*32, 180, False
    claims, events, argv_seen = [], [], []

    def sql(query):
        if scenario == 'agent-metadata' and query.startswith('SELECT row_to_json(b)'):
            source = re.search(r"WHERE id='([^']+)'", query).group(1)
            return json.dumps(rpc('source', jobId=source)['row'])
        claims.append(query)
        reply = rpc('claim', query=query)
        return json.dumps(reply['row']) if reply.get('row') else ''

    def execute(row, fd):
        if fd != 7:
            raise AssertionError('Unexpected owned lock')
        if scenario == 'agent-metadata':
            return execute_metadata(row, fd)
        if not rpc('execute', jobId=row['id']).get('ok'):
            raise ValueError('Synthetic physical execution refused')

    def fail_if_called(*args, **kwargs):
        raise AssertionError('Targeted run must not schedule or retain unrelated work')

    worker.sql = sql; worker.execute = execute
    worker.public_heartbeat = lambda: None
    worker.reconcile = lambda: None
    worker.schedule = worker.automatic_retention = fail_if_called
    worker.event = lambda event, backup_id=None, detail=None: events.append(dict(event=event, backupId=backup_id))
    worker.fenced_update = lambda backup_id, *args, **kwargs: rpc('failed', jobId=backup_id).get('id')

    def node_run(args, **kwargs):
        expected = ['exec', '-T', '--user', '0', '--workdir', '/app/apps/api', '-e',
                    'HISTORY_OPERATIONAL_HOST_ENABLED=true', 'api', 'node', 'dist/history-migration/history-host-cli.js']
        if args[-len(expected):] != expected or kwargs['stderr'] != issuer.subprocess.DEVNULL:
            raise AssertionError('Fixed host transport changed')
        request = json.loads(kwargs['input'])
        reply = rpc('host', input=request)
        return SimpleNamespace(returncode=reply['code'], stdout=reply['stdout'].encode('utf-8'))

    def agent_start(args, **kwargs):
        if args[-5:-1] != ['--config', str(root/'synthetic-agent.json'), '--once', '--job-id']:
            raise AssertionError('Agent was not invoked with a target')
        target = agent.target_job_id(args[-1]); argv_seen.append(args[-5:])
        def wait(timeout):
            try:
                with patch.object(agent, 'host_lock', return_value=contextlib.nullcontext(7)), \
                     patch.object(agent.backup_lease, 'acquire', return_value=scenario != 'lease-denied'), \
                     patch.object(agent.backup_lease, 'heartbeat', return_value=True), \
                     patch.object(agent.backup_lease, 'release'):
                    worker.cycle(target)
                return 0
            except Exception:
                return 1
        return SimpleNamespace(wait=wait)

    def execute_metadata(row, fd):
        # Real Agent.execute builds SQL/result/root metadata. Only external
        # capture/restore and archive validation are synthetic local boundaries.
        backup_id = row['id']
        archive_bytes = b'owned-wire-archive'
        archive_hash = agent.hashlib.sha256(archive_bytes).hexdigest()
        def child(args, lock_fd, target):
            if target != backup_id or lock_fd != fd:
                raise AssertionError('Physical fixture target drift')
            if args[:2] == ['bash', 'scripts/backup.sh']:
                path = worker.root/backup_id
                path.mkdir()
                (path/'archive.tar.gz').write_bytes(archive_bytes)
                if args[2:] != ['data', '--backup-id', backup_id, '--output-dir', str(worker.root)]:
                    raise AssertionError('Backup invocation drift')
            elif args[1] == 'scripts/recovery-drill.py':
                output = Path(args[args.index('--output-dir')+1])
                output.mkdir()
                source = row['metadata']['job']['sourceBackupId']
                if Path(args[args.index('--backup-dir')+1]) != worker.root/source:
                    raise AssertionError('Drill invocation drift')
                report = dict(status='PASS', cleanup='PASS', references=dict(sourceBackupId=source,
                    sourceStoragePath=source, sourceChecksum='e'*64, sourceManifestChecksum='e'*64,
                    sourceArtifactChecksum='1'*64, archiveChecksum=archive_hash))
                agent.atomic_json(output/'drill-report.json', report)
                agent.atomic_json(worker.root/source/'drill-report.json', report)
            else:
                raise AssertionError('Unexpected physical fixture command')
        def validate(path, expected):
            if path.name != expected:
                raise AssertionError('Validation target drift')
            return dict(formatVersion=3, checksum='e'*64, sizeBytes=999,
                manifest=dict(backup_id=expected, files=[], consistency={}), coverage={})
        def fenced(backup, fields, **kwargs):
            # Decode the SQL literals produced by the actual Agent, not a
            # hand-written imitation of its metadata completion logic.
            match = re.search(r"metadata->'job'\|\|'((?:[^']|'')*)'::jsonb\)\|\|'((?:[^']|'')*)'::jsonb", fields)
            if not match:
                raise AssertionError('Completion SQL schema changed')
            payload, metadata = [json.loads(part.replace("''", "'")) for part in match.groups()]
            return rpc('agent-completion', jobId=backup, payload=payload, metadata=metadata,
                checksum=re.search(r'"checksum"=\'([^\']+)\'', fields).group(1),
                sizeBytes=int(re.search(r'"sizeBytes"=(\d+)', fields).group(1)))['id']
        class FixtureDateTime(dt.datetime):
            @classmethod
            def now(cls, tz=None):
                return dt.datetime.fromisoformat(rpc('clock')['utc'].replace('Z', '+00:00'))
        with patch.object(worker, 'child', child, create=True), patch.object(worker, 'fenced_update', fenced), \
             patch.object(agent, 'validate_directory', validate), \
             patch.object(agent, 'local_consistency', return_value=dict(verified=True, trust='VERIFIED_LOCAL_QUIESCENCE')), \
             patch.object(agent, 'version_fields', return_value=''), \
             patch.object(agent, 'dt', SimpleNamespace(datetime=FixtureDateTime)):
            agent.Agent.execute(worker, row, fd)

    commands = issuer.HostCommands(root/'synthetic-agent.json', config, node_run=node_run, agent_start=agent_start)
    publisher = issuer.AtomicGrantPublisher(grants)
    # Harmonized owned clock is an explicit test boundary, not a claim that
    # independent Windows/Python/Node clocks have native-host precision proof.
    # The precision-window case exercises issuer flooring at a sub-ms boundary.
    def clock():
        current = dt.datetime.fromisoformat(rpc('clock')['utc'].replace('Z', '+00:00'))
        return current+dt.timedelta(microseconds=500) if scenario == 'precision-window' else current
    status, result, error, code, attempts = 'PASS', None, None, None, []
    for _ in range(2 if scenario == 'retry-nested' else 1):
        try:
            result = issuer.IssueOrchestrator(commands, commands, publisher, clock=clock, max_seconds=30, max_polls=3, poll_seconds=1).issue(job_id)
            status, error, code = 'PASS', None, None
        except Exception as failure:
            status, error = 'REFUSED', type(failure).__name__
            code = str(failure) if isinstance(failure, issuer.GrantError) else None
        attempts.append(dict(status=status, code=code))
        if status == 'PASS':
            break
    files = list(grants.iterdir())
    print(json.dumps(dict(kind='done', status=status, result=result, error=error, code=code,
        files=[p.name for p in files], argv=argv_seen, claims=len(claims), events=events, attempts=attempts)), flush=True)


if __name__ == '__main__':
    main()
