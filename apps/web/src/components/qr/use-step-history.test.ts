import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { useStepHistory } from './use-step-history';

/**
 * MEM-005. The behaviour under test is the one that was losing members' work: a back
 * gesture on step 5 of 8 used to leave the form and discard the selfie and ID photographs
 * with it.
 */

describe('useStepHistory', () => {
  let pushed: Array<unknown>;

  beforeEach(() => {
    pushed = [];
    vi.spyOn(window.history, 'pushState').mockImplementation((state) => {
      pushed.push(state);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Fire a `popstate` the way a browser does, carrying the state of the entry left. */
  const goBack = (state: unknown) => {
    const event = new PopStateEvent('popstate', { state });
    act(() => {
      window.dispatchEvent(event);
    });
  };

  it('adds one history entry per step forward', () => {
    const { rerender } = renderHook(({ step }) => useStepHistory(step, () => undefined), { initialProps: { step: 0 } });

    rerender({ step: 1 });
    rerender({ step: 2 });

    expect(pushed).toEqual([{ 'mfp-step': 0 }, { 'mfp-step': 1 }]);
  });

  it('does not add an entry when going back, which would need two taps to leave', () => {
    const { rerender } = renderHook(({ step }) => useStepHistory(step, () => undefined), { initialProps: { step: 0 } });

    rerender({ step: 1 });
    rerender({ step: 2 });
    pushed.length = 0;
    rerender({ step: 1 });

    expect(pushed).toEqual([]);
  });

  it('moves the step back on a back gesture instead of leaving the form', () => {
    const onBack = vi.fn();
    const { rerender } = renderHook(({ step }) => useStepHistory(step, onBack), { initialProps: { step: 0 } });
    rerender({ step: 3 });

    goBack({ 'mfp-step': 2 });

    expect(onBack).toHaveBeenCalledWith(2);
  });

  /** Back from the first screen should leave: by then the member means it. */
  it('does not trap the first step', () => {
    const onBack = vi.fn();
    renderHook(() => useStepHistory(0, onBack));

    goBack({ 'mfp-step': 0 });

    expect(onBack).not.toHaveBeenCalled();
  });

  it('ignores a popstate that is not one of ours', () => {
    const onBack = vi.fn();
    const { rerender } = renderHook(({ step }) => useStepHistory(step, onBack), { initialProps: { step: 0 } });
    rerender({ step: 2 });

    goBack(null);
    goBack({ something: 'else' });

    expect(onBack).not.toHaveBeenCalled();
  });

  /**
   * The listener is registered once and reads the step through a ref. Re-registering per
   * step would mean a gesture arriving mid-update hits a listener about to be torn down,
   * and a dropped back gesture is the bug this hook exists to fix.
   */
  it('keeps working across several steps without re-registering', () => {
    const onBack = vi.fn();
    const { rerender } = renderHook(({ step }) => useStepHistory(step, onBack), { initialProps: { step: 0 } });

    for (const step of [1, 2, 3, 4, 5]) rerender({ step });

    goBack({ 'mfp-step': 4 });
    expect(onBack).toHaveBeenLastCalledWith(4);

    rerender({ step: 4 });
    goBack({ 'mfp-step': 3 });
    expect(onBack).toHaveBeenLastCalledWith(3);
  });
});
