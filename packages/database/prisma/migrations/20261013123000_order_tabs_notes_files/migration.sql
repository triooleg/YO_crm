CREATE TYPE "OrderFileRole" AS ENUM ('GENERAL', 'DESIGN_FRONT', 'DESIGN_BACK', 'DESIGN_GALLERY', 'NOTE_ATTACHMENT');
CREATE TYPE "OrderNoteCategory" AS ENUM ('GENERAL', 'CLIENT', 'DESIGNS', 'MEASUREMENTS', 'PRODUCTION', 'SHIPPING', 'FINANCE');
CREATE TYPE "OrderNoteVisibility" AS ENUM ('INTERNAL', 'CUSTOMER_WISH');

ALTER TABLE "Client" ADD COLUMN "preferences" JSONB;
ALTER TABLE "Activity" ADD COLUMN "actorId" TEXT;

CREATE TABLE "OrderTag" (
  "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "label" TEXT NOT NULL, "color" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "archivedAt" TIMESTAMP(3),
  CONSTRAINT "OrderTag_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrderTag_orderId_label_key" ON "OrderTag"("orderId", "label");
CREATE INDEX "OrderTag_orderId_archivedAt_createdAt_idx" ON "OrderTag"("orderId", "archivedAt", "createdAt");

CREATE TABLE "OrderNote" (
  "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "authorId" TEXT, "designItemId" TEXT,
  "itemInstanceId" TEXT, "athleteId" TEXT,
  "category" "OrderNoteCategory" NOT NULL DEFAULT 'GENERAL',
  "visibility" "OrderNoteVisibility" NOT NULL DEFAULT 'INTERNAL',
  "title" TEXT NOT NULL, "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "archivedAt" TIMESTAMP(3),
  CONSTRAINT "OrderNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrderNote_orderId_category_archivedAt_createdAt_idx" ON "OrderNote"("orderId", "category", "archivedAt", "createdAt");
CREATE INDEX "OrderNote_designItemId_idx" ON "OrderNote"("designItemId");
CREATE INDEX "OrderNote_itemInstanceId_idx" ON "OrderNote"("itemInstanceId");
CREATE INDEX "OrderNote_athleteId_idx" ON "OrderNote"("athleteId");

CREATE TABLE "OrderNoteRevision" (
  "id" TEXT NOT NULL, "noteId" TEXT NOT NULL, "editorId" TEXT,
  "category" "OrderNoteCategory" NOT NULL, "visibility" "OrderNoteVisibility" NOT NULL,
  "title" TEXT NOT NULL, "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderNoteRevision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrderNoteRevision_noteId_createdAt_idx" ON "OrderNoteRevision"("noteId", "createdAt");

CREATE TABLE "ClientFile" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "uploadedById" TEXT NOT NULL,
  "name" TEXT NOT NULL, "path" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientFile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClientFile_path_key" ON "ClientFile"("path");
CREATE INDEX "ClientFile_clientId_createdAt_idx" ON "ClientFile"("clientId", "createdAt");

ALTER TABLE "OrderFile"
  ADD COLUMN "orderItemId" TEXT,
  ADD COLUMN "noteId" TEXT,
  ADD COLUMN "role" "OrderFileRole" NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "OrderFile_orderItemId_role_sortOrder_idx" ON "OrderFile"("orderItemId", "role", "sortOrder");
CREATE INDEX "OrderFile_noteId_createdAt_idx" ON "OrderFile"("noteId", "createdAt");

ALTER TABLE "OrderTag" ADD CONSTRAINT "OrderTag_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderNote" ADD CONSTRAINT "OrderNote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderNote" ADD CONSTRAINT "OrderNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderNote" ADD CONSTRAINT "OrderNote_designItemId_fkey" FOREIGN KEY ("designItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderNote" ADD CONSTRAINT "OrderNote_itemInstanceId_fkey" FOREIGN KEY ("itemInstanceId") REFERENCES "OrderItemInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderNote" ADD CONSTRAINT "OrderNote_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderNoteRevision" ADD CONSTRAINT "OrderNoteRevision_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "OrderNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderNoteRevision" ADD CONSTRAINT "OrderNoteRevision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClientFile" ADD CONSTRAINT "ClientFile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientFile" ADD CONSTRAINT "ClientFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderFile" ADD CONSTRAINT "OrderFile_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderFile" ADD CONSTRAINT "OrderFile_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "OrderNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
