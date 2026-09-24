'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckInKeypad, type LookupResult, type MarkResult } from './keypad';

/**
 * The reception tablet's whole screen (BR-9.4).
 *
 * It pairs once, with the same six-digit code a kiosk uses (ADR-071), and keeps its
 * device token from then on. The pairing is not ceremony: without it a member's name
 * and photo would be available to anybody who could reach this URL and guess a
 * number, which is the same mistake the QR flow avoided with OTP (ADR-060).
 *
 * The token lives in `localStorage` because this tablet is the gym's own device,
 * standing on the desk, and it must survive the browser being closed. Losing it costs
 * one pairing; it grants nothing but this screen's two endpoints.
 */

const TOKEN_KEY = 'mfp_checkin_token';

function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    // Private window, or storage blocked: the tablet pairs again each time.
    return null;
  }
}

export function CheckInApp() {
  const t = useTranslations('checkin');
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setToken(readToken());
    setReady(true);
  }, []);

  const pair = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch('/api/v1/kiosk/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, deviceName: 'Reception tablet', appVersion: 'web-1.0.0', modelVersion: 'keypad' }),
      });
      if (!response.ok) {
        setFailed(true);
        return;
      }
      const { data } = (await response.json()) as { data: { deviceToken: string } };
      try {
        window.localStorage.setItem(TOKEN_KEY, data.deviceToken);
      } catch {
        // Unstorable: the screen still works for this session.
      }
      setToken(data.deviceToken);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      setCode('');
    }
  };

  const authorised = (path: string, body: unknown) =>
    fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token ?? ''}` },
      body: JSON.stringify(body),
    });

  const lookup = async (mobile: string): Promise<LookupResult> => {
    try {
      const response = await authorised('/api/v1/checkin/lookup', { mobile });
      // The token was revoked in Max Register: pair again rather than failing silently.
      if (response.status === 401) {
        setToken(null);
        return { ok: false };
      }
      if (!response.ok) return { ok: false };
      const { data } = (await response.json()) as { data: { candidates: LookupResult extends { ok: true; candidates: infer C } ? C : never } };
      return { ok: true, candidates: data.candidates };
    } catch {
      return { ok: false };
    }
  };

  const mark = async (memberId: string): Promise<MarkResult> => {
    try {
      const response = await authorised('/api/v1/checkin/attendance', {
        memberId,
        // One id per tap, so a slow network and an impatient second tap are one visit.
        clientEventId: crypto.randomUUID(),
        method: 'KEYPAD',
      });
      if (response.status === 401) {
        setToken(null);
        return { ok: false };
      }
      if (!response.ok) return { ok: false };
      const { data } = (await response.json()) as { data: { decision: string; greeting: MarkResult extends { ok: true; greeting: infer G } ? G : never; memberName: string | null } };
      return { ok: true, decision: data.decision, greeting: data.greeting, memberName: data.memberName };
    } catch {
      return { ok: false };
    }
  };

  // Nothing is rendered until localStorage has been read, so a paired tablet never
  // flashes the pairing screen at a member standing in front of it.
  if (!ready) return null;

  if (token === null) {
    return (
      <div className="mx-auto grid w-full max-w-sm min-w-0 gap-4">
        <div>
          <h1 className="font-display text-[1.75rem] font-bold text-brand-obsidian">{t('pairTitle')}</h1>
          <p className="mt-1 text-crm-body text-brand-stone">{t('pairHelp')}</p>
        </div>
        <label className="grid gap-1">
          <span className="text-small font-semibold text-brand-obsidian">{t('pairCode')}</span>
          {/* An input carries an intrinsic width of roughly twenty characters, which at
              this size is wider than a 320px phone; it is told to fit its box instead. */}
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="off"
            className="min-h-16 w-full min-w-0 rounded-input border-2 border-brand-stone/30 bg-white text-center font-display text-[2rem] tracking-[0.3em] tabular"
          />
        </label>
        {failed ? (
          <p role="alert" className="text-small font-semibold text-semantic-fee-expired">
            {t('pairFailed')}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void pair()}
          disabled={code.length !== 6 || busy}
          className="min-h-16 rounded-button bg-brand-accent text-crm-body font-semibold text-brand-white disabled:opacity-40"
        >
          {t('pairButton')}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-sm min-w-0 gap-6">
      <h1 className="text-center font-display text-[1.75rem] font-bold text-brand-obsidian">{t('title')}</h1>
      <CheckInKeypad lookup={lookup} mark={mark} />
    </div>
  );
}
