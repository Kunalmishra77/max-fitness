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
  it('draws an A4 poster in millimetres with an 11 cm code, in English', () => {
    const svg = buildPosterSvg({ qr: QR, size: 'A4', demo: false, url: 'https://maxfitness.in/qr' });

    expect(svg).toContain(`width="${POSTER_SIZES.A4.width}mm" height="${POSTER_SIZES.A4.height}mm"`);
    expect(svg).toMatch(/<g id="qr" transform="translate\([\d.]+ [\d.]+\) scale\(([\d.]+)\)">/);
    // 29 modules + 4 quiet modules on each side = 37 modules across 110 mm. The code grew
    // from 90: it is the only thing on this sheet with a job, and a bigger one scans from
    // further away and through a worse camera — which at a gym door is every camera.
    const scale = Number(/scale\(([\d.]+)\)/.exec(svg)?.[1]);
    expect(scale * 37).toBeCloseTo(110, 1);

    // English only. The owner is printing this to put on a wall, and a poster saying one
    // thing twice is a poster nobody finishes reading.
    expect(svg).toContain('SCAN TO JOIN');
    expect(svg).toContain('New here, or already a member — start here.');
    expect(svg).toContain('THANK YOU');
    expect(svg).not.toMatch(/[ऀ-ॿ]/);
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

  it('prints the domain, not the tracking link inside the code', () => {
    // The link in the code carries forty characters of UTM parameters. Printed, nobody
    // reads it and nobody could type it; what somebody with a dead camera needs is an
    // address they can actually reach.
    const svg = buildPosterSvg({ qr: QR, size: 'A4', demo: false, url: 'https://maxfitnessgym.co.in/qr?src=reception&utm_source=qr' });

    expect(svg).toContain('maxfitnessgym.co.in');
    expect(svg).not.toContain('utm_source');
    expect(svg).not.toContain('src=reception');
  });
});
