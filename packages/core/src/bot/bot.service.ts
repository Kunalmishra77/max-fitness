import type { Clock, Language } from '@mfp/shared';
import type { AiTextGenerator } from '../ports/ai';
import { botPrompt, readBotAnswer, type BotDocument } from './answer';

/**
 * Answering a member on WhatsApp (ADR-090).
 *
 * Every branch here is about not sending something wrong.
 *
 * **Two switches, both the owner's.** `isActive` is the bot existing; `autoReply` is it
 * answering members by itself. A gym can configure and test one without it speaking to
 * anybody — which is how you would want to introduce a bot to your own members.
 *
 * **It escalates rather than guesses**, and escalation is not a failure: "let me ask
 * somebody" beats a wrong price, and the owner sees the question either way.
 *
 * **Everything is logged, including the failures.** The log is what the feature is for as far
 * as the owner is concerned: it is where they see what members actually ask, which is how the
 * knowledge base gets better. A model that cannot be reached is logged as failed, not as
 * silence — silence is indistinguishable from nobody having asked.
 */

export interface BotConfigRecord {
  readonly botName: string;
  readonly isActive: boolean;
  readonly autoReply: boolean;
  readonly persona: string;
  readonly languages: readonly Language[];
  readonly escalationNote: string | null;
}

export interface BotReplyLogEntry {
  readonly gymId: string;
  readonly memberId: string | null;
  readonly mobile: string;
  readonly question: string;
  readonly answer: string | null;
  readonly status: 'ANSWERED' | 'ESCALATED' | 'FAILED';
  readonly reason: string | null;
  readonly isTest: boolean;
}

export interface BotStore {
  loadConfig(gymId: string): Promise<BotConfigRecord | null>;
  loadDocuments(gymId: string): Promise<readonly BotDocument[]>;
  logReply(entry: BotReplyLogEntry): Promise<void>;
}

export interface BotAskInput {
  readonly gymId: string;
  readonly question: string;
  readonly member: { readonly memberId: string | null; readonly firstName: string; readonly language: Language; readonly mobile: string };
  /** The owner's test chat: answers even while auto-reply is off, and is logged as a test. */
  readonly isTest?: boolean;
}

export type BotAskResult =
  | { readonly outcome: 'ANSWER'; readonly text: string }
  | { readonly outcome: 'ESCALATE' }
  /** The bot is off, or there was nothing to answer: say nothing, log nothing. */
  | { readonly outcome: 'OFF' };

/** The code from an adapter error, which is its first word. Never the message itself. */
function failureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const first = message.split(':')[0]?.trim() ?? '';
  return first === '' ? 'AI_FAILED' : first;
}

export async function answerMemberQuestion(
  input: BotAskInput,
  deps: { readonly clock: Clock; readonly ai: AiTextGenerator; readonly store: BotStore },
): Promise<BotAskResult> {
  const question = input.question.trim();
  if (question === '') return { outcome: 'OFF' };

  const config = await deps.store.loadConfig(input.gymId);
  if (config === null || !config.isActive) return { outcome: 'OFF' };
  const isTest = input.isTest === true;
  if (!config.autoReply && !isTest) return { outcome: 'OFF' };

  const log = (entry: Omit<BotReplyLogEntry, 'gymId' | 'memberId' | 'mobile' | 'question' | 'isTest'>) =>
    deps.store.logReply({
      gymId: input.gymId,
      memberId: input.member.memberId,
      mobile: input.member.mobile,
      question,
      isTest,
      ...entry,
    });

  if (!deps.ai.available) {
    await log({ status: 'FAILED', answer: null, reason: 'NO_AI_KEY' });
    return { outcome: 'ESCALATE' };
  }

  const documents = await deps.store.loadDocuments(input.gymId);
  const prompt = botPrompt({
    botName: config.botName,
    gymName: 'Max Fitness Gym',
    persona: config.persona,
    languages: config.languages,
    escalationNote: config.escalationNote,
    documents,
    question,
    member: { firstName: input.member.firstName, language: input.member.language },
  });

  let text: string;
  try {
    // Short on purpose: one WhatsApp message, and a long answer is escalated anyway.
    text = (await deps.ai.generate({ system: prompt.system, user: prompt.user, maxTokens: 500 })).text;
  } catch (error) {
    await log({ status: 'FAILED', answer: null, reason: failureCode(error) });
    return { outcome: 'ESCALATE' };
  }

  const answer = readBotAnswer(text);
  if (answer.outcome === 'ESCALATE') {
    await log({ status: 'ESCALATED', answer: null, reason: null });
    return { outcome: 'ESCALATE' };
  }

  await log({ status: 'ANSWERED', answer: answer.text, reason: null });
  return { outcome: 'ANSWER', text: answer.text };
}
