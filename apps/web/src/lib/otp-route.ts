import type { NextRequest, NextResponse } from 'next/server';
import { PrismaOtpStore } from '@mfp/db';
import { apiError } from './api';
import { getContainer } from './container';
import type { GymContext } from './gym';

/** What the OTP and lookup routes share: a small JSON body, a 429, and the code's dependencies. */

const MAX_BODY_BYTES = 2_048;

export async function readSmallJson(
  request: NextRequest,
  requestId: string,
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES)
    return { ok: false, response: apiError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large', requestId) };
  try {
    return { ok: true, body: JSON.parse(raw) as unknown };
  } catch {
    return {
      ok: false,
      response: apiError(400, 'VALIDATION_FAILED', 'Request body must be JSON', requestId),
    };
  }
}

export function tooMany(retryAfterSeconds: number, requestId: string): NextResponse {
  return apiError(429, 'RATE_LIMITED', 'Too many requests', requestId, {
    details: { retryAfterSeconds },
    headers: { 'Retry-After': String(retryAfterSeconds) },
  });
}

export function otpDeps(gym: GymContext) {
  const { clock, prisma, env, otpSender } = getContainer();
  return {
    clock,
    store: new PrismaOtpStore(prisma),
    sender: otpSender,
    gymId: gym.id,
    secret: env.LINK_TOKEN_SECRET,
  };
}

/** Maps a Zod failure to `{ field: code }`, as the other public routes do. */
export function fieldErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) fields[String(issue.path[0] ?? 'form')] ??= issue.message;
  return fields;
}
