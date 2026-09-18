import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { can } from '@mfp/core';
import { setCrmLanguageAction } from '@/app/crm/actions';
import { BottomNav, CrmHeader } from '@/components/crm/crm-chrome';
import { CrmIcon } from '@/components/crm/crm-icons';
import { LanguageSwitch } from '@/components/crm/language-switch';
import { LogoutButton } from '@/components/crm/logout-button';
import { getContainer } from '@/lib/container';
import { requireCrmContext, verificationDeps } from '@/lib/crm';
import { crmNavItems, type CrmNavItem } from '@/lib/crm-nav';

/**
 * "और" — every other place in Max Register (crm-ux-blueprint §2; ADR-062).
 *
 * The same list as the computer's sidebar, grouped, each with a line saying what it is
 * for, then the language and log out. Places the person may not use are not listed.
 */

export const dynamic = 'force-dynamic';

const GROUPS: ReadonlyArray<CrmNavItem['group']> = ['today', 'people', 'business', 'account'];
/** Already one tap away on the bottom bar. */
const ON_BOTTOM_BAR = new Set(['home', 'members', 'fees', 'attendance']);

export default async function CrmMorePage() {
  const { actor, gym } = await requireCrmContext();
  const t = await getTranslations('crm');
  const locale = (await getLocale()) === 'en' ? 'en' : 'hi';
  const now = getContainer().clock.now();
  const waiting = can(actor, 'verification.approve', now) ? await verificationDeps().queue.count(gym.id) : 0;
  const items = crmNavItems(actor, now, waiting).filter((item) => !ON_BOTTOM_BAR.has(item.key));

  return (
    <>
      <CrmHeader title={t('nav.more')} back="/crm" subtitle={`${actor.name} · ${t(`staff.${actor.role}`)}`} />
      <div className="grid gap-6 p-4 lg:p-0">
        {GROUPS.map((group) => {
          const inGroup = items.filter((item) => item.group === group);
          if (inGroup.length === 0) return null;
          return (
            <section key={group} aria-labelledby={`more-${group}`}>
              <h2 id={`more-${group}`} className="px-1 pb-2 text-small font-semibold tracking-[0.18em] text-brand-stone uppercase">
                {t(`menu.groups.${group}`)}
              </h2>
              <ul className="grid gap-3 lg:grid-cols-2">
                {inGroup.map((item) => (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      className="group flex min-h-20 items-center gap-4 rounded-panel border border-brand-stone/15 bg-white px-4 py-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-accent hover:shadow-md"
                    >
                      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-obsidian text-brand-white transition-colors group-hover:bg-brand-accent">
                        <CrmIcon name={item.icon} className="size-6" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-crm-body font-semibold text-brand-obsidian">
                          {t(`menu.${item.key}.label`)}
                          {item.badge === undefined ? null : (
                            <span className="rounded-full bg-brand-accent px-2 py-0.5 text-small font-bold text-brand-white">{item.badge}</span>
                          )}
                        </span>
                        <span className="block text-small text-brand-stone">{t(`menu.${item.key}.desc`)}</span>
                      </span>
                      <CrmIcon name="chevron" className="size-5 shrink-0 text-brand-stone transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <section aria-labelledby="more-language" className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-brand-stone/15 bg-white p-4 shadow-sm lg:hidden">
          <h2 id="more-language" className="flex items-center gap-2 text-crm-body font-semibold text-brand-obsidian">
            <CrmIcon name="language" className="size-5" />
            {t('shell.language')}
          </h2>
          <LanguageSwitch current={locale} change={setCrmLanguageAction} tone="light" />
        </section>

        <div className="lg:hidden">
          <LogoutButton label={t('shell.logout')} withIcon className="text-crm-body text-brand-accent-deep" />
        </div>
      </div>
      <BottomNav active="more" />
    </>
  );
}
