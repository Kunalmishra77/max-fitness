-- CreateEnum
CREATE TYPE "DietPlanStatus" AS ENUM ('COLLECTING', 'GENERATING', 'READY', 'FAILED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "DietProfile" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "weightGrams" INTEGER,
    "heightCm" INTEGER,
    "ageYears" INTEGER,
    "goal" TEXT,
    "dietType" TEXT,
    "allergies" TEXT,
    "mealsPerDay" INTEGER,
    "activityLevel" TEXT,
    "workoutsPerWeek" INTEGER,
    "pendingQuestion" TEXT,
    "nudgesSent" INTEGER NOT NULL DEFAULT 0,
    "askedAt" TIMESTAMPTZ,
    "lastReplyAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "DietProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DietPlan" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "DietPlanStatus" NOT NULL,
    "answers" JSONB NOT NULL,
    "bmiTenths" INTEGER,
    "doc" JSONB,
    "model" TEXT,
    "failureReason" TEXT,
    "pdfMediaId" TEXT,
    "requestedById" TEXT,
    "generatedAt" TIMESTAMPTZ,
    "sentAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "DietPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DietFollowUp" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "dietPlanId" TEXT NOT NULL,
    "pendingQuestion" TEXT,
    "answers" JSONB NOT NULL,
    "askedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ,

    CONSTRAINT "DietFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DietProfile_memberId_key" ON "DietProfile"("memberId");

-- CreateIndex
CREATE INDEX "DietProfile_gymId_pendingQuestion_idx" ON "DietProfile"("gymId", "pendingQuestion");

-- CreateIndex
CREATE INDEX "DietPlan_gymId_status_createdAt_idx" ON "DietPlan"("gymId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DietPlan_memberId_version_key" ON "DietPlan"("memberId", "version");

-- CreateIndex
CREATE INDEX "DietFollowUp_gymId_completedAt_idx" ON "DietFollowUp"("gymId", "completedAt");

-- CreateIndex
CREATE INDEX "DietFollowUp_memberId_idx" ON "DietFollowUp"("memberId");

-- AddForeignKey
ALTER TABLE "DietProfile" ADD CONSTRAINT "DietProfile_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DietProfile" ADD CONSTRAINT "DietProfile_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DietPlan" ADD CONSTRAINT "DietPlan_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DietPlan" ADD CONSTRAINT "DietPlan_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DietFollowUp" ADD CONSTRAINT "DietFollowUp_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DietFollowUp" ADD CONSTRAINT "DietFollowUp_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DietFollowUp" ADD CONSTRAINT "DietFollowUp_dietPlanId_fkey" FOREIGN KEY ("dietPlanId") REFERENCES "DietPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
