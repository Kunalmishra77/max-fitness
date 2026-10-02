import { beforeEach, describe, expect, it } from 'vitest';
import { fakeClockAt } from '../testing/builders';
import type { AiTextGenerator } from '../ports/ai';
import { ESCALATE_MARKER } from './answer';
import { answerMemberQuestion, type BotConfigRecord, type BotStore } from './bot.service';

/**
 * Answering a member (ADR-090).
 *
 * Every branch here is about not sending something wrong. The bot stays silent unless the
 * owner has switched it on, it escalates rather than guesses, and whatever happens is logged —
 * the log is where the owner sees what members actually ask, which is how the knowledge base
 * gets better. A failure to reach the model is not a reply of any kind.
 */

const clock = fakeClockAt('2026-11-03T10:00');

const config = (over: Partial<BotConfigRecord> = {}): BotConfigRecord => ({
  botName: 'Max',
  isActive: true,
  autoReply: true,
  persona: 'Warm and brief.',
  languages: ['hi', 'en'],
  escalationNote: 'Ring the desk.',
  ...over,
});

class FakeBotStore implements BotStore {
  settings: BotConfigRecord | null = config();
  documents = [{ title: 'Timings', body: 'Morning 4:30 to 12. Evening 5 to 10.' }];
  readonly logged: Array<{ status: string; question: string; answer: string | null; reason: string | null; isTest: boolean }> = [];

  loadConfig() {
    return Promise.resolve(this.settings);
  }
  loadDocuments() {
    return Promise.resolve(this.documents);
  }
  logReply(entry: { status: string; question: string; answer: string | null; reason: string | null; isTest: boolean }) {
    this.logged.push(entry);
    return Promise.resolve();
  }
}

const ai = (reply: string | Error): AiTextGenerator => ({
  name: 'fake',
  available: true,
  generate: () => (reply instanceof Error ? Promise.reject(reply) : Promise.resolve({ text: reply, model: 'fake-1' })),
});

const unavailable: AiTextGenerator = { name: 'fake', available: false, generate: () => Promise.reject(new Error('AI_NOT_CONFIGURED')) };

const member = { memberId: 'mem_1', firstName: 'Suresh', language: 'hi' as const, mobile: '+919000000001' };

describe('answerMemberQuestion', () => {
  let store: FakeBotStore;
  beforeEach(() => {
    store = new FakeBotStore();
  });

  const ask = (question: string, generator: AiTextGenerator, isTest = false) =>
    answerMemberQuestion({ gymId: 'gym_1', question, member, isTest }, { clock, ai: generator, store });

  it('answers from the gym’s own words and logs what it said', async () => {
    const result = await ask('kitne baje khulta hai?', ai('सुबह 4:30 से 12 बजे तक।'));

    expect(result).toEqual({ outcome: 'ANSWER', text: 'सुबह 4:30 से 12 बजे तक।' });
    expect(store.logged).toHaveLength(1);
    expect(store.logged[0]).toMatchObject({
      status: 'ANSWERED',
      question: 'kitne baje khulta hai?',
      answer: 'सुबह 4:30 से 12 बजे तक।',
      reason: null,
      isTest: false,
    });
  });

  it('escalates when the model says it does not know, and logs that too', async () => {
    const result = await ask('locker ka rule kya hai?', ai(ESCALATE_MARKER));

    expect(result).toEqual({ outcome: 'ESCALATE' });
    expect(store.logged[0]).toMatchObject({ status: 'ESCALATED', answer: null });
  });

  it('says nothing at all when the owner has not switched the bot on', async () => {
    store.settings = config({ isActive: false });
    expect(await ask('fees?', ai('whatever'))).toEqual({ outcome: 'OFF' });
    expect(store.logged).toEqual([]);
  });

  it('says nothing when the bot is on but not answering members yet', async () => {
    // Configured and testable, not yet live: the owner's second switch.
    store.settings = config({ autoReply: false });
    expect(await ask('fees?', ai('whatever'))).toEqual({ outcome: 'OFF' });
  });

  it('still answers in the test chat while auto-reply is off', async () => {
    store.settings = config({ autoReply: false });
    const result = await ask('fees?', ai('Monthly is 1500.'), true);

    expect(result).toEqual({ outcome: 'ANSWER', text: 'Monthly is 1500.' });
    expect(store.logged[0]).toMatchObject({ isTest: true });
  });

  it('escalates, and records why, when the model cannot be reached', async () => {
    const result = await ask('fees?', ai(new Error('AI_UNREACHABLE: nope')));

    expect(result).toEqual({ outcome: 'ESCALATE' });
    expect(store.logged[0]).toMatchObject({ status: 'FAILED', reason: 'AI_UNREACHABLE' });
  });

  it('escalates when there is no key, without pretending to have tried', async () => {
    const result = await ask('fees?', unavailable);

    expect(result).toEqual({ outcome: 'ESCALATE' });
    expect(store.logged[0]).toMatchObject({ status: 'FAILED', reason: 'NO_AI_KEY' });
  });

  it('refuses an empty question rather than asking the model about nothing', async () => {
    expect(await ask('   ', ai('hello'))).toEqual({ outcome: 'OFF' });
    expect(store.logged).toEqual([]);
  });

  it('escalates every question when the gym has written nothing down', async () => {
    // With no knowledge base the only honest answer is "let me ask somebody".
    store.documents = [];
    const result = await ask('fees?', ai(ESCALATE_MARKER));
    expect(result).toEqual({ outcome: 'ESCALATE' });
  });
});
