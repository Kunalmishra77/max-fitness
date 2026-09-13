'use client';

import { useTranslations } from 'next-intl';
import type { MouseEvent } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/cn';
import { CloseIcon, PhoneIcon } from './icons';
import type { NavSection } from './site-nav';

/**
 * The phone menu sheet, loaded only when the menu button is pressed (ADR-033). A Radix
 * dialog: focus is trapped, Escape closes, and focus returns to the menu button.
 */
export function MobileMenu({
  sections,
  hrefFor,
  onHome,
  telHref,
  phoneDisplay,
  onClose,
  onNavigate,
  onCloseAutoFocus,
}: {
  sections: readonly NavSection[];
  hrefFor: (id: NavSection) => string;
  onHome: boolean;
  telHref: string;
  phoneDisplay: string;
  onClose: () => void;
  /** On the home page: close the sheet, then scroll to the section. */
  onNavigate: (id: NavSection) => void;
  onCloseAutoFocus: () => void;
}) {
  const t = useTranslations('nav');

  const onLink = (event: MouseEvent<HTMLAnchorElement>, id: NavSection) => {
    if (!onHome) return;
    // Scrolling while the sheet still holds the scroll lock does nothing.
    event.preventDefault();
    onNavigate(id);
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        aria-describedby={undefined}
        className="bg-brand-plate-navy text-brand-chalk"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseAutoFocus();
        }}
      >
        <div className="flex items-center justify-between">
          <SheetTitle className="text-title font-semibold">{t('menu')}</SheetTitle>
          <SheetClose aria-label={t('closeMenu')} className="inline-flex size-11 items-center justify-center rounded-button text-[1.5rem]">
            <CloseIcon />
          </SheetClose>
        </div>
        <nav aria-label={t('primary')}>
          <ul className="mt-2 grid">
            {sections.map((id) => (
              <li key={id} className="border-b border-brand-chalk/10">
                <a href={hrefFor(id)} onClick={(event) => onLink(event, id)} className="flex min-h-14 items-center text-body-l font-medium">
                  {t(id)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <a
          href={telHref}
          data-track="call_click"
          data-track-source="menu"
          className={cn(buttonVariants({ variant: 'outlineLight', full: true }), 'mt-6')}
        >
          <PhoneIcon />
          {t('call', { phone: phoneDisplay })}
        </a>
      </SheetContent>
    </Sheet>
  );
}
