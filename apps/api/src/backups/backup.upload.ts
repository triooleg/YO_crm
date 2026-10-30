import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor, PayloadTooLargeException } from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, statfs, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { catchError } from "rxjs";
import { BackupService } from "./backup.service";
import { assertPrivateDirectory, byteLimit } from "./backup.storage";
import type { Request } from "express";
import type { User } from "@prisma/client";
export type QuarantinedArchive = { filename: string; path: string; size: number; checksum: string; admissionToken: string };
type UploadRequest = Request & { user: User; file?: QuarantinedArchive; files?: Record<string, QuarantinedArchive[]> };
const quarantinePath = () => {
  const configured = process.env.BACKUP_STORAGE_PATH || "/backups";
  if (!isAbsolute(configured)) throw new Error("BACKUP_STORAGE_PATH должен быть абсолютным путём");
  return join(resolve(configured), "quarantine");
};
async function removeUpload(file?: QuarantinedArchive) {
  if (!file || !/^[a-f0-9-]{36}\.tar\.gz$/.test(file.filename) || file.path !== join(quarantinePath(), file.filename)) return;
  await assertPrivateDirectory(quarantinePath());
  await unlink(file.path).catch(error => { if (error.code !== "ENOENT") throw error; });
}
@Injectable()
export class BackupUploadInterceptor implements NestInterceptor {
  constructor(private readonly backups: BackupService) {}
  private async cleanup(file?: QuarantinedArchive) {
    try { await removeUpload(file); } finally { await this.backups.releaseUpload(file?.admissionToken); }
  }
  async intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<UploadRequest>();
    const limit = byteLimit("BACKUP_UPLOAD_MAX_BYTES", 2 * 1024 ** 3);
    const storage = {
      _handleFile: (req: UploadRequest, file: { stream: Readable }, done: (error: unknown, result?: QuarantinedArchive) => void) => {
        const write = async () => {
          if (!req.body || !["DATA", "FULL"].includes(req.body.type)) throw new BadRequestException("Поля currentPassword и type должны предшествовать archive");
          await this.backups.reauthenticate(req.user, req.body.currentPassword);
          const directory = quarantinePath(); await assertPrivateDirectory(resolve(directory, ".."));
          await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
          await assertPrivateDirectory(directory);
          const filename = `${randomUUID()}.tar.gz`, path = join(directory, filename);
          const maxPendingGlobal = Math.min(byteLimit("BACKUP_UPLOAD_MAX_PENDING_GLOBAL", 4), 100);
          const files: string[] = [];
          for await (const entry of await opendir(directory)) {
            const info = await lstat(join(directory, entry.name));
            if (!/^[a-f0-9-]{36}\.tar\.gz$/.test(entry.name) || !info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || files.length >= maxPendingGlobal) throw new BadRequestException("Каталог загрузок требует проверки или освобождения");
            files.push(entry.name);
          }
          const disk = await statfs(resolve(directory, ".."), { bigint: true });
          const contentLength = Number(req.headers["content-length"]);
          const expectedBytes = BigInt(Number.isSafeInteger(contentLength) && contentLength > 0 ? Math.min(limit, contentLength) : limit);
          const admissionToken = await this.backups.reserveUpload(req.user, {
            filename, expectedBytes, availableBytes: disk.bavail * disk.bsize,
            reserveBytes: BigInt(byteLimit("BACKUP_UPLOAD_RESERVED_BYTES", 256 * 1024 ** 2)),
            files, maxPendingGlobal,
            maxPendingActor: Math.min(byteLimit("BACKUP_UPLOAD_MAX_PENDING_PER_ACTOR", 2), 100),
          });
          let handle;
          let size = 0; const hash = createHash("sha256");
          try {
            handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
            await pipeline(file.stream, new Transform({ transform(chunk, _encoding, callback) {
              size += chunk.length;
              if (size > limit || BigInt(size) > expectedBytes) return callback(new PayloadTooLargeException("Превышен лимит архива"));
              hash.update(chunk); callback(null, chunk);
            } }), handle.createWriteStream({ autoClose: true }));
            if (!size) throw new BadRequestException("Архив пуст");
            return { filename, path, size, checksum: hash.digest("hex"), admissionToken };
          } catch (error) {
            await handle?.close().catch(() => {}); await unlink(path).catch(() => {});
            await this.backups.releaseUpload(admissionToken); throw error;
          } finally { await handle?.close().catch(() => {}); }
        };
        void write().then(result => done(null, result), error => done(error));
      },
      _removeFile: (_req: UploadRequest, file: QuarantinedArchive, done: (error: unknown) => void) => { void this.cleanup(file).then(() => done(null), done); },
    };
    const Multipart = FileFieldsInterceptor([{ name: "archive", maxCount: 1 }, { name: "file", maxCount: 1 }], { storage, limits: { fileSize: limit, files: 1, fields: 3, parts: 4, fieldSize: 1024, fieldNameSize: 100 } });
    const observable = await new Multipart().intercept(context, { handle: () => {
      request.file = request.files?.archive?.[0] ?? request.files?.file?.[0];
      return next.handle();
    } });
    return observable.pipe(catchError(async error => { await this.cleanup(request.file); throw error; }));
  }
}
