import { classifyInboundText, pauseOnQualitySignal, verifyToken, type ParsedWebhook, type QualityGuardStore, type RestartResult, type UnsubscribeResult } from '@mfp/core';
import type { Clock, E164Mobile } from '@mfp/shared';

/**
 * Acting on what WhatsApp sends back (whatsapp-automation-engine §7; BR-6.1).
 *
 * The member id always comes from a token we minted and signed, never from the message:
 * a payload is only as trustworthy as its signature, and a typed "STOP" is matched to a
 * member by their number instead. When a number belongs to a family, nothing is
 * unsubscribed automatically — the owner is asked, because stopping the wrong person's
 * reminders is worse than a phone call.
 *
 * One bad reply must not swallow the rest of a batch, so each item is handled on its own.
 */

export interface InboundDeps {
  readonly clock: Clock;
  readonly secret: string;
  readonly restartWindowDays: number;
  readonly unsubscribe: (memberId: string) => Promise<UnsubscribeResult>;
  readonly restart: (memberId: string) => Promise<RestartResult>;
  readonly membersOnNumber: (mobile: E164Mobile) => Promise<ReadonlyArray<{ id: string; fullName: string }>>;
  readonly updateStatus: (providerMessageId: string, status: string, at: Date, error: { code: string; message: string } | null) => Promise<void>;
  readonly alertOwner: (kind: 'SHARED_NUMBER_STOP' | 'MEMBER_REPLIED', context: Record<string, string>) => Promise<void>;
  /** §9: a quality signal from Meta pauses the post-expiry rule and tells the owner. */
  readonly qualityGuard: QualityGuardStore;
}

/** `UNSUB.<token>` / `RESTART.<token>`: the prefix says what, the token says who. */
function readPayload(value: string, secret: string, clock: Clock): { action: 'UNSUB' | 'RESTART'; memberId: string } | null {
  const [prefix, token] = value.split('.', 2);
  if (token === undefined || (prefix !== 'UNSUB' && prefix !== 'RESTART')) return null;
  const rest = value.slice(prefix.length + 1);
  const result = verifyToken({ token: rest, purpose: prefix === 'UNSUB' ? 'unsub' : 'restart', secret, clock });
  return result.valid ? { action: prefix, memberId: result.subject } : null;
}

async function handleReply(reply: ParsedWebhook['replies'][number], deps: InboundDeps): Promise<void> {
  if (reply.kind === 'PAYLOAD') {
    const parsed = readPayload(reply.value, deps.secret, deps.clock);
    // A payload we did not mint, or one whose token expired, is not an instruction.
    if (parsed === null) return;
    if (parsed.action === 'UNSUB') await deps.unsubscribe(parsed.memberId);
    else await deps.restart(parsed.memberId);
    return;
  }

  const meaning = classifyInboundText(reply.value);
  if (meaning === 'OTHER') {
    await deps.alertOwner('MEMBER_REPLIED', { from: reply.from, text: reply.value.slice(0, 120) });
    return;
  }

  const members = await deps.membersOnNumber(reply.from);
  if (members.length === 0) {
    // Someone who is not a member, or whose number changed: the owner decides.
    await deps.alertOwner('MEMBER_REPLIED', { from: reply.from, text: reply.value.slice(0, 120) });
    return;
  }
  if (members.length > 1) {
    await deps.alertOwner('SHARED_NUMBER_STOP', { from: reply.from, count: String(members.length) });
    return;
  }

  const only = members[0];
  if (only === undefined) return;
  if (meaning === 'STOP') await deps.unsubscribe(only.id);
  else await deps.restart(only.id);
}

export async function handleInboundWhatsApp(parsed: ParsedWebhook, deps: InboundDeps): Promise<void> {
  for (const status of parsed.statuses) {
    try {
      await deps.updateStatus(status.providerMessageId, status.status, status.at, status.error);
      // Meta repeats the same error for every message in a bad batch; the guard is
      // what makes that one pause and one alert rather than forty.
      if (status.error !== null) {
        await pauseOnQualitySignal({ errorCode: status.error.code, message: status.error.message }, deps.qualityGuard);
      }
    } catch (error) {
      console.error(`[whatsapp-inbound] status ${status.providerMessageId} failed: ${error instanceof Error ? error.name : 'Error'}`);
    }
  }

  for (const reply of parsed.replies) {
    try {
      await handleReply(reply, deps);
    } catch (error) {
      console.error(`[whatsapp-inbound] reply ${reply.providerMessageId} failed: ${error instanceof Error ? error.name : 'Error'}`);
    }
  }
}
