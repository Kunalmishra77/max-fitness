-- e-mandate: a standing instruction, so the fee arrives without the gym chasing it (ADR-105).
--
-- Purely additive. `Mandate` is new, and the two columns added to existing tables are
-- nullable with no default, so nothing already in the register is touched or rewritten.

-- CreateEnum
CREATE TYPE "MandateStatus" AS ENUM ('CREATED', 'AUTHENTICATED', 'ACTIVE', 'PENDING', 'HALTED', 'PAUSED', 'CANCELLED', 'COMPLETED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "providerPlanId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "mandateId" TEXT;

-- CreateTable
CREATE TABLE "Mandate" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "providerSubscriptionId" TEXT NOT NULL,
    "providerPlanId" TEXT NOT NULL,
    "providerCustomerId" TEXT,
    "status" "MandateStatus" NOT NULL DEFAULT 'CREATED',
    "amountPaise" INTEGER NOT NULL,
    "intervalMonths" INTEGER NOT NULL DEFAULT 1,
    "shortUrl" TEXT,
    "authorisedAt" TIMESTAMPTZ,
    "nextChargeOn" DATE,
    "chargeCount" INTEGER NOT NULL DEFAULT 0,
    "lastChargedAt" TIMESTAMPTZ,
    "failureReason" TEXT,
    "haltedAt" TIMESTAMPTZ,
    "cancelledAt" TIMESTAMPTZ,
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Mandate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Mandate_providerSubscriptionId_key" ON "Mandate"("providerSubscriptionId");

-- CreateIndex
CREATE INDEX "Mandate_gymId_status_idx" ON "Mandate"("gymId", "status");

-- CreateIndex
CREATE INDEX "Mandate_memberId_status_idx" ON "Mandate"("memberId", "status");

-- CreateIndex
CREATE INDEX "Payment_mandateId_idx" ON "Payment"("mandateId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "Mandate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mandate" ADD CONSTRAINT "Mandate_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mandate" ADD CONSTRAINT "Mandate_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mandate" ADD CONSTRAINT "Mandate_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The init migration's instruction, honoured: every migration that adds a table to `public`
-- enables row-level security on it, with no policies, so Supabase's auto-generated Data API
-- can read nothing through the anon key. Supabase currently also does this by default for
-- new public tables, which is why `check:rls` reports every existing table as covered — but a
-- default that a platform may change is not something a mandate table should depend on.
ALTER TABLE "Mandate" ENABLE ROW LEVEL SECURITY;
