import { ConflictException, HttpException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { BackupStatus, BackupType, Prisma, type User } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { recoveryConfig } from "./backup.config";
import { safeBackupId } from "./backup.storage";
export type BackupJobKind = "BACKUP" | "IMPORT_VERIFY" | "DRILL";
export type QueueOptions = { kind?: BackupJobKind; sourceBackupId?: string; quarantine?: { file: string; bytes: string; checksum: string }; admissionToken?: string };
export type SettingsInput = { enabled: boolean; frequency: string; time: string; timezone: string; backupType: BackupType; retentionCount: number; recovery?: unknown };
export type UploadCapacity = { filename: string; expectedBytes: bigint; availableBytes: bigint; reserveBytes: bigint; files: string[]; maxPendingGlobal: number; maxPendingActor: number };
type UploadLease = { token: string; actorId: string; filename: string; bytes: string; expiresAt: string };
@Injectable()
export class BackupRepository {
  constructor(private readonly prisma: PrismaService) {}
  list() { return this.prisma.backup.findMany({ where: { archivedAt: null }, orderBy: { createdAt: "desc" }, take: 100 }); }
  get(id: string) { return this.prisma.backup.findFirst({ where: { id, archivedAt: null } }); }
  actor(id: string) { return this.prisma.user.findUnique({ where: { id } }); }
  private admissionLeases(value: Prisma.JsonValue | undefined): UploadLease[] {
    if (value === undefined) return [];
    const leases = (value as { leases?: unknown } | null)?.leases;
    if (!Array.isArray(leases) || leases.length > 100 || leases.some(lease => !lease || typeof lease.token !== "string" || typeof lease.actorId !== "string" || typeof lease.filename !== "string" || !/^[1-9]\d{0,15}$/.test(lease.bytes) || !Number.isFinite(Date.parse(lease.expiresAt)))) throw new HttpException("Реестр загрузок требует проверки", 503);
    return leases as UploadLease[];
  }
  private saveAdmissions(tx: Prisma.TransactionClient, leases: UploadLease[]) {
    const value = { leases: leases.map(lease => ({ ...lease })) };
    return tx.appSetting.upsert({ where: { section_key: { section: "backups", key: "uploadAdmissions" } }, create: { section: "backups", key: "uploadAdmissions", value }, update: { value } });
  }
  reserveUpload(actor: User, input: UploadCapacity) {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'backups-upload-admissions'}))`;
      const stored = await tx.appSetting.findUnique({ where: { section_key: { section: "backups", key: "uploadAdmissions" } } });
      const leases = this.admissionLeases(stored?.value).filter(lease => Date.parse(lease.expiresAt) > Date.now() || input.files.includes(lease.filename));
      const pending: Prisma.BackupWhereInput = { status: { in: ["PENDING", "RUNNING", "VERIFYING"] }, metadata: { path: ["job", "kind"], equals: "IMPORT_VERIFY" } };
      const [global, owned] = await Promise.all([tx.backup.count({ where: pending }), tx.backup.count({ where: { ...pending, createdById: actor.id } })]);
      const physical = new Set([...input.files, ...leases.map(lease => lease.filename)]).size;
      if (Math.max(global + leases.length, physical) >= input.maxPendingGlobal || owned + leases.filter(lease => lease.actorId === actor.id).length >= input.maxPendingActor) throw new HttpException("Достигнут лимит ожидающих загрузок", 429);
      const reserved = leases.reduce((sum, lease) => sum + BigInt(lease.bytes), 0n);
      if (input.availableBytes <= input.reserveBytes + input.expectedBytes + reserved) throw new HttpException("Недостаточно свободного места для загрузки", 507);
      const lease = { token: randomUUID(), actorId: actor.id, filename: input.filename, bytes: input.expectedBytes.toString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() };
      await this.saveAdmissions(tx, [...leases, lease]);
      return lease.token;
    });
  }
  releaseUpload(token: string) {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'backups-upload-admissions'}))`;
      const stored = await tx.appSetting.findUnique({ where: { section_key: { section: "backups", key: "uploadAdmissions" } } });
      if (stored) await this.saveAdmissions(tx, this.admissionLeases(stored.value).filter(lease => lease.token !== token));
    });
  }
  async request(id: string, type: BackupType, actor: User, options: QueueOptions = {}) {
    const kind = options.kind ?? "BACKUP";
    // Each read after the source lock wait must see committed retention claims,
    // even when the server's default transaction isolation is stronger.
    return this.prisma.$transaction(async tx => {
      // Serialize retries across API instances; the row ID also has a database unique constraint.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      if (options.admissionToken) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'backups-upload-admissions'}))`;
        const stored = await tx.appSetting.findUnique({ where: { section_key: { section: "backups", key: "uploadAdmissions" } } });
        const leases = this.admissionLeases(stored?.value);
        const lease = leases.find(item => item.token === options.admissionToken && item.actorId === actor.id && item.filename === options.quarantine?.file);
        if (!lease || BigInt(lease.bytes) < BigInt(options.quarantine?.bytes ?? "0")) throw new ConflictException("Резерв загрузки отсутствует");
        // Admission becomes a durable queue row in this same transaction.
        await this.saveAdmissions(tx, leases.filter(item => item.token !== options.admissionToken));
      }
      const existing = await tx.backup.findUnique({ where: { id } });
      if (existing) {
        const metadata = existing.metadata as Record<string, Prisma.JsonValue> | null;
        const job = metadata?.job as Record<string, Prisma.JsonValue> | undefined;
        if (existing.archivedAt || existing.type !== type || existing.createdById !== actor.id || job?.kind !== kind || (job?.sourceBackupId ?? null) !== (options.sourceBackupId ?? null)) throw new ConflictException("Ключ идемпотентности уже использован для другого запроса");
        return existing;
      }
      if (kind === "DRILL") {
        if (!options.sourceBackupId) throw new ConflictException("Исходная резервная копия недоступна");
        const source = await tx.backup.findUnique({ where: { id: options.sourceBackupId } });
        if (!source || source.archivedAt || source.status !== BackupStatus.COMPLETED) throw new ConflictException("Исходная резервная копия недоступна");
        const storagePath = source.storagePath || source.id;
        if (!safeBackupId(storagePath)) throw new ConflictException("Некорректный путь исходной резервной копии");
        // Retention takes the same storage lock before claiming deletion. Read again
        // after waiting so a committed claim cannot race this durable queue reference.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'backups-source:' + storagePath}))`;
        const current = await tx.backup.findUnique({ where: { id: options.sourceBackupId } });
        const sourceMetadata = current?.metadata as Record<string, Prisma.JsonValue> | null;
        const retentionClaim = sourceMetadata?.retentionClaim as Record<string, Prisma.JsonValue> | undefined;
        if (!current || current.archivedAt || current.status !== BackupStatus.COMPLETED || (current.storagePath || current.id) !== storagePath || retentionClaim?.state === "DELETING") throw new ConflictException("Исходная резервная копия недоступна");
        // Older imports may alias the same files without carrying their own claim.
        const deletingAlias = await tx.backup.findFirst({ where: {
          OR: [{ storagePath }, { id: storagePath, OR: [{ storagePath: null }, { storagePath: "" }] }],
          metadata: { path: ["retentionClaim", "state"], equals: "DELETING" },
        }, select: { id: true } });
        if (deletingAlias) throw new ConflictException("Исходная резервная копия недоступна");
      }
      const metadata = { requestedVia: "API", job: { kind, phase: "QUEUED", progress: 0, ...(options.sourceBackupId ? { sourceBackupId: options.sourceBackupId } : {}) }, ...(options.sourceBackupId ? { sourceBackupId: options.sourceBackupId } : {}), ...(options.quarantine ? { quarantine: options.quarantine } : {}) };
      const backup = await tx.backup.create({ data: { id, type, status: BackupStatus.PENDING, createdById: actor.id, metadata } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: kind === "BACKUP" ? "BACKUP_REQUESTED" : kind === "DRILL" ? "BACKUP_DRILL_REQUESTED" : "BACKUP_IMPORT_REQUESTED", entityType: "Backup", entityId: id, after: { type, status: backup.status, kind, ...(options.sourceBackupId ? { sourceBackupId: options.sourceBackupId } : {}) } } });
      return backup;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  async saveSettings(input: SettingsInput, actor: User) {
    const { recovery, ...legacy } = input;
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'backups-settings'}))`;
      const before = await tx.backupSetting.findUnique({ where: { id: "default" } });
      const stored = await tx.appSetting.findUnique({ where: { section_key: { section: "backups", key: "recovery" } } });
      const next = recoveryConfig(recovery, recoveryConfig(stored?.value));
      const setting = await tx.backupSetting.upsert({ where: { id: "default" }, create: { id: "default", ...legacy }, update: legacy });
      if (recovery !== undefined) await tx.appSetting.upsert({ where: { section_key: { section: "backups", key: "recovery" } }, create: { section: "backups", key: "recovery", value: next }, update: { value: next } });
      const auditView = (value: typeof setting | null) => value ? { enabled: value.enabled, frequency: value.frequency, time: value.time, timezone: value.timezone, backupType: value.backupType, retentionCount: value.retentionCount, storageProvider: value.storageProvider } : undefined;
      await tx.auditLog.create({ data: { actorId: actor.id, action: before ? "BACKUP_SETTINGS_UPDATED" : "BACKUP_SETTINGS_CREATED", entityType: "BackupSetting", entityId: setting.id, before: auditView(before) as Prisma.InputJsonValue | undefined, after: { ...auditView(setting), recovery: next } } });
      return { ...setting, recovery: next };
    });
  }
  async settings() {
    const [legacy, stored] = await Promise.all([
      this.prisma.backupSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} }),
      this.prisma.appSetting.findUnique({ where: { section_key: { section: "backups", key: "recovery" } } }),
    ]);
    return { ...legacy, recovery: recoveryConfig(stored?.value) };
  }
  executor() { return this.prisma.appSetting.findUnique({ where: { section_key: { section: "backups", key: "executor" } } }); }
  drillNotification() { return this.prisma.appSetting.findUnique({ where: { section_key: { section: "backups", key: "drillNotification" } }, select: { value: true } }); }
  private storedBackups(): Prisma.BackupWhereInput {
    return { archivedAt: null, status: BackupStatus.COMPLETED, OR: [
      { metadata: { path: ["job", "kind"], not: "DRILL" } },
      { metadata: { path: ["job", "kind"], equals: Prisma.AnyNull } },
      { metadata: { equals: Prisma.DbNull } },
    ] };
  }
  totalSize() { return this.prisma.backup.aggregate({ where: this.storedBackups(), _sum: { sizeBytes: true } }); }
  evidence(key: "verification" | "drill") {
    return this.prisma.backup.findFirst({ where: { archivedAt: null, metadata: { path: [key], not: Prisma.AnyNull } }, orderBy: { updatedAt: "desc" } });
  }
  latestBackup() {
    return this.prisma.backup.findFirst({ where: this.storedBackups(), orderBy: { completedAt: "desc" } });
  }
  audit(action: string, id: string, actor: User, after: Prisma.InputJsonObject = {}) {
    return this.prisma.auditLog.create({ data: { actorId: actor.id, action, entityType: "Backup", entityId: id, after } });
  }
  recordVerification(id: string, report: Prisma.InputJsonObject, actor?: User) {
    return this.prisma.$transaction(async tx => {
      // Lock the row before reading metadata so concurrent worker results are preserved.
      await tx.$queryRaw`SELECT id FROM "Backup" WHERE id = ${id} FOR UPDATE`;
      const current = await tx.backup.findUniqueOrThrow({ where: { id } });
      const metadata = current.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata) ? current.metadata : {};
      await tx.backup.update({ where: { id }, data: { metadata: { ...metadata, verification: report } } });
      await tx.auditLog.create({ data: { actorId: actor?.id, action: report.status === "PASS" ? "BACKUP_VERIFIED" : "BACKUP_VERIFICATION_FAILED", entityType: "Backup", entityId: id, after: report } });
    });
  }
  journal(limit = 50) {
    return this.prisma.auditLog.findMany({ where: { entityType: { in: ["Backup", "BackupSetting", "BackupRecovery"] } }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, action: true, entityType: true, entityId: true, actorId: true, createdAt: true } });
  }
  retentionCandidates(keep: number) { return this.prisma.backup.findMany({ where: this.storedBackups(), orderBy: { createdAt: "desc" }, skip: keep }); }
  archive(id: string) { return this.prisma.backup.update({ where: { id }, data: { archivedAt: new Date() } }); }
}
