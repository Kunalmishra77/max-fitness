import type { AiTextGenerator, AiTextRequest, AiTextResult } from '@mfp/core/ports';

/**
 * OpenAI behind the same narrow port as the Anthropic adapter (owner's key, 2026-10-15).
 *
 * Plain `fetch` against Chat Completions rather than the SDK, for the same reason as the
 * other adapter: one request, one answer, no streaming and no tools, so a dependency
 * would buy nothing and would have to be kept in step with the lockfile.
 *
 * Every failure keeps its own code, because each means something different to whoever is
 * standing at the CRM when a plan will not generate: no key is the owner's job, a refusal
 * is the account's, and unreachable is "try again in a minute". The key appears in a
 * header and nowhere else — never in a message, a log line or an error, which is why a
 * failed request is never forwarded as a `cause`.
 */

const API_URL = 'https://api.openai.com/v1/chat/completions';
/** Long enough for a service having a slow minute, short enough not to wedge a job. */
const TIMEOUT_MS = 60_000;

interface OpenAiResponse {
  readonly model?: string;
  readonly choices?: ReadonlyArray<{ readonly message?: { readonly content?: string | null } }>;
}

export interface OpenAiGeneratorOptions {
  readonly apiKey: string;
  readonly model: string;
  /** Injected in tests. */
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export function createOpenAiGenerator(options: OpenAiGeneratorOptions): AiTextGenerator {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const available = options.apiKey.trim() !== '';

  return {
    name: 'openai',
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
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model: options.model,
            max_completion_tokens: request.maxTokens,
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
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

      let body: OpenAiResponse;
      try {
        body = (await response.json()) as OpenAiResponse;
      } catch {
        throw new Error('AI_EMPTY: the model service sent something that was not JSON');
      }

      const text = body.choices?.[0]?.message?.content ?? '';
      if (text.trim() === '') {
        throw new Error('AI_EMPTY: the model answered with no text');
      }

      return { text, model: body.model ?? options.model };
    },
  };
}
