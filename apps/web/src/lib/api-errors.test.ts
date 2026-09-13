// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DomainError } from '@mfp/core';
import { PaymentProviderError } from '@mfp/integrations/payments';
import { errorResponse, statusForDomainError } from './api-errors';
import { SelfieRejectedError } from './selfie-image';

describe('statusForDomainError', () => {
  it.each([
    ['VALIDATION_FAILED', 400],
    ['TOKEN_INVALID', 401],
    ['TOKEN_EXPIRED', 401],
    ['TOKEN_WRONG_PURPOSE', 401],
    ['MEMBER_BLOCKED', 403],
    ['MEMBER_NOT_FOUND', 404],
    ['PLAN_NOT_FOUND', 404],
    ['CONFLICT', 409],
    ['PAYMENT_ALREADY_SETTLED', 409],
    ['INVALID_PAYMENT_SIGNATURE', 422],
    ['UNDER_MINIMUM_AGE', 422],
    ['PLAN_GENDER_MISMATCH', 422],
    ['START_DATE_TOO_FAR_AHEAD', 422],
    ['PRICE_MISMATCH', 502],
  ] as const)('%s → %i', (code, status) => {
    expect(statusForDomainError(code)).toBe(status);
  });
});

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
  meta: { requestId: string };
}

const bodyOf = async (response: Response) => (await response.json()) as ErrorBody;

describe('errorResponse', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the domain code and its safe details in the API envelope', async () => {
    const response = errorResponse(new DomainError('UNDER_MINIMUM_AGE', 'Too young', { minAge: 16 }), 'req_1', 'registrations');

    expect(response.status).toBe(422);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: { code: 'UNDER_MINIMUM_AGE', message: expect.any(String), details: { minAge: 16 } },
      meta: { requestId: 'req_1' },
    });
  });

  it('reports a selfie the pipeline refused, with the reason for the UI', async () => {
    const response = errorResponse(new SelfieRejectedError('too_small'), 'req_2', 'registrations');
    expect(response.status).toBe(422);
    expect((await bodyOf(response)).error).toMatchObject({ code: 'SELFIE_REJECTED', details: { reason: 'too_small' } });
  });

  it('turns a gateway failure into 502 without passing on its message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = errorResponse(new PaymentProviderError('createOrder', 'The amount must be at least INR 1.00', 400, 'BAD_REQUEST_ERROR'), 'req_3', 'checkout');

    expect(response.status).toBe(502);
    const body = await bodyOf(response);
    expect(body.error.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toContain('INR 1.00');
  });

  it('hides anything unexpected behind a generic 500, logging only the error class', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secretish = new Error('connect ECONNREFUSED postgresql://user:password@db.example:5432');

    const response = errorResponse(secretish, 'req_4', 'checkout');

    expect(response.status).toBe(500);
    const body = await bodyOf(response);
    expect(body.error).toEqual({ code: 'INTERNAL', message: 'Something went wrong' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('password');
    expect(JSON.stringify(log.mock.calls)).toContain('req_4');
  });
});
