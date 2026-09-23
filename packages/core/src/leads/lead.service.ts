import { toE164, type Clock, type E164Mobile, type LeadCreate, type LeadGoal } from '@mfp/shared';
import type { OutboxEventInput } from '../ports/outbox';
import { appendNote, decideLeadDedupe, dedupeWindowStart, repeatEnquiryNote, type ExistingLead } from './lead.rules';

/**
 * Submitting a lead (PRD LP-04, BR-10.3).
 *
 * One transaction records the enquiry, raises the owner's bell alert, and queues the
 * owner WhatsApp alert in the outbox (system-architecture.md §5) — so an alert is
 * never sent for a lead that failed to save, and a saved lead never silently misses
 * its alert. The WhatsApp itself is dispatched by the worker in a later phase.
 *
 * The NEW_LEAD call task is not created here: BR-7 raises it only if nobody has
 * contacted the lead within 2 gym hours, which is the worker's `lead-followup` job.
 */

export interface NewLeadRecord {
  readonly gymId: string;
  readonly name: string;
  readonly mobile: E164Mobile;
  readonly goal: LeadGoal;
  readonly source: LeadCreate['source'];
  readonly utm: LeadCreate['utm'] | null;
}

export interface LeadAlertRecord {
  readonly gymId: string;
  readonly type: 'NEW_LEAD';
  /** i18n key rendered by the CRM bell. */
  readonly title: string;
  readonly params: Readonly<Record<string, string>>;
}

/** What the lead service needs from storage, inside one transaction. */
export interface LeadStore {
  findLeadsByMobileSince(gymId: string, mobile: E164Mobile, since: Date): Promise<readonly ExistingLead[]>;
  createLead(lead: NewLeadRecord): Promise<string>;
  appendLeadNote(leadId: string, note: (existingNotes: string | null) => string): Promise<void>;
  createAlert(alert: LeadAlertRecord): Promise<void>;
  enqueueOutbox(event: OutboxEventInput): Promise<void>;
}

export interface LeadUnitOfWork {
  transaction<T>(work: (store: LeadStore) => Promise<T>): Promise<T>;
}

export interface SubmitLeadResult {
  readonly leadId: string;
  /** True when this enquiry was folded into an existing lead (BR-10.3). */
  readonly merged: boolean;
}

export async function submitLead(
  input: LeadCreate,
  deps: { readonly gymId: string; readonly clock: Clock; readonly uow: LeadUnitOfWork },
): Promise<SubmitLeadResult> {
  const mobile = toE164(input.mobile);
  const now = deps.clock.now();

  return deps.uow.transaction(async (store) => {
    const existing = await store.findLeadsByMobileSince(deps.gymId, mobile, dedupeWindowStart(now));
    const decision = decideLeadDedupe(existing, now);

    if (decision.action === 'merge') {
      const note = repeatEnquiryNote(input.source, input.goal, now);
      await store.appendLeadNote(decision.leadId, (notes) => appendNote(notes, note));
      return { leadId: decision.leadId, merged: true };
    }

    const leadId = await store.createLead({
      gymId: deps.gymId,
      name: input.name,
      mobile,
      goal: input.goal,
      source: input.source,
      utm: input.utm ?? null,
    });

    await store.createAlert({
      gymId: deps.gymId,
      type: 'NEW_LEAD',
      title: 'crm.alerts.newLead',
      params: { leadId, name: input.name, goal: input.goal },
    });

    return { leadId, merged: false };
  });
}
