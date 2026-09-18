'use client';

import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { getPathname, Link, usePathname } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { cn } from '@/lib/cn';
import { Wordmark } from './brand';
import { MenuIcon, PhoneIcon } from './icons';

/**
 * Sticky navigation (PRD LP-01, wireframe §2).
 *
 * Desktop: wordmark, section links, phone, language, Sign up. Phones: wordmark,
 * language and a menu sheet — Sign up and Call live in the sticky bottom bar there.
 * Off the home page, section links point back to the home page's anchors.
 *
 * The menu sheet and its dialog library load only when the menu is opened (ADR-033).
 */

export type NavSection = 'about' | 'facilities' | 'plans' | 'owner' | 'reviews' | 'contact';

const MobileMenu = dynamic(() => import('./mobile-menu').then((mod) => mod.MobileMenu), { ssr: false });

export function SiteNav({
  sections,
  telHref,
  phoneDisplay,
  onHome,
}: {
  sections: readonly NavSection[];
  telHref: string;
  phoneDisplay: string;
  onHome: boolean;
}) {
  const t = useTranslations('nav');
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const otherLocale: Locale = locale === 'en' ? 'hi' : 'en';
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const pendingAnchor = useRef<NavSection | null>(null);

  const anchorHref = (id: NavSection) => (onHome ? `#${id}` : `${getPathname({ href: '/', locale })}#${id}`);

  // Runs after the sheet has unmounted and released its scroll lock.
  useEffect(() => {
    const id = pendingAnchor.current;
    if (menuOpen || id === null) return;
    pendingAnchor.current = null;
    document.getElementById(id)?.scrollIntoView();
    window.history.pushState(null, '', `#${id}`);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-40 bg-brand-obsidian text-brand-paper">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-4 focus:z-50 focus:rounded-button focus:bg-brand-paper focus:px-4 focus:py-2 focus:text-brand-obsidian"
      >
        {t('skipToContent')}
      </a>
      <div className="mx-auto flex h-16 max-w-[var(--size-content-max)] items-center gap-2 px-5 md:px-6">
        <Link href="/" aria-label={t('home')} className="shrink-0">
          <Wordmark />
        </Link>

        <nav aria-label={t('primary')} className="ml-6 hidden lg:block">
          <ul className="flex items-center">
            {sections.map((id) => (
              <li key={id}>
                <a
                  href={anchorHref(id)}
                  className="nav-link inline-flex min-h-11 items-center rounded-button px-3 text-small font-semibold tracking-[0.14em] text-brand-paper/80 uppercase hover:text-brand-white"
                >
                  {t(id)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1 md:gap-2">
          <a
            href={telHref}
            aria-label={t('call', { phone: phoneDisplay })}
            data-track="call_click"
            data-track-source="nav"
            className="hidden min-h-11 items-center gap-2 rounded-button px-2 font-display text-title font-bold whitespace-nowrap md:inline-flex"
          >
            <PhoneIcon className="text-[1rem]" />
            {phoneDisplay}
          </a>
          <Link
            href={pathname}
            locale={otherLocale}
            lang={otherLocale}
            hrefLang={otherLocale}
            className="inline-flex min-h-11 items-center rounded-button px-3 text-body font-semibold hover:bg-brand-paper/10"
          >
            {t('switchTo')}
          </Link>
          <Link
            href="/join"
            data-track="signup_started"
            data-track-source="nav"
            className={cn(buttonVariants({ variant: 'primary' }), 'hidden md:inline-flex')}
          >
            {t('signUp')}
          </Link>

          <button
            ref={menuButton}
            type="button"
            aria-label={t('menu')}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className="inline-flex size-11 items-center justify-center rounded-button text-[1.5rem] lg:hidden"
          >
            <MenuIcon />
          </button>
          {menuOpen ? (
            <MobileMenu
              sections={sections}
              hrefFor={anchorHref}
              onHome={onHome}
              telHref={telHref}
              phoneDisplay={phoneDisplay}
              onClose={() => setMenuOpen(false)}
              onNavigate={(id) => {
                pendingAnchor.current = id;
                setMenuOpen(false);
              }}
              onCloseAutoFocus={() => {
                if (pendingAnchor.current === null) menuButton.current?.focus({ preventScroll: true });
              }}
            />
          ) : null}
        </div>
      </div>
    </header>
  );
}
