import { fileURLToPath } from 'node:url';
import { PgBoss } from 'pg-boss';
import { parseEnv, systemClock, WORKER_HEARTBEAT_STALE_SECONDS } from '@mfp/shared';
import { createPrismaClient } from '@mfp/db';
import { LocalStorageDriver, resolveStorageRoot } from '@mfp/integrations/storage';
import { nightlyCallTasksHandler, registerReceiptPdfWorker, RECEIPT_PDF_QUEUE, startOutboxPoller, type Phase3Deps } from './jobs/phase3-jobs';
import { createLogger, type Logger } from './logger';
import { EVENT_QUEUES, IST_TZ, SCHEDULES, type ScheduleDefinition } from './schedules';

/**
 * The Max Fitness worker.
 *
 * One process, no inbound ports (system-architecture.md §2), running every
 * time-based job: reminder slots, the nightly call-task and lifecycle jobs, the
 * owner digest, and the outbox dispatcher.
 *
 * Every schedule and queue is registered from the start; each job's real handler
 * replaces its no-op in the phase that builds it. Phase 3 adds the outbox poller,
 * the receipt PDF queue and the SIGNUP_NOT_PAID part of the nightly call tasks. A
 * heartbeat row lets `/api/v1/health` tell whether the worker is alive (ADR-018).
 *
 * **Connection note (ADR-010):** pg-boss uses `DIRECT_URL`, the Supavisor *session*
 * pooler on :5432, not the transaction pooler the web app uses. pg-boss relies on
 * session-level features — advisory locks and LISTEN — which transaction mode
 * cannot provide.
 */

// The .env file is at the repo root; the worker runs with apps/worker as its cwd.
// Node's built-in loader never overrides variables already set by the environment.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // No .env file: rely on the process environment (production, CI).
}

const VERSION = process.env['WORKER_VERSION'] ?? '0.1.0';
const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * pg-boss 10+ keeps retention per queue rather than globally. Finished jobs are kept
 * for two weeks — long enough to investigate a bad night's reminder run — and then
 * deleted so the job tables do not grow without bound.
 */
const QUEUE_OPTIONS = { deleteAfterSeconds: 14 * 24 * 60 * 60 } as const;

async function main(): Promise<void> {
  const env = parseEnv();
  const log = createLogger({ level: env.LOG_LEVEL, workerId: env.WORKER_ID, version: VERSION });

  log.info(
    {
      demoMode: env.DEMO_MODE,
      whatsappProvider: env.WHATSAPP_PROVIDER,
      concurrency: env.WORKER_CONCURRENCY,
      poolMax: env.WORKER_DB_POOL_MAX,
    },
    'worker starting',
  );

  // Session pooler. pg-boss needs session-level connections (ADR-010).
  const boss = new PgBoss({
    connectionString: env.DIRECT_URL,
    max: env.WORKER_DB_POOL_MAX,
    schema: 'pgboss',
  });

  boss.on('error', (error: Error) => {
    log.error({ err: error }, 'pg-boss error');
  });

  const prisma = createPrismaClient({
    connectionString: env.DIRECT_URL,
    poolMax: env.WORKER_DB_POOL_MAX,
  });

  await boss.start();
  log.info('pg-boss started');

  const startedAt = new Date();

  const phase3: Phase3Deps = {
    boss,
    prisma,
    // The same folder as the web app's, whichever app directory each runs from.
    storage: new LocalStorageDriver({ rootPath: resolveStorageRoot(env.STORAGE_LOCAL_PATH), urlSigningSecret: env.LINK_TOKEN_SECRET }),
    clock: systemClock,
    log,
    gymSlug: env.GYM_SLUG,
  };

  await registerSchedules(boss, log, { 'nightly-call-tasks': nightlyCallTasksHandler(phase3) });
  await registerEventQueues(boss, log, new Set([RECEIPT_PDF_QUEUE]));
  await registerReceiptPdfWorker(phase3);
  const stopOutbox = startOutboxPoller(phase3);

  // The heartbeat starts only once every schedule and queue is registered. It is
  // what /api/v1/health reads, so a beat must mean "fully booted" — a worker that
  // connects and then fails to register its jobs must never look healthy.
  const stopHeartbeat = await startHeartbeat({ prisma, log, workerId: env.WORKER_ID, startedAt });

  log.info(
    { schedules: SCHEDULES.length, queues: EVENT_QUEUES.length },
    'worker ready — handlers not yet built log "not implemented" when they fire',
  );

  installShutdownHandlers({ boss, prisma, log, stopHeartbeat, stopOutbox });
}

/**
 * Heartbeat (ADR-018).
 *
 * The worker has no inbound port, so the only way anything can tell it is alive is
 * a row it keeps touching. `/api/v1/health` reports the worker down when the last
 * beat is older than 3 minutes — three missed beats, so a single slow write does
 * not raise a false alarm.
 */
async function startHeartbeat(deps: {
  prisma: ReturnType<typeof createPrismaClient>;
  log: Logger;
  workerId: string;
  startedAt: Date;
}): Promise<() => void> {
  const beat = async (): Promise<void> => {
    try {
      await deps.prisma.workerHeartbeat.upsert({
        where: { id: deps.workerId },
        create: {
          id: deps.workerId,
          version: VERSION,
          lastBeatAt: new Date(),
          startedAt: deps.startedAt,
        },
        update: { lastBeatAt: new Date(), version: VERSION },
      });
    } catch (error) {
      // A failed beat must not kill the worker: the database may be briefly
      // unreachable, and the jobs themselves will fail loudly if it stays that way.
      deps.log.error({ err: error }, 'heartbeat write failed');
    }
  };

  await beat();
  const timer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
  // Do not hold the event loop open on this alone.
  timer.unref();

  deps.log.info(
    { intervalMs: HEARTBEAT_INTERVAL_MS, staleAfterSeconds: WORKER_HEARTBEAT_STALE_SECONDS },
    'heartbeat started',
  );

  return () => {
    clearInterval(timer);
  };
}

/**
 * Register every cron from crm-module-spec.md §4 with a no-op handler.
 *
 * Registering them now, rather than as each phase lands, means the schedule table
 * is complete and visible from day one — and a missing job shows up as a "not
 * implemented" log line at the right time of day rather than as silence.
 */
async function registerSchedules(
  boss: PgBoss,
  log: Logger,
  handlers: Readonly<Record<string, () => Promise<void>>>,
): Promise<void> {
  for (const schedule of SCHEDULES) {
    if (schedule.cron.startsWith('@every')) {
      // Polled, not cron-driven (the outbox). Phase 3 wires the poll loop.
      log.debug({ job: schedule.name }, 'skipping non-cron schedule');
      continue;
    }

    await boss.createQueue(schedule.name, QUEUE_OPTIONS);
    const handler = handlers[schedule.name];
    await boss.work(schedule.name, handler === undefined ? notImplemented(schedule, log) : () => handler());
    await boss.schedule(schedule.name, schedule.cron, null, { tz: IST_TZ });

    log.info(
      { job: schedule.name, cron: schedule.cron, tz: IST_TZ, phase: schedule.implementedIn },
      'schedule registered',
    );
  }
}

/** Creates every event queue; those in `implemented` get their real worker elsewhere. */
async function registerEventQueues(boss: PgBoss, log: Logger, implemented: ReadonlySet<string>): Promise<void> {
  for (const queue of EVENT_QUEUES) {
    await boss.createQueue(queue.name, QUEUE_OPTIONS);
    if (!implemented.has(queue.name)) await boss.work(queue.name, notImplemented({ ...queue, cron: '' }, log));
    log.info({ queue: queue.name, phase: queue.implementedIn }, 'queue registered');
  }
}

function notImplemented(schedule: ScheduleDefinition, log: Logger) {
  return (jobs: readonly { id: string }[]): Promise<void> => {
    log.warn(
      { job: schedule.name, phase: schedule.implementedIn, count: jobs.length, what: schedule.description },
      `not implemented (Phase ${schedule.implementedIn})`,
    );
    return Promise.resolve();
  };
}

/**
 * Graceful shutdown.
 *
 * Docker sends SIGTERM and waits ten seconds. pg-boss must be allowed to finish
 * the job it is holding and release it cleanly, or the job stays locked until its
 * expiry and the next slot silently does nothing.
 */
function installShutdownHandlers(deps: {
  boss: PgBoss;
  prisma: ReturnType<typeof createPrismaClient>;
  log: Logger;
  stopHeartbeat: () => void;
  stopOutbox: () => Promise<void>;
}): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      deps.log.warn({ signal }, 'second signal received — exiting immediately');
      process.exit(1);
    }
    shuttingDown = true;
    deps.log.info({ signal }, 'shutting down');

    void (async () => {
      try {
        deps.stopHeartbeat();
        await deps.stopOutbox();
        await deps.boss.stop({ graceful: true, timeout: 8_000 });
        await deps.prisma.$disconnect();
        deps.log.info('shutdown complete');
        process.exit(0);
      } catch (error) {
        deps.log.error({ err: error }, 'shutdown failed');
        process.exit(1);
      }
    })();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    deps.log.error({ err: reason }, 'unhandled rejection');
  });
  process.on('uncaughtException', (error) => {
    deps.log.fatal({ err: error }, 'uncaught exception — exiting so the supervisor restarts us');
    process.exit(1);
  });
}

main().catch((error: unknown) => {
  // The logger may not exist yet if env parsing failed, so this one goes to stderr.
  console.error('worker failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
