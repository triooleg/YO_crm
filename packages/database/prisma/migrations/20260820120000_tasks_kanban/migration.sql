CREATE TYPE "WorkTaskType" AS ENUM ('CLIENT', 'ADMINISTRATIVE', 'PRODUCTION');

CREATE TABLE "TaskColumn" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT '#7047eb',
  "isDone" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "TaskColumn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkTask" (
  "id" TEXT NOT NULL,
  "columnId" TEXT NOT NULL,
  "clientId" TEXT,
  "sourceMessageId" TEXT,
  "assigneeId" TEXT,
  "createdById" TEXT,
  "type" "WorkTaskType" NOT NULL DEFAULT 'CLIENT',
  "title" TEXT NOT NULL,
  "description" TEXT,
  "markerColor" TEXT NOT NULL DEFAULT '#7047eb',
  "labels" TEXT[] NOT NULL,
  "dueAt" TIMESTAMP(3),
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "WorkTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskAttachment" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskColumn_sortOrder_archivedAt_idx" ON "TaskColumn"("sortOrder", "archivedAt");
CREATE INDEX "WorkTask_columnId_position_archivedAt_idx" ON "WorkTask"("columnId", "position", "archivedAt");
CREATE INDEX "WorkTask_assigneeId_dueAt_idx" ON "WorkTask"("assigneeId", "dueAt");
CREATE INDEX "WorkTask_clientId_createdAt_idx" ON "WorkTask"("clientId", "createdAt");
CREATE INDEX "WorkTask_sourceMessageId_idx" ON "WorkTask"("sourceMessageId");
CREATE INDEX "TaskAttachment_taskId_createdAt_idx" ON "TaskAttachment"("taskId", "createdAt");

ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "TaskColumn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "TaskColumn" ("id", "name", "color", "sortOrder", "updatedAt") VALUES
  ('task-column-new', 'Новые', '#7047eb', 0, CURRENT_TIMESTAMP),
  ('task-column-doing', 'В работе', '#e49a34', 1, CURRENT_TIMESTAMP),
  ('task-column-waiting', 'Ожидают', '#5878c7', 2, CURRENT_TIMESTAMP),
  ('task-column-done', 'Готово', '#3b8f65', 3, CURRENT_TIMESTAMP);

UPDATE "TaskColumn" SET "isDone" = true WHERE "id" = 'task-column-done';
