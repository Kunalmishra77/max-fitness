-- AlterEnum
ALTER TYPE "MediaKind" ADD VALUE 'GOV_ID';

-- AlterTable
ALTER TABLE "MediaFile" ADD COLUMN     "label" TEXT;

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "joinedOn" DATE;
