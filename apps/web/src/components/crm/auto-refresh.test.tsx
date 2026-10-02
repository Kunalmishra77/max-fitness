import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoRefresh } from './auto-refresh';

/**
 * A screen that keeps up with the floor (ADR-092).
 *
 * The reception desk leaves Max Register open all day, so what it shows has to be what
 * is true — a check-in from the kiosk, a payment a trainer just took. The two rules that
 * matter are the ones a timer gets wrong: it must stop while nobody is looking at the
 * tab, and it must catch up the moment somebody looks again.
 */

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

let visibility = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { get: () => visibility, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

const hide = () => {
  visibility = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
};
const show = () => {
  visibility = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('AutoRefresh', () => {
  it('does not refresh before the first interval is up', () => {
    render(<AutoRefresh seconds={30} />);
    vi.advanceTimersByTime(29_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes once per interval while the tab is being looked at', () => {
    render(<AutoRefresh seconds={30} />);
    vi.advanceTimersByTime(90_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('stops asking the server anything while the tab is hidden', () => {
    render(<AutoRefresh seconds={30} />);
    hide();
    vi.advanceTimersByTime(5 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('catches up straight away when the tab is looked at again', () => {
    render(<AutoRefresh seconds={30} />);
    hide();
    vi.advanceTimersByTime(5 * 60_000);
    show();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('leaves no timer behind when the screen goes away', () => {
    const view = render(<AutoRefresh seconds={30} />);
    view.unmount();
    vi.advanceTimersByTime(5 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
