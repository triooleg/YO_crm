import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import webPush from 'web-push';
import { ensureWebPushWatermark } from './web-push-capture';
import { PrismaService } from '../prisma.service';
import { assertExternalSideEffectsAllowed } from '../recovery-safety';
import { notificationPayload, type PushTopic, validateSubscription, webPushConfiguration, WEB_PUSH_ROLES } from './web-push-policy';

@Injectable()
export class WebPushWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebPushWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (!webPushConfiguration()) return;
    await ensureWebPushWatermark(this.prisma);
    this.timer = setInterval(() => void this.tick(), 5000);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async tick() {
    if (this.running || !webPushConfiguration()) return;
    this.running = true;
    try {
      // A crashed sender may already have reached the provider. Preserve uncertainty
      // without replaying the same delivery to the user's device.
      await this.prisma.webPushDelivery.updateMany({
        where: { status: 'PROCESSING', lockedUntil: { lt: new Date() } },
        data: { status: 'INDETERMINATE', lastError: 'SEND_OUTCOME_UNKNOWN', leaseToken: null, lockedUntil: null },
      });
      for (let i = 0; i < 20 && webPushConfiguration(); i++) {
        const lease = randomUUID();
        const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
          UPDATE "WebPushDelivery"
          SET status='PROCESSING', "leaseToken"=${lease}, "lockedUntil"=NOW()+INTERVAL '2 minutes', attempts=attempts+1
          WHERE id IN (
            SELECT id FROM "WebPushDelivery"
            WHERE status='PENDING' AND "availableAt"<=NOW()
            ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1
          )
          RETURNING id
        `;
        if (!rows.length) break;
        await this.deliver(rows[0]!.id, lease);
      }
    } catch {
      // Provider errors can include the endpoint, encryption keys and payload.
      this.logger.warn('WEB_PUSH_WORKER_FAILED');
    } finally {
      this.running = false;
    }
  }

  private async deliver(id: string, lease: string) {
    await this.prisma.$transaction(async tx => {
      const delivery = await tx.webPushDelivery.findUnique({ where: { id } });
      if (!delivery || delivery.status !== 'PROCESSING' || delivery.leaseToken !== lease) return;
      // Hold the subscription and live session through the bounded send so revoke/logout
      // cannot finish while a send using that consent is still being started.
      await tx.$queryRaw`SELECT id FROM "WebPushSubscription" WHERE id=${delivery.subscriptionId} FOR UPDATE`;
      const subscription = await tx.webPushSubscription.findUnique({ where: { id: delivery.subscriptionId } });
      const finish = (status: string, lastError: string | null = null) => tx.webPushDelivery.updateMany({
        where: { id, status: 'PROCESSING', leaseToken: lease },
        data: { status, lastError, leaseToken: null, lockedUntil: null, ...(status === 'SENT' ? { sentAt: new Date() } : {}) },
      });
      if (!subscription || subscription.revokedAt || subscription.version !== delivery.subscriptionVersion ||
          !(delivery.topic === 'messages' ? subscription.messages : delivery.topic === 'websiteOrders' && subscription.websiteOrders)) {
        await finish('CANCELLED', 'CONSENT_REVOKED');
        return;
      }
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${subscription.userId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "Session" WHERE "tokenHash"=${subscription.sessionTokenHash} FOR SHARE`;
      const session = await tx.session.findUnique({ where: { tokenHash: subscription.sessionTokenHash }, include: { user: true } });
      if (!session || session.userId !== subscription.userId || session.expiresAt <= new Date() || !session.user.active || session.user.archivedAt ||
          !WEB_PUSH_ROLES.some(role => role === session.user.role)) {
        await finish('CANCELLED', 'SESSION_REVOKED');
        return;
      }
      if (delivery.createdAt.getTime() < Date.now() - 86400000 || delivery.attempts > 8) {
        await finish('CANCELLED', 'DELIVERY_EXPIRED');
        return;
      }
      const config = webPushConfiguration();
      if (!config) {
        await tx.webPushDelivery.updateMany({ where: { id, leaseToken: lease }, data: { status: 'PENDING', leaseToken: null, lockedUntil: null, availableAt: new Date(Date.now() + 60000) } });
        return;
      }
      let value;
      try {
        value = validateSubscription({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth }, topics: { messages: subscription.messages, websiteOrders: subscription.websiteOrders } });
      } catch {
        await finish('FAILED', 'INVALID_SUBSCRIPTION');
        return;
      }
      try {
        assertExternalSideEffectsAllowed();
        await webPush.sendNotification({ endpoint: value.endpoint, keys: value.keys }, JSON.stringify(notificationPayload(delivery.topic as PushTopic, id)), {
          vapidDetails: config, TTL: Math.max(1, Math.min(86400, Math.floor((delivery.createdAt.getTime() + 86400000 - Date.now()) / 1000))), timeout: 8000, urgency: 'high',
          topic: createHash('sha256').update(id).digest('base64url').slice(0, 32),
        });
        await finish('SENT');
      } catch (error) {
        const status = typeof error === 'object' && error ? Number((error as { statusCode?: unknown }).statusCode) : 0;
        if (status === 404 || status === 410) {
          await tx.webPushSubscription.update({ where: { id: subscription.id }, data: { revokedAt: new Date(), messages: false, websiteOrders: false, p256dh: '', auth: '', version: { increment: 1 } } });
          await finish('CANCELLED', 'SUBSCRIPTION_EXPIRED');
          return;
        }
        const retry = (status === 429 || status >= 500) && delivery.attempts < 8;
        await tx.webPushDelivery.updateMany({
          where: { id, leaseToken: lease },
          data: {
            status: !status ? 'INDETERMINATE' : retry ? 'PENDING' : 'FAILED', leaseToken: null, lockedUntil: null,
            lastError: status ? 'PUSH_HTTP_' + status : 'PUSH_TRANSPORT_ERROR',
            availableAt: new Date(Date.now() + Math.min(3600000, 15000 * 2 ** delivery.attempts)),
          },
        });
      }
    }, { timeout: 20000, maxWait: 5000 });
  }
}
