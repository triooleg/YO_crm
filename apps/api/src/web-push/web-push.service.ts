import { BadRequestException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { MAX_SUBSCRIPTIONS_PER_USER, validateEndpoint, validateSubscription, WEB_PUSH_ROLES, webPushConfiguration } from './web-push-policy';

export function pushSessionHash(token?: string): string {
  if (!token || token.length > 512) throw new UnauthorizedException();
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class WebPushService {
  constructor(private readonly prisma: PrismaService) {}

  private async session(user: User, token?: string) {
    const tokenHash = pushSessionHash(token);
    const session = await this.prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!session || session.userId !== user.id || session.expiresAt <= new Date() || !session.user.active || session.user.archivedAt) throw new UnauthorizedException();
    return session;
  }

  async config(user: User, token?: string, endpoint?: string) {
    const session = await this.session(user, token);
    const config = webPushConfiguration();
    if (!config || !WEB_PUSH_ROLES.some(role => role === session.user.role)) return { enabled: false, publicKey: null, subscription: null };
    const value = endpoint ? validateEndpoint(endpoint) : undefined;
    const row = value ? await this.prisma.webPushSubscription.findFirst({
      where: { endpointHash: this.endpointHash(value), userId: user.id, sessionTokenHash: session.tokenHash, revokedAt: null },
    }) : null;
    return { enabled: true, publicKey: config.publicKey, subscription: row ? { topics: { messages: row.messages, websiteOrders: row.websiteOrders } } : null };
  }

  async subscribe(user: User, token: string | undefined, input: unknown) {
    const session = await this.session(user, token);
    if (!WEB_PUSH_ROLES.some(role => role === session.user.role)) throw new ForbiddenException();
    if (!webPushConfiguration()) throw new ServiceUnavailableException('Уведомления пока недоступны');
    const value = validateSubscription(input);
    const endpointHash = this.endpointHash(value.endpoint);
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'web-push-user:' + user.id},0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'web-push-endpoint:' + endpointHash},0))`;
      const previous = await tx.webPushSubscription.findUnique({ where: { endpointHash } });
      if (previous && previous.userId !== user.id && !previous.revokedAt) {
        const ownerSession = await tx.session.findFirst({ where: { tokenHash: previous.sessionTokenHash, userId: previous.userId, expiresAt: { gt: new Date() } } });
        if (ownerSession) throw new ConflictException('Подписка привязана к другой сессии');
      }
      if (previous && previous.userId === user.id && previous.sessionTokenHash === session.tokenHash && !previous.revokedAt &&
          previous.endpoint === value.endpoint && previous.p256dh === value.keys.p256dh && previous.auth === value.keys.auth &&
          previous.messages === value.topics.messages && previous.websiteOrders === value.topics.websiteOrders) {
        return { ok: true, subscription: { topics: { messages: previous.messages, websiteOrders: previous.websiteOrders } } };
      }
      const sessions = await tx.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, select: { tokenHash: true } });
      const count = await tx.webPushSubscription.count({ where: { userId: user.id, revokedAt: null, sessionTokenHash: { in: sessions.map(row => row.tokenHash) } } });
      if ((!previous || previous.revokedAt || previous.userId !== user.id || !sessions.some(row => row.tokenHash === previous.sessionTokenHash)) && count >= MAX_SUBSCRIPTIONS_PER_USER) throw new BadRequestException('Достигнут лимит устройств для уведомлений');
      const data = { userId: user.id, sessionTokenHash: session.tokenHash, endpoint: value.endpoint, p256dh: value.keys.p256dh, auth: value.keys.auth, messages: value.topics.messages, websiteOrders: value.topics.websiteOrders, revokedAt: null };
      const saved = await tx.webPushSubscription.upsert({
        where: { endpointHash }, create: { endpointHash, ...data }, update: { ...data, version: { increment: 1 } },
      });
      await tx.auditLog.create({ data: { actorId: user.id, action: 'UPDATE', entityType: 'WebPushSubscription', entityId: saved.id, after: { messages: saved.messages, websiteOrders: saved.websiteOrders, consent: true } } });
      return { ok: true, subscription: { topics: { messages: saved.messages, websiteOrders: saved.websiteOrders } } };
    });
  }

  async unsubscribe(user: User, token: string | undefined, input: unknown) {
    const session = await this.session(user, token);
    const endpoint = validateEndpoint(input && typeof input === 'object' ? (input as { endpoint?: unknown }).endpoint : undefined);
    await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'web-push-user:' + user.id},0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'web-push-endpoint:' + this.endpointHash(endpoint)},0))`;
      const row = await tx.webPushSubscription.findFirst({ where: { endpointHash: this.endpointHash(endpoint), userId: user.id, sessionTokenHash: session.tokenHash, revokedAt: null } });
      if (!row) return;
      const result = await tx.webPushSubscription.updateMany({ where: { id: row.id, userId: user.id, sessionTokenHash: session.tokenHash, version: row.version }, data: { revokedAt: new Date(), messages: false, websiteOrders: false, p256dh: '', auth: '', version: { increment: 1 } } });
      if (!result.count) throw new ConflictException('WEB_PUSH_CONSENT_CHANGED');
      await tx.auditLog.create({ data: { actorId: user.id, action: 'REVOKE', entityType: 'WebPushSubscription', entityId: row.id, after: { revoked: true } } });
    });
    return { ok: true };
  }

  private endpointHash(endpoint: string) { return createHash('sha256').update(endpoint).digest('hex'); }
}
