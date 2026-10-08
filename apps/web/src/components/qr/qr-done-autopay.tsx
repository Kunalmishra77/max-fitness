'use client';

import { useEffect, useState } from 'react';
import { AutopayOffer } from '@/components/join/autopay-offer';

/**
 * The standing instruction, offered on the screen that shows the reference code (owner,
 * 2026-10-07).
 *
 * Only for a member who has just answered "online" on the form behind this. It is handed
 * over in `sessionStorage` rather than in the URL: the reference code screen is one a
 * member shows to whoever is at the desk, and a token in the address bar is a token on
 * somebody else's screen.
 *
 * Nothing is taken today, and the offer states the date of the first debit — which is the
 * day after the cover the member themselves typed in. Saying it out loud is the point: if
 * that date is wrong, this is where they will notice, and the desk is two steps away.
 */

const KEY = 'mfp.qr.autopay';

export interface QrAutopayHandover {
  readonly token: string;
  readonly coveredUntil: string;
}

/** Called by the form, just before it sends the member to the reference code screen. */
export function rememberQrAutopay(handover: QrAutopayHandover): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(handover));
  } catch {
    // A browser with storage switched off simply does not get the offer here; the desk
    // sets it up at approval and the member gets the link on WhatsApp either way.
  }
}

function readQrAutopay(): QrAutopayHandover | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { token, coveredUntil } = parsed as Record<string, unknown>;
    return typeof token === 'string' && typeof coveredUntil === 'string' ? { token, coveredUntil } : null;
  } catch {
    return null;
  }
}

export function QrDoneAutopay({ home }: { home: { href: string; label: string } }) {
  // Read after mount: `sessionStorage` does not exist while this is rendered on the server,
  // and a guess either way would be the wrong markup to hydrate against.
  const [handover, setHandover] = useState<QrAutopayHandover | null>(null);
  const [deferred, setDeferred] = useState(false);
  useEffect(() => {
    setHandover(readQrAutopay());
    // Used once. Coming back to this screen later should not re-offer something the member
    // has already set up, and the token is short-lived anyway.
    try {
      window.sessionStorage.removeItem(KEY);
    } catch {
      /* nothing to clean up */
    }
  }, []);

  /**
   * The way home is in here rather than on the page, because for a member who chose to pay
   * online it has to wait (owner, 2026-10-08). Leaving a "Home" button beside "approve your
   * automatic payment" is how the step gets skipped: it is the familiar one.
   *
   * It is hidden, not removed. The offer itself carries "I will do this at the desk", and
   * taking that shows this again.
   */
  const homeLink = (
    <a
      href={home.href}
      className="inline-flex min-h-14 items-center justify-center rounded-panel border-2 border-brand-obsidian px-6 text-body-l font-semibold text-brand-obsidian"
    >
      {home.label}
    </a>
  );

  if (handover === null) return <div className="mt-8">{homeLink}</div>;

  return (
    <div className="mt-8 grid gap-4">
      <AutopayOffer
        required
        auth={{ kind: 'autopay', token: handover.token }}
        endDate={handover.coveredUntil}
        onDeferred={() => setDeferred(true)}
      />
      {deferred ? homeLink : null}
    </div>
  );
}
