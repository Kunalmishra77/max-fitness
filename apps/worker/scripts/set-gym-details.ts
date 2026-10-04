/**
 * Put the gym's registered details on the record, as its Udyam certificate writes them
 * (owner, 2026-10-04).
 *
 * A business verification — Meta's, Razorpay's — compares what the website publishes
 * against what the registration says, and a discrepancy is grounds for rejection. The
 * website reads these three fields from this row, so this is where they have to match.
 *
 * Worth knowing before running it: the certificate and the Google Business Profile do not
 * agree. Google spells the building "Krishan Plaza, Plot No. 6"; the certificate says
 * "C-6, Krishna Plaza". This writes the certificate's version, because that is the document
 * a verifier holds. Directions still point at the Google pin, so nobody loses their way.
 *
 *   pnpm --filter @mfp/worker run set:gym-details
 *   pnpm --filter @mfp/worker run set:gym-details -- --yes
 */
import { createPrismaClient } from '@mfp/db/client';

const commit = process.argv.includes('--yes');

/** Exactly as the Udyam certificate writes them. */
const REGISTERED = {
  phone: '+919871406350',
  email: 'Ajaykuliyal35@gmail.com',
  addressLine: 'C-6, Krishna Plaza',
  city: 'Indirapuram, Ghaziabad',
  state: 'Uttar Pradesh',
  pincode: '201014',
};

async function main(): Promise<void> {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL is not set');
  const prisma = createPrismaClient({ connectionString: url, poolMax: 2 });

  try {
    // By slug, not `findFirst`: a stray test row must never be the one that gets edited.
    const slug = process.env['GYM_SLUG'] ?? 'max-fitness-indirapuram';
    const gym = await prisma.gym.findUnique({
      where: { slug },
      select: { id: true, name: true, phone: true, email: true, addressLine: true, city: true, state: true, pincode: true },
    });
    if (gym === null) throw new Error(`No gym with slug "${slug}"`);

    console.log(`${gym.name} (${slug})\n`);
    for (const [field, next] of Object.entries(REGISTERED)) {
      const now = (gym as unknown as Record<string, string | null>)[field] ?? '(none)';
      console.log(`  ${field.padEnd(12)} ${now === next ? 'unchanged' : `${now}\n  ${' '.repeat(12)} → ${next}`}`);
    }

    if (!commit) {
      console.log('\nDry run — pass --yes to write.');
      return;
    }
    await prisma.gym.update({ where: { id: gym.id }, data: REGISTERED });
    console.log('\nWritten. The website reads these on its next revalidation.');
  } finally {
    await prisma.$disconnect();
  }
}

await main();
