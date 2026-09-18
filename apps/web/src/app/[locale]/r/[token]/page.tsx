import type { Metadata } from 'next';
import { amountInWordsINR, verifyToken } from '@mfp/core';
import { PrismaReceiptReader, type ReceiptView } from '@mfp/db';
import { formatINR, type ISTDate } from '@mfp/shared';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PrintButton } from '@/components/receipt/print-button';
import { buttonVariants } from '@/components/ui/button';
import type { Locale } from '@/i18n/routing';
import { getContainer } from '@/lib/container';
import { formatISTDate, formatISTDateTime } from '@mfp/shared/time';
import { SITE_FALLBACK, whatsappHref } from '@/lib/site';

/**
 * `/r/{token}` — a member's receipt (signup-and-payment-flow.md §7).
 *
 * The link is a signed `receipt` token naming the payment; it goes out on WhatsApp and
 * with the confirmation page. The page is private: never indexed, never cached, and it
 * sends no referrer, so the token does not leak to a site the member clicks through to.
 * An invalid or expired link shows the same message as a missing receipt.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'receipt' });
  return { title: t('metaTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

async function loadReceipt(token: string): Promise<ReceiptView | null> {
  try {
    const { env, clock, prisma } = getContainer();
    const verified = verifyToken({ token, purpose: 'receipt', secret: env.LINK_TOKEN_SECRET, clock });
    if (!verified.valid) return null;
    return await new PrismaReceiptReader(prisma).receipt(verified.subject);
  } catch (error) {
    console.error(`[receipt] failed to load: ${error instanceof Error ? error.name : 'Error'}`);
    return null;
  }
}

const rupees = (paise: number) => formatINR(paise);

export default async function ReceiptPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = (await params) as { locale: Locale; token: string };
  setRequestLocale(locale);
  const t = await getTranslations('receipt');
  const receipt = await loadReceipt(token);

  if (receipt === null) {
    return (
      <main id="main" className="mx-auto grid max-w-xl gap-6 px-5 py-16">
        <h1 className="font-display text-display-m font-bold text-brand-obsidian">{t('title')}</h1>
        <p role="alert" className="text-body-l leading-body">
          {t('expired')}
        </p>
        <a href={whatsappHref(SITE_FALLBACK.phone, '')} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'primary' })}>
          {t('whatsapp')}
        </a>
      </main>
    );
  }

  const { gym, member, membership } = receipt;
  const months = membership?.durationMonths ?? null;
  const planName = months === null ? null : months === 1 ? t('monthly') : t('months', { count: months });

  const rows: Array<readonly [string, string]> = [
    [t('receiptNo'), receipt.receiptNo],
    [t('date'), formatISTDateTime(receipt.paidAt, locale)],
    [t('member'), member.fullName],
  ];
  if (member.memberCode !== null) rows.push([t('memberCode'), member.memberCode]);
  if (planName !== null && membership !== null && membership.startDate !== null) {
    rows.push([
      t('plan'),
      t('period', {
        plan: planName,
        start: formatISTDate(membership.startDate as ISTDate, locale),
        end: formatISTDate(membership.endDate as ISTDate, locale),
      }),
    ]);
  }
  rows.push([t('method'), t(`methods.${receipt.method}`)]);

  return (
    <main id="main" className="mx-auto max-w-2xl px-5 py-10 print:max-w-none print:p-0">
      <article className="rounded-panel border border-brand-stone/30 bg-brand-white p-6 md:p-10 print:border-0">
        <header className="border-b border-brand-stone/30 pb-5">
          <p className="font-display text-title font-bold text-brand-obsidian">{gym.name}</p>
          <p className="mt-1 text-small leading-body text-brand-ink/80">
            {gym.addressLine}, {gym.city}, {gym.state} {gym.pincode} · {gym.phone}
          </p>
          <h1 className="mt-5 font-display text-display-m font-bold text-brand-obsidian">{t('title')}</h1>
        </header>

        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-body">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-brand-stone">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>

        <dl className="mt-6 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 border-t border-brand-stone/30 pt-5 text-body">
          {membership === null ? null : (
            <>
              <dt>{t('planLine')}</dt>
              <dd className="text-right">{rupees(membership.pricePaise)}</dd>
              {membership.admissionPaise > 0 ? (
                <>
                  <dt>{t('admissionLine')}</dt>
                  <dd className="text-right">{rupees(membership.admissionPaise)}</dd>
                </>
              ) : null}
            </>
          )}
          <dt className="border-t border-brand-stone/30 pt-2 font-semibold">{t('total')}</dt>
          <dd className="border-t border-brand-stone/30 pt-2 text-right font-display text-title font-bold text-brand-obsidian">
            {rupees(receipt.amountPaise)}
          </dd>
        </dl>
        <p className="mt-3 text-small text-brand-ink/80">
          {t('inWords')}: {amountInWordsINR(receipt.amountPaise)}
        </p>
        <p className="mt-6 text-small text-brand-stone">{t('computerGenerated')}</p>
      </article>

      <div className="mt-6 flex flex-wrap gap-3 print:hidden">
        {receipt.receiptPdfKey === null ? (
          <p className="w-full text-body text-brand-ink/80">{t('pdfPending')}</p>
        ) : (
          <a href={`/api/v1/receipts/${encodeURIComponent(token)}/pdf`} className={buttonVariants({ variant: 'primary' })}>
            {t('download')}
          </a>
        )}
        <PrintButton label={t('print')} />
      </div>
    </main>
  );
}
