import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';

/**
 * Social share image (content strategy §3). Brand colours and the wordmark only — no
 * photo until the shoot. English for both locales: the image renderer's built-in font
 * has no Devanagari glyphs, and a card of empty boxes would be worse than English.
 */

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export async function generateImageMetadata() {
  const t = await getTranslations({ locale: 'en', namespace: 'meta' });
  return [{ id: 'default', alt: t('title'), size, contentType }];
}

export default async function OpenGraphImage() {
  const t = await getTranslations({ locale: 'en', namespace: 'meta' });
  const [, tagline = t('title')] = t('title').split(' | ');

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#14213D',
          color: '#F2F3EF',
          padding: '72px 80px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 132, fontWeight: 700, color: '#D62828', lineHeight: 1 }}>MAX</div>
          <div style={{ fontSize: 40, letterSpacing: 10 }}>FITNESS GYM</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.05, maxWidth: 900 }}>{tagline}</div>
          <div style={{ display: 'flex', marginTop: 28, height: 6, width: 140, background: '#E3A92B' }} />
        </div>
      </div>
    ),
    size,
  );
}
