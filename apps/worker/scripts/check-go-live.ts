/**
 * What would change the day `DEMO_MODE` is turned off (ADR-096).
 *
 * Turning it off closes the simulated-payment hole and lets search engines in, but it also
 * stops the OTP code being shown on screen — so if this gym has the OTP gate switched on,
 * members scanning the poster would be waiting for a WhatsApp message that cannot be sent
 * until the Cloud API is approved. This says plainly which switches are where, so that is
 * found out before the flip rather than after.
 *
 *   pnpm --filter @mfp/worker run check:go-live
 */
import { createPrismaClient } from '@mfp/db/client';
import { GymSettingsSchema } from '@mfp/shared';

async function main(): Promise<void> {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL is not set');
  const prisma = createPrismaClient({ connectionString: url, poolMax: 2 });

  try {
    const gym = await prisma.gym.findFirstOrThrow({ select: { id: true, name: true, settings: true } });
    const parsed = GymSettingsSchema.safeParse(gym.settings);
    if (!parsed.success) {
      console.log(`${gym.name}: settings do not parse — ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
      return;
    }
    const settings = parsed.data;

    console.log(`${gym.name}`);
    console.log(`  otpRequired        ${settings.features.otpRequired}   ${settings.features.otpRequired ? '<-- QR sign-up would stall without live WhatsApp' : '(QR sign-up needs no code: safe)'}`);
    console.log(`  googleRating       ${settings.trust.googleRating} from ${settings.trust.googleReviews} reviews`);

    const [members, plans, photos] = await Promise.all([
      prisma.member.count({ where: { gymId: gym.id, deletedAt: null } }),
      prisma.plan.count({ where: { gymId: gym.id, isActive: true } }),
      prisma.galleryPhoto.count({ where: { gymId: gym.id, isPublished: true } }),
    ]);
    console.log(`  members ${members}, active plans ${plans}, published gallery photos ${photos}`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
