import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';
import { OG_LOGO_SRC } from '@/content/og-logo.generated';

/**
 * Social share image (content strategy §3). The gym's logo on black with the tagline
 * and a red rule (ADR-061). English for both locales: the image renderer's built-in font
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
          background: '#0A0A0B',
          color: '#F4F4F5',
          padding: '72px 80px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <img src={OG_LOGO_SRC} width={206} height={200} alt="" />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1, letterSpacing: 2 }}>MAX FITNESS</div>
            <div style={{ fontSize: 30, letterSpacing: 12, color: '#C3C5C8', marginTop: 10 }}>GYM · INDIRAPURAM</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.05, maxWidth: 900 }}>{tagline}</div>
          <div style={{ display: 'flex', marginTop: 28, height: 6, width: 140, background: '#ED1021' }} />
        </div>
      </div>
    ),
    size,
  );
}
