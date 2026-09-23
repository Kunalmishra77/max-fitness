import { formatINR, maskMobile, type ISTDate, type Language } from '@mfp/shared';
import type { TransactionalMessage } from './transactional';

/**
 * What the gym tells its owner (whatsapp-automation-engine §8).
 *
 * Two kinds of message, with opposite tempos. The digest arrives once, at 08:30,
 * and is the only WhatsApp the owner needs on a quiet day. An alert arrives the
 * moment something wants a decision — someone walked in with an overdue fee, an
 * enquiry came off the website — and is therefore rationed: more than three in one
 * burst become a single message, so a busy Monday does not buzz the phone eleven
 * times.
 *
 * Every sentence here is built by us from database rows. Nothing a member typed
 * ever reaches the owner's WhatsApp as free text, and a mobile number is masked
 * even on its way to the owner — the number to call is in Max Register.
 */

export interface OwnerDigestCounts {
  readonly endingToday: number;
  readonly overdue: number;
  readonly dueThisWeek: number;
  readonly callsToday: number;
  readonly birthdays: number;
  readonly collectedYesterdayPaise: number;
}

export function buildOwnerDigest(input: {
  ownerId: string;
  firstName: string;
  language: Language;
  today: ISTDate;
  counts: OwnerDigestCounts;
}): TransactionalMessage {
  return {
    templateName: 'mf_owner_daily_digest',
    language: input.language,
    // One digest per owner per day, however many times the 08:30 job is retried.
    idempotencyKey: `digest:${input.ownerId}:${input.today}`,
    purpose: 'OWNER_DIGEST',
    variables: {
      ownerName: input.firstName,
      endingToday: String(input.counts.endingToday),
      overdue: String(input.counts.overdue),
      dueThisWeek: String(input.counts.dueThisWeek),
      callsToday: String(input.counts.callsToday),
      birthdays: String(input.counts.birthdays),
      collectedYesterday: formatINR(input.counts.collectedYesterdayPaise, { showPaise: false }),
    },
  };
}

/** The things worth interrupting the owner for, each with exactly the facts its sentence needs. */
export type OwnerAlert =
  | { readonly kind: 'EXPIRED_MEMBER_VISIT'; readonly memberName: string; readonly daysOverdue: number }
  | { readonly kind: 'ONLINE_PAYMENT'; readonly memberName: string; readonly amountPaise: number }
  | { readonly kind: 'NEW_LEAD'; readonly name: string; readonly goal: string | null; readonly mobile: string }
  | { readonly kind: 'MEMBER_UNSUBSCRIBED'; readonly memberName: string }
  | { readonly kind: 'VERIFICATION_PENDING'; readonly memberName: string; readonly referenceCode: string }
  | { readonly kind: 'PAYMENT_AMOUNT_MISMATCH'; readonly memberName: string; readonly expectedPaise: number; readonly receivedPaise: number }
  | { readonly kind: 'WHATSAPP_QUALITY' }
  | { readonly kind: 'WHATSAPP_FAILURE'; readonly slot: string; readonly failed: number; readonly planned: number }
  | { readonly kind: 'KIOSK_OFFLINE'; readonly deviceName: string; readonly minutesOffline: number };

const rupees = (paise: number) => formatINR(paise, { showPaise: false });

/**
 * One alert, one sentence, no line breaks.
 *
 * The no-line-breaks part is not style: a WhatsApp template variable is rejected if
 * it contains a newline or a tab, and the whole alert body is one variable.
 */
export function alertSentence(alert: OwnerAlert, language: Language): string {
  const hi = language === 'hi';

  switch (alert.kind) {
    case 'EXPIRED_MEMBER_VISIT':
      return hi
        ? `${alert.memberName} अभी जिम आए, फीस ${alert.daysOverdue} दिन से बाकी है।`
        : `${alert.memberName} just came in; their fee is ${alert.daysOverdue} days overdue.`;

    case 'ONLINE_PAYMENT':
      return hi
        ? `${alert.memberName} ने ऑनलाइन ${rupees(alert.amountPaise)} दिए।`
        : `${alert.memberName} paid ${rupees(alert.amountPaise)} online.`;

    case 'NEW_LEAD': {
      const goal = alert.goal === null || alert.goal.trim() === '' ? '' : `${alert.goal.trim()}, `;
      return hi
        ? `नई पूछताछ: ${alert.name}, ${goal}${maskMobile(alert.mobile)}।`
        : `New enquiry: ${alert.name}, ${goal}${maskMobile(alert.mobile)}.`;
    }

    case 'MEMBER_UNSUBSCRIBED':
      return hi
        ? `${alert.memberName} ने रिमाइंडर बंद करवा दिए। एक बार पूछ लीजिए कि क्यों।`
        : `${alert.memberName} has stopped their reminders. Worth asking why.`;

    case 'VERIFICATION_PENDING':
      return hi
        ? `${alert.memberName} की QR जानकारी ${alert.referenceCode} दो घंटे से जाँच के इंतज़ार में है।`
        : `${alert.memberName}'s QR details (${alert.referenceCode}) have been waiting two hours for a check.`;

    case 'PAYMENT_AMOUNT_MISMATCH':
      return hi
        ? `${alert.memberName} का पेमेंट मेल नहीं खाया: माँगे ${rupees(alert.expectedPaise)}, आए ${rupees(alert.receivedPaise)}। पैसे रोके गए हैं।`
        : `${alert.memberName}'s payment did not match: asked ${rupees(alert.expectedPaise)}, received ${rupees(alert.receivedPaise)}. It is on hold.`;

    case 'WHATSAPP_QUALITY':
      return hi
        ? 'WhatsApp ने जिम के नंबर की क्वालिटी गिरा दी है। फीस खत्म होने के बाद वाले रिमाइंडर अपने आप रोक दिए गए हैं; रसीदें चालू हैं।'
        : 'WhatsApp has downgraded the gym number. Reminders after expiry are paused automatically; receipts still go out.';

    case 'WHATSAPP_FAILURE':
      return hi
        ? `${alert.slot} वाले रिमाइंडर रोक दिए गए: ${alert.planned} में से ${alert.failed} नहीं गए।`
        : `The ${alert.slot} reminders were stopped: ${alert.failed} of ${alert.planned} did not go out.`;

    case 'KIOSK_OFFLINE':
      return hi
        ? `${alert.deviceName} वाला टैबलेट ${alert.minutesOffline} मिनट से बंद है।`
        : `The ${alert.deviceName} tablet has been offline for ${alert.minutesOffline} minutes.`;
  }
}

export interface PendingOwnerAlert {
  readonly id: string;
  readonly at: Date;
  readonly alert: OwnerAlert;
}

export interface PlannedOwnerAlert {
  readonly message: TransactionalMessage;
  /** Every alert this message speaks for; the worker marks them all as told. */
  readonly alertIds: readonly string[];
}

const DEFAULT_WINDOW_MINUTES = 5;
/** More than this many in one window, and the owner gets one message instead of many. */
const BUNDLE_ABOVE = 3;

function alertMessage(sentence: string, idempotencyKey: string, language: Language): TransactionalMessage {
  return { templateName: 'mf_owner_alert', language, idempotencyKey, purpose: 'OWNER_ALERT', variables: { sentence } };
}

/**
 * Turn the alerts nobody has told the owner about yet into the messages to send.
 *
 * The window is measured from the first alert of a cluster, not from the one
 * before it: a trickle of alerts three minutes apart is not a burst, and treating
 * it as one would keep pushing the send back for as long as the trickle lasted.
 */
export function planOwnerAlerts(input: {
  pending: readonly PendingOwnerAlert[];
  language: Language;
  windowMinutes?: number;
  /** Individual alerts already sent inside the current window; they spend the same budget. */
  alreadySentInWindow?: number;
}): PlannedOwnerAlert[] {
  const windowMs = (input.windowMinutes ?? DEFAULT_WINDOW_MINUTES) * 60_000;
  const ordered = [...input.pending].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));

  const clusters: PendingOwnerAlert[][] = [];
  for (const item of ordered) {
    const current = clusters[clusters.length - 1];
    const start = current?.[0];
    if (current === undefined || start === undefined || item.at.getTime() - start.at.getTime() > windowMs) clusters.push([item]);
    else current.push(item);
  }

  return clusters.flatMap((cluster, index): PlannedOwnerAlert[] => {
    // Only the first cluster shares a window with whatever already went out; every
    // later cluster is, by construction, a window of its own.
    const budget = index === 0 ? Math.max(0, BUNDLE_ABOVE - (input.alreadySentInWindow ?? 0)) : BUNDLE_ABOVE;

    if (cluster.length <= budget) {
      return cluster.map((item) => ({
        message: alertMessage(alertSentence(item.alert, input.language), `alert:${item.id}`, input.language),
        alertIds: [item.id],
      }));
    }

    const shown = cluster.slice(0, BUNDLE_ABOVE);
    const rest = cluster.length - shown.length;
    const head = input.language === 'hi' ? `${cluster.length} बातें आपके लिए:` : `${cluster.length} things need you:`;
    const tail = input.language === 'hi' ? ` और ${rest} और।` : ` And ${rest} more.`;
    const sentence = `${head} ${shown.map((item) => alertSentence(item.alert, input.language)).join(' ')}${rest > 0 ? tail : ''}`;

    const ids = cluster.map((item) => item.id);
    // Named by the whole cluster, so the same burst dispatched twice is one message.
    return [{ message: alertMessage(sentence, `alert-bundle:${[...ids].sort().join(',')}`, input.language), alertIds: ids }];
  });
}

export function buildBirthdayWish(input: { memberId: string; firstName: string; language: Language; today: ISTDate }): TransactionalMessage {
  return {
    templateName: 'mf_birthday_wish',
    language: input.language,
    // The year, not the date: a wish sent on 28 Feb for a 29 Feb birthday is still
    // that year's one wish (BR-8.1).
    idempotencyKey: `birthday:${input.memberId}:${input.today.slice(0, 4)}`,
    purpose: 'BIRTHDAY',
    variables: { firstName: input.firstName },
  };
}
