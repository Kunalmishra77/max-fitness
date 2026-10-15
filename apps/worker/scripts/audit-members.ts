/**
 * Who in the register is really a member, and who left it half done?
 *
 *   pnpm --filter @mfp/worker run audit:members
 *
 * The owner asked plainly: *"kon se member real hai — kisne apna sahi ID and selfie
 * dala hai and a to z details sahi dala hai, and kon kon adhura chhod diya hai, fake ID
 * image dala hai."*
 *
 * **It writes nothing.** Every verdict here is a reason to go and look at a record, not
 * a reason to delete one. A member who uploaded a blurred Aadhaar is still a member.
 *
 * **What it can be sure about, and what it cannot.** Whether a field is filled, whether
 * a photograph exists, whether two members uploaded the *same* file — these are facts in
 * the database and are reported as such. Whether the thing in a photograph is really a
 * government ID is a question for the OCR in the face service (ADR-120), which only new
 * sign-ups have been through; everybody who joined before that was never asked. Those
 * are listed as **unchecked**, not as fakes, because calling an honest member a forger
 * on no evidence is the worse mistake.
 *
 * **The sharpest signal here costs nothing: the SHA-256 already stored against every
 * file.** Two members whose ID photographs are byte-identical is not a coincidence, and
 * neither is a member whose "ID" is the same file as their selfie. No OCR needed.
 *
 * Mobile numbers are masked. Nothing printed can be pasted into WhatsApp.
 */
import { createPrismaClient } from '@mfp/db/client';
import { loadScriptEnv } from './_env';

/** Names the integration tests write. Real people are not called this. */
const TEST_NAMES = [/^Trend \d+$/i, /^Aaaa Stranger$/i, /^Bday /i, /Tester$/i, /^Demo /i];

/** Never the whole number, in a report that may be shared or pasted. */
const maskMobile = (mobile: string) => `${mobile.slice(0, 5)}xxxxx${mobile.slice(-3)}`;

/** A photographed card below this is a thumbnail or a screenshot, not a document. */
const MIN_ID_PIXELS = 400;

interface Problem {
  readonly severity: 'missing' | 'suspect';
  readonly text: string;
}

async function main(): Promise<void> {
  loadScriptEnv();
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL is not set');
  const prisma = createPrismaClient({ connectionString: url, poolMax: 2 });

  try {
    const members = await prisma.member.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        memberCode: true,
        fullName: true,
        mobile: true,
        email: true,
        dob: true,
        gender: true,
        status: true,
        source: true,
        trainingSlot: true,
        joinedOn: true,
        whatsappOptIn: true,
        faceConsent: true,
        createdAt: true,
        photo: { select: { id: true, sha256: true, width: true, height: true, sizeBytes: true, deletedAt: true } },
        media: {
          where: { kind: 'GOV_ID', deletedAt: null },
          select: { id: true, label: true, sha256: true, width: true, height: true, sizeBytes: true },
        },
        faceTemplates: { where: { status: 'ACTIVE' }, select: { id: true } },
        verifications: {
          select: { referenceCode: true, status: true, govIdType: true, createdAt: true, decidedAt: true },
          orderBy: { createdAt: 'desc' },
        },
        memberships: { where: { status: 'CONFIRMED' }, select: { endDate: true }, orderBy: { endDate: 'desc' }, take: 1 },
        payments: { where: { status: 'PAID' }, select: { amountPaise: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    /**
     * Every file hash in the register, so an image used twice can be named both times.
     * A member's own selfie and ID sharing a hash is the loudest signal there is.
     */
    const owners = new Map<string, Set<string>>();
    const who = (id: string) => members.find((m) => m.id === id);
    for (const member of members) {
      const hashes = [member.photo?.deletedAt === null ? member.photo.sha256 : undefined, ...member.media.map((f) => f.sha256)];
      for (const hash of hashes) {
        if (hash === undefined) continue;
        const set = owners.get(hash) ?? new Set<string>();
        set.add(member.id);
        owners.set(hash, set);
      }
    }

    const real = members.filter((m) => !TEST_NAMES.some((pattern) => pattern.test(m.fullName)));
    const complete: typeof real = [];
    const incomplete: Array<{ member: (typeof real)[number]; problems: Problem[] }> = [];

    for (const member of real) {
      const problems: Problem[] = [];
      const miss = (text: string) => problems.push({ severity: 'missing', text });
      const suspect = (text: string) => problems.push({ severity: 'suspect', text });

      // ── The details themselves ──────────────────────────────────────────────
      if (member.dob === null) miss('date of birth');
      if (member.email === null || member.email === '') miss('email');
      if (member.trainingSlot === null) miss('training slot (morning/evening)');
      if (member.joinedOn === null) miss('joining date');
      if (!member.whatsappOptIn) miss('WhatsApp consent — no reminder can be sent');

      // ── The selfie ──────────────────────────────────────────────────────────
      const photo = member.photo?.deletedAt === null ? member.photo : null;
      if (photo === null) miss('selfie');
      else if ((photo.width ?? 0) < 200 || (photo.height ?? 0) < 200) suspect(`selfie is tiny (${photo.width}×${photo.height})`);

      /**
       * Enrolment, which is what the selfie is *for*. A member with no template is
       * invisible twice over: the camera at the door will not know them, and the
       * duplicate check cannot catch somebody signing up as them.
       */
      if (member.faceTemplates.length === 0) {
        miss(photo === null ? 'face enrolment (no selfie to enrol from)' : 'face enrolment — selfie exists but was never enrolled');
      }

      // ── The ID ──────────────────────────────────────────────────────────────
      const latest = member.verifications[0];
      const front = member.media.find((f) => (f.label ?? '').toLowerCase().includes('front'));
      const back = member.media.find((f) => (f.label ?? '').toLowerCase().includes('back'));
      const wantsId = member.source === 'QR_EXISTING' || member.source === 'QR_NEW' || latest !== undefined;

      if (wantsId && member.media.length === 0) miss('government ID photograph');
      if (wantsId && member.media.length > 0 && front === undefined) miss('front of the ID');
      if (latest?.govIdType == null && member.media.length > 0) miss('which card the ID is');

      for (const file of member.media) {
        const side = file.label ?? 'ID';
        if ((file.width ?? 0) < MIN_ID_PIXELS && (file.height ?? 0) < MIN_ID_PIXELS) {
          suspect(`${side} is too small to read (${file.width}×${file.height}) — likely a screenshot`);
        }
        if (file.sizeBytes < 15_000) suspect(`${side} is only ${Math.round(file.sizeBytes / 1024)}KB — probably not a photograph of a card`);

        const sharedWith = [...(owners.get(file.sha256) ?? [])].filter((id) => id !== member.id);
        for (const other of sharedWith) {
          suspect(`${side} is the **same file** as ${who(other)?.fullName ?? 'another member'}'s — byte for byte`);
        }
        if (photo !== null && file.sha256 === photo.sha256) suspect(`${side} is the **same file as their own selfie**`);
      }

      // ── Where they stand ────────────────────────────────────────────────────
      if (latest !== undefined && latest.status === 'PENDING') {
        miss(`verification still waiting at the desk (${latest.referenceCode}, ${Math.round((Date.now() - latest.createdAt.getTime()) / 86_400_000)} days)`);
      }
      if (latest !== undefined && latest.status === 'REJECTED') suspect(`their verification was rejected (${latest.referenceCode})`);
      if (member.status === 'PENDING_PAYMENT' && member.payments.length === 0) miss('payment — never paid, so never really joined');
      if (member.memberships.length === 0 && member.status === 'ACTIVE') miss('a membership with an end date');

      if (problems.length === 0) complete.push(member);
      else incomplete.push({ member, problems });
    }

    // ── The report ────────────────────────────────────────────────────────────
    const line = (m: (typeof real)[number]) =>
      `${(m.memberCode ?? '—').padEnd(8)} ${m.fullName.padEnd(22)} ${maskMobile(m.mobile).padEnd(13)} ${m.status.padEnd(21)} ${m.source}`;

    console.log(`\n═══ ${real.length} real members (${members.length - real.length} test rows ignored) ═══`);

    console.log(`\n\n✅ COMPLETE — nothing missing, nothing odd: ${complete.length}\n`);
    for (const m of complete) console.log(`   ${line(m)}`);

    const suspects = incomplete.filter((row) => row.problems.some((p) => p.severity === 'suspect'));
    console.log(`\n\n🚩 WORTH LOOKING AT BY HAND: ${suspects.length}\n`);
    for (const { member, problems } of suspects) {
      console.log(`   ${line(member)}`);
      for (const p of problems.filter((x) => x.severity === 'suspect')) console.log(`        ⚠  ${p.text}`);
      for (const p of problems.filter((x) => x.severity === 'missing')) console.log(`        ·  missing ${p.text}`);
      console.log('');
    }

    const partial = incomplete.filter((row) => !row.problems.some((p) => p.severity === 'suspect'));
    console.log(`\n⏳ INCOMPLETE — honest records with gaps: ${partial.length}\n`);
    for (const { member, problems } of partial) {
      console.log(`   ${line(member)}`);
      for (const p of problems) console.log(`        ·  missing ${p.text}`);
      console.log('');
    }

    /**
     * The one thing this script cannot answer. The OCR that decides whether a photograph
     * is really a government ID runs in the face service and only ever saw the sign-ups
     * that happened after it shipped; everybody before that was never asked.
     */
    const unchecked = real.filter((m) => m.media.length > 0 && m.createdAt < new Date('2026-10-15T00:00:00Z'));
    console.log(`\n🔍 ID NEVER MACHINE-CHECKED (joined before the ID reader shipped): ${unchecked.length}`);
    console.log('   Their photographs are on file and look like photographs, but no engine has read them.');
    for (const m of unchecked) console.log(`   ${line(m)}  [${m.verifications[0]?.govIdType ?? 'type not recorded'}]`);

    console.log('\nNothing was changed. Every line above is a record to open, not a record to delete.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
