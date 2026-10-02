/**
 * Whether the website may offer to take money (ADR-093).
 *
 * In `DEMO_MODE` the payment window is simulated: it completes the order and confirms the
 * membership without any money moving. That is right on a demo URL and dangerous on a real
 * one — the day the site answers to the gym's own domain, a stranger pressing Pay would
 * become an ACTIVE member for free.
 *
 * So the public sign-up offers online payment only when **both** halves are true: payments
 * are real, and a gateway secret actually exists. Otherwise it reserves the place and asks
 * the member to pay at reception, which is what every QR arrival already does — a path that
 * is built, tested and true. Nothing about this needs remembering at deploy time: adding
 * the live Razorpay keys turns it on by itself.
 */
export function onlinePaymentsLive(): boolean {
  return process.env['DEMO_MODE'] === 'false' && (process.env['RAZORPAY_KEY_SECRET'] ?? '') !== '';
}
