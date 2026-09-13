import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSiteEvent, propsFromDataset, track, writeConsent } from './analytics';

describe('propsFromDataset', () => {
  it('turns data-track-* attributes into event properties', () => {
    const link = document.createElement('a');
    link.dataset['track'] = 'plan_selected';
    link.dataset['trackSource'] = 'hero';
    link.dataset['trackPlan'] = 'M12';
    link.dataset['other'] = 'ignored';
    expect(propsFromDataset(link.dataset)).toEqual({ source: 'hero', plan: 'M12' });
  });
});

describe('isSiteEvent', () => {
  it('accepts only the PRD §7 events used on the site', () => {
    expect(isSiteEvent('call_click')).toBe(true);
    expect(isSiteEvent('kiosk_match')).toBe(false);
    expect(isSiteEvent(undefined)).toBe(false);
  });
});

describe('track', () => {
  const plausible = vi.fn();

  beforeEach(() => {
    window.localStorage.clear();
    window.plausible = plausible;
  });

  afterEach(() => {
    plausible.mockReset();
    delete window.plausible;
  });

  it('sends nothing before the visitor has chosen', () => {
    track('call_click', { source: 'nav' });
    expect(plausible).not.toHaveBeenCalled();
  });

  it('sends nothing after "No thanks"', () => {
    writeConsent('denied');
    track('call_click', { source: 'nav' });
    expect(plausible).not.toHaveBeenCalled();
  });

  it('sends the event after "Allow analytics"', () => {
    writeConsent('granted');
    track('call_click', { source: 'nav' });
    expect(plausible).toHaveBeenCalledWith('call_click', { props: { source: 'nav' } });
  });
});
