import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";
import { ComputerTransferService, type BackupDevicePrincipal } from "./computer-transfer.service";

export type BackupSyncRequest = Request & { backupDevice: BackupDevicePrincipal };
@Injectable()
export class BackupSyncGuard implements CanActivate {
  constructor(private readonly transfers: ComputerTransferService) {}
  async canActivate(context: ExecutionContext) {
    const http = context.switchToHttp(), request = http.getRequest<BackupSyncRequest>();
    http.getResponse<Response>().setHeader("Cache-Control", "no-store");
    http.getResponse<Response>().setHeader("X-Content-Type-Options", "nosniff");
    if (Object.keys(request.query).some(key => /^(token|access_token|authorization|bearer)($|\[)/i.test(key))) throw new UnauthorizedException("Передавайте токен только в заголовке Authorization");
    request.backupDevice = await this.transfers.authenticate(request.headers.authorization);
    await this.transfers.seen(request.backupDevice);
    return true;
  }
}
