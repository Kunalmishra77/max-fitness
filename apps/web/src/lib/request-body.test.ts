// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readJsonBody } from './request-body';

const post = (body: string) => new Request('http://localhost/api/v1/x', { method: 'POST', body });

describe('readJsonBody', () => {
  it('parses a JSON body within the limit', async () => {
    expect(await readJsonBody(post('{"planId":"p1"}'), 1_024)).toEqual({ ok: true, value: { planId: 'p1' } });
  });

  it('refuses a body over the limit before parsing it', async () => {
    const result = await readJsonBody(post(JSON.stringify({ pad: 'x'.repeat(2_000) })), 1_024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(413);
  });

  it('refuses a body that is not JSON', async () => {
    const result = await readJsonBody(post('planId=p1'), 1_024);
    expect(result).toMatchObject({ ok: false, status: 400 });
  });
});
