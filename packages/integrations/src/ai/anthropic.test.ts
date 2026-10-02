import { describe, expect, it, vi } from 'vitest';
import { createAiGenerator } from './anthropic';

/**
 * The model adapter (ADR-089).
 *
 * All the interesting cases are failures, because this is a network call to somebody
 * else's service and the gym's CRM has to say something sensible about each one. The key
 * is never in a message, a log line or an error — a leaked key is somebody else's bill.
 */

const ok = (text: string) =>
  new Response(JSON.stringify({ content: [{ type: 'text', text }], model: 'claude-sonnet-5-5' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('createAiGenerator', () => {
  it('is unavailable without a key, and says so instead of calling anything', async () => {
    const fetchMock = vi.fn();
    const ai = createAiGenerator({ apiKey: '', model: 'claude-sonnet-5-5', fetch: fetchMock });

    expect(ai.available).toBe(false);
    await expect(ai.generate({ system: 's', user: 'u', maxTokens: 100 })).rejects.toThrow(/AI_NOT_CONFIGURED/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the system and the question, and returns the words and the model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok('{"summary":"hello"}'));
    const ai = createAiGenerator({ apiKey: 'sk-test', model: 'claude-sonnet-5-5', fetch: fetchMock });

    const result = await ai.generate({ system: 'be useful', user: 'write a plan', maxTokens: 1_500 });

    expect(result).toEqual({ text: '{"summary":"hello"}', model: 'claude-sonnet-5-5' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBeTruthy();
    const body = JSON.parse(init.body as string) as { system: string; messages: Array<{ content: string }>; max_tokens: number };
    expect(body.system).toBe('be useful');
    expect(body.messages[0]?.content).toBe('write a plan');
    expect(body.max_tokens).toBe(1_500);
  });

  it('joins every text block, because a long answer can arrive in pieces', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }], model: 'm' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const ai = createAiGenerator({ apiKey: 'sk-test', model: 'm', fetch: fetchMock });

    expect((await ai.generate({ system: 's', user: 'u', maxTokens: 10 })).text).toBe('{"a":1}');
  });

  it('never puts the key in the error when the service refuses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":{"message":"bad key"}}', { status: 401 }));
    const ai = createAiGenerator({ apiKey: 'sk-secret-value', model: 'm', fetch: fetchMock });

    await expect(ai.generate({ system: 's', user: 'u', maxTokens: 10 })).rejects.toThrow(/AI_REFUSED/);
    await ai.generate({ system: 's', user: 'u', maxTokens: 10 }).catch((error: Error) => {
      expect(error.message).not.toContain('sk-secret-value');
    });
  });

  it('says plainly when the answer has no text in it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [], model: 'm' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const ai = createAiGenerator({ apiKey: 'sk-test', model: 'm', fetch: fetchMock });

    await expect(ai.generate({ system: 's', user: 'u', maxTokens: 10 })).rejects.toThrow(/AI_EMPTY/);
  });

  it('gives up rather than hanging the job when the service does not answer', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('socket hang up'));
    const ai = createAiGenerator({ apiKey: 'sk-test', model: 'm', fetch: fetchMock });

    await expect(ai.generate({ system: 's', user: 'u', maxTokens: 10 })).rejects.toThrow(/AI_UNREACHABLE/);
  });
});
