# Backup and restore

Run these commands on the deployment host from `/home/trio/yoleotard-crm`.
By default they use `docker-compose.portainer.yml`, `.env`, and Docker Compose
project `yoleotard-crm`, matching production deployment. A deliberately different
deployment can pass `--compose-file` and `--env-file` explicitly.

## Backup

Choose an absolute directory on a filesystem with sufficient free space:

```bash
./scripts/backup.sh --output-dir /srv/backups/yoleotard-crm
```

Each run creates a new UTC timestamp directory containing:

- `postgres.dump`: PostgreSQL custom-format dump;
- `uploads.tar.gz`: archive of `/app/uploads` from the API container;
- `SHA256SUMS`: integrity checksums;
- `manifest.txt`: backup format, time and Compose project.

Do not treat the server copy as the only backup. Copy the complete timestamp
directory to separate, access-controlled storage. Retain at least 7 daily and 4
weekly copies. Retention cleanup is intentionally outside the script so a bad
path or policy cannot delete recoverable data.

## Isolated restore drill

The restore script refuses both the configured active database and the default
production name `yoleotard_crm`. Create a dedicated drill database first:

```bash
docker compose --env-file .env -p yoleotard-crm -f docker-compose.portainer.yml exec postgres \
  sh -c 'createdb --username="$POSTGRES_USER" yoleotard_crm_restore_drill'
mkdir -p /srv/restore-drills/yoleotard-crm/uploads
```

Then restore with explicit absolute paths and an exact confirmation phrase:

```bash
./scripts/restore.sh \
  --backup-dir /srv/backups/yoleotard-crm/20260813T020000Z \
  --target-database yoleotard_crm_restore_drill \
  --uploads-target /srv/restore-drills/yoleotard-crm/uploads \
  --confirm "RESTORE yoleotard_crm_restore_drill"
```

`--uploads-target` must be empty. Uploads are extracted to that isolated host
directory; the production Docker volume is never overwritten by this script.
Checksums and archive paths are validated before extraction. The database target
must already exist, making its destructive scope explicit.

Validate row counts, representative clients/orders/payments, file count and a
sample of uploaded images. Record the result and date of every quarterly drill.
Keep the backup until validation is complete. Remove the drill database and
directory later only with separate, reviewed commands using their exact paths.
