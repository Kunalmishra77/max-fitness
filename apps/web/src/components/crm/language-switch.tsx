'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { cn } from '@/lib/cn';

/**
 * हिंदी | English for Max Register (ADR-062). The choice is saved on the person's staff
 * record and in the cookie, so it follows them to the next login and every device.
 */
export function LanguageSwitch({
  current,
  change,
  tone = 'dark',
}: {
  current: 'hi' | 'en';
  change: (language: string) => Promise<void>;
  /** `dark` sits on the obsidian bars; `light` on white panels. */
  tone?: 'dark' | 'light';
}) {
  const t = useTranslations('crm.shell');
  const router = useRouter();
  const [pending, start] = useTransition();

  const pick = (language: 'hi' | 'en') => {
    if (language === current) return;
    start(async () => {
      await change(language);
      router.refresh();
    });
  };

  return (
    <div
      role="group"
      aria-label={t('language')}
      className={cn(
        'inline-flex rounded-full p-1 text-small font-semibold',
        tone === 'dark' ? 'bg-brand-white/10' : 'bg-brand-obsidian/[0.06]',
        pending && 'opacity-60',
      )}
    >
      {(
        [
          ['hi', t('hindi')],
          ['en', t('english')],
        ] as const
      ).map(([code, label]) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={current === code}
          disabled={pending}
          onClick={() => pick(code)}
          className={cn(
            'min-h-10 rounded-full px-3 transition-colors',
            current === code
              ? 'bg-brand-accent text-brand-white'
              : tone === 'dark'
                ? 'text-brand-mist hover:text-brand-white'
                : 'text-brand-stone hover:text-brand-obsidian',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
