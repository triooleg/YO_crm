ALTER TYPE "ShippingCarrier" ADD VALUE IF NOT EXISTS 'UPS';
ALTER TABLE "OrderShipment" ADD COLUMN "trackingUrl" TEXT, ADD COLUMN "trackingRevision" INTEGER NOT NULL DEFAULT 1;
CREATE FUNCTION yo_shipment_tracking_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."carrier", NEW."trackingNumber", NEW."trackingUrl") IS DISTINCT FROM ROW(OLD."carrier", OLD."trackingNumber", OLD."trackingUrl") THEN
    NEW."trackingRevision" := OLD."trackingRevision" + 1;
  ELSE
    NEW."trackingRevision" := OLD."trackingRevision";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER yo_shipment_tracking_revision BEFORE UPDATE ON "OrderShipment" FOR EACH ROW EXECUTE FUNCTION yo_shipment_tracking_revision();
CREATE TABLE "ShipmentNotification" (
 "id" TEXT PRIMARY KEY, "shipmentId" TEXT NOT NULL REFERENCES "OrderShipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "clientId" TEXT NOT NULL REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "conversationId" TEXT REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "conversationExternalId" TEXT, "conversationChannel" TEXT, "emailAccountIdentity" TEXT,
 "trackingRevision" INTEGER NOT NULL, "trackingNumber" TEXT NOT NULL, "trackingUrl" TEXT NOT NULL,
 "carrier" "ShippingCarrier" NOT NULL, "language" TEXT NOT NULL, "content" TEXT NOT NULL, "subject" TEXT NOT NULL,
 "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ShipmentNotification_shipmentId_trackingRevision_key" UNIQUE ("shipmentId","trackingRevision")
);
CREATE INDEX "ShipmentNotification_clientId_createdAt_idx" ON "ShipmentNotification"("clientId","createdAt");
CREATE INDEX "ShipmentNotification_orderId_createdAt_idx" ON "ShipmentNotification"("orderId","createdAt");
CREATE TABLE "ShipmentNotificationDelivery" (
 "id" TEXT PRIMARY KEY, "notificationId" TEXT NOT NULL REFERENCES "ShipmentNotification"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "channel" TEXT NOT NULL CHECK ("channel" IN ('CHAT','EMAIL')), "recipient" TEXT NOT NULL,
 "clientRequestId" TEXT NOT NULL UNIQUE, "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','SENDING','SENT','FAILED','UNKNOWN')),
 "messageId" TEXT, "sentAt" TIMESTAMP(3), "error" TEXT, "startedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ShipmentNotificationDelivery_notificationId_channel_key" UNIQUE ("notificationId","channel")
);
CREATE INDEX "ShipmentNotificationDelivery_status_updatedAt_idx" ON "ShipmentNotificationDelivery"("status","updatedAt");
