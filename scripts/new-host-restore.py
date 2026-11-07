#!/usr/bin/env python3
"""Restore a trusted DATA/FULL archive as a durable, quarantined local CRM."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import socket
import socketserver
import stat
import subprocess
import tempfile
import threading
import time

from backup_archive import (
    MAX_BYTES, MAX_SECONDS, InvalidArchive, digest, disk_budget, read_json,
    require, scan_tar, validate_directory,
)
from backup_references import check as check_references
from backup_runtime import atomic_json, fingerprints

spec = importlib.util.spec_from_file_location('recovery_drill', Path(__file__).with_name('recovery-drill.py'))
drill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(drill)

ROLES = ('postgres', 'redis', 'api', 'web')
DB = 'yocrm'
USER = 'yocrm_restore'
PGDATA = '/var/lib/postgresql/data'
UPLOADS = '/app/uploads'
LOCAL_PORT = 33502
ISOLATED_GATEWAY = 'com.docker.network.bridge.gateway_mode_ipv4'


def local_context(deadline, selected=None):
    # Compose and the drill helpers must address the same local engine. Ignore
    # inherited remote host, context, Compose project and env-file overrides.
    for key in tuple(os.environ):
        if key.upper().startswith(('DOCKER_', 'COMPOSE_')):
            os.environ.pop(key)
    context = selected or drill.bounded_run(['docker', 'context', 'show'], deadline,
                                capture_output=True, text=True).stdout.strip()
    require(re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]*', context), 'invalid Docker context name')
    endpoint = drill.bounded_run(['docker', 'context', 'inspect', context, '--format',
                                  '{{.Endpoints.docker.Host}}'], deadline,
                                 capture_output=True, text=True).stdout.strip()
    require(endpoint.startswith('unix:///') or endpoint.startswith('npipe:////./pipe/'),
            'a local Docker socket is required')
    os.environ['DOCKER_CONTEXT'] = context
    engine = drill.bounded_run(['docker', '--context', context, 'version', '--format', '{{.Server.Os}} {{.Server.Version}}'], deadline,
                               capture_output=True, text=True).stdout.strip()
    version = re.fullmatch(r'linux (\d+)\.[^ ]+', engine)
    require(version and int(version[1]) >= 28, 'Linux Docker Engine 28 or later required')
    return context


def check_docker(deadline, selected=None):
    context = local_context(deadline, selected)
    for resource in (['ps', '-aq'], ['volume', 'ls', '-q'], ['network', 'ls', '-q']):
        existing = drill.bounded_run(
            ['docker', '--context', context, *resource, '--filter',
             'label=com.docker.compose.project=yoleotard-crm'],
            deadline, capture_output=True, text=True,
        ).stdout.strip()
        require(not existing, 'the Docker engine contains working CRM project resources')
    return context


def settings_key(path):
    if path is None:
        return secrets.token_hex(32)
    require(os.name == 'posix', 'owner key file requires POSIX permissions')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as key_file:
        info = os.fstat(key_file.fileno())
        require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
                and info.st_uid == os.geteuid(), 'owner key file must be a private mode-0600 regular file')
        raw = key_file.read(4097)
    key = raw.removesuffix(b'\n').removesuffix(b'\r')
    require(len(raw) <= 4096 and len(key.decode('utf-8').strip()) >= 32
            and all(byte >= 32 and byte != 127 for byte in key), 'invalid settings key file')
    return key.decode('utf-8')


def compose_config(project, images, uploads, password):
    def service(role, **options):
        return dict(image=images[role], pull_policy='never', networks=['quarantine'],
                    security_opt=['no-new-privileges:true'], **options)

    def health(*command):
        return dict(test=['CMD', *command], interval='2s', timeout='3s', retries=30)

    return dict(name=project, services=dict(
        postgres=service('postgres',
                         environment=dict(POSTGRES_DB=DB, POSTGRES_USER=USER, POSTGRES_PASSWORD=password),
                         volumes=[dict(type='volume', source='database', target=PGDATA)],
                         healthcheck=health('pg_isready', '-h', '127.0.0.1', '-U', USER, '-d', DB)),
        redis=service('redis', tmpfs=['/data'], healthcheck=health('redis-cli', 'ping')),
        api=service('api', entrypoint=['node', 'dist/main.js'], command=[], working_dir='/app/apps/api',
                    env_file=[dict(path='./api.env', format='raw')],
                    environment=dict(APP_ENV='recovery-isolated', NODE_ENV='production', AUTH_DISABLED='false',
                                     DATABASE_URL=f'postgresql://{USER}:{password}@postgres:5432/{DB}?schema=public',
                                     REDIS_URL='redis://redis:6379', API_PORT='4500', UPLOADS_DIR=UPLOADS,
                                     ALLOW_RESTORE='false', HISTORY_OPERATIONAL_HOST_ENABLED='false',
                                     HISTORY_MIGRATION_OPERATIONAL_ENABLED='false'),
                    volumes=[dict(type='bind', source=str(uploads).replace('$', '$$'), target=UPLOADS,
                                  bind=dict(create_host_path=False))],
                    healthcheck=health('node', '-e',
                                      "fetch('http://127.0.0.1:4500/api/health').then(async r=>"
                                      "{if(!r.ok || !(await r.json()).ok) process.exit(1)}).catch(()=>process.exit(1))")),
        web=service('web', entrypoint=['node', '/app/apps/web/server.js'], command=[],
                    environment=dict(PORT='3500', HOSTNAME='127.0.0.1',
                                     API_INTERNAL_BASE_URL='http://api:4500/api'),
                    healthcheck=health('node', '-e',
                                      "fetch('http://127.0.0.1:3500/api/health').then(async r=>"
                                      "{if(!r.ok || !(await r.json()).ok) process.exit(1)}).catch(()=>process.exit(1))"))
    ), volumes=dict(database={}), networks=dict(quarantine=dict(internal=True, driver='bridge',
                                                                  driver_opts={ISOLATED_GATEWAY: 'isolated'})))


def inspect_service(call, role, project, image, uploads, deadline, *, before_start=False):
    cid = call(['ps', '-a', '-q', role], capture_output=True, text=True).stdout.splitlines()
    require(len(cid) == 1, 'expected one restore container')
    info = json.loads(drill.bounded_run(['docker', 'inspect', cid[0]], deadline,
                                       capture_output=True, text=True).stdout)[0]
    labels = info['Config']['Labels']
    require(info['Image'] == image and labels.get('com.docker.compose.project') == project
            and labels.get('com.docker.compose.service') == role,
            'unexpected restore container identity')
    host = info['HostConfig']
    require(not host['Privileged'] and not host.get('Devices'), 'unexpected privileged container')
    require(not host.get('PortBindings'), 'unexpected host ports')
    mounts = info['Mounts']
    if role == 'api':
        expected = os.path.normcase(str(uploads.resolve(strict=True)))
        require(len(mounts) == 1 and mounts[0]['Type'] == 'bind'
                and mounts[0]['Destination'] == UPLOADS and mounts[0]['RW']
                and os.path.normcase(mounts[0]['Source']) == expected,
                'unexpected uploads mount')
    if before_start:
        require(info['State']['Status'] == 'created', 'restore container must not have started')
        return

    networks = list(info['NetworkSettings']['Networks'].values())
    require(len(networks) == 1, 'unexpected container networks')
    network = json.loads(drill.bounded_run(['docker', 'network', 'inspect', networks[0]['NetworkID']], deadline,
                                          capture_output=True, text=True).stdout)[0]
    require(network['Internal'] and network['Labels']['com.docker.compose.project'] == project
            and network['Options'].get(ISOLATED_GATEWAY) == 'isolated', 'network isolation is not enforced')
    if role == 'postgres':
        require(len(mounts) == 1 and mounts[0]['Type'] == 'volume'
                and mounts[0]['Name'] == project+'_database' and mounts[0]['Destination'] == PGDATA,
                'unexpected PostgreSQL volume')
    elif role != 'api':
        require(all(mount['Type'] == 'tmpfs' and mount['Destination'] == '/data' for mount in mounts),
                'unexpected runtime mounts')


def restore_database(call, source, result):
    pgoptions = ['-e', 'PGOPTIONS=-c statement_timeout=30000 -c lock_timeout=10000']

    def sql(query):
        return call(['exec', '-T', *pgoptions, 'postgres', 'psql', '-U', USER, '-d', DB,
                     '-X', '-At', '-v', 'ON_ERROR_STOP=1'], input=query,
                    capture_output=True, text=True).stdout.strip()

    major = int(sql('SHOW server_version_num;')) // 10000
    require(re.match(r'^' + str(major) + r'\b', result['manifest']['database_version']),
            'PostgreSQL major does not match backup')
    with (source/'postgres.dump').open('rb') as dump:
        call(['exec', '-T', 'postgres', 'pg_restore', '--list'], stdin=dump)
        dump.seek(0)
        call(['exec', '-T', *pgoptions, 'postgres', 'pg_restore', '-U', USER, '-d', DB,
              '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction'], stdin=dump)

    artifacts = set(result['manifest']['files'])
    if 'table-counts.json' in artifacts:
        expected = read_json(source/'table-counts.json')
        statements = sql("SELECT format('SELECT json_build_object(%L,count(*)) FROM %I.%I;',"
                         "schemaname||'.'||tablename,schemaname,tablename) FROM pg_tables "
                         "WHERE schemaname NOT IN ('pg_catalog','information_schema');")
        counts = {}
        for row in sql(statements).splitlines():
            counts.update(json.loads(row))
        require(counts == expected, 'restored table counts differ')
    if 'table-fingerprints.json' in artifacts:
        require(fingerprints(sql) == read_json(source/'table-fingerprints.json'),
                'restored business fingerprints differ')
    require(sql("SELECT count(*) FROM pg_constraint WHERE contype='f' AND NOT convalidated;") == '0',
            'unvalidated foreign keys')
    references = check_references(sql, {item['path'] for item in result['inventory']})
    require(references['status'] == 'PASS', 'missing known local file references')
    return references


def restore(args):
    os.umask(0o077)
    archive = args.archive.absolute()
    target = args.target.parent.resolve()/args.target.name
    require(archive.is_file() and not archive.is_symlink(), 'a regular archive file is required')
    require(not target.exists() and not target.is_symlink() and target.parent.is_dir(),
            'target must be a new directory with an existing parent')
    require(re.fullmatch(r'[a-fA-F0-9]{64}', args.sha256), 'expected SHA-256 must be 64 hex digits')
    args.sha256 = args.sha256.lower()
    require(0 < archive.stat().st_size <= MAX_BYTES, 'archive size outside limit')
    deadline = time.monotonic()+MAX_SECONDS
    require(digest(archive, deadline) == args.sha256, 'archive SHA-256 mismatch')
    disk_budget(target.parent, archive.stat().st_size)
    key = settings_key(args.settings_key_file)
    target.mkdir(mode=0o700)
    # Freeze the operator's exact bytes privately before extracting or using SQL.
    # A concurrent source modification cannot swap verified bytes for another dump.
    with tempfile.TemporaryDirectory(prefix='archive-', dir=target) as temporary:
        stage = Path(temporary)
        frozen = stage/'archive.tar.gz'
        with archive.open('rb') as original, frozen.open('xb') as copy:
            size = 0
            for block in iter(lambda: original.read(1024**2), b''):
                size += len(block)
                require(size <= MAX_BYTES and time.monotonic() < deadline, 'archive copy budget exceeded')
                copy.write(block)
        require(digest(frozen, deadline) == args.sha256, 'archive SHA-256 mismatch')
        source = stage/'artifacts'
        source.mkdir()
        scan_tar(frozen, target=source, deadline=deadline)
        result = validate_directory(source, deadline=deadline)
        require(result['formatVersion'] == 3 or
                (result['formatVersion'] == 2 and result['manifest']['type'] == 'data'),
                'DATA format 2 or DATA/FULL format 3 required')
        uploads = target/'uploads'
        uploads.mkdir()
        require(scan_tar(source/'uploads.tar.gz', target=uploads, deadline=deadline) == result['inventory'],
                'restored upload inventory differs')
        start_runtime(args, source, target, uploads, result, key)


def start_runtime(args, source, target, uploads, result, key):
    deadline = time.monotonic()+drill.WALL_SECONDS
    images = {role: getattr(args, role+'_image') for role in ROLES}
    require(all(images.values()), 'supply all four trusted image IDs')
    context = check_docker(deadline, args.docker_context)
    image_info = [drill.pinned_image(image, deadline) for image in images.values()]
    require(len({info['Architecture'] for info in image_info}) == 1, 'image architectures differ')
    project = 'yo-recovery-'+secrets.token_hex(10)
    drill.project_guard(project, deadline)
    volume = project+'_database'
    existing_volume = drill.bounded_run(['docker', 'volume', 'ls', '-q', '--filter', 'name='+volume],
                                        deadline, capture_output=True, text=True).stdout.strip()
    require(not existing_volume, 'restore volume name is already in use')
    config = target/'compose.json'
    env_file = target/'compose.env'
    env_file.touch()
    (target/'api.env').write_text('SETTINGS_ENCRYPTION_KEY='+key+'\n', encoding='utf-8')
    atomic_json(config, compose_config(project, images, uploads, secrets.token_hex(32)))
    command = ['docker', '--context', context, 'compose', '-p', project,
               '--env-file', str(env_file), '-f', str(config)]

    def call(argv, **kwargs):
        return drill.bounded_run(command+argv, deadline, **kwargs)

    report = dict(status='FAILED', project=project, databaseVolume=volume,
                  dockerContext=context, images=images,
                  sourceArchiveSha256=args.sha256, sourceBackupId=result['manifest']['backup_id'],
                  sourceType=result['manifest']['type'], sourceFormat=result['formatVersion'],
                  sourceCommit=result['manifest']['git_commit'], sourceConsistent=False,
                  fileCount=len(result['inventory']), cutoverAllowed=False,
                  settingsKeyMode='OWNER_FILE' if args.settings_key_file else 'LOCAL_GENERATED',
                  cleanup='FAILED_OPERATOR_ACTION_REQUIRED')
    atomic_json(target/'restore-report.json', report)
    try:
        call(['create', '--no-build', '--pull', 'never'])
        inspect_service(call, 'api', project, images['api'], uploads, deadline, before_start=True)
        call(['start', '--wait', '--wait-timeout', '90', 'postgres'])
        inspect_service(call, 'postgres', project, images['postgres'], uploads, deadline)
        report['fileReferences'] = restore_database(call, source, result)
        call(['start', '--wait', '--wait-timeout', '90'])
        for role in ROLES:
            inspect_service(call, role, project, images[role], uploads, deadline)
        # Verify quarantine through the same web origin used by the browser.
        probe = (
            "const u='http://127.0.0.1:3500/api'; Promise.all(["
            "fetch(u+'/integrations/website/orders',{method:'POST'}),"
            "fetch(u+'/orders',{method:'POST'})]).then(async rs=>{"
            "for(const r of rs) if(r.status!==503 || (await r.json()).code!=='RECOVERY_READ_ONLY') process.exit(1)"
            "}).catch(()=>process.exit(1))"
        )
        call(['exec', '-T', 'web', 'node', '-e', probe])
        report.update(status='PASS', cleanup='NOT_NEEDED', durable=True, appMode='recovery-isolated',
                      productionRtoVerified=False)
        atomic_json(target/'restore-report.json', report)
    except BaseException:
        # The project and volume name were unused before this attempt. Clean
        # only its failed candidate; successful restores retain their volume.
        report.update(status='FAILED', cleanup='FAILED_OPERATOR_ACTION_REQUIRED')
        try:
            cleanup = drill.bounded_run(command+['down', '--volumes', '--timeout', '5'],
                                        time.monotonic()+45, check=False)
            if cleanup.returncode == 0:
                report['cleanup'] = 'PASS'
        except (OSError, subprocess.SubprocessError, InvalidArchive):
            pass
        try:
            atomic_json(target/'restore-report.json', report)
        except OSError:
            # The initial receipt already marks the attempt for operator review.
            pass
        raise
    print(json.dumps(report))


# The relay has no Docker network attachment or published container ports.
# Docker exec connects stdio to the web process in its existing namespace.
WEB_RELAY = (
    "const s=require('node:net').connect(3500,'127.0.0.1');"
    "s.setTimeout(30000,()=>s.destroy());s.on('error',()=>s.destroy());"
    "s.on('close',()=>process.exit());process.stdin.pipe(s);s.pipe(process.stdout);"
)


def open_web(target, port):
    receipt = read_json(target/'restore-report.json')
    require(receipt['status'] == 'PASS' and receipt['appMode'] == 'recovery-isolated',
            'successful isolated restore receipt required')
    deadline = time.monotonic()+30
    context = check_docker(deadline, receipt['dockerContext'])
    command = ['docker', '--context', context, 'compose', '-p', receipt['project'],
               '--env-file', str(target/'compose.env'),
               '-f', str(target/'compose.json')]

    def call(argv, **kwargs):
        return drill.bounded_run(command+argv, deadline, **kwargs)

    inspect_service(call, 'web', receipt['project'], receipt['images']['web'], target/'uploads', deadline)

    class Relay(socketserver.BaseRequestHandler):
        def handle(self):
            self.request.settimeout(30)
            relay = [*command, 'exec', '-T', 'web', 'node', '-e', WEB_RELAY]
            with subprocess.Popen(relay, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL) as process:
                def upload():
                    try:
                        for block in iter(lambda: self.request.recv(65536), b''):
                            process.stdin.write(block)
                            process.stdin.flush()
                    except OSError:
                        pass
                    finally:
                        process.stdin.close()

                reader = threading.Thread(target=upload, daemon=True)
                reader.start()
                try:
                    for block in iter(lambda: process.stdout.read1(65536), b''):
                        self.request.sendall(block)
                except OSError:
                    pass
                finally:
                    try:
                        self.request.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
                    if process.poll() is None:
                        process.kill()
                    reader.join()

    class LoopbackServer(socketserver.ThreadingTCPServer):
        allow_reuse_address = os.name == 'posix'

    with LoopbackServer(('127.0.0.1', port), Relay) as server:
        server.daemon_threads = True
        print(f'http://127.0.0.1:{server.server_address[1]} (Ctrl+C to close)', flush=True)
        server.serve_forever()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, help='Trusted packed archive.tar.gz')
    parser.add_argument('--sha256', help='Archive SHA-256 received independently from the owner')
    parser.add_argument('--target', type=Path, help='New private state directory')
    parser.add_argument('--settings-key-file', type=Path, help='Optional owner-provided POSIX mode-0600 file')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--open', action='store_true', help='Open a temporary loopback browser tunnel')
    mode.add_argument('--check-docker', action='store_true', help='Check the local engine before loading images')
    parser.add_argument('--docker-context', help='Explicit local Docker context for preflight and restore')
    parser.add_argument('--port', type=int, default=LOCAL_PORT, help='Local tunnel port')
    for role in ROLES:
        # Archive verification can run before requiring any Docker inputs.
        parser.add_argument('--'+role+'-image', help='Trusted locally installed exact image ID')
    args = parser.parse_args()
    try:
        if args.check_docker:
            require(args.docker_context, '--check-docker requires --docker-context')
            print(check_docker(time.monotonic()+30, args.docker_context))
            return
        require(args.target, 'restore and --open require --target')
        if args.open:
            require(0 <= args.port <= 65535, 'invalid local port')
            open_web(args.target.absolute(), args.port)
        else:
            require(args.archive and args.sha256, 'restore requires --archive and --sha256')
            restore(args)
    except KeyboardInterrupt:
        if not args.open:
            parser.exit(130, 'Restore interrupted.\n')
    except subprocess.CalledProcessError as error:
        # Do not print command output or PostgreSQL errors which can contain data.
        if '-f' in error.cmd:
            operation = error.cmd[error.cmd.index('-f')+2]
        else:
            operation = error.cmd[1]
        parser.exit(1, f'Restore stopped: Docker operation {operation} failed (exit {error.returncode}).\n')
    except subprocess.TimeoutExpired:
        parser.exit(1, 'Restore stopped: operation timed out.\n')
    except (InvalidArchive, OSError, ValueError) as error:
        parser.exit(1, f'Restore stopped: {error}\n')


if __name__ == '__main__':
    main()
