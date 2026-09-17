import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SitePhoto } from './site-photo';

/**
 * Real photos of the gym on the website (PRD LP-06/07/13; ADR-057).
 *
 * Each photo is served as AVIF with a WebP fallback, in the widths the generator made,
 * so a phone downloads a phone-sized file. The box keeps its aspect ratio before the
 * image arrives, so nothing jumps; only the hero-adjacent photo is fetched eagerly.
 */

const photo = { id: 'cardio-row', width: 1600, height: 1200, widths: [640, 1080, 1600] } as const;

describe('SitePhoto', () => {
  it('offers AVIF and WebP in every generated width, with a WebP fallback and the given description', () => {
    const { container } = render(<SitePhoto photo={photo} alt="Treadmills in a row" sizes="(min-width: 768px) 50vw, 100vw" aspect="aspect-[4/3]" />);

    const avif = container.querySelector('source[type="image/avif"]');
    const webp = container.querySelector('source[type="image/webp"]');
    const img = container.querySelector('img');
    expect(avif?.getAttribute('srcset')).toBe('/media/photos/cardio-row-640.avif 640w, /media/photos/cardio-row-1080.avif 1080w, /media/photos/cardio-row-1600.avif 1600w');
    expect(webp?.getAttribute('srcset')).toBe('/media/photos/cardio-row-640.webp 640w, /media/photos/cardio-row-1080.webp 1080w, /media/photos/cardio-row-1600.webp 1600w');
    expect(avif?.getAttribute('sizes')).toBe('(min-width: 768px) 50vw, 100vw');
    expect(img?.getAttribute('src')).toBe('/media/photos/cardio-row-1080.webp');
    expect(img?.getAttribute('alt')).toBe('Treadmills in a row');
    // Intrinsic size, so the browser reserves the space.
    expect(img?.getAttribute('width')).toBe('1600');
    expect(img?.getAttribute('height')).toBe('1200');
  });

  it('loads lazily unless it is the first thing on screen', () => {
    const lazy = render(<SitePhoto photo={photo} alt="x" sizes="100vw" aspect="aspect-square" />).container.querySelector('img');
    expect(lazy?.getAttribute('loading')).toBe('lazy');

    const eager = render(<SitePhoto photo={photo} alt="x" sizes="100vw" aspect="aspect-square" priority />).container.querySelector('img');
    expect(eager?.getAttribute('loading')).toBe('eager');
    expect(eager?.getAttribute('fetchpriority')).toBe('high');
  });

  it('falls back to the largest width it has when there is no middle one', () => {
    const small = { id: 'trainer-spot', width: 720, height: 960, widths: [640, 720] } as const;
    const img = render(<SitePhoto photo={small} alt="x" sizes="100vw" aspect="aspect-square" />).container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/media/photos/trainer-spot-720.webp');
  });

  it('keeps the box to its aspect ratio and crops the photo to fill it', () => {
    const { container } = render(<SitePhoto photo={photo} alt="x" sizes="100vw" aspect="aspect-[16/9]" className="rounded-photo" />);
    const box = container.firstElementChild;
    expect(box?.className).toContain('aspect-[16/9]');
    expect(box?.className).toContain('rounded-photo');
    expect(container.querySelector('img')?.className).toContain('object-cover');
  });

  it('shows the whole photo when asked to, as the lightbox does', () => {
    const img = render(<SitePhoto photo={photo} alt="x" sizes="100vw" aspect="aspect-[4/3]" fit="contain" />).container.querySelector('img');
    expect(img?.className).toContain('object-contain');
    expect(img?.className).not.toContain('object-cover');
  });
});
