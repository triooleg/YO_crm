CREATE TYPE "OrderDocumentKind" AS ENUM ('INVOICE', 'ORDER_SUMMARY', 'CUSTOMER_CARD', 'CUSTOM');

CREATE TABLE "DocumentTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "OrderDocumentKind" NOT NULL DEFAULT 'INVOICE',
  "language" TEXT NOT NULL DEFAULT 'en',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "config" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderDocument" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "templateKey" TEXT,
  "kind" "OrderDocumentKind" NOT NULL,
  "title" TEXT NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'en',
  "templateSnapshot" JSONB NOT NULL,
  "dataSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "OrderDocument_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Invoice"
  ADD COLUMN "templateKey" TEXT,
  ADD COLUMN "templateSnapshot" JSONB,
  ADD COLUMN "dataSnapshot" JSONB,
  ADD COLUMN "documentOptions" JSONB;

CREATE INDEX "DocumentTemplate_kind_active_archivedAt_idx" ON "DocumentTemplate"("kind", "active", "archivedAt");
CREATE INDEX "DocumentTemplate_name_idx" ON "DocumentTemplate"("name");
CREATE INDEX "OrderDocument_orderId_createdAt_idx" ON "OrderDocument"("orderId", "createdAt");
CREATE INDEX "OrderDocument_kind_createdAt_idx" ON "OrderDocument"("kind", "createdAt");

ALTER TABLE "OrderDocument" ADD CONSTRAINT "OrderDocument_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
