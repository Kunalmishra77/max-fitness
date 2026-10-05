import { CALL_TASK_PRIORITY, toISTDate, todayIST, type Clock, type ISTDate } from '@mfp/shared';
import type { OutboxEventInput } from '../ports/outbox';
import type { MandateAlertRecord } from './record-mandate-charge';
import { isLiveMandate, type MandateStatus } from './mandate';

/**
 * Every `subscription.*` event other than a charge: the mandate's own state (ADR-105).
 *
 * Two of these matter more than the rest.
 *
 * **Authorisation.** Until Razorpay says the member authorised, the mandate is `CREATED` — a
 * link that was sent and may never be opened — and the reminder engine keeps chasing the fee,
 * which is correct. This is what flips that over, so the moment it stops chasing is a fact
 * from the provider and never an assumption.
 *
 * **A halt.** Razorpay gives up after repeated failures, and from that moment the gym is not
 * being paid while the member still shows as paid up. Nothing else about them looks wrong, so
 * this is the one mandate event that raises an alert, sends a message and opens a call task:
 * three ways of saying the same thing, because missing it costs a month's fee.
 */

export interface MandateForStatus {
  readonly id: string;
  readonly gymId: string;
  readonly memberId: string;
  readonly status: MandateStatus;
  readonly authorisedAt: Date | null;
}

/** Only the fields that change. Anything absent is left as it is. */
export interface MandateStatusPatch {
  readonly status: MandateStatus;
  readonly authorisedAt?: Date;
  readonly nextChargeOn?: ISTDate | null;
  readonly haltedAt?: Date;
  readonly cancelledAt?: Date;
  readonly failureReason?: string | null;
}

export interface MandateStatusStore {
  lockMandateBySubscriptionId(providerSubscriptionId: string): Promise<MandateForStatus | null>;
  patchMandate(mandateId: string, patch: MandateStatusPatch): Promise<void>;
  createAlert(alert: MandateAlertRecord): Promise<void>;
  /**
   * At most one OPEN task per member and reason, enforced by a partial unique index
   * (database-design.md §3) — a second halt while the first call is outstanding must not
   * give the desk the same member twice.
   */
  openCallTask(task: MandateCallTask): Promise<void>;
  enqueueOutbox(event: OutboxEventInput): Promise<void>;
}

export interface MandateCallTask {
  readonly memberId: string;
  readonly reason: 'DUE_SOON_NO_RESPONSE';
  readonly priority: number;
  /** Today. The fee is already not being collected, so the call is not for next week. */
  readonly dueDate: ISTDate;
}

export interface MandateStatusUnitOfWork {
  transaction<T>(work: (store: MandateStatusStore) => Promise<T>): Promise<T>;
}

export interface MandateStatusInput {
  readonly providerSubscriptionId: string;
  readonly status: MandateStatus;
  readonly nextChargeAt: Date | null;
  /** Razorpay's reason, as given. Never a card number or a VPA (CLAUDE.md §2.8). */
  readonly failureReason: string | null;
}

export type MandateStatusResult =
  | { readonly outcome: 'UPDATED'; readonly mandateId: string; readonly status: MandateStatus }
  | { readonly outcome: 'UNCHANGED'; readonly mandateId: string; readonly status: MandateStatus }
  | { readonly outcome: 'UNKNOWN_MANDATE' };

/**
 * A mandate in one of these is finished, and no later event makes it live again.
 *
 * Razorpay can deliver out of order, and a `subscription.pending` arriving after a member
 * cancelled would otherwise make them look like they are still paying — which is exactly the
 * mistake that stops the gym chasing a fee that is never coming.
 */
const SETTLED: ReadonlySet<MandateStatus> = new Set<MandateStatus>(['CANCELLED', 'COMPLETED', 'EXPIRED']);

export function updateMandateStatus(
  input: MandateStatusInput,
  deps: { clock: Clock; uow: MandateStatusUnitOfWork },
): Promise<MandateStatusResult> {
  return deps.uow.transaction(async (store) => {
    const mandate = await store.lockMandateBySubscriptionId(input.providerSubscriptionId);
    if (mandate === null) {
      return { outcome: 'UNKNOWN_MANDATE' };
    }
    if (input.status === mandate.status) {
      return { outcome: 'UNCHANGED', mandateId: mandate.id, status: mandate.status };
    }
    // Settled stays settled, unless the provider is settling it a different way.
    if (SETTLED.has(mandate.status) && !SETTLED.has(input.status)) {
      return { outcome: 'UNCHANGED', mandateId: mandate.id, status: mandate.status };
    }

    const now = deps.clock.now();
    const patch: MandateStatusPatch = {
      status: input.status,
      // First time it goes live, and only then: a later `active` must not move the date the
      // member actually signed.
      ...(mandate.authorisedAt === null && isLiveMandate(input.status) ? { authorisedAt: now } : {}),
      ...(input.nextChargeAt === null ? {} : { nextChargeOn: toISTDate(input.nextChargeAt) }),
      ...(input.status === 'HALTED' ? { haltedAt: now, failureReason: input.failureReason } : {}),
      ...(input.status === 'CANCELLED' ? { cancelledAt: now } : {}),
    };
    await store.patchMandate(mandate.id, patch);

    if (input.status === 'HALTED') {
      await store.createAlert({
        gymId: mandate.gymId,
        type: 'SYSTEM',
        memberId: mandate.memberId,
        title: 'crm.alerts.autopayHalted',
        params: { mandateId: mandate.id, reason: input.failureReason ?? '' },
      });
      await store.enqueueOutbox({
        type: 'whatsapp.mandate_halted',
        gymId: mandate.gymId,
        payload: { mandateId: mandate.id, memberId: mandate.memberId },
        dedupeKey: `mandate-halted:${mandate.id}`,
      });
      // A message may not be read, and the fee is already not being collected.
      await store.openCallTask({
        memberId: mandate.memberId,
        reason: 'DUE_SOON_NO_RESPONSE',
        priority: CALL_TASK_PRIORITY['DUE_SOON_NO_RESPONSE'],
        dueDate: todayIST(deps.clock),
      });
    }

    if (input.status === 'CANCELLED') {
      // Not an alert. A member cancelling from their own UPI app is a normal thing to do;
      // they simply pay at the counter again, and the message tells them so.
      await store.enqueueOutbox({
        type: 'whatsapp.mandate_cancelled',
        gymId: mandate.gymId,
        payload: { mandateId: mandate.id, memberId: mandate.memberId },
        dedupeKey: `mandate-cancelled:${mandate.id}`,
      });
    }

    return { outcome: 'UPDATED', mandateId: mandate.id, status: input.status };
  });
}
