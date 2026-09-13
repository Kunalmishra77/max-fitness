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
    planId: z.string().trim().min(1).max(64),
    /** Required for a sign-up; a renewal's start follows BR-3.4 and is left `null`. */
    startDate: z.string().refine(isISTDate, { message: 'startDate' }).nullable().default(null),
    payAtReception: z.boolean().default(false),
  })
  .strict();
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
