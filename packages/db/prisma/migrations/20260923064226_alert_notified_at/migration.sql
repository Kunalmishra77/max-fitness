-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "notifiedAt" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "Alert_gymId_notifiedAt_createdAt_idx" ON "Alert"("gymId", "notifiedAt", "createdAt");
