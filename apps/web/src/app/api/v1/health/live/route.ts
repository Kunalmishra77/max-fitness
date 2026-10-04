import { NextResponse } from 'next/server';

/**
 * `GET /api/v1/health/live` — is this process answering? (ADR-104)
 *
 * Its sibling, `/api/v1/health`, reports the **system**: it answers 503 when the database
 * is unreachable or the worker has stopped beating, which is right for an uptime monitor —
 * a dead worker is an outage and somebody should be woken.
 *
 * It is wrong for a container healthcheck. A platform that restarts an unhealthy container
 * would then restart the web server every time the worker was down, which fixes nothing and
 * takes the website down with it. The two questions are different: "is the whole system
 * working" and "is this one process alive".
 *
 * So this touches nothing — no database, no container, no environment. If the process can
 * run a route handler at all, it is alive, and that is the entire claim.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json({ data: { ok: true } }, { headers: { 'Cache-Control': 'no-store' } });
}
