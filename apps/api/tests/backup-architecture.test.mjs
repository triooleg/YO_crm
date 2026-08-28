import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("backup metadata and settings are migration-managed", async () => {
  const schema = await read("packages/database/prisma/schema.prisma");
  assert.match(schema, /enum BackupType\s*{[\s\S]*DATA[\s\S]*FULL[\s\S]*}/);
  assert.match(schema, /enum BackupStatus\s*{[\s\S]*PENDING[\s\S]*RUNNING[\s\S]*VERIFYING[\s\S]*COMPLETED[\s\S]*FAILED[\s\S]*RESTORING[\s\S]*}/);
  assert.match(schema, /model Backup\s*{/);
  assert.match(schema, /schemaVersion\s+String\?/);
  assert.match(schema, /checksum\s+String\?/);
  assert.match(schema, /model BackupSetting\s*{/);
  assert.match(schema, /retentionCount\s+Int/);
});

test("backup platform module exposes storage, repository, job and restore boundaries", async () => {
  const [storage, service, repository, restore, controller, module, scheduler] = await Promise.all([
    read("apps/api/src/backups/backup.storage.ts"),
    read("apps/api/src/backups/backup.service.ts"),
    read("apps/api/src/backups/backup.repository.ts"),
    read("apps/api/src/backups/restore.service.ts"),
    read("apps/api/src/backups/backups.controller.ts"),
    read("apps/api/src/backups/backups.module.ts"),
    read("apps/api/src/backups/backup.scheduler.ts"),
  ]);
  assert.match(storage, /interface BackupStorage/);
  assert.match(storage, /class LocalBackupStorage/);
  assert.match(service, /class BackupService/);
  assert.match(service, /requestBackup/);
  assert.match(service, /applyRetentionPolicy/);
  assert.match(repository, /class BackupRepository/);
  assert.match(restore, /class RestoreService/);
  assert.match(restore, /ALLOW_RESTORE/);
  assert.match(controller, /@Controller\("admin\/backups"\)/);
  assert.match(controller, /@Roles\("OWNER","ADMIN"\)/);
  assert.match(module, /class BackupsModule/);
  assert.match(scheduler, /interface CreateBackupJob/);
  assert.match(scheduler, /class BackupScheduler/);
});

test("deployment declares persistent backup storage separately from application images", async () => {
  for (const path of ["docker-compose.yml", "docker-compose.portainer.yml"]) {
    const compose = await read(path);
    assert.match(compose, /BACKUP_STORAGE_PATH:\s*\/backups/);
    assert.match(compose, /BACKUP_STORAGE_PATH[^\n]*:\/backups/);
    assert.match(compose, /crm_uploads:\/app\/uploads/);
  }
  const env = await read(".env.example");
  assert.match(env, /BACKUP_STORAGE_PATH=/);
  assert.match(env, /BACKUP_RETENTION_COUNT=/);
  assert.match(env, /ALLOW_RESTORE=false/);
});
