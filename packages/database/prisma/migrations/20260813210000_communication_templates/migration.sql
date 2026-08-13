CREATE TABLE "MessageTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "channel" "ContactChannel",
  "language" TEXT NOT NULL DEFAULT 'ru',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MessageTemplate_archivedAt_name_idx" ON "MessageTemplate"("archivedAt", "name");
