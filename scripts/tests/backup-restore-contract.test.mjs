import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readScript = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("backup script captures PostgreSQL, persistent files, version metadata and uses the production compose project", async () => {
  const source = await readScript("backup.sh");

  assert.match(source, /set -Eeuo pipefail/);
  assert.match(source, /COMPOSE_PROJECT_NAME=.*yoleotard-crm/);
  assert.match(source, /COMPOSE_FILE="docker-compose\.portainer\.yml"/);
  assert.match(source, /ENV_FILE="\.env"/);
  assert.match(source, /--env-file/);
  assert.match(source, /pg_dump/);
  assert.match(source, /--format=custom/);
  assert.match(source, /\/app\/uploads/);
  assert.match(source, /sha256sum/);
  assert.match(source, /manifest\.json/);
  assert.match(source, /BACKUP_STORAGE_PATH/);
  assert.match(source, /schema_version/);
  assert.match(source, /git_commit/);
  assert.match(source, /app_version/);
  assert.match(source, /data\|full/);
  assert.doesNotMatch(source, /rm\s+-rf/);
});

test("restore script requires explicit safe targets and refuses the production database", async () => {
  const source = await readScript("restore.sh");

  assert.match(source, /set -Eeuo pipefail/);
  assert.match(source, /COMPOSE_PROJECT_NAME=.*yoleotard-crm/);
  assert.match(source, /COMPOSE_FILE="docker-compose\.portainer\.yml"/);
  assert.match(source, /ENV_FILE="\.env"/);
  assert.match(source, /--env-file/);
  assert.match(source, /--backup-dir/);
  assert.match(source, /--target-database/);
  assert.match(source, /--confirm/);
  assert.match(source, /ALLOW_RESTORE/);
  assert.match(source, /pg_restore/);
  assert.match(source, /sha256sum --check/);
  assert.match(source, /--uploads-target/);
  assert.doesNotMatch(source, /rm\s+-rf/);
});

test("automated restore drill creates, destroys, restores and verifies representative data", async () => {
  const source = await readScript("backup-restore-test.sh");
  assert.match(source, /BACKUP_RESTORE_INTEGRATION/);
  assert.match(source, /backup\.sh/);
  assert.match(source, /restore\.sh/);
  assert.match(source, /INSERT INTO/);
  assert.match(source, /DELETE FROM/);
  assert.match(source, /pg_restore|restore/);
  assert.match(source, /verify/i);
});
