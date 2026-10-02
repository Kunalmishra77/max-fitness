import { can, mayAfterPinEntry, type CrmActor } from '@mfp/core';
import type { CrmIconName } from '@/components/crm/crm-icons';

/**
 * Every place in Max Register, in one list (ADR-062).
 *
 * The desktop sidebar and the phone's "More" screen both read it, so they never disagree,
 * and each item appears only to whoever may use it — the same rules the screens enforce
 * (the screens still check; this only keeps dead ends out of the menu). Labels and the
 * one-line explanations live in `crm.menu.<key>` in both languages.
 */

export type CrmNavKey =
  | 'home'
  | 'members'
  | 'fees'
  | 'attendance'
  | 'calls'
  | 'messages'
  | 'leads'
  | 'diet'
  | 'announce'
  | 'reports'
  | 'import'
  | 'staff'
  | 'settings'
  | 'pin';

export interface CrmNavItem {
  readonly key: CrmNavKey;
  readonly href: string;
  readonly icon: CrmIconName;
  readonly group: 'today' | 'people' | 'business' | 'account';
  readonly badge?: number;
}

export function crmNavItems(actor: CrmActor, now: Date): CrmNavItem[] {
  const may = (capability: Parameters<typeof can>[1]) => can(actor, capability, now);
  // Settings, staff and the import ask for the PIN on the way in; show them to whoever it would admit.
  const afterPin = (capability: Parameters<typeof mayAfterPinEntry>[1]) => mayAfterPinEntry(actor, capability, now);

  const items: Array<CrmNavItem | false> = [
    { key: 'home', href: '/crm', icon: 'home', group: 'today' },
    { key: 'members', href: '/crm/members', icon: 'members', group: 'people' },
    { key: 'fees', href: '/crm/members?fee=EXPIRED', icon: 'fees', group: 'people' },
    { key: 'attendance', href: '/crm/attendance', icon: 'attendance', group: 'today' },
    { key: 'calls', href: '/crm/calls', icon: 'calls', group: 'today' },
    { key: 'leads', href: '/crm/leads', icon: 'leads', group: 'people' },
    { key: 'messages', href: '/crm/messages', icon: 'whatsapp', group: 'business' },
    // A diet plan is the floor's job, so a trainer sees it too (ADR-089).
    may('diet.manage') && { key: 'diet', href: '/crm/diet', icon: 'diet', group: 'people' },
    // "Check QR members" was its own menu entry, which made QR arrivals feel like a
    // separate kind of person. They are members; the Members screen says how many are
    // waiting and opens the queue (ADR-086). `/crm/verify` still exists.
    // One message to every member is the owner's, and needs the PIN on the way in (ADR-079).
    afterPin('settings.manage') && { key: 'announce', href: '/crm/announcements', icon: 'whatsapp', group: 'business' },
    may('money.view') && { key: 'reports', href: '/crm/reports', icon: 'reports', group: 'business' },
    afterPin('member.import') && { key: 'import', href: '/crm/import', icon: 'import', group: 'business' },
    afterPin('settings.manage') && { key: 'staff', href: '/crm/settings/staff', icon: 'staff', group: 'business' },
    afterPin('settings.manage') && { key: 'settings', href: '/crm/settings', icon: 'settings', group: 'business' },
    { key: 'pin', href: '/crm/more/pin', icon: 'pin', group: 'account' },
  ];
  return items.filter((item): item is CrmNavItem => item !== false);
}
