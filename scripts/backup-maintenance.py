#!/usr/bin/env python3
"""Host-only retention policy, explicit offsite and OWNER secret export.

All commands require --storage-root and share executor flock. Retention is dry-run
unless --apply; only owned, validated, verified backup directories are eligible.
Agent retention additionally requires host allowAutomaticRetention=true and DB
recovery.retention.enabled=true; it reuses the caller-held execution locks.
Offsite restic uses existing RESTIC_REPOSITORY and RESTIC_PASSWORD_FILE ENV only,
requires --apply, and never initializes a repository or claims workstation download.
Secret export requires --owner-confirm OWNER-OFFLINE-SECRET-EXPORT, --input and
--recipient; input is an explicit offline prepared bundle, never automatic ENV.
"""
import argparse
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import contextlib
import backup_lease
from backup_archive import ID, digest, read_json, require, validate_directory


def retention(root, keep, apply=False, tiers=None, protected_ids=(), fence=lambda: None, archived=lambda _: None, completed_drills=(), claim=lambda _: True):
    require(keep >= 1, 'protect at least one verified backup')
    verified = []
    for directory in root.iterdir():
        if directory.is_symlink() or not directory.is_dir() or not ID.fullmatch(directory.name):
            continue
        marker, proof = directory/'.backup-owner', directory/'verification.json'
        if not marker.is_file() or not proof.is_file():
            continue
        ownership = read_json(marker)
        if ownership != dict(owner='yo-backup-engine', backupId=directory.name):
            continue
        result = validate_directory(directory)
        evidence = read_json(proof)
        require(evidence.get('checksum') == result['checksum'], 'stale verification evidence')
        verified.append((evidence.get('verifiedAt', ''), directory, result['manifest']))
    verified.sort(reverse=True)
    protected = set(protected_ids)
    minimum = max(1, int((tiers or {}).get('minimumVerified', keep)))
    protected.update(p.name for _, p, _ in verified[:minimum])
    restored = []
    for _, path, _ in verified:
        reports = list(completed_drills)
        sidecar = path/'drill-report.json'
        if not apply and sidecar.is_file() and not sidecar.is_symlink():
            reports.append(read_json(sidecar))
        matches = []
        for report in reports:
            refs = report.get('references', {})
            if (report.get('status') == 'PASS' and isinstance(refs, dict)
                and refs.get('sourceStoragePath') == path.name
                and refs.get('sourceChecksum') == digest(path/'manifest.json' if (path/'manifest.json').exists() else path/'manifest.txt')
                and refs.get('sourceArtifactChecksum') == digest(path/'SHA256SUMS')
                and (not (path/'archive.tar.gz').exists() or refs.get('archiveChecksum') == digest(path/'archive.tar.gz'))):
                matches.append((report.get('finishedAt', '') or '', path.name))
        if matches:
            restored.append(max(matches))
    restored.sort(reverse=True)
    protected.update(name for _, name in restored[:minimum])
    # Independently preserve latest verified DATA and FULL, plus pending drill sources.
    for kind in ('data','full'):
        match = next((p for _,p,m in verified if m.get('type') == kind), None)
        if match:
            protected.add(match.name)
    if tiers:
        for tier, limit in (('daily',7),('weekly',4),('monthly',3)):
            buckets = set()
            for timestamp, path, manifest in verified:
                raw = manifest.get('created_at') or timestamp
                try:
                    date = dt.datetime.strptime(raw,'%Y%m%dT%H%M%SZ') if len(raw)==16 else dt.datetime.fromisoformat(raw.replace('Z','+00:00'))
                except (ValueError,TypeError):
                    protected.add(path.name)  # Unknown age never authorizes deletion.
                    continue
                bucket = date.date() if tier=='daily' else date.isocalendar()[:2] if tier=='weekly' else (date.year,date.month)
                if bucket not in buckets and len(buckets)<max(0,int(tiers.get(tier,limit))):
                    buckets.add(bucket)
                    protected.add(path.name)
    else:
        protected.update(p.name for _,p,_ in verified[:keep])
    candidates = [p for _,p,_ in verified if p.name not in protected]
    blocked = len(restored) < minimum
    if blocked:
        candidates = []  # Integrity is not restore proof; fail closed even offline.
    events = dict(at=dt.datetime.now(dt.timezone.utc).isoformat(), action='RETENTION_APPLY' if apply else 'RETENTION_DRY_RUN',
                  keep=keep, protected=sorted(protected), candidates=[p.name for p in candidates],
                  restoreVerified=[name for _, name in restored],
                  blockedReason='insufficient checksum-bound restore verified backups' if blocked else None)
    audit = root/'retention-journal.jsonl'
    with audit.open('a', encoding='utf8') as out:
        out.write(json.dumps(events)+'\n')
        out.flush()
        os.fsync(out.fileno())
    deleted, skipped = [], []
    if apply:
        for path in candidates:
            fence()
            require(path.parent.resolve() == root.resolve() and not path.is_symlink(), 'retention target escaped root')
            if not claim(path.name):
                skipped.append(path.name)
                continue
            shutil.rmtree(path)
            archived(path.name)
            deleted.append(path.name)
    return dict(events, executed=apply, deleted=deleted, skippedReserved=skipped)


def claim_deletion(online, storage_path, fence):
    """Commit a durable source tombstone under the API enqueue transaction lock."""
    require(ID.fullmatch(storage_path), 'invalid retention storage path')
    backup_lease.owner_valid(online.owner)
    fence()
    quoted = "'"+storage_path.replace("'", "''")+"'"
    lock_key = "'backups-source:"+storage_path.replace("'", "''")+"'"
    # Separate statements are intentional: after a contended lock is acquired,
    # UPDATE receives a fresh READ COMMITTED snapshot of any accepted DRILL.
    query = '''BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT pg_advisory_xact_lock(hashtext('''+lock_key+'''));
UPDATE "Backup" b SET metadata=jsonb_set(CASE WHEN jsonb_typeof(b.metadata)='object' THEN b.metadata
 ELSE jsonb_build_object('legacyMetadata',b.metadata) END,'{retentionClaim}',
 jsonb_build_object('state','DELETING','owner','''+"'"+online.owner+"'"+''','claimedAt',CURRENT_TIMESTAMP)),
 "updatedAt"=CURRENT_TIMESTAMP
WHERE COALESCE(b."storagePath",b.id)='''+quoted+''' AND b.status='COMPLETED' AND b."archivedAt" IS NULL
 AND COALESCE(b.metadata#>>'{job,kind}','BACKUP') IN ('BACKUP','IMPORT_VERIFY')
 AND NOT EXISTS (SELECT 1 FROM "Backup" pending JOIN "Backup" source
   ON source.id=pending.metadata#>>'{job,sourceBackupId}'
   WHERE COALESCE(source."storagePath",source.id)='''+quoted+'''
   AND pending.status IN ('PENDING','RUNNING','VERIFYING','RESTORING'))
 AND NOT EXISTS (SELECT 1 FROM "Backup" claimed WHERE COALESCE(claimed."storagePath",claimed.id)='''+quoted+'''
   AND claimed.metadata#>>'{retentionClaim,state}'='DELETING')
 AND '''+backup_lease.fence(online.owner)+''' RETURNING b.id;
COMMIT;'''
    return bool(online.sql(query).strip())


def online_retention(online, root, keep=10, apply=False, *, automatic=False, fence):
    """Reuse the policy under the caller's existing flock/global lease; never acquire.

    Only trusted completed DB drills authorize deletion. Pending sources refer to
    Backup IDs, while the filesystem policy protects their actual storage paths.
    Explicit CLI apply retains its existing DB opt-in; automatic use needs both.
    """
    if automatic and (online is None or online.config.get('allowAutomaticRetention') is not True):
        return dict(executed=False, blockedReason='host automatic retention disabled')
    config, protected, completed_drills = {}, [], []
    if online:
        raw = online.sql("SELECT value FROM \"AppSetting\" WHERE section='backups' AND key='recovery';")
        config = json.loads(raw).get('retention', {}) if raw else {}
        if automatic and config.get('enabled') is not True:
            return dict(executed=False, blockedReason='recovery retention disabled')
        require(not apply or config.get('enabled') is True, 'retention remains disabled')
        raw = online.sql("SELECT COALESCE(source.\"storagePath\",source.id) FROM \"Backup\" pending JOIN \"Backup\" source ON source.id=pending.metadata#>>'{job,sourceBackupId}' WHERE pending.status IN ('PENDING','RUNNING','VERIFYING','RESTORING');")
        protected = raw.splitlines()
        raw = online.sql("SELECT json_build_object('status','PASS','finishedAt',\"completedAt\",'references',COALESCE(metadata->'references',metadata#>'{drill,references}',metadata#>'{job,result,references}')) FROM \"Backup\" WHERE status='COMPLETED' AND metadata#>>'{job,kind}'='DRILL' AND COALESCE(metadata#>>'{drill,status}',metadata#>>'{job,result,status}')='PASS' ORDER BY \"completedAt\" DESC;")
        completed_drills = [json.loads(line) for line in raw.splitlines()]
    require(not apply or online is not None, 'retention apply requires source configuration')

    def archived(storage_path):
        fence()
        quoted = "'"+storage_path.replace("'", "''")+"'"
        saved = online.sql('UPDATE "Backup" SET "archivedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP '
                           'WHERE COALESCE("storagePath",id)='+quoted+" AND status='COMPLETED' AND \"archivedAt\" IS NULL AND "
                           +backup_lease.fence(online.owner)+" AND metadata#>>'{retentionClaim,owner}'='"+online.owner+"' RETURNING id;")
        require(saved, 'retention archive fence lost or completed row unavailable')
        for backup_id in saved.splitlines():
            online.event('BACKUP_RETENTION_APPLIED', backup_id)

    return retention(root, keep, apply, config or None, protected, fence, archived, completed_drills,
                     claim=lambda storage_path: claim_deletion(online, storage_path, fence))


def offsite(path, apply=False):
    require(shutil.which('restic'), 'UNAVAILABLE: restic is not installed')
    require(os.environ.get('RESTIC_REPOSITORY') and os.environ.get('RESTIC_PASSWORD_FILE'), 'UNAVAILABLE: explicit restic ENV configuration required')
    require(Path(os.environ['RESTIC_PASSWORD_FILE']).is_file(), 'UNAVAILABLE: restic password file missing')
    validate_directory(path)
    if not apply:
        return dict(status='DRY_RUN', configured=True, uploaded=False)
    # No shell, no password/repository logging. Restic authenticates encrypted repository.
    subprocess.run(['restic', 'backup', '--json', '--tag', 'yo-crm-backup', str(path)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(['restic', 'check', '--read-data'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return dict(status='PARTIAL', encryption=dict(status='PASS', method='restic-authenticated'),
                integrity=dict(status='PASS', method='restic-check-read-data'),
                physicalIndependence=dict(status='UNKNOWN', reason='Host attestation required; repository location is not physical proof'),
                uploaded=True, repositoryChecked=True)


def export_secret(source, destination, recipient, confirmation):
    require(confirmation == 'OWNER-OFFLINE-SECRET-EXPORT', 'explicit OWNER offline confirmation required')
    require(shutil.which('age'), 'UNAVAILABLE: age is not installed')
    require(source.is_file() and not source.is_symlink() and not destination.exists(), 'explicit input/new destination required')
    require(recipient and recipient.startswith('age1'), 'explicit age recipient required')
    with destination.open('xb') as out:
        os.chmod(destination, 0o600)
        try:
            subprocess.run(['age', '-r', recipient, str(source)], check=True, stdout=out, stderr=subprocess.DEVNULL)
        except Exception:
            out.close()
            destination.unlink(missing_ok=True)
            raise
    return dict(status='ENCRYPTED', decryptVerified=False, sha256=digest(destination))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['retention', 'offsite', 'secret-export'])
    parser.add_argument('--storage-root', type=Path, required=True)
    parser.add_argument('--backup-id')
    parser.add_argument('--keep', type=int, default=10)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--input', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--recipient')
    parser.add_argument('--owner-confirm')
    parser.add_argument('--config', type=Path, help='Source host-agent config required for online mutations/global execution fence')
    args = parser.parse_args()
    os.umask(0o077)
    require(args.storage_root.is_absolute() and args.storage_root != Path(args.storage_root.anchor), 'absolute private root required')
    spec = importlib.util.spec_from_file_location('backup_agent', Path(__file__).with_name('backup-agent.py'))
    agent = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(agent)
    online = agent.Agent(read_json(args.config)) if args.config else None
    require(not args.apply or online is not None, '--apply requires source configuration and global lease')
    with agent.host_lock(args.storage_root), (backup_lease.hold(online.sql, online.owner) if online else contextlib.nullcontext(lambda: None)) as fence:
        if args.command == 'retention':
            result = online_retention(online, args.storage_root, args.keep, args.apply, fence=fence)
        elif args.command == 'offsite':
            require(ID.fullmatch(args.backup_id or ''), 'backup id required')
            result = offsite(args.storage_root/args.backup_id, args.apply)
        else:
            result = export_secret(args.input, args.output, args.recipient, args.owner_confirm)
        fence()
    print(json.dumps(result))


if __name__ == '__main__':
    main()
