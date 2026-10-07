'use client';

import { QrNewForm, type QrJoinResult, type QrPlanCard } from './qr-new-form';

/**
 * Registering and holding the plan, from one screen (ADR-083).
 *
 * Two calls, because that is what the API is: the registration, then the order marked
 * `payAtReception`. The member sees one Send. If the first succeeds and the second
 * fails they are told, with the reference — the registration is not lost, and reception
 * can take it from there.
 */
async function joinAtReception({
  form,
  planId,
  trialDays,
  ptPlanId,
  startDate,
}: {
  form: FormData;
  planId: string | null;
  trialDays: number | null;
  ptPlanId: string | null;
  startDate: string;
}): Promise<QrJoinResult> {
  const envelope = async (response: Response) =>
    (await response.json().catch(() => ({}))) as {
      data?: Record<string, unknown>;
      error?: { code?: string; details?: { fields?: Record<string, string>; field?: string; minAge?: number; reason?: string } };
      meta?: { requestId?: string };
    };

  const refusal = (body: Awaited<ReturnType<typeof envelope>>, status: number): QrJoinResult => ({
    ok: false,
    code: body.error?.code ?? `HTTP ${status}`,
    fields: [
      ...Object.keys(body.error?.details?.fields ?? {}),
      ...(body.error?.details?.field === undefined ? [] : [body.error.details.field]),
      // A refused selfie names its reason rather than a field, so the field is added here.
      // Without it the form flagged nothing, stayed on the last screen and showed the raw
      // code — leaving the member to guess which of eight answers the gym disliked.
      ...(body.error?.code === 'SELFIE_REJECTED' ? ['selfie'] : []),
    ],
    requestId: body.meta?.requestId,
    minAge: body.error?.details?.minAge,
    selfieReason: body.error?.details?.reason,
  });

  try {
    const registered = await fetch('/api/v1/registrations', { method: 'POST', body: form });
    const registeredBody = await envelope(registered);
    const token = registeredBody.data?.['registrationToken'];
    if (!registered.ok || typeof token !== 'string') return refusal(registeredBody, registered.status);

    const held = await fetch('/api/v1/checkout/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-registration-token': token },
      // A sign-up must name its start date — `null` is for a renewal, and sending it
      // here is what made the order come back 400 while the registration stood.
      body: JSON.stringify({ planId, trialDays, ptPlanId, startDate, payAtReception: true }),
    });
    const heldBody = await envelope(held);
    if (!held.ok) return refusal(heldBody, held.status);

    const given = form.get('fullName');
    const firstName = (typeof given === 'string' ? given : '').trim().split(/\s+/)[0] ?? '';
    const reserved = heldBody.data?.['reservedUntil'];
    return {
      ok: true,
      firstName,
      amountPaise: Number(heldBody.data?.['amountPaise'] ?? 0),
      reservedUntil: typeof reserved === 'string' ? reserved : '',
    };
  } catch {
    // The request never arrived: no code and no reference, and saying otherwise would
    // send the member to the desk with a number that means nothing.
    return { ok: false, code: 'NETWORK' };
  }
}

export function QrNewPageFlow(props: {
  today: string;
  minAge: number;
  noticeVersion: string;
  termsHref: string;
  privacyHref: string;
  plans: readonly QrPlanCard[];
  ptPlans: readonly QrPlanCard[];
  trialOptions: ReadonlyArray<{ days: number; totalPaise: number }>;
  admissionFeePaise: number;
}) {
  return <QrNewForm {...props} join={joinAtReception} />;
}
