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
