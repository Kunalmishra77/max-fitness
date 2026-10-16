import { getTranslations } from 'next-intl/server';

/**
 * The 404 for a URL that matched no route at all (U-1 / Phase 8).
 *
 * This is the boundary Next reaches when `[locale]/layout.tsx` itself calls `notFound()`
 * for an unknown locale — `/xx/plans`, a crawler guessing, an old link. The layout that
 * threw cannot also render the fallback, so the locale-level not-found never gets a turn
 * and this one does.
 *
 * It therefore carries its own `<html>` and `<body>`: the root layout renders only
 * `children`, by design, because `lang` belongs to whichever area is serving. No
 * stylesheet and no `SiteContext` either — the gym's details come from the database, and a
 * 404 must not be able to fail because the database is slow.
 *
 * No locale is resolved here, so the copy is Hindi first and then English, which is the
 * order the owner reads.
 */

export const metadata = { robots: { index: false, follow: false } };

export default async function RootNotFound() {
  // `getTranslations` with an explicit locale works outside a resolved request.
  const hi = await getTranslations({ locale: 'hi', namespace: 'errors.notFound' });
  const en = await getTranslations({ locale: 'en', namespace: 'errors.notFound' });

  return (
    <html lang="hi">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '24px',
          background: '#0A0A0B',
          color: '#F4F4F2',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <main style={{ maxWidth: '34rem', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '0.875rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#D90F1F' }}>Max Fitness Gym</p>
          <h1 style={{ margin: '0.75rem 0 0', fontSize: '1.5rem', lineHeight: 1.3 }}>{hi('title')}</h1>
          <p style={{ margin: '0.5rem 0 0', fontSize: '1rem', lineHeight: 1.6, color: '#B9B9B4' }}>{hi('body')}</p>
          <h2 style={{ margin: '1.5rem 0 0', fontSize: '1.125rem', lineHeight: 1.3 }}>{en('title')}</h2>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.9375rem', lineHeight: 1.6, color: '#B9B9B4' }}>{en('body')}</p>
          {/* A plain anchor, not next/link: this page may render with no router above it. */}
          <a
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: '2rem',
              minHeight: '56px',
              padding: '0 2rem',
              fontSize: '1rem',
              fontWeight: 600,
              color: '#FFFFFF',
              background: '#D90F1F',
              borderRadius: '6px',
              textDecoration: 'none',
            }}
          >
            {hi('home')} / {en('home')}
          </a>
        </main>
      </body>
    </html>
  );
}
