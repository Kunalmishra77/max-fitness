import { describe, expect, it } from 'vitest';
import { serviceWindow } from './service-window';

/** Meta's 24-hour customer service window (ADR-127). */
describe('serviceWindow', () => {
  const now = new Date('2026-10-16T12:00:00.000Z');

  it('is shut when the member has never written', () => {
    expect(serviceWindow(null, now)).toEqual({ open: false, minutesLeft: 0 });
  });

  it('is open for 24 hours after they write, and says how long is left', () => {
    const anHourAgo = new Date('2026-10-16T11:00:00.000Z');
    expect(serviceWindow(anHourAgo, now)).toEqual({ open: true, minutesLeft: 23 * 60 });
  });

  it('shuts exactly 24 hours after their message, not a minute later', () => {
    expect(serviceWindow(new Date('2026-10-15T12:00:01.000Z'), now)).toEqual({ open: true, minutesLeft: 0 });
    expect(serviceWindow(new Date('2026-10-15T12:00:00.000Z'), now)).toEqual({ open: false, minutesLeft: 0 });
  });

  /**
   * A clock that disagrees with the provider's must not open a window Meta has shut.
   * A reply sent into a closed window is rejected and charged as a failure.
   */
  it('treats a message from the future as shut rather than as 24 hours of credit', () => {
    expect(serviceWindow(new Date('2026-10-16T13:00:00.000Z'), now)).toEqual({ open: false, minutesLeft: 0 });
  });
});
