-- CreateEnum
CREATE TYPE "BotReplyStatus" AS ENUM ('ANSWERED', 'ESCALATED', 'FAILED');

-- CreateTable
CREATE TABLE "BotConfig" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Max',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "autoReply" BOOLEAN NOT NULL DEFAULT false,
    "persona" TEXT NOT NULL DEFAULT '',
    "languages" TEXT[] DEFAULT ARRAY['hi', 'en']::TEXT[],
    "escalationNote" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "BotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotDocument" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sourceName" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "BotDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotReply" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "memberId" TEXT,
    "mobile" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "status" "BotReplyStatus" NOT NULL,
    "reason" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotConfig_gymId_key" ON "BotConfig"("gymId");

-- CreateIndex
CREATE INDEX "BotDocument_gymId_createdAt_idx" ON "BotDocument"("gymId", "createdAt");

-- CreateIndex
CREATE INDEX "BotReply_gymId_createdAt_idx" ON "BotReply"("gymId", "createdAt");

-- CreateIndex
CREATE INDEX "BotReply_gymId_status_idx" ON "BotReply"("gymId", "status");

-- AddForeignKey
ALTER TABLE "BotConfig" ADD CONSTRAINT "BotConfig_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotDocument" ADD CONSTRAINT "BotDocument_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotReply" ADD CONSTRAINT "BotReply_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotReply" ADD CONSTRAINT "BotReply_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
