'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { CrmIcon } from '@/components/crm/crm-icons';
import { MemberDataSection } from '@/components/crm/member-data';
import type { EraseResult, UnlockResult } from '@/lib/settings-types';

/**
 * The member profile's own actions, top right (ADR-086).
 *
 * Call, WhatsApp and Take Fees are the three things staff do all day, so they stay as big
 * buttons on the card. Editing details, exporting a member's data and erasing them are
 * occasional and, in two cases, irreversible — they belong behind one menu in the corner,
 * not as a wall of buttons under the profile where "Erase" sat next to "Take fees".
 *
 * Export and erasure keep the panel that already works, PIN gate and all; the menu only
 * decides when it is on screen.
 */
export function MemberActionsMenu({
  memberId,
  memberName,
  mayEdit,
  mayManageData,
  exportReady,
  unlock,
  erase,
}: {
  readonly memberId: string;
  readonly memberName: string;
  readonly mayEdit: boolean;
  readonly mayManageData: boolean;
  readonly exportReady: boolean;
  readonly unlock: (pin: string) => Promise<UnlockResult>;
  readonly erase: (memberId: string, reason: string, pin: string) => Promise<EraseResult>;
}) {
  const t = useTranslations('crm.profile');
  const [open, setOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const menu = useRef<HTMLDivElement | null>(null);

  // A menu at a desk must close when the next person taps anywhere else.
  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => {
      if (menu.current !== null && !menu.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (!mayEdit && !mayManageData) return null;

  const item = 'flex min-h-14 w-full items-center gap-3 px-4 text-left text-crm-body font-semibold text-brand-obsidian hover:bg-brand-paper';

  return (
    <div ref={menu} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('actions')}
        onClick={() => setOpen((was) => !was)}
        className="flex size-12 items-center justify-center rounded-full text-brand-paper hover:bg-brand-white/10"
      >
        <CrmIcon name="more" className="size-6" />
      </button>

      {open ? (
        <div role="menu" className="absolute end-0 top-14 z-30 w-60 overflow-hidden rounded-panel bg-white py-1 shadow-[0_18px_40px_-12px_rgb(11_11_12/0.45)]">
          {mayEdit ? (
            <Link role="menuitem" href={`/crm/members/${memberId}/edit`} className={item} onClick={() => setOpen(false)}>
              <CrmIcon name="settings" className="size-5 shrink-0 text-brand-stone" />
              {t('edit')}
            </Link>
          ) : null}
          {mayManageData ? (
            <button
              role="menuitem"
              type="button"
              className={item}
              onClick={() => {
                setOpen(false);
                setDataOpen(true);
              }}
            >
              <CrmIcon name="import" className="size-5 shrink-0 text-brand-stone" />
              {t('dataAndPrivacy')}
            </button>
          ) : null}
        </div>
      ) : null}

      <Dialog open={dataOpen} onOpenChange={setDataOpen}>
        <DialogContent className="max-w-xl">
          <DialogTitle className="text-crm-body font-bold text-brand-obsidian">{memberName}</DialogTitle>
          <MemberDataSection memberId={memberId} memberName={memberName} exportReady={exportReady} unlock={unlock} erase={erase} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
