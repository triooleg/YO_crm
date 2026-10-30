import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { User } from "@prisma/client";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { BackupService } from "./backup.service";
import { safeBackupId } from "./backup.storage";
import { parseBackupJson } from "./backup.json";
import { ComputerTransferStore, transferArchive, validTransferConfig, type ComputerDevice, type TransferCursor } from "./computer-transfer.store";

export type BackupDevicePrincipal = { deviceId: string; issuer: User };
@Injectable()
export class ComputerTransferService {
  constructor(private readonly store: ComputerTransferStore, private readonly backups: BackupService) {}
  private async authorize(actor: User) {
    if (!actor || !["OWNER", "ADMIN"].includes(actor.role)) throw new ForbiddenException("Недостаточно прав");
    const current = await this.store.actor(actor.id);
    if (!current?.active || current.archivedAt || !["OWNER", "ADMIN"].includes(current.role)) throw new ForbiddenException("Недостаточно прав");
  }
  async config(actor: User) { await this.authorize(actor); return this.store.config(); }
  async saveConfig(input: { mode: string; folder: string; intervalMinutes: number; currentPassword: string }, actor: User) {
    await this.backups.reauthenticate(actor, input.currentPassword);
    if (!validTransferConfig(input)) throw new BadRequestException("Некорректные настройки переноса");
    const { mode, folder, intervalMinutes } = input;
    return this.store.saveConfig({ mode, folder, intervalMinutes }, actor);
  }
  async devices(actor: User) {
    await this.authorize(actor);
    return (await this.store.devices()).map(({ id, name, createdById, createdAt, expiresAt, revoked, revokedAt, lastSeenAt }) => ({ id, name, createdById, createdAt, expiresAt, revoked, revokedAt: revokedAt ?? null, lastSeenAt: lastSeenAt ?? null }));
  }
  async issue(name: string, password: string, actor: User) {
    await this.backups.reauthenticate(actor, password);
    if (typeof name !== "string" || !name.trim() || name.trim().length > 120 || /[\x00-\x1f\x7f]/.test(name)) throw new BadRequestException("Укажите название компьютера");
    const token = randomBytes(32).toString("base64url"), now = Date.now();
    const device: ComputerDevice = { id: randomUUID(), name: name.trim(), tokenHash: createHash("sha256").update(token).digest("hex"), createdById: actor.id,
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 90 * 86400000).toISOString(), revoked: false };
    await this.store.addDevice(device, actor);
    return { id: device.id, token, expiresAt: device.expiresAt };
  }
  async revoke(id: string, password: string, actor: User) {
    await this.backups.reauthenticate(actor, password);
    if (!(await this.store.revokeDevice(id, actor))) throw new NotFoundException("Компьютер не найден");
    return { id, revoked: true };
  }
  async authenticate(authorization: unknown): Promise<BackupDevicePrincipal> {
    if (typeof authorization !== "string" || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) throw new UnauthorizedException("Недействительный токен компьютера");
    const hash = createHash("sha256").update(authorization.slice(7)).digest();
    const device = (await this.store.devices()).find(item => timingSafeEqual(hash, Buffer.from(item.tokenHash, "hex")));
    if (!device || device.revoked || Date.parse(device.expiresAt) <= Date.now() || Date.parse(device.createdAt) > Date.now()) throw new UnauthorizedException("Недействительный токен компьютера");
    const issuer = await this.store.actor(device.createdById);
    if (!issuer?.active || issuer.archivedAt || !["OWNER", "ADMIN"].includes(issuer.role)) throw new UnauthorizedException("Недействительный токен компьютера");
    return { deviceId: device.id, issuer };
  }
  private async revalidate(principal: BackupDevicePrincipal) {
    const device = (await this.store.devices()).find(item => item.id === principal.deviceId && item.createdById === principal.issuer.id);
    if (!device || device.revoked || Date.parse(device.expiresAt) <= Date.now()) throw new UnauthorizedException("Недействительный токен компьютера");
    await this.authorize(principal.issuer);
  }
  seen(principal: BackupDevicePrincipal) { return this.store.seen(principal.deviceId, principal.issuer); }
  private cursor(value?: string): TransferCursor | undefined {
    if (value === undefined) return undefined;
    try {
      if (typeof value !== "string" || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
      const decoded = parseBackupJson(Buffer.from(value, "base64url")) as { createdAt: string; id: string };
      if (!decoded || Object.keys(decoded).length !== 2 || typeof decoded.id !== "string" || !safeBackupId(decoded.id)
        || typeof decoded.createdAt !== "string" || new Date(decoded.createdAt).toISOString() !== decoded.createdAt) throw new Error();
      return { id: decoded.id, createdAt: new Date(decoded.createdAt) };
    } catch { throw new BadRequestException("Некорректный курсор архивов"); }
  }
  async archives(principal: BackupDevicePrincipal, cursor?: string, limit?: string) {
    await this.revalidate(principal);
    const config = await this.store.config();
    if (config.mode === "MANUAL") return { ...config, paired: true, archives: [], nextCursor: null };
    if (limit !== undefined && (typeof limit !== "string" || !/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > 100)) throw new BadRequestException("Лимит архивов должен быть от 1 до 100");
    const size = limit === undefined ? 100 : Number(limit), rows = await this.store.archives(this.cursor(cursor), size);
    await this.revalidate(principal);
    const currentConfig = await this.store.config();
    if (currentConfig.mode === "MANUAL") return { ...currentConfig, paired: true, archives: [], nextCursor: null };
    const last = rows.at(-1);
    // Advance over invalid metadata as well: sparse pages must never trap the client.
    const nextCursor = rows.length === size && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString("base64url") : null;
    return { ...currentConfig, paired: true, archives: rows.map(transferArchive).filter(item => item !== null), nextCursor };
  }
  async download(id: string, principal: BackupDevicePrincipal) {
    await this.revalidate(principal);
    const config = await this.store.config();
    if (config.mode !== "AUTOMATIC") throw new ForbiddenException("Автоматический перенос отключён");
    if (!safeBackupId(id)) throw new BadRequestException("Некорректный идентификатор архива");
    const row = await this.store.archive(id);
    if (!row || !transferArchive(row)) throw new NotFoundException("Архив не найден");
    const file = await this.backups.verifiedDownload(id, principal.issuer, { deviceId: principal.deviceId });
    try {
      // Hashing large archives can take time; do not release a stream revoked meanwhile.
      await this.revalidate(principal);
      if ((await this.store.config()).mode !== "AUTOMATIC") throw new ForbiddenException("Автоматический перенос отключён");
      const current = await this.store.archive(id);
      if (!current || !transferArchive(current)) throw new NotFoundException("Архив не найден");
    } catch (error) { file.getStream().destroy(); throw error; }
    return file;
  }
}
