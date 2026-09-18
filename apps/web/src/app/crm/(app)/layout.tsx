import { getLocale, getTranslations } from 'next-intl/server';
import { Suspense, type ReactNode } from 'react';
import { setCrmLanguageAction } from '@/app/crm/actions';
import { CrmSidebar, type SidebarGroup } from '@/components/crm/crm-sidebar';
import { getContainer } from '@/lib/container';
import { requireCrmContext, verificationDeps } from '@/lib/crm';
import { crmNavItems, type CrmNavItem } from '@/lib/crm-nav';
import { can } from '@mfp/core';

/**
 * Everything behind the login (crm-ux-blueprint §2; ADR-062).
 *
 * Resolving the session here means no CRM screen can render without an actor. On a phone
 * each screen brings its own top bar and the bottom tab bar; from `lg` the sidebar holds
 * the menu and the content gets the width of a computer screen.
 */

export const dynamic = 'force-dynamic';

const GROUP_ORDER: ReadonlyArray<CrmNavItem['group']> = ['today', 'people', 'business', 'account'];

export default async function CrmAppLayout({ children }: { children: ReactNode }) {
  const { actor, gym } = await requireCrmContext();
  const t = await getTranslations('crm');
  const locale = (await getLocale()) === 'en' ? 'en' : 'hi';
  const now = getContainer().clock.now();
  const waiting = can(actor, 'verification.approve', now) ? await verificationDeps().queue.count(gym.id) : 0;
  const items = crmNavItems(actor, now, waiting);

  const groups: SidebarGroup[] = GROUP_ORDER.map((group) => ({
    title: t(`menu.groups.${group}`),
    items: items.filter((item) => item.group === group).map((item) => ({ ...item, label: t(`menu.${item.key}.label`) })),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="min-h-dvh">
      {/* useSearchParams needs a boundary; the sidebar has no loading state worth showing. */}
      <Suspense fallback={null}>
        <CrmSidebar
          appName={t('appName')}
          groups={groups}
          name={actor.name}
          role={t(`staff.${actor.role}`)}
          signedInAs={t('shell.signedInAs')}
          logoutLabel={t('shell.logout')}
          language={locale}
          changeLanguage={setCrmLanguageAction}
        />
      </Suspense>
      <div className="min-w-0 pb-24 lg:pb-12 lg:pl-72">
        <main className="mx-auto max-w-xl lg:max-w-6xl lg:px-8 lg:pt-8">{children}</main>
      </div>
    </div>
  );
}
