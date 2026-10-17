'use client';

/**
 * The last resort (U-1 / Phase 8).
 *
 * Next renders this when the failure is in the root layout itself, which means it
 * *replaces* the root layout — so it has to carry its own `<html>` and `<body>`. That is
 * true of every app, and doubly true here: `app/layout.tsx` deliberately renders only
 * `children`, because `<html lang>` belongs to whichever area is serving (the public site
 * takes it from the URL, Max Register from a cookie). So there is no shell to inherit.
 *
 * It cannot use `next-intl` either: the provider lives inside the layout that just failed.
 * Hence the hard-coded bilingual copy — Hindi first, like everything the owner reads. This
 * is the one screen in the application allowed to hold its strings inline, and the reason
 * is written here so nobody "fixes" it into a broken import.
 *
 * Styling is inline for the same reason: a stylesheet import is one more thing that can be
 * the thing that is broken.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
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
        <main style={{ maxWidth: '32rem', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '0.875rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#D90F1F' }}>Max Fitness Gym</p>
          <h1 style={{ margin: '0.75rem 0 0', fontSize: '1.5rem', lineHeight: 1.3 }}>कुछ गड़बड़ हो गई</h1>
          <p style={{ margin: '0.5rem 0 0', fontSize: '1rem', lineHeight: 1.6, color: '#B9B9B4' }}>
            थोड़ी देर में फिर कोशिश करें। आपका कोई डेटा नहीं खोया है।
          </p>
          <h2 style={{ margin: '1.5rem 0 0', fontSize: '1.125rem', lineHeight: 1.3 }}>Something went wrong</h2>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.9375rem', lineHeight: 1.6, color: '#B9B9B4' }}>
            Please try again in a moment. Nothing you entered has been lost.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '2rem',
              minHeight: '56px',
              padding: '0 2rem',
              fontSize: '1rem',
              fontWeight: 600,
              color: '#FFFFFF',
              background: '#D90F1F',
              border: 0,
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            फिर कोशिश करें / Try again
          </button>
        </main>
      </body>
    </html>
  );
}
