# Backup and restore

- Daily PostgreSQL custom dump; retain 7 daily and 4 weekly copies.
- Daily uploads archive, retained independently.
- Copy backups to separate access-controlled storage.
- Perform and record a quarterly isolated restore drill.

Use `scripts/backup.sh`. Restore only to an explicit target database with
`scripts/restore.sh BACKUP_FILE TARGET_DATABASE`; production name is refused.
