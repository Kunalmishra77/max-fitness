/**
 * Writing text with a model (ADR-089).
 *
 * One narrow port, because the domain's only interest is "ask this, get words back". The
 * adapter deals with the HTTP, the key and the model name; `packages/core` deals with
 * what is asked and what is allowed back (`diet/plan.ts`).
 *
 * There is deliberately no streaming and no tool use. A diet plan is one request and one
 * answer, and a member is not watching it type.
 */

export interface AiTextRequest {
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
}

export interface AiTextResult {
  readonly text: string;
  /** Which model actually answered, stored with the plan so a bad batch can be traced. */
  readonly model: string;
}

export interface AiTextGenerator {
  readonly name: string;
  /** True when a key is configured; the CRM says so plainly rather than failing late. */
  readonly available: boolean;
  generate(request: AiTextRequest): Promise<AiTextResult>;
}
