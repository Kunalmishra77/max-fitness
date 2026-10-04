-- The gym's own email address, for the website's contact page and footer.
--
-- A business verification (Meta, Razorpay) compares what the website publishes against
-- what the registration certificate says. The address and phone were already here; the
-- email was nowhere on the site at all, which is itself a discrepancy to be picked up.
--
-- Nullable: a gym without one publishes no email rather than an empty one.

-- AlterTable
ALTER TABLE "Gym" ADD COLUMN     "email" TEXT;
