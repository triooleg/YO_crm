import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, StreamableFile, UnauthorizedException } from "@nestjs/common";
import { BackupType, type Backup, type User } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import { BACKUP_STORAGE, byteLimit, safeBackupId, type BackupStorage } from "./backup.storage";
import { BackupRepository, type BackupJobKind, type UploadCapacity } from "./backup.repository";
import type { QuarantinedArchive } from "./backup.upload";
const present = (backup: Backup) => ({ ...backup, sizeBytes: backup.sizeBytes?.toString() ?? null });
const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  constructor(private readonly repository: BackupRepository, @Inject(BACKUP_STORAGE) private readonly storage: BackupStorage) {}
  async listBackups() { return (await this.repository.list()).map(present); }
  async getBackup(id: string) { return present(await this.find(id)); }
  async settings() { return this.repository.settings(); }
  async saveSettings(input: Parameters<BackupRepository["saveSettings"]>[0], actor: User) {
    await this.authorize(actor);
    try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }); } catch { throw new BadRequestException("Неизвестный часовой пояс"); }
    return this.repository.saveSettings(input, actor);
  }
  private async authorize(actor: User) {
    if (!actor || !["OWNER", "ADMIN"].includes(actor.role)) throw new ForbiddenException("Недостаточно прав");
    const current = await this.repository.actor(actor.id);
    if (!current?.active || current.archivedAt || !["OWNER", "ADMIN"].includes(current.role)) throw new ForbiddenException("Недостаточно прав");
    return current;
  }
  async reauthenticate(actor: User, password: string) {
    const current = await this.authorize(actor);
    if (typeof password !== "string" || !password || password.length > 1024) throw new UnauthorizedException("Текущий пароль указан неверно");
    const valid = await argon2.verify(current.passwordHash, password).catch(() => false);
    if (!valid) throw new UnauthorizedException("Текущий пароль указан неверно");
  }
  async reserveUpload(actor: User, input: UploadCapacity) { await this.authorize(actor); return this.repository.reserveUpload(actor, input); }
  async releaseUpload(token?: string) { if (token) await this.repository.releaseUpload(token); }
  private async find(id: string) {
    if (!safeBackupId(id)) throw new BadRequestException("Некорректный идентификатор резервной копии");
    const backup = await this.repository.get(id);
    if (!backup) throw new NotFoundException("Резервная копия не найдена");
    return backup;
  }
  private queueId(actor: User, kind: BackupJobKind, key?: string) {
    if (key !== undefined && (typeof key !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(key))) throw new BadRequestException("Некорректный ключ идемпотентности");
    return key ? `api-${createHash("sha256").update(`${actor.id}:${kind}:${key}`).digest("hex")}` : `${new Date().toISOString().replace(/[-:.]/g, "")}-${randomUUID().slice(0, 8)}`;
  }
  async requestBackup(type: BackupType, actor: User, idempotencyKey?: string) {
    await this.authorize(actor);
    if (!["DATA", "FULL"].includes(type)) throw new BadRequestException("Некорректный тип резервной копии");
    const backup = await this.repository.request(this.queueId(actor, "BACKUP", idempotencyKey), type, actor);
    this.logger.log(JSON.stringify({ event: "BACKUP_REQUESTED", backupId: backup.id, type, provider: this.storage.provider }));
    return { ...present(backup), execution: { job: "CreateBackupJob", kind: "BACKUP", executor: "EXTERNAL_WORKER", cli: `./scripts/backup.sh ${type.toLowerCase()} --backup-id ${backup.id}` } };
  }
  async verifyBackup(id: string, actor?: User) {
    if (actor) await this.authorize(actor);
    const backup = await this.find(id);
    if (backup.storageProvider !== "LOCAL") throw new BadRequestException("Локальная проверка недоступна для этого хранилища");
    const metadata = object(backup.metadata), job = object(metadata.job);
    const sourceId = job.kind === "IMPORT_VERIFY" ? metadata.sourceBackupId ?? job.sourceBackupId ?? id : id;
    let verified;
    try {
      if (!safeBackupId(sourceId)) throw new BadRequestException("Отсутствует идентификатор исходной копии");
      try {
        if (!(await this.storage.exists(id))) throw new Error("Missing files");
        verified = await this.storage.verify(id, sourceId);
      } catch { throw new BadRequestException("Проверка файлов резервной копии не пройдена"); }
      if (backup.checksum && backup.checksum !== verified.checksum) throw new BadRequestException("Checksum резервной копии не соответствует метаданным");
      if (backup.sizeBytes !== null && backup.sizeBytes !== verified.sizeBytes) throw new BadRequestException("Размер резервной копии не соответствует метаданным");
      if (verified.manifest.type.toUpperCase() !== backup.type) throw new BadRequestException("Тип резервной копии не соответствует метаданным");
    } catch (error) {
      await this.repository.recordVerification(id, { status: "FAILED", kind: "INTEGRITY", verifiedAt: new Date().toISOString() }, actor);
      throw error;
    }
    const verification = { status: "PASS", kind: "INTEGRITY", verifiedAt: new Date().toISOString(), checksum: verified.checksum, sizeBytes: verified.sizeBytes.toString() };
    await this.repository.recordVerification(id, verification, actor);
    this.logger.log(JSON.stringify({ event: "BACKUP_VERIFIED", backupId: id, provider: this.storage.provider, sizeBytes: verified.sizeBytes.toString() }));
    return { ...verified, sizeBytes: verified.sizeBytes.toString(), verification };
  }
  async download(id: string, currentPassword: string, actor: User) {
    await this.reauthenticate(actor, currentPassword);
    return this.verifiedDownload(id, actor);
  }
  /** Internal shared integrity path; HTTP callers supply their own scoped authentication. */
  async verifiedDownload(id: string, actor: User, context: { deviceId?: string } = {}) {
    const backup = await this.find(id), archive = object(object(backup.metadata).archive);
    if (backup.status !== "COMPLETED" || !this.storage.openArchive || archive.file !== "archive.tar.gz" || typeof archive.checksum !== "string" || !/^[a-f0-9]{64}$/.test(archive.checksum) || !/^[1-9]\d{0,15}$/.test(String(archive.bytes))) throw new BadRequestException("Завершённый архив недоступен");
    await this.verifyBackup(id, actor);
    let stream;
    try { stream = await this.storage.openArchive(id, archive.checksum, BigInt(archive.bytes)); }
    catch { throw new BadRequestException("Архив не прошёл проверку целостности"); }
    try { await this.repository.audit("BACKUP_DOWNLOAD_AUTHORIZED", id, actor, { bytes: String(archive.bytes), ...(context.deviceId ? { deviceId: context.deviceId } : {}) }); }
    catch (error) { stream.destroy(); throw error; }
    // This audits authorization, not delivery completion or offsite protection.
    return new StreamableFile(stream, { type: "application/gzip", disposition: `attachment; filename="${id}-archive.tar.gz"`, length: Number(archive.bytes) });
  }
  async importArchive(file: QuarantinedArchive, type: BackupType, actor: User) {
    try {
      await this.authorize(actor);
      if (!["DATA", "FULL"].includes(type)) throw new BadRequestException("Некорректный тип резервной копии");
      const id = this.queueId(actor, "IMPORT_VERIFY");
      const backup = await this.repository.request(id, type, actor, { kind: "IMPORT_VERIFY", quarantine: { file: file.filename, bytes: String(file.size), checksum: file.checksum }, admissionToken: file.admissionToken });
      return present(backup);
    } catch (error) { await this.releaseUpload(file.admissionToken); throw error; }
  }
  async requestDrill(id: string, currentPassword: string, actor: User, idempotencyKey?: string) {
    await this.reauthenticate(actor, currentPassword);
    const source = await this.find(id);
    if (source.status !== "COMPLETED" || object(object(source.metadata).job).kind === "DRILL") throw new BadRequestException("Проверка восстановления требует завершённой копии");
    await this.verifyBackup(id, actor);
    return present(await this.repository.request(this.queueId(actor, "DRILL", idempotencyKey), source.type, actor, { kind: "DRILL", sourceBackupId: id }));
  }
  async recoveryPlan(id: string, currentPassword: string, confirmBackupId: string, actor: User) {
    await this.reauthenticate(actor, currentPassword);
    if (confirmBackupId !== id) throw new BadRequestException("Подтвердите точный идентификатор резервной копии");
    const backup = await this.find(id);
    if (backup.status !== "COMPLETED" || object(object(backup.metadata).job).kind === "DRILL") throw new BadRequestException("Требуется завершённая резервная копия");
    const verified = await this.verifyBackup(id, actor);
    const plan = { id, readOnly: true, productionRestoreAllowed: false, emergencyBackupRequired: true, rollbackRequired: true, snapshotCreatedAt: backup.createdAt, execution: "EXTERNAL_RUNBOOK_REQUIRED", target: "NEW_ISOLATED_PROJECT_ONLY", verified: { checksum: verified.checksum, sizeBytes: verified.sizeBytes, formatVersion: verified.manifest.format_version }, steps: ["VERIFY_ARCHIVE", "CREATE_AND_VERIFY_FRESH_EMERGENCY_BACKUP", "ENTER_MAINTENANCE_AND_STOP_WRITERS", "RECORD_ROLLBACK_CONNECTIONS_AND_VOLUMES", "PREPARE_NEW_PROJECT_AND_VOLUMES", "RESTORE_DATABASE_AND_FILES_OFFLINE", "CHECK_RELATIONSHIPS_AND_FILE_DIGESTS", "CHECK_HEALTH_AND_CONTROL_RECORDS", "REQUIRE_SEPARATE_CUTOVER_APPROVAL", "ATOMIC_SWITCH_WITH_ROLLBACK_READY", "RESUME_ONE_SET_OF_SENDERS"], warnings: ["CHANGES_AFTER_SNAPSHOT_WILL_BE_LOST", "NO_PROVIDER_SENDS_OR_WORKERS", "ORIGINAL_ENCRYPTION_KEY_REQUIRED_SEPARATELY", "NO_PRODUCTION_MUTATIONS_AUTHORIZED"] };
    await this.repository.audit("BACKUP_RECOVERY_PLAN_VIEWED", id, actor, { readOnly: true, productionRestoreAllowed: false });
    return plan;
  }
  async journal(limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException("Лимит журнала должен быть от 1 до 100");
    return this.repository.journal(limit);
  }
  async overview() {
    const [latest, verification, drill, total, heartbeat, settings, notification] = await Promise.all([this.repository.latestBackup(), this.repository.evidence("verification"), this.repository.evidence("drill"), this.repository.totalSize(), this.repository.executor(), this.repository.settings(), this.repository.drillNotification()]);
    const hb = object(heartbeat?.value);
    const timestamp = typeof hb.lastSeenAt === "string" ? hb.lastSeenAt : hb.heartbeatAt;
    const seen = typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
    const age = Date.now() - seen;
    const configured = hb.configured === false ? false : Boolean(heartbeat);
    const executor = {
      status: !configured ? "UNCONFIGURED" : hb.status === "UNAVAILABLE" || !Number.isFinite(seen) ? "UNAVAILABLE" : age < -60_000 || age > 120_000 ? "STALE" : hb.status === "AVAILABLE" || hb.configured === true ? "AVAILABLE" : "UNAVAILABLE",
      configured,
      lastSeenAt: Number.isFinite(seen) ? new Date(seen).toISOString() : null,
      ...(typeof hb.version === "string" ? { version: hb.version.slice(0, 100) } : {}),
    };
    return { maxUploadBytes: byteLimit("BACKUP_UPLOAD_MAX_BYTES", 2 * 1024 ** 3), latestBackup: latest ? present(latest) : null, latestVerification: verification ? { backupId: verification.id, ...object(object(verification.metadata).verification) } : null, nextRun: this.nextRun(settings), totalSizeBytes: total._sum.sizeBytes?.toString() ?? "0", lastDrill: drill ? { backupId: drill.id, ...object(object(drill.metadata).drill) } : null, drillNotification: this.presentDrillNotification(notification?.value), executor, offsite: { mode: "MANUAL_DOWNLOAD", configured: false, evidence: latest ? object(latest.metadata).offsite ?? null : null }, coverage: { ...(latest ? object(object(latest.metadata).coverage) : { status: "UNKNOWN" }), disclaimer: "Копия CRM охватывает только захваченные PostgreSQL и локальные uploads. Отдельные база и media Chatwoot требуют отдельного захвата; ссылки на удалённые вложения не гарантируют наличие файлов. Инвентаризация не доказывает восстановление." } };
  }
  private presentDrillNotification(value: unknown) {
    const item = object(value);
    if (item.version !== 1 || item.type !== "BACKUP_DRILL_RESULT" || !["PASS", "FAILED"].includes(item.status)
      || typeof item.eventId !== "string" || !/^[a-f0-9]{64}$/.test(item.eventId)
      || typeof item.backupId !== "string" || !safeBackupId(item.backupId)
      || typeof item.sourceBackupId !== "string" || !safeBackupId(item.sourceBackupId)
      || typeof item.finishedAt !== "string" || item.finishedAt.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(item.finishedAt) || !Number.isFinite(Date.parse(item.finishedAt))
      || !["SCHEDULED", "MANUAL"].includes(item.trigger) || item.delivery !== "LOCAL_PENDING" || item.externalDeliveryEnabled !== false
      || (item.trigger === "SCHEDULED" && (typeof item.scheduleSlot !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.scheduleSlot)))) return null;
    return { version: 1, type: "BACKUP_DRILL_RESULT", eventId: item.eventId as string, backupId: item.backupId as string, sourceBackupId: item.sourceBackupId as string,
      status: item.status as "PASS" | "FAILED", severity: item.status === "PASS" ? "INFO" : "ERROR", finishedAt: new Date(item.finishedAt).toISOString(),
      trigger: item.trigger as "SCHEDULED" | "MANUAL", scheduleSlot: item.trigger === "SCHEDULED" ? item.scheduleSlot as string : null,
      delivery: "LOCAL_PENDING", externalDeliveryEnabled: false };
  }
  private nextRun(settings: Awaited<ReturnType<BackupRepository["settings"]>>) {
    if (!settings.enabled && !settings.recovery.weeklyFull.enabled && !settings.recovery.monthlyDrill.enabled) return null;
    let formatter: Intl.DateTimeFormat;
    try { formatter = new Intl.DateTimeFormat("en-GB", { timeZone: settings.timezone, hour: "2-digit", minute: "2-digit", weekday: "short", day: "numeric", hourCycle: "h23" }); } catch { return null; }
    const now = Date.now(), start = Math.floor(now / 3_600_000) * 3_600_000;
    const rules = [settings.enabled ? { time: settings.time, day: settings.frequency === "WEEKLY" ? "Sun" : undefined, hourly: settings.frequency === "HOURLY" } : null, settings.recovery.weeklyFull.enabled ? { time: settings.recovery.weeklyFull.time, day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][settings.recovery.weeklyFull.dayOfWeek] } : null, settings.recovery.monthlyDrill.enabled ? { time: settings.recovery.monthlyDrill.time, monthDay: String(settings.recovery.monthlyDrill.dayOfMonth) } : null].filter(rule => rule !== null);
    for (let hour = 0; hour < 32 * 24; hour++) {
      const base = new Date(start + hour * 3_600_000);
      const localMinute = Number(formatter.formatToParts(base).find(part => part.type === "minute")?.value);
      const candidates = rules.map(rule => {
        const minuteOffset = (Number(rule.time.split(":")[1]) - localMinute + 60) % 60;
        const date = new Date(base.getTime() + minuteOffset * 60_000);
        const p = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
        return date.getTime() > now && (rule.hourly || `${p.hour}:${p.minute}` === rule.time) && (!rule.day || p.weekday === rule.day) && (!rule.monthDay || p.day === rule.monthDay) ? date.toISOString() : null;
      }).filter((value): value is string => value !== null).sort();
      if (candidates.length) return candidates[0];
    }
    return null;
  }
  async applyRetentionPolicy() {
    const settings = await this.repository.settings();
    const candidates = await this.repository.retentionCandidates(settings.retentionCount);
    return { keep: settings.retentionCount, candidates: candidates.map(item => item.id), executed: false, note: "Автоматическое удаление отключено до реализации блокировки, аудита и идемпотентного жизненного цикла" };
  }
}
