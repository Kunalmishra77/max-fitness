import { getTranslations } from 'next-intl/server';

/**
 * What Max Register shows while a screen's data arrives (U-1 / Phase 8).
 *
 * Every CRM route is `force-dynamic` and reads Supabase from Mumbai, so a tap on the
 * bottom bar used to leave the previous screen on the phone with nothing moving —
 * indistinguishable, at a busy desk, from a tap that did not register. People tap again.
 *
 * A skeleton of the shape that is coming rather than a spinner: the header strip, then
 * card rows, which is what every list screen in here looks like. It is announced once for
 * a screen reader and hidden from it after that, because the cards themselves are
 * decoration.
 */
export default async function CrmAppLoading() {
  const t = await getTranslations('errors.loading');

  return (
    <div className="animate-pulse p-4">
      <p role="status" className="sr-only">
        {t('label')}
      </p>
      <div aria-hidden>
        <div className="h-7 w-2/5 rounded bg-brand-stone/20" />
        <div className="mt-2 h-4 w-1/4 rounded bg-brand-stone/15" />
        <div className="mt-6 grid gap-3">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-center gap-3 rounded-panel border border-brand-stone/15 bg-white p-4">
              <div className="size-14 shrink-0 rounded-full bg-brand-stone/20" />
              <div className="min-w-0 flex-1">
                <div className="h-4 w-1/3 rounded bg-brand-stone/20" />
                <div className="mt-2 h-3 w-1/4 rounded bg-brand-stone/15" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
