import { ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type Backup, type User } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { safeBackupId } from "./backup.storage";

export type ComputerTransferConfig = { mode: "MANUAL" | "AUTOMATIC"; folder: string; intervalMinutes: number };
export type ComputerDevice = { id: string; name: string; tokenHash: string; createdById: string; createdAt: string; expiresAt: string; revoked: boolean; revokedAt?: string; lastSeenAt?: string };
export type TransferCursor = { createdAt: Date; id: string };
type ArchiveRow = Pick<Backup, "id" | "type" | "status" | "storageProvider" | "createdAt" | "metadata" | "archivedAt">;
export function transferArchive(row: ArchiveRow) {
  const metadata = row.metadata as { job?: { kind?: unknown }; archive?: { file?: unknown; checksum?: unknown; bytes?: unknown } } | null;
  const archive = metadata?.archive;
  if (!safeBackupId(row.id) || row.status !== "COMPLETED" || row.archivedAt || row.storageProvider !== "LOCAL" || metadata?.job?.kind === "DRILL"
    || !["DATA", "FULL"].includes(row.type) || archive?.file !== "archive.tar.gz" || typeof archive.checksum !== "string"
    || !/^[a-f0-9]{64}$/.test(archive.checksum) || !["string", "number"].includes(typeof archive.bytes)
    || !/^[1-9]\d{0,15}$/.test(String(archive.bytes)) || !Number.isSafeInteger(Number(archive.bytes))) return null;
  return { id: row.id, type: row.type, createdAt: row.createdAt.toISOString(), archiveChecksum: archive.checksum, archiveBytes: Number(archive.bytes) };
}
export const DEFAULT_COMPUTER_TRANSFER: ComputerTransferConfig = { mode: "MANUAL", folder: "D:\\YO_CRM_Backups", intervalMinutes: 30 };
export function validTransferConfig(value: unknown): value is ComputerTransferConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as ComputerTransferConfig;
  return ["MANUAL", "AUTOMATIC"].includes(config.mode) && typeof config.folder === "string"
    && config.folder.length <= 240 && /^[A-Za-z]:\\[^<>:"'`/|?*\x00-\x1f\x7f]+$/.test(config.folder)
    && config.folder.split("\\").slice(1).every(part => Boolean(part) && part !== "." && part !== ".." && !/[. ]$/.test(part))
    && Number.isInteger(config.intervalMinutes) && config.intervalMinutes >= 5 && config.intervalMinutes <= 1440;
}
@Injectable()
export class ComputerTransferStore {
  constructor(private readonly prisma: PrismaService) {}
  async config(): Promise<ComputerTransferConfig> {
    const stored = await this.prisma.appSetting.findUnique({ where: { section_key: { section: "backups", key: "computer-transfer" } } });
    if (!stored) return { ...DEFAULT_COMPUTER_TRANSFER };
    if (!validTransferConfig(stored.value)) throw new ServiceUnavailableException("Настройки переноса повреждены");
    const { mode, folder, intervalMinutes } = stored.value;
    return { mode, folder, intervalMinutes };
  }
  actor(id: string) { return this.prisma.user.findUnique({ where: { id } }); }
  private async readDevices(db: Prisma.TransactionClient = this.prisma): Promise<ComputerDevice[]> {
    const stored = await db.appSetting.findUnique({ where: { section_key: { section: "backups", key: "computer-devices" } } });
    if (!stored) return [];
    const devices = (stored.value as { devices?: unknown } | null)?.devices;
    if (!Array.isArray(devices) || devices.length > 100 || devices.some(device => !device || typeof device.id !== "string"
      || !/^[a-f0-9-]{36}$/.test(device.id) || typeof device.name !== "string" || !device.name.trim() || device.name.length > 120
      || typeof device.tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(device.tokenHash)
      || typeof device.createdById !== "string" || !device.createdById || typeof device.revoked !== "boolean"
      || typeof device.createdAt !== "string" || !Number.isFinite(Date.parse(device.createdAt))
      || (device.lastSeenAt !== undefined && (typeof device.lastSeenAt !== "string" || !Number.isFinite(Date.parse(device.lastSeenAt))))
      || (device.revokedAt !== undefined && (typeof device.revokedAt !== "string" || !Number.isFinite(Date.parse(device.revokedAt))))
      || typeof device.expiresAt !== "string" || !Number.isFinite(Date.parse(device.expiresAt))
      || Date.parse(device.expiresAt) <= Date.parse(device.createdAt) || Date.parse(device.expiresAt) - Date.parse(device.createdAt) > 90 * 86400000)
      || new Set(devices.map(device => device.id)).size !== devices.length || new Set(devices.map(device => device.tokenHash)).size !== devices.length) {
      throw new ServiceUnavailableException("Реестр компьютеров повреждён");
    }
    return devices as ComputerDevice[];
  }
  devices() { return this.readDevices(); }
  private async mutation<T>(actor: User, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(async tx => {
      // One lock covers both AppSettings, including first insert, active cap and history pruning.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'backups-computer-transfer'}))`;
      const current = await tx.user.findUnique({ where: { id: actor.id } });
      if (!current?.active || current.archivedAt || !["OWNER", "ADMIN"].includes(current.role)) throw new ForbiddenException("Недостаточно прав");
      return fn(tx);
    });
  }
  private write(tx: Prisma.TransactionClient, key: string, value: Prisma.InputJsonObject) {
    return tx.appSetting.upsert({ where: { section_key: { section: "backups", key } }, create: { section: "backups", key, value }, update: { value } });
  }
  saveConfig(config: ComputerTransferConfig, actor: User) {
    return this.mutation(actor, async tx => {
      await this.write(tx, "computer-transfer", config);
      await tx.auditLog.create({ data: { actorId: actor.id, action: "BACKUP_COMPUTER_TRANSFER_UPDATED", entityType: "BackupSetting", entityId: "computer-transfer", after: config } });
      return config;
    });
  }
  addDevice(device: ComputerDevice, actor: User) {
    return this.mutation(actor, async tx => {
      const devices = await this.readDevices(tx);
      const now = Date.now(), active = (item: ComputerDevice) => !item.revoked && Date.parse(item.expiresAt) > now;
      if (devices.filter(active).length >= 20) throw new ConflictException("Достигнут лимит 20 активных компьютеров");
      // Retain history until space is needed. Never evict a valid active credential.
      const pruneCount = Math.max(0, devices.length + 1 - 100);
      const prunedIds = devices.filter(item => !active(item))
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
        .slice(0, pruneCount).map(item => item.id);
      const pruned = new Set(prunedIds);
      await this.write(tx, "computer-devices", { devices: [...devices.filter(item => !pruned.has(item.id)), device] });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "BACKUP_COMPUTER_PAIRED", entityType: "BackupSetting", entityId: device.id, after: { deviceId: device.id, name: device.name, expiresAt: device.expiresAt, ...(prunedIds.length ? { prunedDeviceIds: prunedIds } : {}) } } });
    });
  }
  revokeDevice(id: string, actor: User) {
    return this.mutation(actor, async tx => {
      const devices = await this.readDevices(tx), device = devices.find(item => item.id === id);
      if (!device) return false;
      if (!device.revoked) {
        device.revoked = true;
        device.revokedAt = new Date().toISOString();
        await this.write(tx, "computer-devices", { devices });
        await tx.auditLog.create({ data: { actorId: actor.id, action: "BACKUP_COMPUTER_REVOKED", entityType: "BackupSetting", entityId: id, after: { deviceId: id, revoked: true } } });
      }
      return true;
    });
  }
  seen(id: string, issuer: User) {
    return this.mutation(issuer, async tx => {
      const devices = await this.readDevices(tx), device = devices.find(item => item.id === id && item.createdById === issuer.id);
      if (!device || device.revoked || Date.parse(device.expiresAt) <= Date.now()) throw new ForbiddenException("Компьютер отключён");
      device.lastSeenAt = new Date().toISOString();
      await this.write(tx, "computer-devices", { devices });
    });
  }
  archives(cursor: TransferCursor | undefined, limit: number) {
    return this.prisma.backup.findMany({ where: {
      archivedAt: null, status: "COMPLETED", storageProvider: "LOCAL",
      OR: [{ metadata: { path: ["job", "kind"], not: "DRILL" } }, { metadata: { path: ["job", "kind"], equals: Prisma.AnyNull } }],
      ...(cursor ? { AND: [{ OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] }] } : {}),
    }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit,
    select: { id: true, type: true, status: true, storageProvider: true, createdAt: true, archivedAt: true, metadata: true } });
  }
  archive(id: string) { return this.prisma.backup.findFirst({ where: { id, archivedAt: null } }); }
}
