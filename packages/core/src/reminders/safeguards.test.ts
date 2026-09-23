import { describe, expect, it } from 'vitest';
import { isQualitySignal, pauseOnQualitySignal, slotFailureVerdict, RULES_PAUSED_ON_QUALITY_DROP, type QualityGuardStore } from './safeguards';

/**
 * The two guards that stop a bad night becoming a banned number
 * (whatsapp-automation-engine §9).
 *
 * Both are deliberately blunt: they stop sending and tell the owner. Neither tries to
 * be clever about *why*, because by the time either fires, the thing that knows why is
 * Meta, and the only safe move is to stop pushing.
 */

function store() {
  const disabled: string[][] = [];
  const alerts: Array<{ code: string; message: string }> = [];
  const impl: QualityGuardStore = {
    disableRules: (codes) => {
      disabled.push([...codes]);
      return Promise.resolve(codes.length);
    },
    alertOwner: (code, message) => {
      alerts.push({ code, message });
      return Promise.resolve();
    },
  };
  return { disabled, alerts, impl };
}

describe('isQualitySignal', () => {
  it.each(['131049', '131048', '130472', '131056'])('recognises Meta code %s', (code) => {
    expect(isQualitySignal(code)).toBe(true);
  });

  it('leaves an ordinary undeliverable message alone', () => {
    // 131026 is "this number cannot receive WhatsApp" — one member's problem, not the
    // gym's, and pausing every lapsed member's reminder over it would be wrong.
    expect(isQualitySignal('131026')).toBe(false);
    expect(isQualitySignal(null)).toBe(false);
    expect(isQualitySignal(undefined)).toBe(false);
  });
});

describe('pauseOnQualitySignal', () => {
  it('stops the post-expiry chasing and leaves everything else running', () => {
    // The pre-expiry reminders and the receipts are the messages members expect;
    // it is the chasing after expiry that earns a quality downgrade.
    expect([...RULES_PAUSED_ON_QUALITY_DROP]).toEqual(['POST']);
  });

  it('disables the POST rule and tells the owner, once', async () => {
    const s = store();

    const result = await pauseOnQualitySignal({ errorCode: '131049', message: 'Healthy ecosystem' }, s.impl);

    expect(result).toEqual({ paused: ['POST'] });
    expect(s.disabled).toEqual([['POST']]);
    expect(s.alerts).toEqual([{ code: '131049', message: 'Healthy ecosystem' }]);
  });

  it('does nothing at all for an error that is not about the number', async () => {
    const s = store();

    expect(await pauseOnQualitySignal({ errorCode: '131026', message: 'Undeliverable' }, s.impl)).toEqual({ paused: [] });
    expect(s.disabled).toEqual([]);
    expect(s.alerts).toEqual([]);
  });

  it('does not alert again when the rule was already paused', async () => {
    const s = store();
    s.impl.disableRules = () => Promise.resolve(0);

    expect(await pauseOnQualitySignal({ errorCode: '131049', message: 'again' }, s.impl)).toEqual({ paused: [] });
    expect(s.alerts).toEqual([]);
  });
});

describe('slotFailureVerdict', () => {
  it('stops a slot where more than a fifth of the sends failed', () => {
    expect(slotFailureVerdict({ attempted: 20, failed: 5 })).toEqual({ stop: true, ratio: 0.25 });
  });

  it('lets a slot with the odd failure carry on', () => {
    expect(slotFailureVerdict({ attempted: 20, failed: 4 })).toMatchObject({ stop: false });
    expect(slotFailureVerdict({ attempted: 100, failed: 3 })).toMatchObject({ stop: false });
  });

  it('will not condemn a slot on a handful of sends', () => {
    // One failure out of two is 50%, and means nothing. The guard is about a channel
    // that has stopped working, which needs enough sends to tell.
    expect(slotFailureVerdict({ attempted: 2, failed: 1 })).toMatchObject({ stop: false });
    expect(slotFailureVerdict({ attempted: 4, failed: 4 })).toMatchObject({ stop: false });
    expect(slotFailureVerdict({ attempted: 5, failed: 5 })).toMatchObject({ stop: true });
  });

  it('treats a slot that sent nothing as healthy, not as wholly failed', () => {
    expect(slotFailureVerdict({ attempted: 0, failed: 0 })).toEqual({ stop: false, ratio: 0 });
  });

  it('takes the threshold from the caller when the gym wants a different one', () => {
    expect(slotFailureVerdict({ attempted: 20, failed: 3 }, { threshold: 0.1 })).toMatchObject({ stop: true });
  });
});
