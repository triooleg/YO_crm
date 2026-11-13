CREATE TABLE "WebsiteOrderNumberReservation" (
    "sourceAccount" TEXT NOT NULL,
    "cartKey" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "externalId" TEXT,
    CONSTRAINT "WebsiteOrderNumberReservation_pkey" PRIMARY KEY ("sourceAccount", "cartKey")
);
CREATE UNIQUE INDEX "WebsiteOrderNumberReservation_number_key" ON "WebsiteOrderNumberReservation"("number");
CREATE UNIQUE INDEX "WebsiteOrderNumberReservation_sequence_key" ON "WebsiteOrderNumberReservation"("sequence");
CREATE UNIQUE INDEX "WebsiteOrderNumberReservation_sourceAccount_externalId_key" ON "WebsiteOrderNumberReservation"("sourceAccount", "externalId");
