/**
 * Give the two accounts an email address to sign in with, and the PIN the owner chose
 * (owner, 2026-10-02; ADR-094).
 *
 * The accounts themselves are not new — these are the same two rows the gym has been
 * using, so sessions, the audit trail and everything attached to them stays where it is.
 * Only the sign-in changes: an address is added beside the mobile number, and the PIN is
 * replaced. Both numbers still work; nothing is taken away.
 *
 * It also clears any lockout and failed-attempt count, because changing somebody's PIN
 * while they are locked out of the old one would be a cruel way to hand it over.
 *
 *   pnpm --filter @mfp/worker run set:staff-logins          # says what it would do
 *   pnpm --filter @mfp/worker run set:staff-logins -- --yes
 */
import { createPrismaClient } from '@mfp/db/client';
import { Argon2PinHasher } from '@mfp/integrations/auth';

const commit = process.argv.includes('--yes');

/** Keyed by the mobile that account already signs in with. */
const LOGINS: ReadonlyArray<{ mobile: string; email: string; pin: string }> = [
  { mobile: '+919000000001', email: 'admin@maxfitnessgym.com', pin: '626162' },
  { mobile: '+919000000002', email: 'reception@maxfitnessgym.com', pin: '626162' },
];

async function main(): Promise<void> {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL is not set');
  const prisma = createPrismaClient({ connectionString: url, poolMax: 2 });
  const hasher = new Argon2PinHasher();

  try {
    const staff = await prisma.staffUser.findMany({ select: { id: true, name: true, mobile: true, email: true, role: true }, orderBy: { role: 'asc' } });
    const byMobile = new Map(staff.map((person) => [person.mobile, person]));

    for (const login of LOGINS) {
      const person = byMobile.get(login.mobile);
      // The PIN is never printed, here or anywhere: the owner knows what they chose.
      console.log(
        person === undefined
          ? `  MISSING    no account on ${login.mobile.slice(0, 5)}***${login.mobile.slice(-2)} — nothing to change`
          : `  ${person.role.padEnd(10)} ${person.name.padEnd(12)} email ${person.email ?? '(none)'} → ${login.email}, PIN replaced`,
      );
    }

    const found = LOGINS.filter((login) => byMobile.has(login.mobile));
    if (!commit) {
      console.log(`\nDry run — ${found.length} account${found.length === 1 ? '' : 's'} would change. Pass --yes.`);
      return;
    }

    for (const login of found) {
      const person = byMobile.get(login.mobile);
      if (person === undefined) continue;
      await prisma.staffUser.update({
        where: { id: person.id },
        data: { email: login.email, pinHash: await hasher.hash(login.pin), failedPinCount: 0, lockedUntil: null },
      });
    }
    console.log(`\nWritten: ${found.length} account${found.length === 1 ? '' : 's'}. Both the email and the old mobile number sign in.`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
