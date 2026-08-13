# Portainer deployment

Stack: `yoleotard-crm`
Directory: `/home/trio/yoleotard-crm`
LAN: web `http://192.168.31.219:3500`, API `:4500/api/health`

`/api/health` is the production readiness contract. It actively verifies
PostgreSQL, Redis, and a safe write/read/delete probe in `UPLOADS_DIR`, returns
only `up`/`down` dependency states, and responds with HTTP 503 if any required
dependency is unavailable.

Use saved local SSH config and pinned PuTTY host key
`SHA256:T19XnWHTx7hni9k6PI3fnFv/y7Sff3dpg5z+M0hOfYM` without printing secrets.

```sh
docker compose -p yoleotard-crm -f docker-compose.portainer.yml --env-file .env up -d --build
```

Do not expose the database/Redis or modify existing stacks. Add a future public
domain to the existing Nginx Proxy Manager only after DNS is chosen.
