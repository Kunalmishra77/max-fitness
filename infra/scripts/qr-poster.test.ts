import { describe, expect, it } from 'vitest';
import { POSTER_SIZES, buildPosterSvg, receptionQrUrl } from './qr-poster';

/**
 * The reception QR standee (assets/reception-qr/README.md; qr-onboarding-flow §1).
 *
 * The URL never changes, so the poster never needs reprinting; the QR is black on white
 * with its quiet zone, 9 cm on A4 and at least 6 cm on the A5 counter card; a demo poster
 * says DEMO so it is never mistaken for the real one.
 */

const QR = { size: 29, modules: Array.from({ length: 29 * 29 }, (_, i) => i % 3 === 0) };

describe('receptionQrUrl', () => {
  it('builds the static poster link with its source and campaign tags', () => {
    expect(receptionQrUrl('https://maxfitness.in/', 'max-fitness-indirapuram', 'reception')).toBe(
      'https://maxfitness.in/qr?src=reception&g=max-fitness-indirapuram&utm_source=qr&utm_medium=poster',
    );
  });

  it('refuses a link that is not https, since phones warn on it', () => {
    expect(() => receptionQrUrl('http://maxfitness.in', 'g', 'reception')).toThrow('https');
  });
});

describe('buildPosterSvg', () => {
  it('draws an A4 poster in millimetres with a 9 cm code and both languages', () => {
    const svg = buildPosterSvg({ qr: QR, size: 'A4', demo: false, url: 'https://maxfitness.in/qr' });

    expect(svg).toContain(`width="${POSTER_SIZES.A4.width}mm" height="${POSTER_SIZES.A4.height}mm"`);
    expect(svg).toMatch(/<g id="qr" transform="translate\([\d.]+ [\d.]+\) scale\(([\d.]+)\)">/);
    // 29 modules + 4 quiet modules on each side = 37 modules across 90 mm.
    const scale = Number(/scale\(([\d.]+)\)/.exec(svg)?.[1]);
    expect(scale * 37).toBeCloseTo(90, 1);
    expect(svg).toContain('Scan once. Train stress-free.');
    expect(svg).toContain('एक बार स्कैन करें।');
    expect(svg).not.toContain('DEMO');
  });

  it('keeps the code at least 6 cm on the A5 card', () => {
    const svg = buildPosterSvg({ qr: QR, size: 'A5', demo: false, url: 'https://maxfitness.in/qr' });
    const scale = Number(/scale\(([\d.]+)\)/.exec(svg)?.[1]);
    expect(scale * 37).toBeGreaterThanOrEqual(60);
  });

  it('marks a demo poster across its face', () => {
    expect(buildPosterSvg({ qr: QR, size: 'A4', demo: true, url: 'https://x.vercel.app/qr' })).toContain('>DEMO<');
  });

  it('puts the gym logo at the top when one is given, and the name as text either way', () => {
    const withLogo = buildPosterSvg({ qr: QR, size: 'A4', demo: false, url: 'https://x.in/qr', logo: { dataUri: 'data:image/png;base64,AAAA', aspect: 1.03 } });
    expect(withLogo).toContain('<image href="data:image/png;base64,AAAA"');
    expect(withLogo).toContain('MAX FITNESS');
    expect(buildPosterSvg({ qr: QR, size: 'A4', demo: false, url: 'https://x.in/qr' })).not.toContain('<image');
  });

  it('escapes the printed link', () => {
    expect(buildPosterSvg({ qr: QR, size: 'A4', demo: false, url: 'https://x.in/qr?a=1&b=2' })).toContain('a=1&amp;b=2');
  });
});
