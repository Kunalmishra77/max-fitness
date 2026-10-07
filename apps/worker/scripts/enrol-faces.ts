/**
 * Turn members' signup selfies into face templates (ADR-107).
 *
 *   pnpm --filter @mfp/worker run enrol:faces          # says what it would do
 *   pnpm --filter @mfp/worker run enrol:faces -- --yes
 *
 * A member who signs up from now on is enrolled as their selfie is accepted, while they are
 * still holding the phone and can be told to step closer. This is for everybody who signed
 * up before that existed, and for a member whose photograph was replaced.
 *
 * **It refuses more often than it enrols, and that is the point.** A selfie whose face is
 * too small produces a template that will never match the member at the desk — measured at
 * 0.42 against itself, below where two *different* members score (ADR-107). Enrolling it
 * anyway would look like success and fail silently every day afterwards. Each refusal names
 * what is wrong with the photograph, so the desk can ask that member for a new one.
 */
import { decideEnrolment, photoGatesFrom, type EnrolmentRefusal } from '@mfp/core';
import { createPrismaClient } from '@mfp/db/client';
import { PrismaFaceTemplates, keyFromEnv } from '@mfp/db';
import { FaceClient, FaceEngineUnavailableError } from '@mfp/integrations/face';
import { createStorageDriver } from '@mfp/integrations/storage';
import { AttendanceSettingsSchema } from '@mfp/shared';

const commit = process.argv.includes('--yes');
const replace = process.argv.includes('--replace');

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};

/** What the desk should say to the member, rather than the code we store. */
const EXPLAIN: Readonly<Record<EnrolmentRefusal, string>> = {
  NO_CONSENT: 'did not agree to face attendance',
  MINOR: 'is under age — mark them by hand',
  NOT_A_MEMBER: 'has left',
  ENOUGH_TEMPLATES: 'already has enough templates',
  NOT_AN_IMAGE: 'their photo file is not an image',
  NO_FACE: 'no face in the photo at all',
  NOT_A_FACE: 'what is in the photo is not really a face',
  TOO_FAR: 'photo taken from too far away — needs a new one, closer',
  TOO_DARK: 'photo too dark — needs a new one',
  TOO_BRIGHT: 'photo too bright — needs a new one',
  BLURRED: 'photo too blurred — needs a new one',
  ANOTHER_FACE: 'somebody else is in the photo — needs a new one, alone',
};

async function main(): Promise<void> {
  // On a laptop the settings are in the repository's `.env`; in the container they come from
  // the platform and there is no such file. `loadEnvFile` throws on a missing one, so the
  // absence is tolerated — this script has to run **inside the worker container**, because
  // the face service has no public address and nothing outside that network can reach it.
  try {
    process.loadEnvFile(new URL('../../../.env', import.meta.url));
  } catch {
    // Already in the environment, which is how a container is configured.
  }
  const prisma = createPrismaClient({ connectionString: need('DATABASE_URL'), poolMax: 3 });

  const face = new FaceClient({ baseUrl: need('FACE_SERVICE_URL'), token: need('FACE_SERVICE_TOKEN'), timeoutMs: 20_000 });
  const templates = new PrismaFaceTemplates(prisma, keyFromEnv(need('FIELD_ENCRYPTION_KEY')));
  const storage = createStorageDriver({
    STORAGE_DRIVER: 's3',
    S3_ENDPOINT: need('S3_ENDPOINT'),
    S3_REGION: need('S3_REGION'),
    S3_ACCESS_KEY_ID: need('S3_ACCESS_KEY_ID'),
    S3_SECRET_ACCESS_KEY: need('S3_SECRET_ACCESS_KEY'),
    S3_BUCKET: need('S3_BUCKET'),
    LINK_TOKEN_SECRET: need('LINK_TOKEN_SECRET'),
    STORAGE_LOCAL_PATH: '',
  } as Parameters<typeof createStorageDriver>[0]);
  // Files are served through the app so the signature can be checked, never straight from
  // the bucket, so a relative path needs the site in front of it.
  const appUrl = process.env['APP_URL'] ?? 'https://maxfitnessgym.co.in';

  const slug = process.env['GYM_SLUG'] ?? 'max-fitness-indirapuram';

  try {
    const gym = await prisma.gym.findUnique({ where: { slug }, select: { id: true, name: true, settings: true } });
    if (gym === null) throw new Error(`No gym with slug "${slug}"`);
    const attendance = AttendanceSettingsSchema.parse((gym.settings as { attendance?: unknown } | null)?.attendance ?? {});
    const gates = photoGatesFrom(attendance);

    console.log(`${gym.name} (${slug})`);
    console.log(`enrolment needs a face of at least ${gates.enrolmentMinFacePx}px\n`);

    const members = await prisma.member.findMany({
      where: { gymId: gym.id, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        faceConsent: true,
        isMinor: true,
        status: true,
        photo: { select: { id: true, storageKey: true, deletedAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    let enrolled = 0;
    const refused: Array<{ name: string; why: string }> = [];

    for (const member of members) {
      const label = member.fullName.slice(0, 22).padEnd(23);
      const photo = member.photo;
      if (photo === null || photo.deletedAt !== null) {
        refused.push({ name: member.fullName, why: 'has no photo at all' });
        console.log(`${label} skipped   no photo`);
        continue;
      }

      const existing = await templates.countFor(member.id);
      if (existing > 0 && !replace) {
        console.log(`${label} already   ${existing} template(s)`);
        continue;
      }

      // The measurement comes before any decision, because the refusal has to name what is
      // wrong with the photograph — "needs a new one" is not something a desk can act on.
      let result;
      try {
        const signed = await storage.signedUrl(photo.storageKey, 300);
        const response = await fetch(signed.startsWith('http') ? signed : `${appUrl}${signed}`);
        if (!response.ok) throw new Error(`photo fetch HTTP ${response.status}`);
        result = await face.embed(Buffer.from(await response.arrayBuffer()), 'selfie.jpg');
      } catch (error) {
        if (error instanceof FaceEngineUnavailableError) throw error; // nothing will work; stop.
        console.log(`${label} FAILED    ${error instanceof Error ? error.message : 'error'}`);
        continue;
      }

      const decision = decideEnrolment(
        {
          faceConsent: member.faceConsent,
          isMinor: member.isMinor,
          memberStatus: member.status,
          existingTemplates: replace ? 0 : existing,
          maxTemplatesPerMember: attendance.maxTemplatesPerMember,
          measurement: result.measurement,
        },
        gates,
      );

      const size = result.measurement.found ? `${result.measurement.facePx}px` : '—';
      if (!decision.enrol) {
        refused.push({ name: member.fullName, why: EXPLAIN[decision.reason] });
        console.log(`${label} refused   ${size.padEnd(6)} ${decision.reason} — ${EXPLAIN[decision.reason]}`);
        continue;
      }

      if (!commit) {
        enrolled += 1;
        console.log(`${label} would     ${size}`);
        continue;
      }

      await templates.save({
        gymId: gym.id,
        memberId: member.id,
        vector: result.embedding ?? [],
        modelVersion: result.modelVersion,
        // The face's size *is* the quality that matters, and keeping it means "who was
        // enrolled off a poor photograph" is answerable later without the photograph.
        qualityScore: result.measurement.found ? result.measurement.facePx : 0,
        sourceKind: 'signup_selfie',
        sourceMediaId: photo.id,
      });
      enrolled += 1;
      console.log(`${label} enrolled  ${size}`);
    }

    console.log(`\n${enrolled} ${commit ? 'enrolled' : 'would be enrolled'} · ${refused.length} refused · ${members.length} members looked at`);
    if (refused.length > 0) {
      console.log('\nThese members cannot be recognised until they give a better photograph:');
      for (const r of refused) console.log(`   ${r.name} — ${r.why}`);
    }
    if (!commit && enrolled > 0) console.log('\nRe-run with -- --yes to write the templates.');
  } finally {
    await prisma.$disconnect();
  }
}

await main();
