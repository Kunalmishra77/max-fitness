import { toISTDate } from '@mfp/shared';

/**
 * Lead rules (BR-10).
 *
 * Enquiries arrive from the website, WhatsApp and the front desk, and the same person
 * often asks twice — once from the hero form tonight, again from the WhatsApp button
 * tomorrow. BR-10.3 folds those into one lead so the owner's call list has one row
 * per person, not one per click.
 */

/** BR-10.3: the same mobile within this many days is the same enquiry. */
export const LEAD_DEDUPE_WINDOW_DAYS = 7;

/** Faster than this from page render to submit is not a person typing a name and number. */
export const MIN_FORM_FILL_MS = 2_500;

const DAY_MS = 86_400_000;

export interface ExistingLead {
  readonly id: string;
  readonly createdAt: Date;
}

export type LeadDedupeDecision =
  | { readonly action: 'create' }
  | { readonly action: 'merge'; readonly leadId: string };

/** The start of the dedupe window, for the repository query. */
export function dedupeWindowStart(now: Date): Date {
  return new Date(now.getTime() - LEAD_DEDUPE_WINDOW_DAYS * DAY_MS);
}

/**
 * BR-10.3: merge into the newest lead with this mobile from the last 7 days;
 * otherwise create a new one.
 *
 * The caller passes leads already filtered by gym and mobile. Anything older than the
 * window is ignored here too, so the rule holds even if a repository over-fetches.
 */
export function decideLeadDedupe(existing: readonly ExistingLead[], now: Date): LeadDedupeDecision {
  const cutoff = dedupeWindowStart(now).getTime();
  const newest = [...existing]
    .filter((lead) => lead.createdAt.getTime() >= cutoff && lead.createdAt.getTime() <= now.getTime())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  return newest === undefined ? { action: 'create' } : { action: 'merge', leadId: newest.id };
}

/**
 * BR-10.3 "the newest source is appended": a note line recording the repeat enquiry,
 * dated in IST so the owner reads it the way they think about days.
 */
export function repeatEnquiryNote(source: string, goal: string, now: Date): string {
  return `Enquired again on ${toISTDate(now)} via ${source} (goal: ${goal})`;
}

/** Join a new note onto existing notes without losing either. */
export function appendNote(existing: string | null, note: string): string {
  return existing === null || existing.trim() === '' ? note : `${existing}\n${note}`;
}

export type BotSignal = 'HONEYPOT' | 'TOO_FAST';

/**
 * Cheap, privacy-friendly bot checks until a challenge is chosen in Phase 8
 * (security-plan.md §3.1).
 *
 * A filled honeypot or an impossibly fast submission is treated as a bot. The route
 * answers such requests exactly like a success, so a script learns nothing from the
 * response, but nothing is stored and no one is alerted.
 */
export function detectBot(input: {
  readonly honeypot: string | undefined;
  readonly renderedAt: number | undefined;
  readonly now: Date;
}): BotSignal | null {
  if (input.honeypot !== undefined && input.honeypot.trim() !== '') return 'HONEYPOT';
  if (input.renderedAt !== undefined) {
    const elapsed = input.now.getTime() - input.renderedAt;
    if (elapsed >= 0 && elapsed < MIN_FORM_FILL_MS) return 'TOO_FAST';
  }
  return null;
}
