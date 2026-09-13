import { describe, expect, it } from 'vitest';
import { CheckoutOrderSchema, CheckoutVerifySchema, PlansQuerySchema, SimulateCheckoutSchema } from './checkout';

describe('CheckoutOrderSchema', () => {
  it('accepts a plan and a start date, defaulting to online payment', () => {
    expect(CheckoutOrderSchema.parse({ planId: 'cm1plan000001', startDate: '2026-09-11' })).toEqual({
      planId: 'cm1plan000001',
      startDate: '2026-09-11',
      payAtReception: false,
    });
  });

  it('allows a renewal to leave the start date to the server', () => {
    expect(CheckoutOrderSchema.parse({ planId: 'cm1plan000001', payAtReception: true })).toMatchObject({ startDate: null, payAtReception: true });
  });

  it('never accepts an amount from the client (BR-11.3)', () => {
    expect(CheckoutOrderSchema.safeParse({ planId: 'cm1plan000001', startDate: '2026-09-11', amountPaise: 1 }).success).toBe(false);
  });

  it('rejects an impossible date or a missing plan', () => {
    expect(CheckoutOrderSchema.safeParse({ planId: 'cm1plan000001', startDate: '2026-02-30' }).success).toBe(false);
    expect(CheckoutOrderSchema.safeParse({ planId: '', startDate: '2026-09-11' }).success).toBe(false);
  });
});

describe('CheckoutVerifySchema', () => {
  const body = { razorpay_order_id: 'order_P1aBcD2eFgH3iJ', razorpay_payment_id: 'pay_P1aBcD2eFgH3iJ', razorpay_signature: 'a'.repeat(64) };

  it("accepts Razorpay's success callback fields", () => {
    expect(CheckoutVerifySchema.parse(body)).toEqual(body);
  });

  it('rejects ids of the wrong kind or shape', () => {
    expect(CheckoutVerifySchema.safeParse({ ...body, razorpay_payment_id: 'order_P1aBcD2eFgH3iJ' }).success).toBe(false);
    expect(CheckoutVerifySchema.safeParse({ ...body, razorpay_order_id: 'order_../../x' }).success).toBe(false);
    expect(CheckoutVerifySchema.safeParse({ ...body, razorpay_signature: '' }).success).toBe(false);
  });
});

describe('SimulateCheckoutSchema', () => {
  it('takes an order and the outcome to simulate', () => {
    expect(SimulateCheckoutSchema.parse({ providerOrderId: 'order_sim_1a2b3c', outcome: 'failure' })).toEqual({
      providerOrderId: 'order_sim_1a2b3c',
      outcome: 'failure',
    });
    expect(SimulateCheckoutSchema.safeParse({ providerOrderId: 'order_sim_1a2b3c', outcome: 'refund' }).success).toBe(false);
  });
});

describe('PlansQuerySchema', () => {
  it('filters by gender when given one', () => {
    expect(PlansQuerySchema.parse({ gender: 'FEMALE' })).toEqual({ gender: 'FEMALE' });
    expect(PlansQuerySchema.parse({})).toEqual({});
    expect(PlansQuerySchema.safeParse({ gender: 'female' }).success).toBe(false);
  });
});
