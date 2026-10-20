# Reproducible deployment

The modular monolith consists of Next.js web, NestJS API, PostgreSQL, Redis and persistent file storage. Nginx Proxy Manager remains the only owner of 80/443.

Persistent data:

- PostgreSQL: `crm_postgres`;
- customer files: `crm_uploads` at `/app/uploads`;
- backup artifacts: bind-mounted `BACKUP_STORAGE_PATH` at `/backups`;
- Redis is rebuildable operational data.

## New server

```bash
git clone <repository-url> yoleotard-crm
cd yoleotard-crm
cp .env.portainer.example .env
# fill server-only secrets and absolute BACKUP_STORAGE_PATH
docker compose --env-file .env -p yoleotard-crm -f docker-compose.portainer.yml config --quiet
docker compose --env-file .env -p yoleotard-crm -f docker-compose.portainer.yml up -d --build
```

API startup runs committed Prisma migrations. Production schema changes must never be applied manually. Verify `/api/health`, container health and `prisma migrate status` after deployment.

Updates replace containers without removing volumes or backup directories. Never use `docker compose down -v` during an update.

Environment groups are APP, DATABASE, REDIS, SECURITY, STORAGE, BACKUP and integration-specific META/EMAIL/AI values. Update `.env.example` for every new variable and never commit real `.env` files.

## Versioned releases and rollback

The root `package.json` version is the release version and must be incremented
for every production deployment. Record the release in `CHANGELOG.md` before
the release commit. Build both runtime containers with the exact version and
commit:

```bash
CRM_VERSION="$(node -p "require('./package.json').version")"
CRM_COMMIT="$(git rev-parse HEAD)"
export CRM_VERSION CRM_COMMIT
docker compose --env-file .env -p yoleotard-crm -f docker-compose.portainer.yml up -d --build --no-deps api web
```

`--no-deps` is mandatory for an API/web-only update: it prevents Compose from
recreating PostgreSQL or Redis when their existing containers were created from
a different but compatible Compose file. Verify both dependency health checks
before the update and confirm their container IDs afterwards.

After backup verification, quality gates, deployment and live smoke checks
have succeeded, create and push the immutable release tag:

```bash
git tag -a "crm-v${CRM_VERSION}" "$CRM_COMMIT" -m "Yoleotard CRM v${CRM_VERSION}"
git push origin "crm-v${CRM_VERSION}"
```

The tag push creates a GitHub Release from the matching `CHANGELOG.md` entry.
Do not move or reuse a published release tag.

To roll application code back, first create and verify a fresh safety backup,
check the target release's database compatibility note, then check out the
exact `crm-vX.Y.Z` tag and rebuild only `api` and `web` with that tag's version
and commit. Never remove PostgreSQL or uploads volumes during a rollback. If a
release introduced a non-backward-compatible migration, follow
`BACKUP_RESTORE.md` and restore the matching verified backup instead of merely
rolling back containers.
