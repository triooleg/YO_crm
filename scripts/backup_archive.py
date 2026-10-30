#!/usr/bin/env python3
"""Untrusted backup validation. Never executes archive contents. Python stdlib only.

SHA256SUMS authenticates integrity, not provenance. Treat imported SQL as untrusted;
restore exclusively into disposable isolated PostgreSQL, never a live server.
v1 permits the historical unsigned manifest.txt; v2 size/checksum remain unchanged.
"""
import argparse
import hashlib
import gzip
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
import tempfile
import time

MAX_BYTES = 4 * 1024**3
MAX_MEMBERS = 100000
MAX_JSON = 32 * 1024**2
MAX_SECONDS = 120
DISK_RESERVE = 64 * 1024**2
LOCAL_EVIDENCE = {'.backup-owner', 'verification.json', 'drill-report.json'}
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{7,127}\Z')


class InvalidArchive(ValueError):
    pass


def require(value, message):
    if not value:
        raise InvalidArchive(message)


def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, 'duplicate JSON key')
        result[key] = value
    return result


def read_json(path):
    require(path.stat().st_size <= MAX_JSON, 'JSON too large')
    try:
        return json.loads(path.read_text(encoding='utf8'), object_pairs_hook=pairs,
                          parse_constant=lambda _: require(False, 'nonfinite JSON'))
    except (ValueError, RecursionError, UnicodeError) as error:
        raise InvalidArchive('invalid JSON') from error


def digest(path, deadline=None):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):
            require(deadline is None or time.monotonic() < deadline, 'archive deadline exceeded')
            h.update(chunk)
    return h.hexdigest()


def safe_name(name):
    require(isinstance(name, str) and name and '\\' not in name and ':' not in name
            and not name.startswith('/') and not any(ord(c) < 32 for c in name), 'unsafe path')
    parts = PurePosixPath(name).parts
    require('..' not in parts, 'path traversal')
    return '/'.join(p for p in parts if p != '.') or '.'


class ScanBudget:
    def __init__(self, max_bytes, max_members=MAX_MEMBERS, deadline=None):
        self.max_bytes, self.max_members = max_bytes, max_members
        self.deadline = time.monotonic()+MAX_SECONDS if deadline is None else deadline
        self.bytes, self.members = 0, 0
        self.metadata_bytes, self.name_bytes = 0, 0

    def tick(self):
        require(time.monotonic() < self.deadline, 'archive deadline exceeded')

    def member(self, size):
        self.tick()
        self.bytes += size
        self.members += 1
        require(self.bytes <= self.max_bytes, 'archive exceeds expanded byte limit')
        require(self.members <= self.max_members, 'too many archive entries')


class CheckedReader:
    """Bound tar header/PAX reads before tarfile can allocate from untrusted sizes."""
    def __init__(self, source, budget):
        self.source, self.budget, self.count = source, budget, 0

    def read(self, size=-1):
        self.budget.tick()
        require(0 <= size <= MAX_JSON, 'oversized archive header read')
        block = self.source.read(size)
        self.budget.tick()
        self.count += len(block)
        require(self.count <= self.budget.max_bytes + self.budget.max_members*1024 + MAX_JSON,
                'archive exceeds expanded byte limit')
        return block


class BoundedTarInfo(tarfile.TarInfo):
    def metadata_budget(self, tar):
        require(self.size <= 65536, 'oversized archive metadata')
        budget = tar.fileobj.fileobj.budget
        budget.metadata_bytes += self.size
        require(budget.metadata_bytes <= 8*1024**2, 'archive metadata budget exceeded')

    def _proc_pax(self, tar):
        self.metadata_budget(tar)
        return super()._proc_pax(tar)

    def _proc_gnulong(self, tar):
        self.metadata_budget(tar)
        return super()._proc_gnulong(tar)


def disk_budget(target, size, members=0):
    require(shutil.disk_usage(target).free > size + members*4096 + DISK_RESERVE,
            'insufficient free space for expanded archive')


def scan_tar(path, max_bytes=MAX_BYTES, max_members=MAX_MEMBERS, target=None,
             deadline=None, budget=None, nested=False, compressed=None, depth=0):
    """Stream payloads to detect truncated gzip, duplicates, links and expansion bombs."""
    budget = budget or ScanBudget(max_bytes, max_members, deadline)
    require(depth <= 4, 'nested archive depth limit exceeded')
    budget.tick()
    if target is not None:
        before = scan_tar(path, max_bytes, max_members, deadline=budget.deadline)
        disk_budget(target, sum(i['sizeBytes'] for i in before), len(before))
    seen, file_names, implicit_directories, files, total = set(), set(), set(), [], 0
    own_stream = not hasattr(path, 'read')
    stream = Path(path).open('rb') if own_stream else path
    if compressed is None:
        compressed = str(path).endswith('.gz')
    decoded = gzip.GzipFile(fileobj=stream) if compressed else stream
    try:
        with tarfile.open(fileobj=CheckedReader(decoded, budget), mode='r|', tarinfo=BoundedTarInfo) as tar:
            for member in tar:
                budget.tick()
                name = safe_name(member.name)
                budget.name_bytes += len(name.encode('utf8'))
                require(len(name) <= 4096 and budget.name_bytes <= 8*1024**2, 'archive path metadata budget exceeded')
                require(name not in seen, 'duplicate tar entry')
                seen.add(name)
                parents = {str(p) for p in PurePosixPath(name).parents if str(p) != '.'}
                require(not parents.intersection(file_names), 'file used as ancestor directory')
                require(not member.isfile() or name not in implicit_directories, 'directory replaced with file')
                implicit_directories.update(parents)
                if member.isfile():
                    file_names.add(name)
                require(len(seen) <= max_members, 'too many archive entries')
                require(member.isfile() or member.isdir(), 'links/special files forbidden')
                require(not member.sparse and not any('sparse' in k.lower() for k in member.pax_headers), 'sparse file forbidden')
                require(member.size >= 0, 'negative size')
                budget.member(member.size)
                total += member.size
                require(total <= max_bytes, 'archive exceeds expanded byte limit')
                output = None
                if target is not None:
                    output = Path(target) / name
                    if member.isdir():
                        output.mkdir(mode=0o700, parents=True, exist_ok=True)
                    else:
                        output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                if member.isfile():
                    h, count = hashlib.sha256(), 0
                    source = tar.extractfile(member)
                    if nested and name.endswith(('.tar.gz', '.tar')):
                        scan_tar(source, budget=budget, nested=True, compressed=name.endswith('.gz'), depth=depth+1)
                        files.append(dict(path=name, sizeBytes=member.size, sha256=None))
                        continue
                    dest = output.open('xb') if output else None
                    try:
                        for block in iter(lambda: source.read(1024*1024), b''):
                            budget.tick()
                            count += len(block)
                            h.update(block)
                            if dest:
                                dest.write(block)
                    finally:
                        if dest:
                            dest.close()
                    require(count == member.size, 'truncated tar payload')
                    files.append(dict(path=name, sizeBytes=count, sha256=h.hexdigest()))
    except (tarfile.TarError, EOFError, OSError) as error:
        raise InvalidArchive('invalid or conflicting tar contents') from error
    finally:
        if decoded is not stream:
            decoded.close()
        if own_stream:
            stream.close()
    return sorted(files, key=lambda x: x['path'])


def validate_directory(directory, expected_id=None, max_bytes=MAX_BYTES, deadline=None):
    budget = ScanBudget(max_bytes, deadline=deadline)
    root = Path(directory)
    require(root.is_dir() and not root.is_symlink(), 'not a private backup directory')
    for entry in root.iterdir():
        require(entry.is_file() and not entry.is_symlink() and entry.stat().st_nlink == 1, 'unexpected directory or link')
    manifest_path = root / 'manifest.json'
    if manifest_path.exists():
        m = read_json(manifest_path)
        require(isinstance(m, dict), 'invalid manifest object')
        version = m.get('format_version')
        require(type(version) is int and version in (2, 3), 'unsupported format')
        require(isinstance(m.get('backup_id'), str) and ID.fullmatch(m['backup_id']), 'invalid backup id')
        require(not expected_id or m['backup_id'] == expected_id, 'backup id mismatch')
        require(m.get('type') in ('data', 'full') and m.get('storage_provider') == 'local', 'invalid manifest')
        for key in ('app_version', 'git_commit', 'schema_version', 'database_version'):
            require(isinstance(m.get(key), str) and m[key], 'missing version metadata')
        names = m.get('files')
        require(isinstance(names, list) and all(isinstance(n, str) for n in names) and len(names) == len(set(names)), 'invalid artifact list')
        require(names[:2] == ['postgres.dump', 'uploads.tar.gz'], 'missing data artifacts')
        require(version != 2 or names == ['postgres.dump', 'uploads.tar.gz'], 'invalid v2 artifact list')
        require(all(re.fullmatch(r'[A-Za-z0-9._-]+', n) for n in names), 'unsafe artifact')
        if version == 3:
            require(isinstance(m.get('consistency'), dict) and m['consistency'].get('verified') is True, 'v3 requires verified quiescence')
            require('inventory.json' in names and 'table-counts.json' in names, 'missing v3 inventories')
            require(m['type'] != 'full' or 'application.tar.gz' in names, 'missing portable application')
        required = names + ['manifest.json']
    else:
        path = root / 'manifest.txt'
        require(path.is_file() and path.stat().st_size < 65536, 'missing legacy manifest')
        lines = path.read_text().splitlines()
        require('format_version=1' in lines and 'compose_project=yoleotard-crm' in lines, 'invalid legacy manifest')
        version, m, required = 1, {'format_version': 1}, ['postgres.dump', 'uploads.tar.gz']
    sums = root / 'SHA256SUMS'
    require(sums.is_file() and sums.stat().st_size < 1024*1024, 'missing/oversized checksums')
    checks = {}
    for line in sums.read_text(encoding='ascii').splitlines():
        match = re.fullmatch(r'([a-f0-9]{64}) [ *]([A-Za-z0-9._-]+)', line)
        require(match, 'invalid checksum line')
        sha, name = match.groups()
        require(name not in checks, 'duplicate checksum')
        checks[name] = sha
    require(set(required).issubset(checks), 'missing artifact checksum')
    require(set(checks).issubset(set(required) | {'manifest.txt'}), 'unexpected checksummed artifact')
    require(sum(p.stat().st_size for p in root.iterdir()) <= max_bytes, 'backup exceeds byte limit')
    budget.bytes = sum((root/n).stat().st_size for n in checks) + sums.stat().st_size
    require(budget.bytes <= max_bytes, 'archive exceeds expanded byte limit')
    for name, sha in checks.items():
        path = root / name
        require(path.is_file() and digest(path, budget.deadline) == sha, 'checksum mismatch: ' + name)
    with (root/'postgres.dump').open('rb') as dump:
        require(dump.read(5) == b'PGDMP', 'not a PostgreSQL custom dump')
    inventory = scan_tar(root / 'uploads.tar.gz', budget=budget)
    if version == 3:
        require(read_json(root / 'inventory.json') == inventory, 'file inventory mismatch')
        counts = read_json(root / 'table-counts.json')
        require(isinstance(counts, dict) and all(isinstance(k, str) and type(v) is int and v >= 0 for k, v in counts.items()), 'invalid table counts')
        for name in ('application.tar.gz',):
            if name in required:
                contents = scan_tar(root / name, budget=budget)
                require(not any(secret_path(x['path']) for x in contents), 'secret in application bundle')
        if 'chatwoot-media.tar.gz' in required:
            require(all(n in required for n in ('chatwoot-postgres.dump','chatwoot-inventory.json')), 'incomplete Chatwoot component')
            require(scan_tar(root/'chatwoot-media.tar.gz', budget=budget) == read_json(root/'chatwoot-inventory.json'), 'Chatwoot inventory mismatch')
        if 'runtime-images.tar' in required:
            scan_tar(root/'runtime-images.tar', budget=budget)
    allowed = set(required) | {'SHA256SUMS', 'manifest.txt', 'archive.tar.gz', 'archive.sha256', '.backup-owner', 'verification.json', 'drill-report.json'}
    require(all(p.name in allowed for p in root.iterdir()), 'unexpected backup artifact')
    size_names = ['postgres.dump', 'uploads.tar.gz', manifest_path.name if version != 1 else 'manifest.txt', 'SHA256SUMS'] if version < 3 else required + ['SHA256SUMS']
    coverage = dict(postgresql=True, uploads=True,
                    chatwoot=all(name in required for name in ('chatwoot-postgres.dump','chatwoot-media.tar.gz','chatwoot-inventory.json')),
                    remoteMedia='external-pointers-only', secrets=False, redis=False)
    return dict(formatVersion=version, manifest=m, checksum=digest(manifest_path if version != 1 else root/'manifest.txt'),
                sizeBytes=sum((root/n).stat().st_size for n in size_names), expandedSizeBytes=budget.bytes, inventory=inventory,
                coverage=coverage, claimedCoverage=m.get('coverage'),
                consistent=False, claimedConsistency=m.get('consistency'), consistencyTrust='UNVERIFIED')


def secret_path(name):
    parts = PurePosixPath(name).parts
    return any(p == '.env' or p.startswith('.env.') and p != '.env.example' or
               p.lower().endswith(('.pem', '.key', '.p12', '.pfx', '.pyc')) or
               p.startswith(('test-results', 'playwright-report')) or
               p in ('.git', '.local', 'node_modules', '__pycache__', '.next', 'dist', 'coverage') for p in parts)


def pack(root, deadline=None, max_bytes=MAX_BYTES):
    root = Path(root)
    deadline = deadline if deadline is not None else time.monotonic()+MAX_SECONDS
    result = validate_directory(root, deadline=deadline, max_bytes=max_bytes)
    names = sorted(p.name for p in root.iterdir() if p.name not in
                   ('archive.tar.gz', 'archive.sha256', '.backup-owner', 'verification.json', 'drill-report.json'))
    temporary = root / '.archive.tmp'
    disk_budget(root, sum((root/n).stat().st_size for n in names)+len(names)*1024)
    try:
        # Dumps/uploads/image layers are largely compressed already. Level 1 keeps
        # the fixed validation/work budget usable for offline FULL packages.
        with tarfile.open(temporary, 'w:gz', compresslevel=1) as tar:
            for name in names:
                info = tar.gettarinfo(root/name, arcname=name)
                with (root/name).open('rb') as source:
                    tar.addfile(info, CheckedReader(source, ScanBudget(max_bytes, deadline=deadline)))
        os.replace(temporary, root/'archive.tar.gz')
    finally:
        temporary.unlink(missing_ok=True)
    (root/'archive.sha256').write_text(digest(root/'archive.tar.gz', deadline) + '  archive.tar.gz\n')
    return result


def import_archive(source, storage, backup_id, max_bytes=MAX_BYTES):
    require(ID.fullmatch(backup_id), 'invalid import id')
    storage = Path(storage).resolve()
    destination = storage/backup_id
    require(not destination.exists(), 'import destination exists')
    deadline = time.monotonic()+MAX_SECONDS
    require(Path(source).stat().st_size <= max_bytes, 'compressed archive exceeds byte limit')
    budget = ScanBudget(max_bytes, deadline=deadline)
    outer = scan_tar(source, budget=budget, nested=True)
    require(not any(i['path'] in LOCAL_EVIDENCE for i in outer), 'import cannot supply local evidence')
    disk_budget(storage, sum(i['sizeBytes'] for i in outer)*3 + budget.bytes, budget.members)
    with tempfile.TemporaryDirectory(prefix='.quarantine-', dir=storage) as temporary:
        root = Path(temporary)
        scan_tar(source, max_bytes=max_bytes, target=root, deadline=deadline)
        result = validate_directory(root, max_bytes=max_bytes, deadline=deadline)
        # V1 has no authenticated identity; use the local import job identity.
        source_id = result['manifest'].get('backup_id') or backup_id
        pack(root, deadline=deadline, max_bytes=max_bytes)
        # Never rewrite source manifest or checksum. API job id and source id differ.
        os.rename(root, destination)
    return dict(result, sourceBackupId=source_id, storagePath=backup_id)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['validate', 'pack', 'import', 'extract-uploads'])
    parser.add_argument('path', type=Path)
    parser.add_argument('--expected-id')
    parser.add_argument('--storage', type=Path)
    parser.add_argument('--id')
    parser.add_argument('--target', type=Path)
    args = parser.parse_args()
    try:
        if args.command == 'import':
            result = import_archive(args.path, args.storage, args.id)
        elif args.command == 'extract-uploads':
            validate_directory(args.path)
            require(args.target.is_dir() and not args.target.is_symlink() and not any(args.target.iterdir()), 'target must be empty')
            result = scan_tar(args.path/'uploads.tar.gz', target=args.target)
        else:
            result = pack(args.path) if args.command == 'pack' else validate_directory(args.path, args.expected_id)
            # Only a local CLI pack with the external writer journal can attest
            # quiescence. Import never reads this journal or trusts bundled claims.
            journal = args.path.parent/'.quiescence.json'
            if args.command == 'pack' and journal.is_file() and not journal.is_symlink():
                state = read_json(journal)
                claim = result['claimedConsistency'] or {}
                if (state.get('phase') == 'QUIESCED' and state.get('verified') is True
                    and state.get('project') == os.environ.get('COMPOSE_PROJECT_NAME')
                    and state.get('services') == claim.get('services')
                    and claim.get('verified') is True and os.environ.get('BACKUP_CONSISTENT') == 'true'):
                    result.update(consistent=True, consistencyTrust='VERIFIED_LOCAL_QUIESCENCE')
        print(json.dumps(result, ensure_ascii=True))
    except (InvalidArchive, OSError, TypeError, KeyError, RecursionError) as error:
        parser.exit(1, 'Backup validation failed: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
