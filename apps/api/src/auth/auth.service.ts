import { Injectable, UnauthorizedException } from "@nestjs/common";
import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma.service";

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}
  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }
  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user?.active || !(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException("Invalid email or password");
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 14 * 86_400_000);
    await this.prisma.session.create({ data: { userId: user.id, tokenHash: this.hashToken(token), expiresAt } });
    return { token, expiresAt, user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } };
  }
  async userForToken(token?: string) {
    if (!token) throw new UnauthorizedException();
    const session = await this.prisma.session.findUnique({ where: { tokenHash: this.hashToken(token) }, include: { user: true } });
    if (!session || session.expiresAt <= new Date() || !session.user.active) throw new UnauthorizedException();
    return session.user;
  }
  async logout(token?: string) {
    if (token) await this.prisma.session.deleteMany({ where: { tokenHash: this.hashToken(token) } });
  }
}
