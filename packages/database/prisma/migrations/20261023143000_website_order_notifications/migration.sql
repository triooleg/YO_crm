ALTER TABLE "Order"
ADD COLUMN "websiteNoticeAt" TIMESTAMP(3),
ADD COLUMN "websiteReviewedAt" TIMESTAMP(3);

CREATE INDEX "Order_websiteReviewedAt_websiteNoticeAt_archivedAt_idx"
ON "Order"("websiteReviewedAt", "websiteNoticeAt", "archivedAt");
