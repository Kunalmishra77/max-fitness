import type { AiTextGenerator } from '@mfp/core/ports';
import { createAiGenerator } from './anthropic';
import { createOpenAiGenerator } from './openai';

/**
 * Pick the adapter the key belongs to (ADR-114).
 *
 * The port is the same either way, so nothing in `packages/core` knows or cares which
 * service answered — only which model did, and that is already recorded with every plan
 * so a bad batch can be traced to it.
 */
export function createAiTextGenerator(options: {
  readonly provider: 'anthropic' | 'openai';
  readonly apiKey: string;
  readonly model: string;
}): AiTextGenerator {
  return options.provider === 'openai'
    ? createOpenAiGenerator({ apiKey: options.apiKey, model: options.model })
    : createAiGenerator({ apiKey: options.apiKey, model: options.model });
}
