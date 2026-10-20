import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const readScript = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");
const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
const toBashPath = (path) => process.platform === "win32"
  ? path.replace(/^([A-Za-z]):\\/, (_, drive) => `/${drive.toLowerCase()}/`).replaceAll("\\", "/")
  : path;

function resolveBackupCommit(root) {
  const helper = toBashPath(fileURLToPath(new URL("../backup-metadata.sh", import.meta.url)));
  const result = spawnSync(bash, ["-c", '. "$1"; resolve_backup_git_commit "$2"', "backup-metadata-test", helper, toBashPath(root)], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("backup metadata resolves an exact release SHA without a deployed Git checkout", async () => {
  const root = await mkdtemp(join(tmpdir(), "yoleotard-backup-metadata-"));
  try {
    await writeFile(join(root, ".release-commit"), "3c42f2c7f0ed0642d4d0caaeafe5ef187a9d224b\r\n");
    assert.equal(resolveBackupCommit(root), "3c42f2c7f0ed0642d4d0caaeafe5ef187a9d224b");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("backup metadata fails closed when valid release markers disagree", async () => {
  const root = await mkdtemp(join(tmpdir(), "yoleotard-backup-metadata-"));
  try {
    await writeFile(join(root, ".release-commit"), "3c42f2c7f0ed0642d4d0caaeafe5ef187a9d224b\n");
    await writeFile(join(root, ".deployed-commit"), "17dcb28e2a5e2831a3b364eb9b308c15b54454b4\n");
    assert.equal(resolveBackupCommit(root), "unknown");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("backup metadata falls back safely through deployed marker and unknown", async () => {
  const root = await mkdtemp(join(tmpdir(), "yoleotard-backup-metadata-"));
  try {
    await writeFile(join(root, ".release-commit"), "not-a-sha\n");
    await writeFile(join(root, ".deployed-commit"), "17dcb28e2a5e2831a3b364eb9b308c15b54454b4\n");
    assert.equal(resolveBackupCommit(root), "17dcb28e2a5e2831a3b364eb9b308c15b54454b4");
    await rm(join(root, ".deployed-commit"));
    assert.equal(resolveBackupCommit(root), "unknown");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("backup metadata prefers the checked out Git commit over release markers", () => {
  const expected = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  assert.match(expected, /^[a-f0-9]{40}$/);
  assert.equal(resolveBackupCommit(fileURLToPath(new URL("../..", import.meta.url))), expected);
});

test("backup metadata never inherits Git identity from an ancestor directory", () => {
  assert.equal(resolveBackupCommit(fileURLToPath(new URL("..", import.meta.url))), "unknown");
});

test("backup script captures PostgreSQL, persistent files, version metadata and uses the production compose project", async () => {
  const source = await readScript("backup.sh");

  assert.match(source, /set -Eeuo pipefail/);
  assert.match(source, /COMPOSE_PROJECT_NAME=.*yoleotard-crm/);
  assert.match(source, /COMPOSE_FILE=.*docker-compose\.portainer\.yml/);
  assert.match(source, /ENV_FILE=.*\.env/);
  assert.match(source, /--env-file/);
  assert.match(source, /pg_dump/);
  assert.match(source, /--format=custom/);
  assert.match(source, /\/app\/uploads/);
  assert.match(source, /sha256sum/);
  assert.match(source, /manifest\.json/);
  assert.match(source, /BACKUP_STORAGE_PATH/);
  assert.match(source, /schema_version/);
  assert.match(source, /git_commit/);
  assert.match(source, /backup-metadata\.sh/);
  assert.match(source, /resolve_backup_git_commit/);
  assert.match(source, /app_version/);
  assert.match(source, /data\|full/);
  assert.doesNotMatch(source, /rm\s+-rf/);
});

test("restore script requires explicit safe targets and refuses the production database", async () => {
  const source = await readScript("restore.sh");

  assert.match(source, /set -Eeuo pipefail/);
  assert.match(source, /COMPOSE_PROJECT_NAME=.*yoleotard-crm/);
  assert.match(source, /COMPOSE_FILE=.*docker-compose\.portainer\.yml/);
  assert.match(source, /ENV_FILE=.*\.env/);
  assert.match(source, /--env-file/);
  assert.match(source, /--backup-dir/);
  assert.match(source, /--target-database/);
  assert.match(source, /--confirm/);
  assert.match(source, /ALLOW_RESTORE/);
  assert.match(source, /pg_restore/);
  assert.match(source, /sha256sum --check/);
  assert.match(source, /manifest\.txt/);
  assert.match(source, /format_version=1/);
  assert.match(source, /to_regclass/);
  assert.match(source, /freshly created and contain no user objects/);
  assert.match(source, /backup id mismatch/);
  assert.match(source, /--uploads-target/);
  assert.doesNotMatch(source, /rm\s+-rf/);
});

test("automated restore drill creates, destroys, restores and verifies representative data", async () => {
  const source = await readScript("backup-restore-test.sh");
  assert.match(source, /BACKUP_RESTORE_INTEGRATION/);
  assert.match(source, /APP_ENV=backup-drill/);
  assert.match(source, /backup\.sh/);
  assert.match(source, /restore\.sh/);
  assert.match(source, /DELETE FROM/);
  assert.doesNotMatch(source, /CREATE TABLE/);
  assert.match(source, /pg_restore|restore/);
  assert.match(source, /verify/i);
});
