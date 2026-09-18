import { afterEach, describe, expect, it, vi } from 'vitest';
import { JOIN_STORAGE_KEY, clearJoinState, readJoinState, updateJoinState } from './join-state';

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('join state', () => {
  it('starts empty', () => {
    expect(readJoinState()).toEqual({});
  });

  it('keeps progress in sessionStorage so a refresh does not lose it', () => {
    updateJoinState({ registrationToken: 'tok', firstName: 'Priya', gender: 'FEMALE', isMinor: false, whatsappUpdates: true });
    updateJoinState({ planId: 'plan_1', startDate: '2026-09-11' });

    expect(readJoinState()).toEqual({
      registrationToken: 'tok',
      firstName: 'Priya',
      gender: 'FEMALE',
      isMinor: false,
      whatsappUpdates: true,
      planId: 'plan_1',
      startDate: '2026-09-11',
    });
    expect(window.localStorage.getItem(JOIN_STORAGE_KEY)).toBeNull();
  });

  it('drops fields that are missing, of the wrong type, or unknown', () => {
    window.sessionStorage.setItem(
      JOIN_STORAGE_KEY,
      JSON.stringify({ registrationToken: 42, planId: 'plan_1', gender: 'ALIEN', startDate: 'soon', mobile: '9876543210' }),
    );
    expect(readJoinState()).toEqual({ planId: 'plan_1' });
  });

  it('survives corrupt JSON and storage that throws', () => {
    window.sessionStorage.setItem(JOIN_STORAGE_KEY, '{not json');
    expect(readJoinState()).toEqual({});

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readJoinState()).toEqual({});
    expect(() => updateJoinState({ planId: 'plan_2' })).not.toThrow();
  });

  it('keeps where the flow ended: a payment to look up, or a reservation', () => {
    updateJoinState({ paymentId: 'cm1payment00001', reservedUntil: '2026-09-13T04:30:00.000Z', reservedAmountPaise: 400_000 });
    expect(readJoinState()).toMatchObject({ paymentId: 'cm1payment00001', reservedUntil: '2026-09-13T04:30:00.000Z', reservedAmountPaise: 400_000 });

    window.sessionStorage.setItem(JOIN_STORAGE_KEY, JSON.stringify({ reservedUntil: 'later', reservedAmountPaise: -5 }));
    expect(readJoinState()).toEqual({});
  });

  it('remembers that the sign-up started at the reception QR', () => {
    updateJoinState({ fromQr: true });
    expect(readJoinState()).toMatchObject({ fromQr: true });
    window.sessionStorage.setItem(JOIN_STORAGE_KEY, JSON.stringify({ fromQr: 'yes' }));
    expect(readJoinState()).toEqual({});
  });

  it('removes a field when updated to undefined, and clears everything at the end', () => {
    updateJoinState({ planId: 'plan_1', startDate: '2026-09-11' });
    updateJoinState({ startDate: undefined });
    expect(readJoinState()).toEqual({ planId: 'plan_1' });

    clearJoinState();
    expect(window.sessionStorage.getItem(JOIN_STORAGE_KEY)).toBeNull();
  });
});
