import { toISTDate, type Clock } from '@mfp/shared';
import { DomainError } from '../errors';
import { appendNote } from '../leads/lead.rules';
import { assertCan, type CrmActor } from './permissions';

/**
 * Moving an enquiry along the pipeline (BR-10.1; crm-ux-blueprint §12).
 *
 * `NEW → CONTACTED → TRIAL_BOOKED → VISITED → CONVERTED | LOST`. Real enquiries do not
 * follow that in order — someone phones at noon and walks in at six — so skipping ahead
 * is allowed. Going backwards is not: the history of an enquiry is what the owner reads
 * to decide whether it is still worth a call, and a status that can move both ways tells
 * them nothing.
 *
 * Notes are appended with the IST date rather than replaced, for the same reason.
 */

export const LEAD_PIPELINE = ['NEW', 'CONTACTED', 'TRIAL_BOOKED', 'VISITED'] as const;
export const LEAD_TERMINAL = ['CONVERTED', 'LOST'] as const;

export type LeadPipelineStatus = (typeof LEAD_PIPELINE)[number];
export type LeadTerminalStatus = (typeof LEAD_TERMINAL)[number];
export type LeadStatus = LeadPipelineStatus | LeadTerminalStatus;

export interface LeadForUpdate {
  readonly id: string;
  readonly gymId: string;
  readonly status: LeadStatus;
  readonly notes: string | null;
}

export interface LeadUpdate {
  readonly status: LeadStatus;
  readonly notes: string | null;
  /** When to call back, or `null` to leave it to the follow-up job (BR-7 NEW_LEAD). */
  readonly followUpAt: Date | null;
  readonly convertedMemberId: string | null;
}

export interface LeadPipelineStore {
  loadLead(gymId: string, leadId: string): Promise<LeadForUpdate | null>;
  updateLead(leadId: string, update: LeadUpdate): Promise<void>;
}

export interface LeadPipelineUnitOfWork {
  transaction<T>(work: (store: LeadPipelineStore) => Promise<T>): Promise<T>;
}

function isTerminal(status: LeadStatus): status is LeadTerminalStatus {
  return (LEAD_TERMINAL as readonly string[]).includes(status);
}

export async function advanceLead(
  input: {
    readonly leadId: string;
    readonly to: LeadStatus;
    readonly note?: string;
    readonly followUpAt?: Date;
    readonly convertedMemberId?: string;
  },
  deps: { readonly actor: CrmActor; readonly clock: Clock; readonly uow: LeadPipelineUnitOfWork },
): Promise<{ readonly leadId: string; readonly status: LeadStatus }> {
  const now = deps.clock.now();
  // Enquiries are member work: the same people who may edit a member may work them.
  assertCan(deps.actor, 'member.edit', now);

  return deps.uow.transaction(async (store) => {
    const lead = await store.loadLead(deps.actor.gymId, input.leadId);
    if (lead === null) throw new DomainError('NOT_FOUND', 'No such enquiry');

    if (isTerminal(lead.status)) {
      throw new DomainError('CONFLICT', 'This enquiry is already closed', { status: lead.status });
    }
    if (!isTerminal(input.to)) {
      const from = LEAD_PIPELINE.indexOf(lead.status);
      if (LEAD_PIPELINE.indexOf(input.to) <= from) {
        throw new DomainError('CONFLICT', 'An enquiry does not go backwards', { from: lead.status, to: input.to });
      }
    }

    const note = input.note?.trim() ?? '';
    await store.updateLead(lead.id, {
      status: input.to,
      notes: note === '' ? lead.notes : appendNote(lead.notes, `${toISTDate(now)}: ${note}`),
      followUpAt: input.followUpAt ?? null,
      convertedMemberId: input.convertedMemberId ?? null,
    });

    return { leadId: lead.id, status: input.to };
  });
}
