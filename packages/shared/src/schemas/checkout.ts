import { z } from 'zod';
import { isISTDate } from '../time/ist-date';
import { MEMBER_GENDERS } from './registration';

/**
 * Checkout requests (api-specification.md §3 `/plans`, `/checkout/*`).
 *
 * No request carries an amount. The server prices every order from the plan and the
 * gym's settings (BR-11.3), so a body with an amount is malformed, not ignored.
 */

export const CheckoutOrderSchema = z
  .object({
    /** A plan, or `null` with `trialDays` for the paid trial (ADR-088). */
    planId: z.string().trim().min(1).max(64).nullable().default(null),
    /** How many days of trial, instead of a plan. The server prices it. */
    trialDays: z.number().int().positive().max(30).nullable().default(null),
    /** Personal training bought alongside it; `null` is "no thanks" (ADR-087). */
    ptPlanId: z.string().trim().min(1).max(64).nullable().default(null),
    /** Required for a sign-up; a renewal's start follows BR-3.4 and is left `null`. */
    startDate: z.string().refine(isISTDate, { message: 'startDate' }).nullable().default(null),
    payAtReception: z.boolean().default(false),
  })
  .strict()
  // One or the other: both would be two memberships for one payment, neither is not an order.
  .refine((order) => (order.planId === null) !== (order.trialDays === null), { message: 'planId' });
export type CheckoutOrderInput = z.input<typeof CheckoutOrderSchema>;
export type CheckoutOrder = z.output<typeof CheckoutOrderSchema>;

/** Provider ids reach a URL path at the gateway, so only their documented shape passes. */
const providerOrderId = z.string().regex(/^order_[A-Za-z0-9_]{1,60}$/);
const providerPaymentId = z.string().regex(/^pay_[A-Za-z0-9_]{1,60}$/);

/** Razorpay Standard Checkout's success handler fields, posted back unchanged. */
export const CheckoutVerifySchema = z
  .object({
    razorpay_order_id: providerOrderId,
    razorpay_payment_id: providerPaymentId,
    razorpay_signature: z.string().min(1).max(200),
  })
  .strict();
export type CheckoutVerify = z.output<typeof CheckoutVerifySchema>;

/** The DEMO_MODE pay dialog (signup-and-payment-flow.md §8). */
export const SimulateCheckoutSchema = z
  .object({
    providerOrderId,
    outcome: z.enum(['success', 'failure']),
  })
  .strict();
export type SimulateCheckout = z.output<typeof SimulateCheckoutSchema>;

export const PlansQuerySchema = z.object({
  gender: z.enum(MEMBER_GENDERS).optional(),
});
