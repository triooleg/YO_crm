import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { User, UserRole } from "@prisma/client";
import type { Request } from "express";
import { ROLES_KEY } from "./roles.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!roles?.length) return true;
    const request = context.switchToHttp().getRequest<Request & { user?: User }>();
    if (!request.user || !roles.includes(request.user.role)) {
      throw new ForbiddenException("Недостаточно прав для выполнения действия");
    }
    return true;
  }
}
