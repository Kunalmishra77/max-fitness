import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  PrismaAttendanceUnitOfWork,
  PrismaCallOutcomeUnitOfWork,
  PrismaCrmAuthStore,
  PrismaCrmReader,
  PrismaCrmSessions,
  PrismaDeskPaymentUnitOfWork,
  PrismaElevationStore,
  PrismaLeadPipelineUnitOfWork,
  PrismaRegistrationUnitOfWork,
  PrismaReportsReader,
  PrismaSettingsUnitOfWork,
  PrismaVoidPaymentUnitOfWork,
} from '@mfp/db';
import { elevateSession, login as loginService } from '@mfp/core';
import type { CrmSessionActor } from '@mfp/db';
import { Argon2PinHasher } from '@mfp/integrations/auth';
import { todayIST, type ISTDate } from '@mfp/shared';
import { getContainer } from './container';
import { checkoutSettingsOf, loadGym, type GymContext } from './gym';
import { withOneRetry } from './retry';
import { hashIp } from './signup-access';

/**
 * The CRM's session and dependencies (security-plan.md §3.1; crm-module-spec §3).
 *
 * The cookie is `HttpOnly; Secure; SameSite=Lax`, so it is not readable from JavaScript
 * and does not ride along with cross-site requests. Every screen resolves it to an
 * actor server-side; there is no client-side notion of "who is logged in".
 */

export const CRM_SESSION_COOKIE = 'mfp_session';

export interface CrmContext {
  readonly actor: CrmSessionActor;
  readonly gym: GymContext;
  readonly today: ISTDate;
  readonly reader: PrismaCrmReader;
}

async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(CRM_SESSION_COOKIE)?.value ?? null;
}

export async function currentActor(): Promise<CrmSessionActor | null> {
  const token = await sessionToken();
  if (token === null) return null;

  const container = getContainer();
  try {
    // A failed lookup is tried once more before it counts as "no session": otherwise a
    // passing database hiccup signs staff out in the middle of their work.
    return await withOneRetry(async () => {
      const gym = await loadGym(container);
      return new PrismaCrmSessions(container.prisma).actorFor(token, container.clock.now(), gym.settings.pricing.allowDeskDiscounts);
    });
  } catch (error) {
    console.error(`[crm] session lookup failed: ${error instanceof Error ? error.name : 'Error'}`);
    return null;
  }
}

/** Every CRM screen starts here; without a session it goes to the login page. */
export async function requireCrmContext(): Promise<CrmContext> {
  const actor = await currentActor();
  if (actor === null) redirect('/crm/login');

  const container = getContainer();
  const gym = await loadGym(container);
  return { actor, gym, today: todayIST(container.clock), reader: new PrismaCrmReader(container.prisma) };
}

export type LoginOutcome = { ok: true } | { ok: false; code: 'INVALID_PIN' | 'ACCOUNT_LOCKED' | 'VALIDATION_FAILED' | 'INTERNAL'; attemptsLeft?: number; minutes?: number };

export async function signIn(input: { mobile: string; pin: string; trusted: boolean }): Promise<LoginOutcome> {
  const container = getContainer();
  const requestHeaders = await headers();

  try {
    const gym = await loadGym(container);
    const { token, actor } = await loginService(
      {
        mobile: input.mobile,
        pin: input.pin,
        ipHash: hashIp(requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown', container.env.LINK_TOKEN_SECRET),
        userAgent: requestHeaders.get('user-agent')?.slice(0, 300) ?? null,
        trusted: input.trusted,
      },
      {
        store: new PrismaCrmAuthStore(container.prisma),
        hasher: new Argon2PinHasher(),
        clock: container.clock,
        gymId: gym.id,
      },
    );

    (await cookies()).set(CRM_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: container.env.NODE_ENV === 'production',
      path: '/',
      expires: new Date(container.clock.now().getTime() + (input.trusted ? 30 * 86_400_000 : 12 * 3_600_000)),
    });
    // The language follows the person who signed in (CLAUDE.md §2.9).
    (await cookies()).set('MFP_LOCALE', actor.language, { sameSite: 'lax', path: '/', maxAge: 31_536_000 });
    return { ok: true };
  } catch (error) {
    const code = (error as { code?: string }).code;
    const meta = (error as { meta?: { attemptsLeft?: number; retryAfterSeconds?: number } }).meta ?? {};
    if (code === 'INVALID_PIN') return { ok: false, code, ...(meta.attemptsLeft === undefined ? {} : { attemptsLeft: meta.attemptsLeft }) };
    if (code === 'ACCOUNT_LOCKED') return { ok: false, code, minutes: Math.ceil((meta.retryAfterSeconds ?? 900) / 60) };
    if (code === 'VALIDATION_FAILED') return { ok: false, code };
    console.error(`[crm] login failed: ${error instanceof Error ? error.name : 'Error'}`);
    return { ok: false, code: 'INTERNAL' };
  }
}

export async function signOut(): Promise<void> {
  const token = await sessionToken();
  const container = getContainer();
  if (token !== null) {
    try {
      await new PrismaCrmSessions(container.prisma).revoke(token, container.clock.now());
    } catch (error) {
      console.error(`[crm] logout failed: ${error instanceof Error ? error.name : 'Error'}`);
    }
  }
  (await cookies()).delete(CRM_SESSION_COOKIE);
}

/** The desk-payment dependencies, built per request. */
export function deskPaymentDeps(gym: GymContext) {
  const container = getContainer();
  return {
    clock: container.clock,
    uow: new PrismaDeskPaymentUnitOfWork(container.prisma),
    settings: checkoutSettingsOf(gym.settings),
  };
}

/** Adding a member at the desk: the same stores online sign-up uses (crm-ux-blueprint §7). */
export function deskRegistrationDeps(gym: GymContext) {
  const container = getContainer();
  return {
    clock: container.clock,
    uow: new PrismaRegistrationUnitOfWork(container.prisma),
    storage: container.storage,
    minAge: gym.settings.privacy.minAge,
  };
}

/** Marking attendance by hand, with the gym's cooldown (BR-9.1). */
export function attendanceDeps(gym: GymContext) {
  const container = getContainer();
  return {
    clock: container.clock,
    uow: new PrismaAttendanceUnitOfWork(container.prisma),
    cooldownMinutes: gym.settings.attendance.checkInCooldownMinutes,
  };
}

/** The owner's settings and plan prices (crm-ux-blueprint §14). */
export function settingsDeps() {
  const container = getContainer();
  return { clock: container.clock, uow: new PrismaSettingsUnitOfWork(container.prisma) };
}

/** The rows behind the owner's reports (crm-module-spec §6). */
export function reportsReader() {
  return new PrismaReportsReader(getContainer().prisma);
}

/** Moving an enquiry along the pipeline (BR-10.1). */
export function leadPipelineDeps() {
  const container = getContainer();
  return { clock: container.clock, uow: new PrismaLeadPipelineUnitOfWork(container.prisma) };
}

export function callOutcomeDeps() {
  const container = getContainer();
  return { clock: container.clock, uow: new PrismaCallOutcomeUnitOfWork(container.prisma) };
}

export function voidPaymentDeps() {
  const container = getContainer();
  return { clock: container.clock, uow: new PrismaVoidPaymentUnitOfWork(container.prisma) };
}

export type ElevateOutcome =
  | { ok: true; elevatedUntil: Date }
  | { ok: false; code: 'INVALID_PIN' | 'ACCOUNT_LOCKED' | 'VALIDATION_FAILED' | 'INTERNAL' };

/**
 * Re-enter the PIN for a sensitive action (security-plan.md §3.1).
 *
 * The elevation is written to the session row, so it survives the redirect and the
 * actor loaded on the next request already counts as elevated. The caller gets the new
 * expiry back because the actor it is holding was read before this ran.
 */
export async function elevate(actor: CrmSessionActor, pin: string): Promise<ElevateOutcome> {
  const token = await sessionToken();
  if (token === null) return { ok: false, code: 'INTERNAL' };

  const container = getContainer();
  try {
    const elevatedUntil = await elevateSession(
      { token, pin },
      { actor, store: new PrismaElevationStore(container.prisma), hasher: new Argon2PinHasher(), clock: container.clock },
    );
    return { ok: true, elevatedUntil };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'INVALID_PIN' || code === 'ACCOUNT_LOCKED' || code === 'VALIDATION_FAILED') return { ok: false, code };
    console.error(`[crm] PIN re-entry failed: ${error instanceof Error ? error.name : 'Error'}`);
    return { ok: false, code: 'INTERNAL' };
  }
}
