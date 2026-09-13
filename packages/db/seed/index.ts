/**
 * `pnpm db:seed` — realistic demo data (docs/05-engineering/demo-data-seed-spec.md).
 *
 * Runs against remote Supabase (override 5), so it is built for few round trips:
 * the whole dataset is computed in memory first (`build.ts`), then written with
 * chunked `createMany` calls. Timings are printed per phase.
 *
 * Idempotent: the demo gym and everything under it is deleted, then recreated.
 * Deterministic: a fixed RNG seed, and every date relative to `SEED_TODAY` or today
 * in IST, so `SEED_TODAY=2026-09-10 pnpm db:seed` reproduces the same database.
 *
 * Never prints a connection string or a mobile number (CLAUDE.md §2.8, override 8).
 */
import { fileURLToPath } from 'node:url';
import { hash } from '@node-rs/argon2';
import {
  DEFAULT_PLAN_PRICES_PAISE,
  DEFAULT_REMINDER_RULES,
  FEE_STATES,
  GymSettingsSchema,
  PLAN_DURATIONS,
  PRICED_GENDERS,
  formatINR,
  istDate,
  istTime,
  planCode,
  slotToUtc,
  systemClock,
  todayIST,
  type FeeState,
  type PlanCode,
} from '@mfp/shared';
import { createPrismaClient, type PrismaClient } from '../src/client';
import { buildDataset, type JsonObject, type SeedDataset } from './build';
import { loadDemoMembers } from './csv';
import { DEMO_RNG_SEED, Rng } from './rng';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // No .env file: rely on the process environment.
}

const CSV_PATH = fileURLToPath(new URL('../../../assets/demo-data/members_demo.csv', import.meta.url));
const CHUNK_SIZE = 1000;

const GYM = {
  id: 'gym_demo_max_fitness',
  name: 'Max Fitness Gym',
  phone: '+919871406350',
  // Google Business Profile address line; Justdial and postal references give PIN 201014
  // (Google shows 201020 — owner to correct the listing). Verified 2026-09-11 (ADR-031).
  addressLine: 'Krishan Plaza, Plot No. 6, Abhay Khand 1, Nyay Khand I (opposite Sai Mandir)',
  city: 'Indirapuram, Ghaziabad',
  state: 'Uttar Pradesh',
  pincode: '201014',
} as const;

/** Seed spec §1. Staging only — production gets its own seed that prompts for real values. */
const STAFF = [
  { id: 'staff_demo_owner', name: 'Demo Owner', mobile: '+919000000001', role: 'OWNER', pin: '2468' },
  { id: 'staff_demo_reception', name: 'Demo Staff', mobile: '+919000000002', role: 'RECEPTION', pin: '1357' },
] as const;

const KIOSK_ID = 'kiosk_demo_reception';

// ── Timing ──────────────────────────────────────────────────────────────────

const timings: Array<{ phase: string; ms: number; rows?: number }> = [];

async function timed<T>(phase: string, fn: () => Promise<T>, rows?: number): Promise<T> {
  const started = performance.now();
  const result = await fn();
  const ms = Math.round(performance.now() - started);
  timings.push(rows === undefined ? { phase, ms } : { phase, ms, rows });
  console.log(`  ${phase.padEnd(28)} ${String(ms).padStart(6)} ms${rows === undefined ? '' : `  (${rows} rows)`}`);
  return result;
}

async function inChunks<T>(rows: readonly T[], write: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await write(rows.slice(i, i + CHUNK_SIZE));
  }
}

/** Omit a nullable JSON column rather than passing `null`, which Prisma's JSON input rejects. */
function json<K extends string>(key: K, value: JsonObject | null): Partial<Record<K, JsonObject>> {
  return value === null ? {} : ({ [key]: value } as Record<K, JsonObject>);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Refusing to run the demo seed with NODE_ENV=production (database-design.md §8).');
  }

  const directUrl = process.env['DIRECT_URL'];
  if (directUrl === undefined || directUrl.trim() === '') {
    throw new Error('DIRECT_URL is not set. The seed uses the Supavisor session pooler (ADR-010).');
  }

  const slug = process.env['GYM_SLUG']?.trim() || 'max-fitness-indirapuram';
  const seedTodayRaw = process.env['SEED_TODAY']?.trim();
  const realToday = todayIST(systemClock);
  const today = seedTodayRaw !== undefined && seedTodayRaw !== '' ? istDate(seedTodayRaw) : realToday;
  // Seeding for a different day: pretend it is 19:30 IST, so the evening rush and the
  // day's reminder slots are all in the past.
  const now = today === realToday ? systemClock.now() : slotToUtc(today, istTime('19:30'));

  const target = new URL(directUrl);
  console.log('\nMax Fitness demo seed');
  console.log(`  database   ${target.hostname}:${target.port || '5432'} (session pooler)`);
  console.log(`  gym        ${slug}`);
  console.log(`  today      ${today} IST${today === realToday ? '' : ' (SEED_TODAY)'}`);
  console.log(`  rng seed   ${DEMO_RNG_SEED}\n`);

  const prisma = createPrismaClient({ connectionString: directUrl, poolMax: 3 });
  const started = performance.now();

  try {
    await timed('wipe demo gym', () => wipe(prisma, slug));

    const settings = GymSettingsSchema.parse({
      // Google Business Profile hours, verified 2026-09-11: Mon–Sat 4:30 am–10 pm, Sunday closed.
      hours: [
        ...[1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '04:30', close: '22:00' })),
        { day: 0, open: '00:00', close: '00:00', closed: true },
      ],
      promo: {
        enabled: true,
        textEn: 'DEMO — Free fitness assessment with any 3-month plan',
        textHi: 'डेमो — किसी भी 3 महीने के प्लान के साथ फ्री फिटनेस जाँच',
      },
    });

    await timed('gym, plans, rules, staff', async () => {
      await prisma.gym.create({
        data: {
          ...GYM,
          slug,
          settings: JSON.parse(JSON.stringify(settings)) as JsonObject,
        },
      });

      await prisma.plan.createMany({
        data: PRICED_GENDERS.flatMap((gender) =>
          PLAN_DURATIONS.map((months) => {
            const code = planCode(months, gender);
            return {
              id: `plan_${code.toLowerCase()}`,
              gymId: GYM.id,
              code,
              durationMonths: months,
              gender,
              pricePaise: DEFAULT_PLAN_PRICES_PAISE[code],
              isActive: true,
              sortOrder: months,
            };
          }),
        ),
      });

      await prisma.reminderRule.createMany({
        data: DEFAULT_REMINDER_RULES.map((rule) => ({
          id: `rr_${rule.code.toLowerCase()}`,
          gymId: GYM.id,
          code: rule.code,
          offsetDays: rule.offsetDays,
          // ADR-015: the POST cap is mirrored from settings and authoritative here.
          offsetDaysTo: rule.code === 'POST' ? settings.reminders.postExpiryMaxDays : rule.offsetDaysTo,
          slots: [...rule.slots],
          templateName: rule.templateName,
          isEnabled: true,
        })),
      });

      const staffRows = await Promise.all(
        STAFF.map(async (s) => {
          // security-plan.md §3.1: Argon2id, memory ≥ 19 MiB, iterations ≥ 2.
          const pinHash = await hash(s.pin, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
          if (!pinHash.startsWith('$argon2id$')) {
            throw new Error('PIN hash is not Argon2id — check @node-rs/argon2 defaults');
          }
          return {
            id: s.id,
            gymId: GYM.id,
            name: s.name,
            mobile: s.mobile,
            role: s.role,
            pinHash,
            language: 'hi' as const,
          };
        }),
      );
      await prisma.staffUser.createMany({ data: staffRows });

      await prisma.kioskDevice.create({
        data: {
          id: KIOSK_ID,
          gymId: GYM.id,
          name: 'Reception phone',
          status: 'ACTIVE',
          appVersion: '0.1.0-demo',
          lastSeenAt: new Date(now.getTime() - 2 * 60_000),
          lastHeartbeat: { battery: 78, temperatureC: 34, queueSize: 0, cameraOk: true, freeStorageMb: 5120 },
          shadowMode: settings.features.kioskShadowMode,
        },
      });
    });

    const rows = loadDemoMembers(CSV_PATH);
    const plans = new Map<PlanCode, { id: string; pricePaise: number }>(
      PRICED_GENDERS.flatMap((gender) =>
        PLAN_DURATIONS.map((months) => {
          const code = planCode(months, gender);
          return [code, { id: `plan_${code.toLowerCase()}`, pricePaise: DEFAULT_PLAN_PRICES_PAISE[code] }] as const;
        }),
      ),
    );

    const data = await timed('build dataset (in memory)', () =>
      Promise.resolve(
        buildDataset(rows, {
          gymId: GYM.id,
          today,
          now,
          rng: new Rng(DEMO_RNG_SEED),
          plans,
          ownerId: STAFF[0].id,
          receptionId: STAFF[1].id,
          ownerMobile: STAFF[0].mobile,
          kioskId: KIOSK_ID,
          postExpiryMaxDays: settings.reminders.postExpiryMaxDays,
        }),
      ),
    );

    await insert(prisma, data);

    const viewCounts = await timed('verify fee states (SQL)', () => feeStatesFromSql(prisma, today));
    printSummary(data, viewCounts, rows.length, Math.round(performance.now() - started));
  } finally {
    await prisma.$disconnect();
  }
}

/** Delete the demo gym and everything under it, children first. */
async function wipe(prisma: PrismaClient, slug: string): Promise<void> {
  const gym = await prisma.gym.findUnique({ where: { slug }, select: { id: true } });
  if (gym === null) return;
  const gymId = gym.id;

  await prisma.$transaction(
    async (tx) => {
      await tx.alert.deleteMany({ where: { gymId } });
      await tx.callTask.deleteMany({ where: { gymId } });
      await tx.messageLog.deleteMany({ where: { gymId } });
      await tx.attendanceEvent.deleteMany({ where: { gymId } });
      await tx.consent.deleteMany({ where: { gymId } });
      await tx.faceTemplate.deleteMany({ where: { gymId } });
      await tx.enrollmentJob.deleteMany({ where: { gymId } });
      await tx.verificationRequest.deleteMany({ where: { gymId } });
      await tx.payment.deleteMany({ where: { gymId } });
      await tx.membership.deleteMany({ where: { gymId } });
      await tx.member.updateMany({ where: { gymId }, data: { photoMediaId: null } });
      await tx.mediaFile.deleteMany({ where: { gymId } });
      await tx.member.deleteMany({ where: { gymId } });
      await tx.lead.deleteMany({ where: { gymId } });
      await tx.kioskDevice.deleteMany({ where: { gymId } });
      await tx.reminderRule.deleteMany({ where: { gymId } });
      await tx.plan.deleteMany({ where: { gymId } });
      await tx.session.deleteMany({ where: { staffUser: { gymId } } });
      await tx.staffUser.deleteMany({ where: { gymId } });
      await tx.otpCode.deleteMany({ where: { gymId } });
      await tx.counter.deleteMany({ where: { gymId } });
      await tx.auditLog.deleteMany({ where: { gymId } });
      await tx.outboxEvent.deleteMany({ where: { gymId } });
      await tx.webhookEvent.deleteMany({ where: { gymId } });
      await tx.gym.delete({ where: { id: gymId } });
    },
    // Remote database: generous, but bounded so a stuck wipe does not hold a
    // pooler connection indefinitely.
    { timeout: 120_000, maxWait: 15_000 },
  );
}

/**
 * Write the dataset in dependency order.
 *
 * Not one transaction: ~20k rows over the network would outlive any sensible
 * transaction timeout. If a run fails part-way, running the seed again wipes and
 * rebuilds, so the database never stays half-seeded for long.
 */
async function insert(prisma: PrismaClient, data: SeedDataset): Promise<void> {
  await timed('members', () => inChunks(data.members, (c) => prisma.member.createMany({ data: c })), data.members.length);
  await timed(
    'memberships',
    () => inChunks(data.memberships, (c) => prisma.membership.createMany({ data: c })),
    data.memberships.length,
  );
  await timed('payments', () => inChunks(data.payments, (c) => prisma.payment.createMany({ data: c })), data.payments.length);
  await timed('consents', () => inChunks(data.consents, (c) => prisma.consent.createMany({ data: c })), data.consents.length);
  await timed(
    'verification requests',
    () => inChunks(data.verifications, (c) => prisma.verificationRequest.createMany({ data: c })),
    data.verifications.length,
  );
  await timed(
    'leads',
    () =>
      inChunks(data.leads, (c) =>
        prisma.lead.createMany({ data: c.map(({ utm, ...rest }) => ({ ...rest, ...json('utm', utm) })) }),
      ),
    data.leads.length,
  );
  await timed(
    'attendance',
    () => inChunks(data.attendance, (c) => prisma.attendanceEvent.createMany({ data: c })),
    data.attendance.length,
  );
  await timed(
    'message log',
    () =>
      inChunks(data.messages, (c) =>
        prisma.messageLog.createMany({
          data: c.map(({ payload, ...rest }) => ({ ...rest, ...json('payload', payload) })),
        }),
      ),
    data.messages.length,
  );
  await timed('call tasks', () => inChunks(data.callTasks, (c) => prisma.callTask.createMany({ data: c })), data.callTasks.length);
  await timed(
    'alerts',
    () =>
      inChunks(data.alerts, (c) =>
        prisma.alert.createMany({ data: c.map(({ params, ...rest }) => ({ ...rest, ...json('params', params) })) }),
      ),
    data.alerts.length,
  );
  await timed('counters', () => prisma.counter.createMany({ data: data.counters }), data.counters.length);
}

/**
 * Fee-state counts from SQL, pinned to the seed's "today" with `member_fee_at()`.
 *
 * ADR-013 in miniature: the TypeScript `feeState()` is canonical, and the SQL read
 * model must agree with it. Printing both side by side makes a divergence visible
 * the moment it appears.
 */
async function feeStatesFromSql(prisma: PrismaClient, today: string): Promise<Record<FeeState, number>> {
  const rows = await prisma.$queryRaw<Array<{ feeState: string; count: bigint }>>`
    SELECT f."feeState", COUNT(*) AS count
    FROM "member_fee_at"(${today}::date) f
    JOIN "Member" m ON m."id" = f."memberId"
    WHERE m."gymId" = ${GYM.id} AND m."status" = 'ACTIVE'
    GROUP BY f."feeState"
  `;
  const out = Object.fromEntries(FEE_STATES.map((s) => [s, 0])) as Record<FeeState, number>;
  for (const row of rows) {
    if ((FEE_STATES as readonly string[]).includes(row.feeState)) {
      out[row.feeState as FeeState] = Number(row.count);
    }
  }
  return out;
}

function printSummary(
  data: SeedDataset,
  sql: Record<FeeState, number>,
  csvRows: number,
  totalMs: number,
): void {
  const s = data.summary;
  const line = (label: string, value: string | number) => console.log(`  ${label.padEnd(34)} ${value}`);

  console.log('\n┌─ Seed summary ─────────────────────────────────────────────');
  line('CSV rows', csvRows);
  for (const [status, count] of Object.entries(s.membersByStatus).sort()) {
    line(`members ${status}`, count);
  }

  console.log('\n  Fee state (ACTIVE members)          core   sql');
  let allMatch = true;
  for (const state of FEE_STATES) {
    const match = s.feeStates[state] === sql[state];
    allMatch &&= match;
    console.log(
      `    ${state.padEnd(32)} ${String(s.feeStates[state]).padStart(4)}  ${String(sql[state]).padStart(4)}${match ? '' : '  ← differs'}`,
    );
  }
  console.log(`    ${allMatch ? 'core and SQL agree' : 'core and SQL DISAGREE — see ADR-013/014'}`);

  console.log('');
  line("today's birthdays", s.birthdaysToday);
  line('birthdays in the next 6 days', s.birthdaysThisWeek);
  line('open call tasks', s.openCallTasks);
  for (const [reason, count] of Object.entries(s.openCallTasksByReason).sort()) {
    line(`  ${reason}`, count);
  }
  line("this month's collections", `${formatINR(s.collectionsThisMonthPaise)} (${s.paymentsThisMonth} payments)`);
  line('check-ins today', s.attendanceToday);
  line('unread alerts', s.unreadAlerts);

  console.log('\n  Rows written');
  const counts: Array<[string, number]> = [
    ['memberships', data.memberships.length],
    ['payments', data.payments.length],
    ['attendance events', data.attendance.length],
    ['message log', data.messages.length],
    ['call tasks', data.callTasks.length],
    ['leads', data.leads.length],
    ['consents', data.consents.length],
  ];
  for (const [label, count] of counts) line(`  ${label}`, count);

  line('\n  total time', `${(totalMs / 1000).toFixed(1)} s`);
  console.log('└────────────────────────────────────────────────────────────\n');
}

main().catch((error: unknown) => {
  // Never print the error object itself: a driver error can embed the connection string.
  const message = error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g, '[connection string]') : String(error);
  console.error(`\nSeed failed: ${message}\n`);
  process.exit(1);
});
