import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { handleRazorpayWebhook, isDomainError } from '@mfp/core';
import { newRequestId } from '@/lib/api';
import { getContainer } from '@/lib/container';

/**
 * `POST /api/v1/webhooks/razorpay` — the source of truth for payments
 * (api-specification.md §4; security-plan.md §3.1; PAY-03).
 *
 * The body is read as raw text and the signature checked over those exact bytes
 * before anything is parsed. Not rate limited: a valid signature is the gate.
 * Responses stay minimal — Razorpay reads only the status: 2xx means "delivered",
 * anything else is retried, which is what we want when the database is briefly down.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Razorpay events are a few kilobytes. */
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const { env, clock, payments, paymentUow, webhookEvents } = getContainer();

  // In DEMO_MODE the simulator's "signature" is a fixed marker, so accepting webhooks
  // would let anyone confirm a payment. The demo confirms through the pay dialog instead.
  if (env.DEMO_MODE) {
    return new NextResponse(null, { status: 404 });
  }

  if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  try {
    const { outcome } = await handleRazorpayWebhook(
      {
        rawBody,
        signature: request.headers.get('x-razorpay-signature') ?? '',
        eventId: request.headers.get('x-razorpay-event-id'),
      },
      { provider: payments, clock, uow: paymentUow, events: webhookEvents },
    );
    if (outcome === 'AMOUNT_MISMATCH') {
      console.warn(`[webhook-razorpay] amount mismatch held for review ${requestId}`);
    }
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (isDomainError(error) && error.code === 'INVALID_PAYMENT_SIGNATURE') {
      console.warn(`[webhook-razorpay] signature did not verify ${requestId}`);
      return new NextResponse(null, { status: 401 });
    }
    if (isDomainError(error) && error.code === 'VALIDATION_FAILED') {
      return new NextResponse(null, { status: 400 });
    }
    console.error(`[webhook-razorpay] failed ${requestId}: ${error instanceof Error ? error.name : 'Error'}`);
    return new NextResponse(null, { status: 500 });
  }
}
