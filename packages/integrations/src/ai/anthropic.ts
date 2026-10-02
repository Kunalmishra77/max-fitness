import type { AiTextGenerator, AiTextRequest, AiTextResult } from '@mfp/core/ports';

/**
 * The model, over HTTP (ADR-089).
 *
 * Plain `fetch` against the Messages API rather than an SDK: one request, one answer, no
 * streaming and no tools, so a dependency would buy nothing and would have to be kept in
 * step with the rest of the lockfile.
 *
 * Every failure gets its own code, because each one means something different to whoever
 * is standing at the CRM: no key is the owner's job, a refusal is the account's, and
 * unreachable is "try again in a minute". The key appears in a header and nowhere else —
 * never in a message, a log line or an error.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
/** Long enough for a service having a slow minute, short enough not to wedge a job. */
const TIMEOUT_MS = 60_000;

interface AnthropicResponse {
  readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>;
  readonly model?: string;
}

export interface AiGeneratorOptions {
  readonly apiKey: string;
  readonly model: string;
  /** Injected in tests. */
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export function createAiGenerator(options: AiGeneratorOptions): AiTextGenerator {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const available = options.apiKey.trim() !== '';

  return {
    name: 'anthropic',
    available,

    async generate(request: AiTextRequest): Promise<AiTextResult> {
      if (!available) {
        throw new Error('AI_NOT_CONFIGURED: no AI_API_KEY is set, so nothing can be generated');
      }

      let response: Response;
      try {
        response = await doFetch(API_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': options.apiKey,
            'anthropic-version': API_VERSION,
          },
          body: JSON.stringify({
            model: options.model,
            max_tokens: request.maxTokens,
            system: request.system,
            messages: [{ role: 'user', content: request.user }],
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // Deliberately not forwarding the cause: it can carry the request, headers and all.
        throw new Error('AI_UNREACHABLE: the model service could not be reached');
      }

      if (!response.ok) {
        throw new Error(`AI_REFUSED: the model service answered ${response.status}`);
      }

      let body: AnthropicResponse;
      try {
        body = (await response.json()) as AnthropicResponse;
      } catch {
        throw new Error('AI_EMPTY: the model service sent something that was not JSON');
      }

      const text = (body.content ?? [])
        .filter((block) => block.type === undefined || block.type === 'text')
        .map((block) => block.text ?? '')
        .join('');
      if (text.trim() === '') {
        throw new Error('AI_EMPTY: the model answered with no text');
      }

      return { text, model: body.model ?? options.model };
    },
  };
}
