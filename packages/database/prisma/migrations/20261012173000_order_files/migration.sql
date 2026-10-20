CREATE TABLE "OrderFile" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderFile_path_key" ON "OrderFile"("path");
CREATE INDEX "OrderFile_orderId_createdAt_idx" ON "OrderFile"("orderId", "createdAt");
ALTER TABLE "OrderFile" ADD CONSTRAINT "OrderFile_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderFile" ADD CONSTRAINT "OrderFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
