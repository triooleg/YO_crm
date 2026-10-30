#!/usr/bin/env python3
"""Executable new-server preflight/runbook. No cutover and no uploaded code execution.

python3 scripts/recovery-install.py --backup-dir ABS --target EMPTY_ABS
 --project yo-recovery-UNIQUE --postgres-image sha256:... [--drill]
Uses only the installed trusted recovery-drill.py; uploaded source/Compose/scripts
are inspected and retained as data. Starting API/Web, secrets, DNS and integrations
remain explicit operator work after independent review.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import time
from backup_archive import read_json, require, validate_directory
from backup_runtime import atomic_json


def preflight(backup, target, project, image):
    result = validate_directory(backup)
    require(result['formatVersion'] == 3 and result['manifest'].get('type') == 'full', 'portable FULL v3 required')
    require(target.is_absolute() and target != Path(target.anchor) and not target.is_symlink(), 'new absolute target required')
    require(not target.exists() or target.is_dir() and not any(target.iterdir()), 'target must be empty')
    parent = target if target.exists() else target.parent
    require(parent.is_dir(), 'target parent required')
    from backup_archive import disk_budget
    disk_budget(parent, result['expandedSizeBytes']+result['sizeBytes']*2, len(result['inventory']))
    spec = importlib.util.spec_from_file_location('recovery_drill', Path(__file__).with_name('recovery-drill.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.project_guard(project)
    image_info = module.pinned_image(image)
    images = read_json(backup/'runtime-images.json')
    require(isinstance(images, dict) and all(isinstance(i, dict) and i.get('id', '').startswith('sha256:') for i in images.values()), 'missing pinned runtime inventory')
    for item in images.values():
        require(item.get('architecture') == image_info.get('Architecture') and item.get('os') == 'linux', 'CPU/OS incompatibility')
    module.bounded_run(['docker', 'compose', 'version'], time.monotonic()+30, check=True, stdout=subprocess.DEVNULL)
    return dict(status='PREFLIGHT_PASS', productionRestoreAllowed=False, cutoverAllowed=False,
                project=project, target=str(target), sourceBackupId=result['manifest']['backup_id'],
                pinnedImages=images, sourceCommit=result['manifest']['git_commit'],
                uploadedCodeExecuted=False, secretsRequiredSeparately=True,
                nextSteps=['Run trusted isolated drill', 'Review uploaded source and Compose as data',
                           'Provision separate reviewed secrets offline', 'Pin all runtime images; no database ports',
                           'Keep outbound disabled and sender/import workers stopped',
                           'Independent acceptance and separate DNS/integration cutover authorization required'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup-dir', required=True, type=Path)
    parser.add_argument('--target', required=True, type=Path)
    parser.add_argument('--project', required=True)
    parser.add_argument('--postgres-image', required=True)
    parser.add_argument('--drill', action='store_true')
    parser.add_argument('--prepare', '--restore', dest='prepare', action='store_true', help='Leave new quarantined VOLATILE tmpfs target running; stopping destroys DB')
    parser.add_argument('--load-images', action='store_true', help='Explicitly load validated offline image tar; never run imported images')
    args = parser.parse_args()
    os.umask(0o077)
    spec = importlib.util.spec_from_file_location('backup_agent',Path(__file__).with_name('backup-agent.py'))
    agent = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(agent)
    with agent.host_lock(args.backup_dir.resolve().parent) as fd:
        os.environ['BACKUP_LOCK_FD']=str(fd)
        os.environ['BACKUP_STORAGE_PATH']=str(args.backup_dir.resolve().parent)
        report = preflight(args.backup_dir, args.target, args.project, args.postgres_image)
        args.target.mkdir(mode=0o700, exist_ok=True)
        atomic_json(args.target/'preflight.json', report)
        if args.load_images:
            image_archive = args.backup_dir/'runtime-images.tar'
            require(image_archive.is_file(), 'offline images absent')
            with image_archive.open('rb') as source:
                subprocess.run(['docker','image','load'],stdin=source,check=True,stdout=subprocess.DEVNULL)
        if args.drill or args.prepare:
            command = [os.sys.executable, str(Path(__file__).with_name('recovery-drill.py')), '--backup-dir',
                str(args.backup_dir), '--output-dir', str(args.target/'drill'), '--project', args.project,
                '--postgres-image', args.postgres_image]
            if args.prepare:
                command.append('--retain-target')
            subprocess.run(command, check=True, pass_fds=(int(os.environ['BACKUP_LOCK_FD']),), timeout=350)
            report.update(status='QUARANTINED_VOLATILE' if args.prepare else 'DRILL_PASS',
                          restored=read_json(args.target/'drill/drill-report.json'))
            # Preserve portable application artifacts as inert data for reviewed installation.
            for name in ('application.tar.gz','runtime-images.json'):
                shutil.copyfile(args.backup_dir/name,args.target/name)
            atomic_json(args.target/'preflight.json', report)
        print(json.dumps(report))


if __name__ == '__main__':
    main()
