import { afterEach, describe, expect, it } from 'vitest';
import { onlinePaymentsLive } from './online-payments';

/**
 * Whether the website may offer to take money (ADR-093).
 *
 * The question this answers is the one that matters on the day the site goes live at its
 * own domain: a stranger must never be able to press Pay and become an ACTIVE member
 * without any money having moved. So the default is no, and both halves have to be true.
 */

const original = { demo: process.env['DEMO_MODE'], secret: process.env['RAZORPAY_KEY_SECRET'] };

afterEach(() => {
  for (const [name, value] of [['DEMO_MODE', original.demo], ['RAZORPAY_KEY_SECRET', original.secret]] as const) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
});

const env = (demo: string | undefined, secret: string | undefined) => {
  if (demo === undefined) Reflect.deleteProperty(process.env, 'DEMO_MODE');
  else process.env['DEMO_MODE'] = demo;
  if (secret === undefined) Reflect.deleteProperty(process.env, 'RAZORPAY_KEY_SECRET');
  else process.env['RAZORPAY_KEY_SECRET'] = secret;
};

describe('onlinePaymentsLive', () => {
  it('offers online payment when payments are real and the gateway is configured', () => {
    env('false', 'rzp_secret');
    expect(onlinePaymentsLive()).toBe(true);
  });

  it('refuses in DEMO_MODE, however well configured the gateway is', () => {
    // This is the live-domain case: simulated payment on a public URL is a free membership.
    env('true', 'rzp_secret');
    expect(onlinePaymentsLive()).toBe(false);
  });

  it('refuses without a gateway secret, however real the mode claims to be', () => {
    env('false', '');
    expect(onlinePaymentsLive()).toBe(false);
    env('false', undefined);
    expect(onlinePaymentsLive()).toBe(false);
  });

  it('refuses when nothing is configured at all', () => {
    env(undefined, undefined);
    expect(onlinePaymentsLive()).toBe(false);
  });
});
