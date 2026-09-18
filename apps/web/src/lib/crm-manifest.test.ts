import { describe, expect, it } from 'vitest';
import { crmManifest } from './crm-manifest';

/**
 * The install card for Max Register (crm-ux-blueprint §18; PRD CRM-24).
 *
 * The owner installs the CRM, never the website: scope and start URL both point at
 * `/crm`, so the installed icon opens Today, and a tap through to a public page leaves
 * the installed window rather than wandering into the marketing site.
 */

describe('crmManifest', () => {
  const m = crmManifest();

  it('installs Max Register itself, opening at Today', () => {
    expect(m.start_url).toBe('/crm');
    expect(m.scope).toBe('/crm');
    expect(m.display).toBe('standalone');
    expect(m.name).toContain('Max Register');
    // A home screen shows about twelve characters before it trims the name.
    expect((m.short_name ?? '').length).toBeLessThanOrEqual(12);
  });

  it('wears the brand colours and opens in Hindi, portrait', () => {
    expect(m.theme_color).toBe('#0A0A0B');
    expect(m.background_color).toBe('#0A0A0B');
    expect(m.lang).toBe('hi');
    expect(m.orientation).toBe('portrait');
  });

  it('carries both icon sizes, and a maskable one for Android', () => {
    const icons = m.icons ?? [];
    expect(icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(icons.every((icon) => icon.type === 'image/png' && (icon.src ?? '').startsWith('/icons/'))).toBe(true);
    expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });
});
