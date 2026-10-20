-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'PRODUCTION', 'ACCOUNTANT', 'VIEWER');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('LEAD', 'ACTIVE', 'VIP', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('WEBSITE', 'CHATWOOT', 'INSTAGRAM', 'FACEBOOK', 'WHATSAPP', 'EMAIL', 'TELEGRAM', 'REFERRAL', 'RETURNING_CUSTOMER', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "Discipline" AS ENUM ('RHYTHMIC_GYMNASTICS', 'ACROBATIC_GYMNASTICS', 'FIGURE_SKATING', 'AEROBIC_GYMNASTICS', 'BATON_TWIRLING_MAJORETTE', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('READY_MODEL', 'CUSTOM_ORDER', 'COPY_MODEL', 'MODIFIED_MODEL', 'PAIR', 'GROUP_ORDER', 'REPEAT_ORDER', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "SalesStatus" AS ENUM ('NEW_LEAD', 'WAITING_CLIENT_REPLY', 'NEEDS_ESTIMATE', 'ESTIMATE_SENT', 'DESIGN_DISCUSSION', 'WAITING_COACH_APPROVAL', 'WAITING_DEPOSIT', 'DEPOSIT_RECEIVED', 'ORDER_CONFIRMED', 'MEASUREMENTS_REQUIRED', 'MEASUREMENTS_RECEIVED', 'READY_FOR_PRODUCTION', 'IN_PRODUCTION', 'FINAL_DECORATION', 'QUALITY_CONTROL', 'PHOTO_SENT', 'WAITING_FINAL_PAYMENT', 'PAID', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'REVIEW_REQUESTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductionStatus" AS ENUM ('NOT_SCHEDULED', 'TENTATIVE', 'SCHEDULED', 'MATERIALS', 'CUTTING', 'SEWING', 'DECORATION', 'QUALITY_CONTROL', 'READY', 'ON_HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'DEPOSIT_PAID', 'PAID', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShippingStatus" AS ENUM ('NOT_READY', 'READY', 'LABEL_CREATED', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'RETURNED', 'LOST');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'BANK_TRANSFER', 'PAYPAL', 'CASH', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MANAGER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "displayName" TEXT NOT NULL,
    "country" TEXT,
    "city" TEXT,
    "address" TEXT,
    "postalCode" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "instagram" TEXT,
    "facebook" TEXT,
    "telegram" TEXT,
    "preferredChannel" "ContactChannel",
    "language" TEXT,
    "timezone" TEXT,
    "firstContactAt" TIMESTAMP(3),
    "source" "ContactChannel" NOT NULL DEFAULT 'MANUAL',
    "status" "ClientStatus" NOT NULL DEFAULT 'LEAD',
    "notes" TEXT,
    "responsibleManagerId" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "lastContactAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Athlete" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "birthDate" TIMESTAMP(3),
    "discipline" "Discipline",
    "club" TEXT,
    "coach" TEXT,
    "country" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Athlete_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Measurement" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'cm',
    "height" DECIMAL(6,2),
    "chest" DECIMAL(6,2),
    "waist" DECIMAL(6,2),
    "hips" DECIMAL(6,2),
    "torso" DECIMAL(6,2),
    "values" JSONB,
    "notes" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Measurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "athleteId" TEXT,
    "measurementId" TEXT,
    "type" "OrderType" NOT NULL,
    "discipline" "Discipline",
    "country" TEXT,
    "requiredDeliveryAt" TIMESTAMP(3),
    "promisedProductionAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "responsibleManagerId" TEXT,
    "productionOwner" TEXT,
    "priceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "depositRequiredMinor" INTEGER NOT NULL,
    "deliveryMinor" INTEGER NOT NULL DEFAULT 0,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "productionCostMinor" INTEGER,
    "salesStatus" "SalesStatus" NOT NULL DEFAULT 'NEW_LEAD',
    "productionStatus" "ProductionStatus" NOT NULL DEFAULT 'NOT_SCHEDULED',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "shippingStatus" "ShippingStatus" NOT NULL DEFAULT 'NOT_READY',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceMinor" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionSlot" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "tentative" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "orderId" TEXT,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "Client_displayName_idx" ON "Client"("displayName");

-- CreateIndex
CREATE INDEX "Client_email_idx" ON "Client"("email");

-- CreateIndex
CREATE INDEX "Client_phone_idx" ON "Client"("phone");

-- CreateIndex
CREATE INDEX "Client_status_archivedAt_idx" ON "Client"("status", "archivedAt");

-- CreateIndex
CREATE INDEX "Athlete_clientId_archivedAt_idx" ON "Athlete"("clientId", "archivedAt");

-- CreateIndex
CREATE INDEX "Measurement_athleteId_measuredAt_idx" ON "Measurement"("athleteId", "measuredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");

-- CreateIndex
CREATE INDEX "Order_salesStatus_archivedAt_idx" ON "Order"("salesStatus", "archivedAt");

-- CreateIndex
CREATE INDEX "Order_requiredDeliveryAt_idx" ON "Order"("requiredDeliveryAt");

-- CreateIndex
CREATE INDEX "Order_clientId_createdAt_idx" ON "Order"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_orderId_receivedAt_idx" ON "Payment"("orderId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionSlot_orderId_key" ON "ProductionSlot"("orderId");

-- CreateIndex
CREATE INDEX "ProductionSlot_startsAt_endsAt_idx" ON "ProductionSlot"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Activity_clientId_createdAt_idx" ON "Activity"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_orderId_createdAt_idx" ON "Activity"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_responsibleManagerId_fkey" FOREIGN KEY ("responsibleManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Athlete" ADD CONSTRAINT "Athlete_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_measurementId_fkey" FOREIGN KEY ("measurementId") REFERENCES "Measurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_responsibleManagerId_fkey" FOREIGN KEY ("responsibleManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionSlot" ADD CONSTRAINT "ProductionSlot_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
