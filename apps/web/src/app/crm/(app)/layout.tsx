import { getLocale, getTranslations } from 'next-intl/server';
import { Suspense, type ReactNode } from 'react';
import { setCrmLanguageAction } from '@/app/crm/actions';
import { CrmSidebar, type SidebarGroup } from '@/components/crm/crm-sidebar';
import { getContainer } from '@/lib/container';
import { requireCrmContext } from '@/lib/crm';
import { crmNavItems, type CrmNavItem } from '@/lib/crm-nav';

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
  const { actor } = await requireCrmContext();
  const t = await getTranslations('crm');
  const locale = (await getLocale()) === 'en' ? 'en' : 'hi';
  const now = getContainer().clock.now();
  const items = crmNavItems(actor, now);

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
        {/**
         * Width (ADR-130).
         *
         * This was `max-w-xl` — 576px — below `lg`, which does nothing on a phone and
         * strands a 1024px laptop window in a narrow column with empty space either side.
         * The owner saw it on every screen and asked why.
         *
         * It is still bounded, because a register read edge to edge on a wide monitor is
         * a row of names an arm's length from the fees they belong to. 1536px is about
         * where a members table stops gaining from more room, and the three-pane inbox
         * sits in it exactly.
         */}
        <main className="mx-auto w-full max-w-4xl px-0 lg:max-w-[96rem] lg:px-8 lg:pt-8">{children}</main>
      </div>
    </div>
  );
}
