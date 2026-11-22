CREATE TABLE "WebPushEvent" (
  "eventKey" TEXT NOT NULL PRIMARY KEY,
  "topic" TEXT NOT NULL CHECK ("topic" IN ('messages','websiteOrders')),
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "WebPushSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionTokenHash" TEXT NOT NULL,
  "endpointHash" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "messages" BOOLEAN NOT NULL DEFAULT false,
  "websiteOrders" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebPushSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebPushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WebPushSubscription_endpointHash_key" ON "WebPushSubscription"("endpointHash");
CREATE INDEX "WebPushSubscription_userId_revokedAt_idx" ON "WebPushSubscription"("userId", "revokedAt");
CREATE TABLE "WebPushDelivery" (
  "id" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "subscriptionVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedUntil" TIMESTAMP(3),
  "leaseToken" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "WebPushDelivery_eventKey_fkey" FOREIGN KEY ("eventKey") REFERENCES "WebPushEvent"("eventKey") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WebPushDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebPushDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WebPushSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WebPushDelivery_topic_check" CHECK ("topic" IN ('messages','websiteOrders')),
  CONSTRAINT "WebPushDelivery_status_check" CHECK ("status" IN ('PENDING','PROCESSING','SENT','FAILED','CANCELLED','INDETERMINATE'))
);
CREATE UNIQUE INDEX "WebPushDelivery_eventKey_subscriptionId_key" ON "WebPushDelivery"("eventKey", "subscriptionId");
CREATE INDEX "WebPushDelivery_status_availableAt_idx" ON "WebPushDelivery"("status", "availableAt");
