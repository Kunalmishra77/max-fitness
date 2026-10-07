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

export function QrDoneAutopay() {
  // Read after mount: `sessionStorage` does not exist while this is rendered on the server,
  // and a guess either way would be the wrong markup to hydrate against.
  const [handover, setHandover] = useState<QrAutopayHandover | null>(null);
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

  if (handover === null) return null;
  return (
    <div className="mt-8">
      <AutopayOffer auth={{ kind: 'autopay', token: handover.token }} endDate={handover.coveredUntil} />
    </div>
  );
}
