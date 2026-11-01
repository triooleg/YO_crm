"""One-shot host issuer using the EXISTING targeted backup-agent and Node CLI.

CLI input is only host config and job UUID, never context, reports or secrets.
Deployment still requires reviewed Node/agent implementations and an API read-only
grant mount. An in-process capability is not a sandbox against malicious Python
code. This module delegates physical verification and sealing to the trusted
runtime; it neither implements backups nor copies the secret-box credentials.
"""
import argparse
import datetime as dt
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import uuid
import weakref

# Code readiness is not deployment/host-permission or real-target acceptance.
ISSUER_READY = False
PURPOSE = 'OPERATIONAL_NATIVE_BACKUP_GRANT_V1'
MAX_GRANT_BYTES = 64 * 1024
CONTEXT_KEYS = frozenset(('jobId', 'actorId', 'clientId', 'sourceDigest', 'previewDigest',
                          'candidateSnapshot', 'targetIdentity', 'migrationSetDigest'))
EVIDENCE_KEYS = frozenset(('backupId', 'captureStartedAt', 'manifestSha256', 'sha256sumsSha256',
                           'archiveSha256', 'archiveBytes', 'drillJobId', 'drillReportSha256', 'drillFinishedAt'))
_RUNS = weakref.WeakKeyDictionary()
_PREPARED = weakref.WeakKeyDictionary()


class GrantError(ValueError):
    pass


def _require(value, code='OPERATIONAL_GRANT_INVALID'):
    if not value:
        raise GrantError(code)


def _exact(value, keys):
    _require(type(value) is dict and set(value) == set(keys))
    return value


def _text(value, maximum=256):
    _require(type(value) is str and 0 < len(value) <= maximum and value == value.strip()
             and not re.search(r'[\x00-\x1f\x7f]', value))


def _uuid(value):
    _require(type(value) is str and re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', value, re.I))


def _digest(value):
    _require(type(value) is str and re.fullmatch('[a-f0-9]{64}', value))


def _uint(value):
    _require(type(value) is str and re.fullmatch('[1-9][0-9]{0,19}', value) and int(value) <= 18446744073709551615)


def _timestamp(value):
    _require(type(value) is str and re.fullmatch(
        r'\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)', value))
    try:
        result = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        _require(result.tzinfo is not None and result.utcoffset() is not None)
        return result
    except (ValueError, OverflowError):
        raise GrantError('OPERATIONAL_GRANT_TIME_INVALID') from None


def _validate_context(context):
    _exact(context, CONTEXT_KEYS)
    _uuid(context['jobId']); _text(context['actorId']); _text(context['clientId'])
    for key in ('sourceDigest', 'previewDigest', 'candidateSnapshot', 'migrationSetDigest'):
        _digest(context[key])
    target = _exact(context['targetIdentity'], ('cluster', 'databaseName', 'databaseOid'))
    _uint(target['cluster']); _text(target['databaseName'], 63)
    _require(type(target['databaseOid']) is int and 0 < target['databaseOid'] <= 4294967295)


def _validate_evidence(evidence):
    _exact(evidence, EVIDENCE_KEYS)
    for key in ('backupId', 'drillJobId'):
        _require(type(evidence[key]) is str and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{7,127}', evidence[key]))
    for key in ('manifestSha256', 'sha256sumsSha256', 'archiveSha256', 'drillReportSha256'):
        _digest(evidence[key])
    _uint(evidence['archiveBytes'])
    _require(_timestamp(evidence['captureStartedAt']) <= _timestamp(evidence['drillFinishedAt']))


def _encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))


class VerifiedRun:
    """Opaque local capability, not a deserializable caller report."""
    __slots__ = ('__weakref__',)

    def __new__(cls):
        raise GrantError('OWNED_RUN_REQUIRED')


class PreparedGrant:
    """Detached payload for the future trusted secret-box runtime call."""
    __slots__ = ('__weakref__',)

    def __new__(cls):
        raise GrantError('PREPARED_GRANT_REQUIRED')

    @property
    def payload(self):
        _require(self in _PREPARED, 'PREPARED_GRANT_REQUIRED')
        return json.loads(_PREPARED[self])


def _record_verified_run(context, evidence):
    """Private handoff AFTER our runner gets authenticated VERIFY_EVIDENCE.

    Never use this as admission for a caller report. Only the owned orchestration
    and synthetic unit fixtures populate it; no CLI option supplies these facts.
    """
    _validate_context(context); _validate_evidence(evidence)
    capability = object.__new__(VerifiedRun)
    _RUNS[capability] = _encode(dict(context=context, evidence=evidence))
    return capability


def build_grant_payload(run, *, now=None, grant_id=None, lifetime_seconds=600):
    _require(type(run) is VerifiedRun and run in _RUNS, 'OWNED_RUN_REQUIRED')
    record = json.loads(_RUNS[run])
    context, evidence = record['context'], record['evidence']
    _validate_context(context); _validate_evidence(evidence)
    current = now if now is not None else dt.datetime.now(dt.timezone.utc)
    _require(type(current) is dt.datetime and current.tzinfo is not None and current.utcoffset() is not None)
    _require(type(lifetime_seconds) is int and 0 < lifetime_seconds <= 7200)
    capture, drill = _timestamp(evidence['captureStartedAt']), _timestamp(evidence['drillFinishedAt'])
    _require(capture <= drill <= current and dt.timedelta(0) <= current-capture < dt.timedelta(seconds=7200), 'CAPTURE_STALE_OR_FUTURE')
    # JS Date has millisecond precision. Floor issuance only; retain the
    # actual clock for freshness/expiry and never relax the server future guard.
    issued = current.replace(microsecond=(current.microsecond//1000)*1000)
    _require(drill <= issued, 'CAPTURE_STALE_OR_FUTURE')
    expires = min(current+dt.timedelta(seconds=lifetime_seconds), capture+dt.timedelta(seconds=7200))
    identifier = str(uuid.uuid4()) if grant_id is None else grant_id
    _uuid(identifier)
    payload = dict(**context, **evidence, version=1, purpose=PURPOSE, grantId=identifier,
                   issuedAt=issued.astimezone(dt.timezone.utc).isoformat(timespec='microseconds'),
                   expiresAt=expires.astimezone(dt.timezone.utc).isoformat(timespec='microseconds'))
    prepared = object.__new__(PreparedGrant)
    _PREPARED[prepared] = _encode(payload)
    return prepared


def _identity(info):
    return info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid


def _host_owned(info):
    if os.name == 'posix':
        _require(info.st_uid == 0 and info.st_mode & 0o022 == 0, 'HOST_ONLY_WRITABLE_REQUIRED')


def _root_snapshot(root):
    result = []
    for path in [*reversed(root.parents), root]:
        info = path.lstat()
        _require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and info.st_ino > 0, 'UNSAFE_GRANTS_ROOT')
        result.append((path, _identity(info)))
    _host_owned(info)
    _require(os.path.normcase(str(root.resolve())) == os.path.normcase(str(root)), 'UNSAFE_GRANTS_ROOT')
    return result


def _same_root(snapshot):
    for path, expected in snapshot:
        current = path.lstat()
        _require(not stat.S_ISLNK(current.st_mode) and _identity(current) == expected, 'GRANTS_ROOT_CHANGED')


def _sealed_bytes(value):
    _require(type(value) is bytes and 0 < len(value) <= MAX_GRANT_BYTES, 'SEALED_GRANT_REQUIRED')
    try:
        parts = value.decode('ascii').split('.')
        _require(len(parts) == 4 and parts[0] == 'v1', 'SEALED_GRANT_REQUIRED')
        decoded = []
        for part in parts[1:]:
            _require(re.fullmatch('[A-Za-z0-9_-]+', part), 'SEALED_GRANT_REQUIRED')
            raw = base64.urlsafe_b64decode(part+'='*((-len(part)) % 4))
            _require(base64.urlsafe_b64encode(raw).rstrip(b'=').decode('ascii') == part, 'SEALED_GRANT_REQUIRED')
            decoded.append(raw)
        _require(len(decoded[0]) == 12 and decoded[1] and len(decoded[2]) == 16, 'SEALED_GRANT_REQUIRED')
    except (ValueError, UnicodeError):
        raise GrantError('SEALED_GRANT_REQUIRED') from None


class AtomicGrantPublisher:
    """Fixed HOST configuration, never a caller path. Does not seal or verify AES.

    Root must already exist with root-only write permission, exposed read-only
    to the API. POSIX ownership is checked; Windows ACLs are a deployment
    prerequisite. Only a trusted runtime sealer may supply ciphertext. A
    structurally valid ciphertext alone is not evidence of a completed backup.
    """
    def __init__(self, grants_root):
        raw = os.fspath(grants_root)
        _require(type(raw) is str and raw and '\0' not in raw and not raw.startswith(('//', '\\\\')))
        root = Path(raw)
        _require(root.is_absolute() and '..' not in root.parts, 'FIXED_ABSOLUTE_ROOT_REQUIRED')
        self._root = root

    def publish(self, prepared, ciphertext, *, now=None):
        _require(type(prepared) is PreparedGrant and prepared in _PREPARED, 'PREPARED_GRANT_REQUIRED')
        payload = prepared.payload
        current = now if now is not None else dt.datetime.now(dt.timezone.utc)
        _require(type(current) is dt.datetime and current.tzinfo is not None and current.utcoffset() is not None)
        _require(_timestamp(payload['issuedAt']) <= current < _timestamp(payload['expiresAt']), 'GRANT_STALE_OR_FUTURE')
        _require(dt.timedelta(0) <= current-_timestamp(payload['captureStartedAt']) <= dt.timedelta(seconds=7200), 'CAPTURE_STALE_OR_FUTURE')
        _sealed_bytes(ciphertext)
        root = self._root
        snapshot = _root_snapshot(root)
        temporary, final = '.grant-'+uuid.uuid4().hex+'.tmp', payload['grantId']+'.grant'
        directory_fd = None
        temporary_identity = None
        published_identity = None
        try:
            if os.name == 'posix':
                directory_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | getattr(os, 'O_NOFOLLOW', 0))
                _require(_identity(os.fstat(directory_fd)) == snapshot[-1][1], 'GRANTS_ROOT_CHANGED')
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
            file_fd = os.open(temporary, flags, 0o600, dir_fd=directory_fd) if directory_fd is not None else os.open(root/temporary, flags, 0o600)
            try:
                info = os.fstat(file_fd)
                temporary_identity = (info.st_dev, info.st_ino)
                published_identity = temporary_identity
                _require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_ino > 0, 'UNSAFE_GRANT_FILE')
                _host_owned(info)
                offset = 0
                while offset < len(ciphertext):
                    written = os.write(file_fd, ciphertext[offset:])
                    _require(written > 0, 'GRANT_WRITE_FAILED')
                    offset += written
                os.fsync(file_fd)
            finally:
                os.close(file_fd)
            _same_root(snapshot)
            # link is atomic and fails if final already exists. Never use replace,
            # which would silently overwrite an already issued immutable grant.
            if directory_fd is not None:
                os.link(temporary, final, src_dir_fd=directory_fd, dst_dir_fd=directory_fd, follow_symlinks=False)
                os.unlink(temporary, dir_fd=directory_fd)
            else:
                os.link(root/temporary, root/final, follow_symlinks=False)
                os.unlink(root/temporary)
            temporary_identity = None
            if directory_fd is not None:
                os.fsync(directory_fd)
            _same_root(snapshot)
            info = (root/final).lstat()
            _require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size == len(ciphertext)
                     and (info.st_dev, info.st_ino) == published_identity, 'GRANT_PUBLICATION_CHANGED')
            _host_owned(info)
            flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
            read_fd = os.open(final, flags, dir_fd=directory_fd) if directory_fd is not None else os.open(root/final, flags)
            try:
                opened = os.fstat(read_fd)
                _require(_identity(opened) == _identity(info), 'GRANT_PUBLICATION_CHANGED')
                actual = bytearray()
                while len(actual) <= MAX_GRANT_BYTES:
                    chunk = os.read(read_fd, MAX_GRANT_BYTES+1-len(actual))
                    if not chunk:
                        break
                    actual.extend(chunk)
                _require(bytes(actual) == ciphertext, 'GRANT_PUBLICATION_CHANGED')
                after = os.fstat(read_fd)
                _require((opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) ==
                         (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'GRANT_PUBLICATION_CHANGED')
            finally:
                os.close(read_fd)
            _same_root(snapshot)
            return dict(grantId=payload['grantId'], ciphertextSha256=hashlib.sha256(ciphertext).hexdigest(), bytes=len(ciphertext))
        finally:
            try:
                if temporary_identity is not None:
                    try:
                        info = os.stat(temporary, dir_fd=directory_fd, follow_symlinks=False) if directory_fd is not None else (root/temporary).lstat()
                    except FileNotFoundError:
                        pass
                    else:
                        _require((info.st_dev, info.st_ino) == temporary_identity and stat.S_ISREG(info.st_mode), 'CLEANUP_TARGET_CHANGED')
                        if directory_fd is not None:
                            os.unlink(temporary, dir_fd=directory_fd)
                        else:
                            os.unlink(root/temporary)
            finally:
                if directory_fd is not None:
                    os.close(directory_fd)


class IssueOrchestrator:
    """One owned preparation, two targeted existing jobs, one immutable grant.

    backend and target_runner are internal host adapters, never caller DTOs.
    All operations revalidate sealed preparation on the Node side. A failed or
    ambiguous worker invocation is not retried by this issuer.
    """
    def __init__(self, backend, target_runner, publisher, *, clock=None,
                 monotonic=time.monotonic, sleep=time.sleep, max_seconds=1800, max_polls=900, poll_seconds=2):
        _require(type(max_seconds) is int and 0 < max_seconds <= 1800)
        _require(type(max_polls) is int and 0 < max_polls <= 900)
        _require(type(poll_seconds) is int and 0 < poll_seconds <= 30)
        self.backend, self.target_runner, self.publisher = backend, target_runner, publisher
        self.clock = clock or (lambda: dt.datetime.now(dt.timezone.utc))
        self.monotonic, self.sleep = monotonic, sleep
        self.max_seconds, self.max_polls, self.poll_seconds = max_seconds, max_polls, poll_seconds

    def issue(self, job_id):
        _uuid(job_id)
        deadline = self.monotonic()+self.max_seconds

        def remaining():
            value = deadline-self.monotonic()
            _require(0 < value <= self.max_seconds, 'ISSUER_DEADLINE_EXCEEDED')
            return value

        def operation(name, payload=None, grant_id=None):
            result = self.backend.operation(name, job_id, payload=payload, grant_id=grant_id, timeout=remaining())
            remaining()
            _require(type(result) is dict, 'HOST_WIRE_INVALID')
            return result

        def preparation():
            value = _exact(operation('PREPARED_CONTEXT'), ('context', 'preview', 'preparationDigest'))
            _validate_context(value['context']); _digest(value['preparationDigest'])
            _require(value['context']['jobId'] == job_id and type(value['preview']) is dict, 'PREPARATION_INVALID')
            return value

        initial = preparation()
        local_start = self.clock()
        queued = _exact(operation('QUEUE_DATA'), ('backupId', 'captureStartedAt', 'context', 'preparationDigest'))
        _require(queued['context'] == initial['context'] and queued['preparationDigest'] == initial['preparationDigest'], 'PREPARATION_CHANGED')
        _require(type(queued['backupId']) is str and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{7,127}', queued['backupId']))
        captured = _timestamp(queued['captureStartedAt'])
        current = self.clock()
        # A restarted issuer may receive the same preparation's already-owned
        # completed job. Keep its ORIGINAL capture clock, never refresh it to
        # this invocation's time. Node owns that preparation->job binding.
        _require(local_start <= current and dt.timedelta(0) <= current-captured < dt.timedelta(seconds=7200), 'CAPTURE_CLOCK_INVALID')
        backup_id = queued['backupId']

        def wait_target(kind, drill_id=None):
            launched, seen_active = False, False
            statuses = ('PENDING', 'RUNNING', 'VERIFYING', 'COMPLETED', 'FAILED')
            for _ in range(self.max_polls):
                value = _exact(operation('CAPTURE_STATUS'), ('backupId', 'backupStatus', 'drillJobId', 'drillStatus'))
                _require(value['backupId'] == backup_id and value['backupStatus'] in statuses, 'TARGET_IDENTITY_CHANGED')
                if value['drillJobId'] is None:
                    _require(value['drillStatus'] is None)
                else:
                    _require(type(value['drillJobId']) is str and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{7,127}', value['drillJobId'])
                             and value['drillStatus'] in statuses)
                if kind == 'DRILL':
                    _require(value['backupStatus'] == 'COMPLETED' and value['drillJobId'] == drill_id, 'DRILL_SOURCE_CHANGED')
                status = value['backupStatus'] if kind == 'DATA' else value['drillStatus']
                if status == 'COMPLETED':
                    return
                _require(status != 'FAILED', 'TARGET_JOB_FAILED')
                if status == 'PENDING':
                    _require(not launched and not seen_active, 'TARGET_RETRY_OR_BACKOFF')
                    self.target_runner.run_target(backup_id if kind == 'DATA' else drill_id, timeout=remaining())
                    launched = True
                    remaining()
                else:
                    seen_active = True
                    self.sleep(min(self.poll_seconds, remaining()))
            raise GrantError('TARGET_POLL_LIMIT_EXCEEDED')

        wait_target('DATA')
        drill = _exact(operation('QUEUE_DRILL'), ('backupId', 'drillJobId'))
        _require(drill['backupId'] == backup_id and type(drill['drillJobId']) is str
                 and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{7,127}', drill['drillJobId']), 'DRILL_SOURCE_CHANGED')
        wait_target('DRILL', drill['drillJobId'])
        verified = _exact(operation('VERIFY_EVIDENCE'), ('context', 'evidence'))
        _require(verified['context'] == initial['context'], 'CONTEXT_CHANGED')
        _validate_evidence(verified['evidence'])
        facts = verified['evidence']
        _require(facts['backupId'] == backup_id and facts['drillJobId'] == drill['drillJobId']
                 and _timestamp(facts['captureStartedAt']) == captured, 'VERIFIED_SOURCE_CHANGED')
        final = preparation()
        _require(final['context'] == initial['context'] and final['preparationDigest'] == initial['preparationDigest'], 'PREPARATION_CHANGED')
        owned = _record_verified_run(final['context'], facts)
        prepared = build_grant_payload(owned, now=self.clock())
        sealed = _exact(operation('SEAL_GRANT', prepared.payload), ('grantId', 'ciphertext', 'digest'))
        _require(sealed['grantId'] == prepared.payload['grantId'] and type(sealed['ciphertext']) is str, 'SEALED_GRANT_MISMATCH')
        try:
            ciphertext = sealed['ciphertext'].encode('ascii')
        except UnicodeError:
            raise GrantError('SEALED_GRANT_MISMATCH') from None
        _sealed_bytes(ciphertext); _digest(sealed['digest'])
        _require(hashlib.sha256(ciphertext).hexdigest() == sealed['digest'], 'SEALED_DIGEST_MISMATCH')
        remaining()
        published = self.publisher.publish(prepared, ciphertext, now=self.clock())
        # Never delete a valid immutable file when API RO-mount readback or
        # metadata recording fails. RECORD does not consume the grant.
        recorded = _exact(operation('RECORD_GRANT', grant_id=prepared.payload['grantId']), ('grantId', 'expiresAt'))
        _require(recorded['grantId'] == prepared.payload['grantId']
                 and _timestamp(recorded['expiresAt']) == _timestamp(prepared.payload['expiresAt']), 'GRANT_RECORD_MISMATCH')
        return dict(published, expiresAt=recorded['expiresAt'])


OPERATIONS = frozenset(('PREPARED_CONTEXT', 'QUEUE_DATA', 'QUEUE_DRILL', 'CAPTURE_STATUS',
                         'VERIFY_EVIDENCE', 'SEAL_GRANT', 'RECORD_GRANT'))
MAX_WIRE_BYTES = 512 * 1024


def _read_json(bytes_):
    _require(type(bytes_) is bytes and 0 < len(bytes_) <= MAX_WIRE_BYTES, 'HOST_WIRE_INVALID')
    def pairs(items):
        result = {}
        for key, value in items:
            _require(key not in result, 'HOST_WIRE_INVALID')
            result[key] = value
        return result
    def constant(_):
        raise GrantError('HOST_WIRE_INVALID')
    try:
        value = json.loads(bytes_.decode('utf-8'), object_pairs_hook=pairs, parse_constant=constant)
        def bounded(item, depth=0):
            _require(depth <= 32, 'HOST_WIRE_INVALID')
            if type(item) is dict:
                for child in item.values():
                    bounded(child, depth+1)
            elif type(item) is list:
                for child in item:
                    bounded(child, depth+1)
            elif type(item) is float:
                _require(math.isfinite(item), 'HOST_WIRE_INVALID')
        bounded(value)
        return value
    except (ValueError, UnicodeError, RecursionError):
        raise GrantError('HOST_WIRE_INVALID') from None


def _fixed_path(value):
    _require(type(value) is str and '\0' not in value and not value.startswith(('//', '\\\\')))
    path = Path(value)
    _require(path.is_absolute() and '..' not in path.parts, 'HOST_CONFIG_INVALID')
    return path


class HostCommands:
    """Fixed Linux Docker API transport and targeted existing host-agent only."""
    def __init__(self, config_path, config, *, node_run=subprocess.run, agent_start=subprocess.Popen):
        _require(type(config) is dict and type(config.get('project')) is str
                 and re.fullmatch('[a-z0-9][a-z0-9_-]{2,62}', config['project']), 'HOST_CONFIG_INVALID')
        self.config_path = _fixed_path(os.fspath(config_path))
        self.repository = _fixed_path(config.get('repositoryRoot'))
        env_file = _fixed_path(config.get('envFile')); compose_file = _fixed_path(config.get('composeFile'))
        self.grants_root = _fixed_path(config.get('historyOperationalGrantsRoot'))
        self.node_run, self.agent_start = node_run, agent_start
        self.node_command = ['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock', 'compose',
            '--env-file', str(env_file), '-p', config['project'], '-f', str(compose_file),
            'exec', '-T', '--user', '0', '--workdir', '/app/apps/api',
            '-e', 'HISTORY_OPERATIONAL_HOST_ENABLED=true', 'api', 'node',
            'dist/history-migration/history-host-cli.js']

    def _environment(self):
        # Both the fixed transport and inherited agent must address this host,
        # regardless of a caller shell's Docker context or Compose defaults.
        env = {k:v for k,v in os.environ.items() if k not in ('DOCKER_CONTEXT', 'COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'SETTINGS_ENCRYPTION_KEY', 'HISTORY_OPERATIONAL_HOST_ENABLED')}
        env['DOCKER_HOST'] = 'unix:///var/run/docker.sock'
        return env

    def operation(self, operation, job_id, *, payload=None, grant_id=None, timeout=120):
        _uuid(job_id); _require(operation in OPERATIONS, 'HOST_OPERATION_INVALID')
        _require((operation == 'SEAL_GRANT') == (payload is not None)
                 and (operation == 'RECORD_GRANT') == (grant_id is not None), 'HOST_OPERATION_INVALID')
        request = dict(operation=operation, jobId=job_id)
        if payload is not None:
            _require(type(payload) is dict); request['payload'] = payload
        if grant_id is not None:
            _uuid(grant_id); request['grantId'] = grant_id
        encoded = _encode(request).encode('utf-8')
        _require(len(encoded) <= MAX_GRANT_BYTES and type(timeout) in (int, float) and 0 < timeout <= 1800)
        try:
            result = self.node_run(self.node_command, input=encoded, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                timeout=min(120, timeout), cwd=self.repository, env=self._environment(), check=False)
        except (OSError, subprocess.SubprocessError):
            raise GrantError('HOST_OPERATION_FAILED') from None
        _require(result.returncode == 0, 'HOST_OPERATION_FAILED')
        envelope = _exact(_read_json(result.stdout), ('ok', 'result'))
        _require(envelope['ok'] is True and type(envelope['result']) is dict, 'HOST_WIRE_INVALID')
        return envelope['result']

    def run_target(self, job_id, *, timeout=1500):
        _require(type(job_id) is str and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{7,127}', job_id))
        _require(type(timeout) in (int, float) and 0 < timeout <= 1800)
        args = [sys.executable, str(self.repository/'scripts/backup-agent.py'),
                '--config', str(self.config_path), '--once', '--job-id', job_id]
        try:
            process = self.agent_start(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                cwd=self.repository, env=self._environment(), start_new_session=True)
            result = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            # Do not kill a worker which may own a writer-pause journal. It keeps
            # its existing bounded job/watchdog/recovery, but NO grant is issued.
            raise GrantError('TARGET_AGENT_STILL_RUNNING_NO_GRANT') from None
        except (OSError, subprocess.SubprocessError):
            raise GrantError('TARGET_AGENT_FAILED') from None
        _require(result == 0, 'TARGET_AGENT_FAILED')


def _load_host_config(path):
    path = _fixed_path(os.fspath(path))
    _root_snapshot(path.parent)
    before = path.lstat()
    _require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= MAX_GRANT_BYTES, 'HOST_CONFIG_INVALID')
    _host_owned(before)
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        opened = os.fstat(fd)
        _require(_identity(opened) == _identity(before), 'HOST_CONFIG_CHANGED')
        data = bytearray()
        while len(data) <= MAX_GRANT_BYTES:
            chunk = os.read(fd, MAX_GRANT_BYTES+1-len(data))
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(fd)
        named = path.lstat()
        _require(len(data) == before.st_size and _identity(named) == _identity(before)
                 and (before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                     (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'HOST_CONFIG_CHANGED')
    finally:
        os.close(fd)
    return _read_json(bytes(data))


def main(argv=None):
    class Parser(argparse.ArgumentParser):
        def error(self, message):
            raise GrantError('CLI_ARGUMENTS_INVALID')
    try:
        parser = Parser(add_help=False)
        parser.add_argument('--config', required=True)
        parser.add_argument('--job-id', required=True)
        args = parser.parse_args(argv)
        _uuid(args.job_id)
        _require(sys.platform == 'linux' and os.geteuid() == 0, 'LINUX_ROOT_HOST_REQUIRED')
        config = _load_host_config(args.config)
        commands = HostCommands(args.config, config)
        # Fail before queueing if the configured host grant directory is unsafe.
        _root_snapshot(commands.grants_root)
        publisher = AtomicGrantPublisher(commands.grants_root)
        result = IssueOrchestrator(commands, commands, publisher).issue(args.job_id)
        print(_encode(dict(ok=True, result=result)))
        return 0
    except (Exception, KeyboardInterrupt):
        print('Operational backup grant issuance failed', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
