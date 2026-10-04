/**
 * Every gym row, because there should be exactly one.
 *
 * The integration tests create throwaway gyms and delete them again; a run whose teardown
 * does not finish leaves one behind, and scripts that say `findFirst` then report on the
 * wrong gym. This lists them so that is visible rather than confusing.
 *
 *   pnpm --filter @mfp/worker run check:gyms
 */
import { createPrismaClient } from '@mfp/db/client';

const args = process.argv.slice(2);
const clean = args.includes('--clean-leftovers');
const commit = args.includes('--yes');

async function main(): Promise<void> {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL is not set');
  const prisma = createPrismaClient({ connectionString: url, poolMax: 2 });

  try {
    const gyms = await prisma.gym.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        phone: true,
        addressLine: true,
        city: true,
        state: true,
        pincode: true,
        createdAt: true,
        _count: { select: { members: true, staff: true, plans: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    console.log(`${gyms.length} gym row(s)\n`);
    for (const gym of gyms) {
      const test = gym.id.startsWith('gym_it_');
      console.log(`${test ? 'TEST LEFTOVER ' : 'REAL          '}${gym.slug}`);
      console.log(`  id        ${gym.id}`);
      console.log(`  name      ${gym.name}`);
      console.log(`  phone     ${gym.phone}`);
      console.log(`  address   ${gym.addressLine}`);
      console.log(`  city      ${gym.city}, ${gym.state} ${gym.pincode}`);
      console.log(`  counts    members ${gym._count.members}, staff ${gym._count.staff}, plans ${gym._count.plans}\n`);
    }

    if (!clean) return;
    // Only the test fixtures, and only when they are empty: a leftover with rows hanging
    // off it is not a leftover, it is something that went wrong and wants looking at.
    const leftovers = gyms.filter(
      (gym) => gym.id.startsWith('gym_it_') && gym._count.members === 0 && gym._count.staff === 0 && gym._count.plans === 0,
    );
    if (leftovers.length === 0) {
      console.log('No empty test leftovers to remove.');
      return;
    }
    if (!commit) {
      console.log(`Dry run — would delete ${leftovers.length} empty test gym(s). Pass --yes.`);
      return;
    }
    for (const gym of leftovers) await prisma.gym.delete({ where: { id: gym.id } });
    console.log(`Deleted ${leftovers.length} empty test gym(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
