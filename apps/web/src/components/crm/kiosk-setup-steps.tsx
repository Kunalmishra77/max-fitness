'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * How to put the attendance screen on a phone (owner, 2026-10-07).
 *
 * The owner asked for this after having to be told the address in a conversation: the page
 * generated a six-digit code and never said **where to type it**. A code with no address is
 * half an instruction, and the person reading it is usually standing at the desk with the
 * phone already in their hand.
 *
 * So the address comes first, in a size that can be read off one screen and typed into
 * another, with a copy button for when the two are the same person's two devices. Then the
 * three steps, in the order they happen. Removing the phone later is the button already on
 * the card below, and the last step says so, because "can I undo this?" is the question
 * anybody pairing a device to their member list is entitled to ask first.
 */
export function KioskSetupSteps({ url }: { url: string }) {
  const t = useTranslations('crm.kiosk.setup');
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      // No clipboard (an old browser, an insecure origin): the address is on screen anyway,
      // which is what it is there for.
      .catch(() => undefined);
  };

  return (
    <section className="rounded-panel border border-brand-stone/15 bg-white p-4 lg:p-6">
      <h2 className="text-crm-body font-bold text-brand-obsidian">{t('title')}</h2>

      <p className="mt-3 text-small text-brand-stone">{t('openThis')}</p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        {/* `break-all`: the address has to survive a 360px phone without taking the page
            sideways with it. */}
        <code className="min-w-0 flex-1 rounded-input border border-brand-stone/25 bg-semantic-surface-crm-alt px-3 py-3 font-display text-crm-body break-all text-brand-obsidian">
          {url}
        </code>
        <button
          type="button"
          onClick={copy}
          className="min-h-14 shrink-0 rounded-button border-2 border-brand-stone/25 px-5 text-crm-body font-semibold text-brand-obsidian"
        >
          {copied ? t('copied') : t('copy')}
        </button>
      </div>

      <ol className="mt-4 grid gap-2 text-crm-body text-brand-obsidian">
        {(['step1', 'step2', 'step3', 'step4'] as const).map((key, index) => (
          <li key={key} className="flex gap-3">
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-obsidian text-small font-bold text-brand-white"
            >
              {index + 1}
            </span>
            <span className="min-w-0">{t(key)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
