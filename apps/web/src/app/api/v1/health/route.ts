import { NextResponse } from 'next/server';
import { EnvValidationError, WORKER_HEARTBEAT_STALE_SECONDS } from '@mfp/shared';
import { getContainer } from '@/lib/container';

/**
 * `GET /api/v1/health` (api-specification.md §3, extended by ADR-018).
 *
 * Reports both processes. The worker has no inbound port
 * (system-architecture.md §2), so the only evidence it is alive is the heartbeat
 * row it keeps touching — which means one URL can cover the whole system and
 * Uptime Kuma needs a single monitor.
 *
 * Deliberately contains no counts, no versions of dependencies and no
 * configuration: this endpoint is unauthenticated, so it says whether things work
 * and nothing else (api-specification.md: "no secrets").
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VERSION = process.env['APP_VERSION'] ?? '0.1.0';

interface ComponentStatus {
  ok: boolean;
  detail?: string;
}

interface WorkerStatus extends ComponentStatus {
  lastBeatAt: string | null;
  ageSeconds: number | null;
}

export async function GET(): Promise<NextResponse> {
  const db = await checkDatabase();
  const worker = db.ok ? await checkWorker() : notCheckable();
  const ok = db.ok && worker.ok;

  return NextResponse.json(
    {
      data: {
        ok,
        db: db.ok ? 'ok' : 'down',
        worker: {
          ok: worker.ok,
          lastBeatAt: worker.lastBeatAt,
          ageSeconds: worker.ageSeconds,
        },
        version: VERSION,
      },
    },
    {
      // 503 so an uptime monitor treats a dead worker as an outage rather than
      // a healthy page that happens to contain the word "down".
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

async function checkDatabase(): Promise<ComponentStatus> {
  try {
    const { prisma } = getContainer();
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error) {
    if (error instanceof EnvValidationError) {
      // A bad .env looks like "db down" from outside. Say why in the server log —
      // key names and reasons only; EnvValidationError never includes values.
      console.error('[health] invalid environment:', error.issues.join('; '));
      return { ok: false, detail: 'invalid environment' };
    }
    // Never surface the driver's message: it contains the connection string.
    return { ok: false, detail: 'unreachable' };
  }
}

async function checkWorker(): Promise<WorkerStatus> {
  try {
    const { prisma } = getContainer();
    const latest = await prisma.workerHeartbeat.findFirst({
      orderBy: { lastBeatAt: 'desc' },
      select: { lastBeatAt: true },
    });

    if (latest === null) {
      return { ok: false, lastBeatAt: null, ageSeconds: null, detail: 'never started' };
    }

    const ageSeconds = Math.round((Date.now() - latest.lastBeatAt.getTime()) / 1000);
    return {
      // Three missed beats before we call it dead, so one slow write is not an alarm.
      ok: ageSeconds < WORKER_HEARTBEAT_STALE_SECONDS,
      lastBeatAt: latest.lastBeatAt.toISOString(),
      ageSeconds,
    };
  } catch {
    return { ok: false, lastBeatAt: null, ageSeconds: null, detail: 'unreachable' };
  }
}

function notCheckable(): WorkerStatus {
  return { ok: false, lastBeatAt: null, ageSeconds: null, detail: 'database unreachable' };
}
