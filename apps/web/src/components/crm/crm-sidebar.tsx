'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/cn';
import type { CrmNavItem } from '@/lib/crm-nav';
import { CrmIcon } from './crm-icons';
import { LanguageSwitch } from './language-switch';
import { LogoutButton } from './logout-button';

export interface SidebarGroup {
  readonly title: string;
  readonly items: ReadonlyArray<CrmNavItem & { readonly label: string }>;
}

/** Which item a URL belongs to: the fee filter is its own place, the rest match by path. */
export function isActive(item: Pick<CrmNavItem, 'href' | 'key'>, pathname: string, fee: string | null): boolean {
  if (item.key === 'fees') return pathname === '/crm/members' && fee === 'EXPIRED';
  if (item.key === 'members') return pathname.startsWith('/crm/members') && fee !== 'EXPIRED';
  if (item.href === '/crm') return pathname === '/crm';
  if (item.key === 'settings') return pathname === '/crm/settings';
  return pathname.startsWith(item.href);
}

/**
 * Max Register's sidebar on a computer (ADR-062): the logo, every place grouped by what it
 * is for, who is signed in, the language and log out. Phones use the bottom bar instead.
 */
export function CrmSidebar({
  appName,
  groups,
  name,
  role,
  signedInAs,
  logoutLabel,
  language,
  changeLanguage,
}: {
  appName: string;
  groups: readonly SidebarGroup[];
  name: string;
  role: string;
  signedInAs: string;
  logoutLabel: string;
  language: 'hi' | 'en';
  changeLanguage: (language: string) => Promise<void>;
}) {
  const pathname = usePathname();
  const fee = useSearchParams().get('fee');

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col bg-brand-obsidian text-brand-paper lg:flex">
      <Link href="/crm" className="flex items-center gap-3 border-b border-brand-white/10 px-6 py-5">
        <img src="/brand/logo-96.webp" alt="" width={99} height={96} className="h-11 w-auto" />
        <span className="font-display text-title leading-none font-bold tracking-[0.04em] uppercase">{appName}</span>
      </Link>

      <nav aria-label={appName} className="flex-1 overflow-y-auto px-3 py-4">
        {groups.map((group) => (
          <div key={group.title} className="mb-3">
            <p className="px-3 pb-2 text-[0.7rem] font-semibold tracking-[0.22em] text-brand-mist uppercase">{group.title}</p>
            <ul className="grid gap-1">
              {group.items.map((item) => {
                const active = isActive(item, pathname, fee);
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex min-h-10 items-center gap-3 rounded-button px-3 text-body font-medium transition-colors',
                        active ? 'bg-brand-accent text-brand-white' : 'text-brand-paper/80 hover:bg-brand-white/[0.06] hover:text-brand-white',
                      )}
                    >
                      <CrmIcon name={item.icon} className="size-5 shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {item.badge === undefined ? null : (
                        <span className={cn('rounded-full px-2 py-0.5 text-small font-bold', active ? 'bg-brand-white text-brand-accent' : 'bg-brand-accent text-brand-white')}>
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="grid gap-2 border-t border-brand-white/10 px-6 py-4">
        <p className="text-small text-brand-mist">
          {signedInAs}
          <span className="block text-body font-semibold text-brand-white">{name}</span>
          <span className="text-small">{role}</span>
        </p>
        <LanguageSwitch current={language} change={changeLanguage} />
        <LogoutButton label={logoutLabel} withIcon className="-ml-3 text-brand-mist hover:text-brand-white" />
      </div>
    </aside>
  );
}
