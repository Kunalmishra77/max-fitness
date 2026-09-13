import { describe, expect, it } from 'vitest';
import type { E164Mobile, WhatsAppSendRequest } from '@mfp/core/ports';
import { InMemoryMessageLog, SimulatorWhatsAppProvider } from './simulator';
import { BUTTON_LABELS, daysLeftPhrase, renderTemplate, templateDefinition } from './templates';

const TO = '+919000010188' as E164Mobile;
const ALLOWED = '+919999999999' as E164Mobile;

function request(overrides: Partial<WhatsAppSendRequest> = {}): WhatsAppSendRequest {
  return {
    to: TO,
    templateName: 'mf_renewal_due',
    language: 'en',
    variables: { firstName: 'Anita', endDate: '17 Sep 2026', whenPhrase: 'in 7 days' },
    idempotencyKey: 'rem:mem_1:mship_1:PRE_7:2026-09-10:10:00',
    ...overrides,
  };
}

describe('renderTemplate', () => {
  it('substitutes the ordered variables into the English body', () => {
    const body = renderTemplate('mf_renewal_due', 'en', {
      firstName: 'Anita',
      endDate: '17 Sep 2026',
      whenPhrase: 'in 7 days',
    });
    expect(body).toContain('Hi Anita, your Max Fitness Gym membership ends on 17 Sep 2026 (in 7 days).');
    expect(body).toContain('please unsubscribe');
  });

  it('renders the Hindi body', () => {
    const body = renderTemplate('mf_renewal_due', 'hi', {
      firstName: 'अनीता',
      endDate: '17 सित 2026',
      whenPhrase: '7 दिन बाद',
    });
    expect(body).toContain('नमस्ते अनीता');
    expect(body).toContain('17 सित 2026 (7 दिन बाद)');
  });

  it('appends the footer with the gym address', () => {
    expect(renderTemplate('mf_renewal_due', 'en', {})).toContain('Nyay Khand 1, Indirapuram');
  });

  it('leaves a visible placeholder for a missing variable rather than an empty gap', () => {
    const body = renderTemplate('mf_renewal_due', 'en', { firstName: 'Anita' });
    expect(body).toContain('Hi Anita');
    expect(body).toContain('{{2}}');
  });

  it('renders the payment receipt with all six variables', () => {
    const body = renderTemplate('mf_payment_receipt', 'en', {
      firstName: 'Rohit',
      amount: '₹4,000',
      planName: '3 months',
      startDate: '10 Sep 2026',
      endDate: '9 Dec 2026',
      receiptNo: 'MF/2026-27/000123',
    });
    expect(body).toContain('Payment received. Thank you, Rohit.');
    expect(body).toContain('Amount: ₹4,000');
    expect(body).toContain('Receipt no: MF/2026-27/000123');
    expect(body).not.toContain('{{');
  });

  it('covers the four templates the reminder engine and receipts need', () => {
    for (const name of [
      'mf_renewal_due',
      'mf_renewal_due_today',
      'mf_membership_expired',
      'mf_payment_receipt',
    ] as const) {
      const def = templateDefinition(name);
      expect(def.name, name).toBe(name);
      expect(def.body.en.length, name).toBeGreaterThan(0);
      expect(def.body.hi.length, name).toBeGreaterThan(0);
      expect(def.category, name).toBe('UTILITY');
    }
  });
});

describe('daysLeftPhrase — the {{3}} variable in T1', () => {
  it('reads naturally in English', () => {
    expect(daysLeftPhrase(7, 'en')).toBe('in 7 days');
    expect(daysLeftPhrase(2, 'en')).toBe('in 2 days');
    expect(daysLeftPhrase(1, 'en')).toBe('tomorrow');
    expect(daysLeftPhrase(0, 'en')).toBe('today');
  });

  it('reads naturally in Hindi', () => {
    expect(daysLeftPhrase(7, 'hi')).toBe('7 दिन बाद');
    expect(daysLeftPhrase(1, 'hi')).toBe('कल');
    expect(daysLeftPhrase(0, 'hi')).toBe('आज');
  });

  it('never says "in 0 days" or a negative count', () => {
    expect(daysLeftPhrase(-3, 'en')).toBe('today');
    expect(daysLeftPhrase(-3, 'hi')).toBe('आज');
  });
});

describe('button labels are translated', () => {
  it('has both languages for every button', () => {
    expect(BUTTON_LABELS.en.unsubscribe).toBe('Unsubscribe');
    expect(BUTTON_LABELS.hi.unsubscribe).toBe('अनसब्सक्राइब');
    expect(BUTTON_LABELS.hi.renew.length).toBeGreaterThan(0);
    expect(BUTTON_LABELS.hi.restart.length).toBeGreaterThan(0);
  });
});

describe('SimulatorWhatsAppProvider', () => {
  function build(options: { allowlist?: string[]; realProvider?: never } = {}) {
    const log = new InMemoryMessageLog();
    const provider = new SimulatorWhatsAppProvider({
      gymId: 'gym_1',
      log,
      allowlist: options.allowlist ?? [],
      ...(options.realProvider !== undefined ? { realProvider: options.realProvider } : {}),
    });
    return { log, provider };
  }

  it('simulates instead of sending, and logs the rendered preview', async () => {
    const { log, provider } = build();
    const outcome = await provider.send(request());

    expect(outcome.status).toBe('SIMULATED');
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toMatchObject({
      gymId: 'gym_1',
      direction: 'OUTBOUND',
      status: 'SIMULATED',
      templateName: 'mf_renewal_due',
      toNumber: TO,
    });
    expect(log.entries[0]?.bodyPreview).toContain('Hi Anita');
  });

  it('never sends to a seeded demo number, even though it looks real (seed spec §1)', async () => {
    const { provider } = build({ allowlist: [ALLOWED] });
    const outcome = await provider.send(request({ to: TO }));
    expect(outcome.status).toBe('SIMULATED');
  });

  it('BR-5.3 rule 6 — a repeated idempotency key is skipped, not sent twice', async () => {
    const { log, provider } = build();
    const first = await provider.send(request());
    const second = await provider.send(request());

    expect(first.status).toBe('SIMULATED');
    expect(second).toEqual({ status: 'SKIPPED', reason: 'ALREADY_SENT' });
    expect(log.entries).toHaveLength(1);
  });

  it('R19 — two members sharing a number each get their own message', async () => {
    const { log, provider } = build();
    await provider.send(request({ idempotencyKey: 'rem:mem_1:m1:PRE_7:2026-09-10:10:00' }));
    await provider.send(
      request({
        idempotencyKey: 'rem:mem_2:m2:PRE_7:2026-09-10:10:00',
        variables: { firstName: 'Rohit', endDate: '17 Sep 2026', whenPhrase: 'in 7 days' },
      }),
    );

    expect(log.entries).toHaveLength(2);
    expect(log.entries[0]?.bodyPreview).toContain('Anita');
    expect(log.entries[1]?.bodyPreview).toContain('Rohit');
  });

  it('records the member and membership when a context resolver is wired', async () => {
    const log = new InMemoryMessageLog();
    const provider = new SimulatorWhatsAppProvider({
      gymId: 'gym_1',
      log,
      allowlist: [],
      resolveContext: () => ({
        memberId: 'mem_1',
        membershipId: 'mship_1',
        purpose: 'REMINDER',
        ruleCode: 'PRE_7',
      }),
    });

    await provider.send(request());
    expect(log.entries[0]).toMatchObject({
      memberId: 'mem_1',
      membershipId: 'mship_1',
      purpose: 'REMINDER',
      ruleCode: 'PRE_7',
    });
  });

  it('stores the variables and buttons on the log row for the simulator UI', async () => {
    const { log, provider } = build();
    await provider.send(
      request({ buttons: [{ payload: 'UNSUB.tok', label: 'Unsubscribe' }] }),
    );
    expect(log.entries[0]?.payload).toMatchObject({
      buttons: [{ payload: 'UNSUB.tok', label: 'Unsubscribe' }],
    });
  });
});

describe('InMemoryMessageLog', () => {
  it('mirrors the database uniqueness constraint on idempotencyKey', async () => {
    const log = new InMemoryMessageLog();
    const entry = {
      gymId: 'g',
      memberId: null,
      membershipId: null,
      direction: 'OUTBOUND' as const,
      purpose: 'REMINDER' as const,
      ruleCode: null,
      templateName: null,
      language: null,
      toNumber: null,
      idempotencyKey: 'k',
      providerMessageId: null,
      status: 'SIMULATED' as const,
      bodyPreview: null,
      payload: null,
    };

    expect(await log.record(entry)).toBe(true);
    expect(await log.record(entry)).toBe(false);
    expect(log.entries).toHaveLength(1);
  });

  it('allows several rows with no idempotency key — inbound messages have none', async () => {
    const log = new InMemoryMessageLog();
    const entry = {
      gymId: 'g',
      memberId: null,
      membershipId: null,
      direction: 'INBOUND' as const,
      purpose: 'OTHER' as const,
      ruleCode: null,
      templateName: null,
      language: null,
      toNumber: null,
      idempotencyKey: null,
      providerMessageId: null,
      status: 'DELIVERED' as const,
      bodyPreview: null,
      payload: null,
    };

    expect(await log.record(entry)).toBe(true);
    expect(await log.record(entry)).toBe(true);
    expect(log.entries).toHaveLength(2);
  });

  it('clears itself between tests', async () => {
    const log = new InMemoryMessageLog();
    await log.record({
      gymId: 'g',
      memberId: null,
      membershipId: null,
      direction: 'OUTBOUND',
      purpose: 'OTHER',
      ruleCode: null,
      templateName: null,
      language: null,
      toNumber: null,
      idempotencyKey: 'k',
      providerMessageId: null,
      status: 'SIMULATED',
      bodyPreview: null,
      payload: null,
    });
    log.clear();
    expect(log.entries).toHaveLength(0);
    // The key set is cleared too, so the same key can be used again.
    expect(
      await log.record({
        gymId: 'g',
        memberId: null,
        membershipId: null,
        direction: 'OUTBOUND',
        purpose: 'OTHER',
        ruleCode: null,
        templateName: null,
        language: null,
        toNumber: null,
        idempotencyKey: 'k',
        providerMessageId: null,
        status: 'SIMULATED',
        bodyPreview: null,
        payload: null,
      }),
    ).toBe(true);
  });
});
