import { createHmac, timingSafeEqual } from 'node:crypto';
import type { E164Mobile } from '@mfp/shared';

/**
 * What arrives back from WhatsApp (whatsapp-automation-engine §7; security-plan §3.1).
 *
 * Meta posts delivery statuses, button taps and free text to one URL, batched inside
 * `entry[].changes[].value`. Two rules hold here:
 *
 * 1. Nothing is believed before the signature over the raw bytes checks out.
 * 2. Parsing keeps only what a handler acts on and never throws — an unknown shape has
 *    to be ignorable, because Meta adds fields without asking.
 */

export type InboundStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface StatusUpdate {
  readonly providerMessageId: string;
  readonly status: InboundStatus;
  readonly at: Date;
  readonly error: { readonly code: string; readonly message: string } | null;
}

export interface InboundReply {
  readonly providerMessageId: string;
  readonly from: E164Mobile;
  /** A tapped button carries a payload we minted; free text carries what they typed. */
  readonly kind: 'PAYLOAD' | 'TEXT';
  readonly value: string;
  readonly at: Date;
}

export interface ParsedWebhook {
  readonly statuses: readonly StatusUpdate[];
  readonly replies: readonly InboundReply[];
}

/** `X-Hub-Signature-256: sha256=<hex>` over the exact bytes Meta sent. */
export function verifyMetaSignature(rawBody: string, header: string, appSecret: string): boolean {
  const [scheme, provided] = header.split('=');
  if (scheme !== 'sha256' || provided === undefined || !/^[0-9a-f]+$/i.test(provided)) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(provided, 'hex');
  } catch {
    return false;
  }
  // Constant time, and only after the lengths match: `timingSafeEqual` throws otherwise.
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const STATUS_NAMES: Readonly<Record<string, InboundStatus>> = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Meta sends seconds since the epoch, as a string. */
function instant(value: unknown): Date | null {
  const seconds = Number(typeof value === 'string' || typeof value === 'number' ? value : NaN);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}

/** Meta gives the number without the `+`. */
function e164(value: unknown): E164Mobile | null {
  const digits = text(value)?.replace(/\D/g, '');
  return digits === undefined || digits === null || digits.length < 10 ? null : (`+${digits}` as E164Mobile);
}

function parseStatus(raw: unknown): StatusUpdate | null {
  const row = asRecord(raw);
  const id = text(row?.['id']);
  const status = STATUS_NAMES[text(row?.['status']) ?? ''];
  const at = instant(row?.['timestamp']);
  if (id === null || status === undefined || at === null) return null;

  const firstError = asRecord(asArray(row?.['errors'])[0]);
  // Meta sends the code as a number in some events and a string in others.
  const rawCode = firstError?.['code'];
  const code = typeof rawCode === 'number' ? String(rawCode) : text(rawCode);
  return {
    providerMessageId: id,
    status,
    at,
    error: firstError === null || code === null || code === '' ? null : { code, message: text(firstError['title']) ?? text(firstError['message']) ?? '' },
  };
}

function parseMessage(raw: unknown): InboundReply | null {
  const row = asRecord(raw);
  const id = text(row?.['id']);
  const from = e164(row?.['from']);
  const at = instant(row?.['timestamp']);
  if (id === null || from === null || at === null) return null;

  const type = text(row?.['type']);
  if (type === 'button') {
    const payload = text(asRecord(row?.['button'])?.['payload']);
    return payload === null ? null : { providerMessageId: id, from, kind: 'PAYLOAD', value: payload, at };
  }
  if (type === 'interactive') {
    const interactive = asRecord(row?.['interactive']);
    const reply = asRecord(interactive?.['button_reply']) ?? asRecord(interactive?.['list_reply']);
    const value = text(reply?.['id']);
    return value === null ? null : { providerMessageId: id, from, kind: 'PAYLOAD', value, at };
  }
  if (type === 'text') {
    const body = text(asRecord(row?.['text'])?.['body'])?.trim();
    return body === undefined || body === null || body === '' ? null : { providerMessageId: id, from, kind: 'TEXT', value: body, at };
  }
  // Images, audio, locations: nothing here acts on them.
  return null;
}

export function parseWhatsAppWebhook(body: unknown): ParsedWebhook {
  const statuses: StatusUpdate[] = [];
  const replies: InboundReply[] = [];

  for (const entry of asArray(asRecord(body)?.['entry'])) {
    for (const change of asArray(asRecord(entry)?.['changes'])) {
      const value = asRecord(asRecord(change)?.['value']);
      for (const raw of asArray(value?.['statuses'])) {
        const parsed = parseStatus(raw);
        if (parsed !== null) statuses.push(parsed);
      }
      for (const raw of asArray(value?.['messages'])) {
        const parsed = parseMessage(raw);
        if (parsed !== null) replies.push(parsed);
      }
    }
  }
  return { statuses, replies };
}

/**
 * What a member means when they type back (BR-6.1).
 *
 * Both languages, and the Latin spellings people actually use on an Indian keyboard.
 * Anything else is "other": the owner is told someone replied, and a person answers.
 */
export function classifyInboundText(message: string): 'STOP' | 'RESTART' | 'OTHER' {
  const normalised = message.trim().toLowerCase();
  if (normalised === '') return 'OTHER';
  if (/(^|\s)(stop|unsubscribe|band|बंद)(\s|$|\W)/u.test(normalised)) return 'STOP';
  if (/(^|\s)(restart|start|chalu|चालू)(\s|$|\W)/u.test(normalised)) return 'RESTART';
  return 'OTHER';
}
