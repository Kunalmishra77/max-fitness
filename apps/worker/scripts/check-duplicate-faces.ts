/**
 * Who is in the register twice, by face (ADR-124)?
 *
 *   pnpm --filter @mfp/worker run check:duplicate-faces
 *
 * Reads nothing but the gallery and names nothing it is not sure about. It writes
 * nothing at all — merging or deleting a record is a decision for the desk, because the
 * two rows may carry different payments, different attendance and different plans, and
 * only a person knows which one to keep.
 *
 * **Every pair above the gym's own `duplicateThreshold`**, which is the bar the QR form
 * uses when it refuses a sign-up. A pair listed here is a pair the form would now stop,
 * so this doubles as the check on whether the fix would have caught what got through.
 *
 * Nothing it prints is a face, a number or an image — a name, a member code and a score.
 */
import { cosineSimilarity } from '@mfp/core';
import { createPrismaClient } from '@mfp/db/client';
import { PrismaFaceTemplates, keyFromEnv } from '@mfp/db';
import { GymSettingsSchema } from '@mfp/shared';

async function main(): Promise<void> {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
  const url = process.env['DATABASE_URL'];
  const key = process.env['FIELD_ENCRYPTION_KEY'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL is not set');
  if (key === undefined || key === '') throw new Error('FIELD_ENCRYPTION_KEY is not set');

  const prisma = createPrismaClient({ connectionString: url, poolMax: 2 });

  try {
    const gyms = await prisma.gym.findMany({ select: { id: true, name: true, settings: true } });

    for (const gym of gyms) {
      const attendance = GymSettingsSchema.parse(gym.settings).attendance;
      const templates = await prisma.faceTemplate.findMany({
        where: { gymId: gym.id, status: 'ACTIVE' },
        select: { modelVersion: true },
        distinct: ['modelVersion'],
      });

      for (const { modelVersion } of templates) {
        const gallery = await new PrismaFaceTemplates(prisma, keyFromEnv(key)).gallery(gym.id, modelVersion);
        if (gallery.length < 2) continue;

        const members = await prisma.member.findMany({
          where: { id: { in: [...new Set(gallery.map((row) => row.memberId))] } },
          select: { id: true, fullName: true, memberCode: true, createdAt: true },
        });
        const named = new Map(members.map((m) => [m.id, m]));

        /**
         * The best score between each pair of *different* members. A member's own
         * templates scoring alike is how enrolment is supposed to look.
         */
        const best = new Map<string, number>();
        for (let i = 0; i < gallery.length; i += 1) {
          for (let j = i + 1; j < gallery.length; j += 1) {
            const a = gallery[i];
            const b = gallery[j];
            if (a === undefined || b === undefined || a.memberId === b.memberId) continue;
            const score = cosineSimilarity(a.vector, b.vector);
            if (score === null || score < attendance.duplicateThreshold) continue;
            const pair = [a.memberId, b.memberId].sort().join('|');
            best.set(pair, Math.max(best.get(pair) ?? 0, score));
          }
        }

        console.log(`\n${gym.name} — ${modelVersion} — ${gallery.length} templates, threshold ${attendance.duplicateThreshold}`);
        if (best.size === 0) {
          console.log('  No two members share a face.');
          continue;
        }

        const pairs = [...best.entries()].sort(([, x], [, y]) => y - x);
        console.log(`  ${pairs.length} pair(s) the QR form would now refuse:\n`);
        for (const [pair, score] of pairs) {
          const [left, right] = pair.split('|') as [string, string];
          const one = named.get(left);
          const two = named.get(right);
          // Oldest first: that is almost always the record worth keeping.
          const [older, newer] =
            (one?.createdAt.getTime() ?? 0) <= (two?.createdAt.getTime() ?? 0) ? [one, two] : [two, one];
          console.log(
            `  ${score.toFixed(3)}  ${older?.memberCode ?? '?'} ${older?.fullName ?? '?'}` +
              `  ←→  ${newer?.memberCode ?? '?'} ${newer?.fullName ?? '?'}  (newer, joined ${newer?.createdAt.toISOString().slice(0, 10) ?? '?'})`,
          );
        }
        console.log('\n  Nothing has been changed. Decide at the desk which record to keep.');
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
