-- CreateEnum
CREATE TYPE "PlanKind" AS ENUM ('MEMBERSHIP', 'PT');

-- CreateEnum
CREATE TYPE "PtEnrolmentStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED');

-- DropIndex
DROP INDEX "Plan_gymId_gender_isActive_idx";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "ptEnrolmentId" TEXT;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "kind" "PlanKind" NOT NULL DEFAULT 'MEMBERSHIP';

-- CreateTable
CREATE TABLE "PtEnrolment" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "membershipId" TEXT,
    "durationMonths" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "status" "PtEnrolmentStatus" NOT NULL,
    "createdById" TEXT,
    "confirmedAt" TIMESTAMPTZ,
    "cancelledAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "PtEnrolment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtEnrolment_gymId_status_endDate_idx" ON "PtEnrolment"("gymId", "status", "endDate");

-- CreateIndex
CREATE INDEX "PtEnrolment_memberId_idx" ON "PtEnrolment"("memberId");

-- CreateIndex
CREATE INDEX "Plan_gymId_kind_gender_isActive_idx" ON "Plan"("gymId", "kind", "gender", "isActive");

-- AddForeignKey
ALTER TABLE "PtEnrolment" ADD CONSTRAINT "PtEnrolment_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtEnrolment" ADD CONSTRAINT "PtEnrolment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtEnrolment" ADD CONSTRAINT "PtEnrolment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtEnrolment" ADD CONSTRAINT "PtEnrolment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_ptEnrolmentId_fkey" FOREIGN KEY ("ptEnrolmentId") REFERENCES "PtEnrolment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
