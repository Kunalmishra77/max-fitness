import { describe, expect, it, vi } from 'vitest';
import { createOpenAiGenerator } from './openai';

/**
 * The same narrow port as the Anthropic adapter, against a different service (owner has
 * a paid OpenAI key, 2026-10-15).
 *
 * The failures matter more than the happy path here. Whoever is standing at the CRM when
 * a diet plan will not generate needs to know whether it is their key, their account, or
 * a bad minute — so each one keeps its own code, and none of them carries the key.
 */

const ok = (text: string, model = 'gpt-5') => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ model, choices: [{ message: { content: text } }] }),
});

const generator = (fetchImpl: unknown, apiKey = 'sk-test') =>
  createOpenAiGenerator({ apiKey, model: 'gpt-5', fetch: fetchImpl as typeof fetch });

const ask = { system: 'You are a gym assistant.', user: 'When does the gym open?', maxTokens: 200 };

describe('createOpenAiGenerator', () => {
  it('sends the system and the question as two messages, and returns the answer', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(ok('We open at 4:30 am.')));

    const result = await generator(fetchImpl).generate(ask);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers['authorization']).toBe('Bearer sk-test');
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'gpt-5',
      messages: [
        { role: 'system', content: ask.system },
        { role: 'user', content: ask.user },
      ],
    });
    expect(result).toEqual({ text: 'We open at 4:30 am.', model: 'gpt-5' });
  });

  it('reports the model that actually answered, not the one asked for', async () => {
    const result = await generator(vi.fn(() => Promise.resolve(ok('Yes.', 'gpt-5-2026-04-01')))).generate(ask);

    expect(result.model).toBe('gpt-5-2026-04-01');
  });

  /** The CRM says so plainly rather than failing at the moment somebody presses the button. */
  it('is unavailable, and refuses, when no key is configured', async () => {
    const gen = generator(vi.fn(), '');

    expect(gen.available).toBe(false);
    await expect(gen.generate(ask)).rejects.toThrow(/AI_NOT_CONFIGURED/);
  });

  it('names a refusal separately from a service that could not be reached', async () => {
    await expect(
      generator(vi.fn(() => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) }))).generate(ask),
    ).rejects.toThrow(/AI_REFUSED: the model service answered 429/);

    await expect(generator(vi.fn(() => Promise.reject(new Error('ECONNRESET')))).generate(ask)).rejects.toThrow(/AI_UNREACHABLE/);
  });

  it('treats an answer with no words in it as a failure', async () => {
    await expect(generator(vi.fn(() => Promise.resolve(ok('   ')))).generate(ask)).rejects.toThrow(/AI_EMPTY/);
  });

  /**
   * A thrown error is logged and sometimes shown. The key must not travel with it — not
   * in the message, not as a `cause` carrying the request that held the header.
   */
  it('never lets the key out in an error', async () => {
    const leaky = vi.fn(() => Promise.reject(new Error('connect failed to https://api.openai.com with sk-test')));

    await expect(generator(leaky, 'sk-test').generate(ask)).rejects.toSatisfy(
      (error: Error) => !JSON.stringify({ m: error.message, c: error.cause ?? null }).includes('sk-test'),
    );
  });
});
