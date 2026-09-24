import type { QrSubmitResult } from './qr-existing-form';

/**
 * Posts the reception form to the API and reads its envelope (api-specification.md §1).
 *
 * Every refusal is carried through with its code and request id rather than flattened
 * into "that could not be sent", which is what the member used to see (ADR-075).
 */
export async function postQrExisting(form: FormData): Promise<QrSubmitResult> {
  try {
    const response = await fetch('/api/v1/qr/existing', { method: 'POST', body: form });
    const body = (await response.json().catch(() => ({}))) as {
      data?: { referenceCode?: string };
      error?: { code?: string; details?: { fields?: Record<string, string>; field?: string; minAge?: number } };
      meta?: { requestId?: string };
    };
    if (response.ok && typeof body.data?.referenceCode === 'string') return { ok: true, referenceCode: body.data.referenceCode };
    const code = body.error?.code;
    const fields = [
      ...Object.keys(body.error?.details?.fields ?? {}),
      ...(body.error?.details?.field === undefined ? [] : [body.error.details.field]),
    ];
    // Carried through so a member who cannot get past this can show reception a
    // reference rather than "it did not work" (ADR-075).
    const requestId = body.meta?.requestId;
    if (code === 'RATE_LIMITED' || code === 'OTP_REQUIRED') return { ok: false, code, requestId };
    if (code === 'UNDER_MINIMUM_AGE') return { ok: false, code, fields: ['dob'], requestId, minAge: body.error?.details?.minAge };
    if (code === 'SELFIE_REJECTED') return { ok: false, code, fields: ['selfie'], requestId };
    if (code === 'VALIDATION_FAILED') return { ok: false, code, fields, requestId };
    return { ok: false, code: code ?? `HTTP ${response.status}`, requestId };
  } catch {
    // The request never arrived: no code, no reference, and saying otherwise would
    // send the member to reception with a number that means nothing.
    return { ok: false, code: 'NETWORK' };
  }
}
