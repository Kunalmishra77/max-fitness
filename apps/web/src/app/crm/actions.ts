'use server';

import { redirect } from 'next/navigation';
import {
  addStaff,
  advanceLead,
  can,
  resetStaffPin,
  setStaffActive,
  markAttendance,
  mayAfterPinEntry,
  recordCallOutcome,
  registerAtDesk,
  undoAttendance,
  updateGymSettings,
  updatePlanPrices,
  voidPayment,
  type LeadStatus,
} from '@mfp/core';
import { revalidateLandingContent } from '@/lib/revalidate-landing';
import type { PriceInput, SettingsPatchInput, SettingsResult, StaffCreateFields, StaffResult, UnlockResult } from '@/lib/settings-types';
import { RegistrationFieldsSchema, StaffCreateSchema, StaffPinSchema } from '@mfp/shared';
import type { AddMemberErrorCode, AddMemberFields, AddMemberResult } from '@/components/crm/add-member-flow';
import type { MarkResult, UndoResult } from '@/components/crm/attendance-marker';
import type { CallOutcomeChoice, OutcomeResult } from '@/components/crm/call-outcome';
import type { LeadResult } from '@/components/crm/lead-actions';
import type { VoidResult } from '@/components/crm/void-payment';
import { getContainer } from '@/lib/container';
import {
  attendanceDeps,
  callOutcomeDeps,
  deskRegistrationDeps,
  elevate,
  leadPipelineDeps,
  requireCrmContext,
  settingsDeps,
  signOut,
  staffDeps,
  voidPaymentDeps,
} from '@/lib/crm';

/**
 * Server actions shared by CRM screens.
 *
 * Every one of them resolves the session again server-side: what the browser sends is a
 * task id and a few words, never who the person is or what they may do.
 */

export async function logoutAction(): Promise<void> {
  await signOut();
  redirect('/crm/login');
}

/** Codes the wizard knows; anything else is a bug on our side, not the member's. */
const FIELD_CODES = new Set<AddMemberErrorCode>(['fullName', 'mobile', 'dob', 'gender', 'terms']);

/**
 * Add a walk-in member at the desk (crm-ux-blueprint §7).
 *
 * The fields go through the same Zod schema the website uses, so "what counts as a
 * name, a number and a date of birth" is decided in one place (CLAUDE.md §2.3).
 */
export async function addMemberAction(fields: AddMemberFields): Promise<AddMemberResult> {
  const { actor, gym } = await requireCrmContext();

  const parsed = RegistrationFieldsSchema.safeParse({
    fullName: fields.fullName,
    mobile: fields.mobile,
    dob: fields.dob,
    gender: fields.gender,
    // The desk is Hindi-first; the member can be switched later (CLAUDE.md §2.9).
    language: 'hi',
    consents: {
      terms: fields.terms,
      privacy: fields.terms,
      whatsappUpdates: fields.whatsappUpdates,
      faceAttendance: fields.faceAttendance,
    },
    noticeVersion: gym.settings.privacy.privacyNoticeVersion,
  });
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.message as AddMemberErrorCode | undefined;
    return { ok: false, code: code !== undefined && FIELD_CODES.has(code) ? code : 'generic' };
  }

  try {
    const result = await registerAtDesk({ fields: parsed.data }, { actor, ...deskRegistrationDeps(gym) });
    return { ok: true, memberId: result.memberId, possibleDuplicate: result.possibleDuplicate };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'UNDER_MINIMUM_AGE') {
      return { ok: false, code: 'underAge', minAge: (error as { meta?: { minAge?: number } }).meta?.minAge ?? gym.settings.privacy.minAge };
    }
    if (code === 'FORBIDDEN') return { ok: false, code: 'FORBIDDEN' };
    // A date in the future or an impossible age arrives as VALIDATION_FAILED.
    if (code === 'VALIDATION_FAILED') return { ok: false, code: 'dob' };
    console.error(`[crm] add member failed: ${code ?? (error instanceof Error ? error.name : 'Error')}`);
    return { ok: false, code: 'generic' };
  }
}

/**
 * Mark someone in by hand (BR-9.4).
 *
 * The fee state the desk could see is stored with the check-in, so the follow-up rules
 * can tell later that this member was standing here with fees overdue (BR-9.3).
 */
export async function markAttendanceAction(memberId: string, clientEventId: string): Promise<MarkResult> {
  const { actor, gym, today, reader } = await requireCrmContext();

  try {
    const member = await reader.member(gym.id, memberId, today);
    if (member === null) return { ok: false, code: 'NOT_FOUND' };

    const result = await markAttendance({ memberId, clientEventId, feeStateAtCheckIn: member.feeState }, { actor, ...attendanceDeps(gym) });
    return result.decision === 'RECORD' && result.eventId !== null
      ? { ok: true, decision: 'RECORD', eventId: result.eventId, callTaskRaised: result.callTaskRaised }
      : { ok: true, decision: result.decision === 'DUPLICATE_EVENT' ? 'DUPLICATE_EVENT' : 'WITHIN_COOLDOWN', eventId: null };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'FORBIDDEN') return { ok: false, code: 'FORBIDDEN' };
    if (code === 'NOT_FOUND') return { ok: false, code: 'NOT_FOUND' };
    console.error(`[crm] mark attendance failed: ${code ?? (error instanceof Error ? error.name : 'Error')}`);
    return { ok: false, code: 'generic' };
  }
}

/** The undo bar behind a mistaken tap. */
export async function undoAttendanceAction(eventId: string): Promise<UndoResult> {
  const { actor, gym } = await requireCrmContext();
  try {
    await undoAttendance({ eventId }, { actor, ...attendanceDeps(gym) });
    return { ok: true };
  } catch (error) {
    console.error(`[crm] undo attendance failed: ${(error as { code?: string }).code ?? (error instanceof Error ? error.name : 'Error')}`);
    return { ok: false };
  }
}

/**
 * Enter the PIN again to open settings (security-plan.md §3.1).
 *
 * The role is checked before the PIN is looked at, so someone who could never change
 * settings does not spend a PIN attempt, or learn whether the PIN was right.
 */
export async function unlockSettingsAction(pin: string): Promise<UnlockResult> {
  const { actor } = await requireCrmContext();
  if (!mayAfterPinEntry(actor, 'settings.manage', getContainer().clock.now())) return { ok: false, code: 'FORBIDDEN' };
  const elevated = await elevate(actor, pin);
  if (elevated.ok) return { ok: true };
  return { ok: false, code: elevated.code === 'VALIDATION_FAILED' ? 'INVALID_PIN' : elevated.code };
}

/** Shared by both saves: who may, whether the PIN is still fresh, and what an error means. */
async function settingsSave(work: (deps: ReturnType<typeof settingsDeps> & { actor: Awaited<ReturnType<typeof requireCrmContext>>['actor'] }) => Promise<boolean>): Promise<SettingsResult> {
  const { actor } = await requireCrmContext();
  const now = getContainer().clock.now();
  if (!mayAfterPinEntry(actor, 'settings.manage', now)) return { ok: false, code: 'FORBIDDEN' };
  // The PIN lapses five minutes after it was entered; the screen asks again and retries.
  if (!can(actor, 'settings.manage', now)) return { ok: false, code: 'PIN_REQUIRED' };

  try {
    const changed = await work({ actor, ...settingsDeps() });
    // Prices, promo, trust numbers and hours all show on the public site (ADR-022).
    if (changed) revalidateLandingContent();
    return { ok: true, changed };
  } catch (error) {
    const code = (error as { code?: string }).code;
    const field = (error as { meta?: { field?: string } }).meta?.field;
    if (code === 'VALIDATION_FAILED' || code === 'NOT_FOUND') return { ok: false, code: 'VALIDATION_FAILED', ...(field === undefined ? {} : { field }) };
    if (code === 'FORBIDDEN') return { ok: false, code: 'PIN_REQUIRED' };
    console.error(`[crm] settings save failed: ${code ?? (error instanceof Error ? error.name : 'Error')}`);
    return { ok: false, code: 'generic' };
  }
}

export async function savePlanPricesAction(prices: readonly PriceInput[]): Promise<SettingsResult> {
  return settingsSave(async (deps) => (await updatePlanPrices({ prices }, deps)).changed > 0);
}

export async function saveSettingsAction(patch: SettingsPatchInput): Promise<SettingsResult> {
  return settingsSave(async (deps) => (await updateGymSettings({ patch }, deps)).changedGroups.length > 0);
}

/** Shared by the staff actions: owner with a fresh PIN, and what an error means for the form. */
async function staffChange(work: (deps: ReturnType<typeof staffDeps> & { actor: Awaited<ReturnType<typeof requireCrmContext>>['actor'] }) => Promise<unknown>): Promise<StaffResult> {
  const { actor } = await requireCrmContext();
  const now = getContainer().clock.now();
  if (!mayAfterPinEntry(actor, 'settings.manage', now)) return { ok: false, code: 'FORBIDDEN' };
  if (!can(actor, 'settings.manage', now)) return { ok: false, code: 'PIN_REQUIRED' };

  try {
    await work({ actor, ...staffDeps() });
    return { ok: true };
  } catch (error) {
    const code = (error as { code?: string }).code;
    const field = (error as { meta?: { field?: string } }).meta?.field;
    const withField = field === undefined ? {} : { field };
    if (code === 'VALIDATION_FAILED' || code === 'NOT_FOUND') return { ok: false, code: 'VALIDATION_FAILED', ...withField };
    if (code === 'CONFLICT') return { ok: false, code: 'CONFLICT', ...withField };
    if (code === 'FORBIDDEN') return { ok: false, code: 'FORBIDDEN' };
    console.error(`[crm] staff change failed: ${code ?? (error instanceof Error ? error.name : 'Error')}`);
    return { ok: false, code: 'generic' };
  }
}

/** Add reception or a trainer, with a PIN of their own (security-plan §3.1). */
export async function addStaffAction(fields: StaffCreateFields): Promise<StaffResult> {
  const parsed = StaffCreateSchema.safeParse(fields);
  if (!parsed.success) return { ok: false, code: 'VALIDATION_FAILED', field: parsed.error.issues[0]?.message ?? 'name' };
  return staffChange((deps) => addStaff(parsed.data, deps));
}

/** A new PIN for someone who forgot theirs; it signs them out everywhere. */
export async function resetStaffPinAction(staffUserId: string, pin: string): Promise<StaffResult> {
  if (!StaffPinSchema.safeParse(pin).success) return { ok: false, code: 'VALIDATION_FAILED', field: 'pin' };
  return staffChange((deps) => resetStaffPin({ staffUserId, pin }, deps));
}

/** Switch someone off (signed out everywhere) or back on. */
export async function setStaffActiveAction(staffUserId: string, active: boolean): Promise<StaffResult> {
  return staffChange((deps) => setStaffActive({ staffUserId, active }, deps));
}

/** Move an enquiry along the pipeline (BR-10.1). */
export async function advanceLeadAction(leadId: string, to: LeadStatus, note: string): Promise<LeadResult> {
  const { actor } = await requireCrmContext();
  try {
    await advanceLead({ leadId, to, ...(note === '' ? {} : { note }) }, { actor, ...leadPipelineDeps() });
    return { ok: true };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'FORBIDDEN') return { ok: false, code: 'FORBIDDEN' };
    if (code === 'CONFLICT') return { ok: false, code: 'CONFLICT' };
    console.error(`[crm] lead update failed: ${code ?? (error instanceof Error ? error.name : 'Error')}`);
    return { ok: false, code: 'generic' };
  }
}

/** What happened on the call (BR-7). The rules live in the domain service. */
export async function recordCallOutcomeAction(taskId: string, outcome: CallOutcomeChoice): Promise<OutcomeResult> {
  const { actor } = await requireCrmContext();
  try {
    await recordCallOutcome({ taskId, outcome }, { actor, ...callOutcomeDeps() });
    return { ok: true };
  } catch (error) {
    console.error(`[crm] call outcome failed: ${(error as { code?: string }).code ?? (error instanceof Error ? error.name : 'Error')}`);
    return { ok: false };
  }
}

/**
 * Void a payment entered wrongly (case P9).
 *
 * The PIN is checked first, and only for a role that could ever do this — a receptionist
 * tapping it never spends a PIN attempt, and never learns whether the PIN was right.
 */
export async function voidPaymentAction(paymentId: string, reason: string, pin: string): Promise<VoidResult> {
  const { actor } = await requireCrmContext();
  const { clock } = getContainer();
  if (!mayAfterPinEntry(actor, 'payment.void', clock.now())) return { ok: false, code: 'FORBIDDEN' };

  const elevated = await elevate(actor, pin);
  if (!elevated.ok) return { ok: false, code: elevated.code === 'VALIDATION_FAILED' ? 'INVALID_PIN' : elevated.code };

  try {
    await voidPayment({ paymentId, reason }, { actor: { ...actor, elevatedUntil: elevated.elevatedUntil }, ...voidPaymentDeps() });
    return { ok: true };
  } catch (error) {
    const code = (error as { code?: string }).code;
    console.error(`[crm] void failed: ${code ?? (error instanceof Error ? error.name : 'Error')}`);
    return { ok: false, code: code === 'FORBIDDEN' ? 'FORBIDDEN' : 'INTERNAL' };
  }
}
