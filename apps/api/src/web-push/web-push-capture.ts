import type { Prisma } from '@prisma/client';
import { type PushTopic, webPushConfiguration } from './web-push-policy';

export async function ensureWebPushWatermark(tx: Pick<Prisma.TransactionClient, 'appSetting'>) {
  return tx.appSetting.upsert({
    where: { section_key: { section: 'web-push', key: 'activatedAt' } },
    create: { section: 'web-push', key: 'activatedAt', value: new Date().toISOString() },
    update: {},
  });
}

/** Event and recipients commit atomically with the business event. No historical scan. */
export async function captureWebPush(tx: Prisma.TransactionClient, topic: PushTopic, eventKey: string, occurredAt: Date): Promise<void> {
  if (!webPushConfiguration()) return;
  const watermark = await ensureWebPushWatermark(tx);
  if (typeof watermark.value !== 'string' || !Number.isFinite(occurredAt.getTime()) ||
      !Number.isFinite(Date.parse(watermark.value)) || occurredAt.getTime() < Date.parse(watermark.value)) return;
  // Claim the source event even when nobody is subscribed. Later consent cannot
  // turn a repeated synchronization into a historical notification.
  const captured = await tx.$queryRaw<Array<{ eventKey: string }>>`
    INSERT INTO "WebPushEvent" ("eventKey",topic,"occurredAt")
    VALUES (${eventKey},${topic},${occurredAt})
    ON CONFLICT ("eventKey") DO NOTHING RETURNING "eventKey"
  `;
  if (!captured.length) return;
  await tx.$executeRaw`
    INSERT INTO "WebPushDelivery" ("id","eventKey","topic","subscriptionId","subscriptionVersion","createdAt","availableAt","status","attempts")
    SELECT md5(${eventKey} || ':' || s."id"), ${eventKey}, ${topic}, s."id", s."version", NOW(), NOW(), 'PENDING', 0
    FROM "WebPushSubscription" s
    JOIN "User" u ON u.id=s."userId"
    JOIN "Session" sess ON sess."tokenHash"=s."sessionTokenHash" AND sess."userId"=u.id
    WHERE s."updatedAt" <= ${occurredAt} AND s."revokedAt" IS NULL AND u.active AND u."archivedAt" IS NULL
      AND u.role::text IN ('OWNER','ADMIN','MANAGER') AND sess."expiresAt">NOW()
      AND ((${topic}='messages' AND s.messages) OR (${topic}='websiteOrders' AND s."websiteOrders"))
    ON CONFLICT ("eventKey","subscriptionId") DO NOTHING
  `;
}
