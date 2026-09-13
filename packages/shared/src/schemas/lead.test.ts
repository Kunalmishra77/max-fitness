import { describe, expect, it } from 'vitest';
import { LEAD_ERROR_CODES, LeadCreateSchema, LeadFormSchema, leadIssueField } from './lead';

const valid = {
  name: 'Neha Gupta',
  mobile: '98765 43210',
  goal: 'LOSE_WEIGHT',
  consentContact: true,
} as const;

function codes(input: unknown): string[] {
  const result = LeadCreateSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe('LeadFormSchema — the fields a visitor fills in', () => {
  it('accepts a real name, an Indian mobile in any common format, and a goal', () => {
    for (const mobile of ['9876543210', '+91 98765 43210', '09876543210']) {
      expect(LeadFormSchema.safeParse({ ...valid, mobile }).success, mobile).toBe(true);
    }
  });

  it('trims the name', () => {
    const parsed = LeadFormSchema.parse({ ...valid, name: '  Neha  ' });
    expect(parsed.name).toBe('Neha');
  });

  it('rejects a one-letter or empty name with the "name" code', () => {
    expect(codes({ ...valid, name: 'N' })).toContain('name');
    expect(codes({ ...valid, name: '   ' })).toContain('name');
  });

  it('rejects a name longer than 80 characters', () => {
    expect(codes({ ...valid, name: 'x'.repeat(81) })).toContain('name');
  });

  it('rejects numbers that are not Indian mobiles with the "mobile" code', () => {
    for (const mobile of ['12345', '5876543210', '+14155552671', '']) {
      expect(codes({ ...valid, mobile }), mobile).toContain('mobile');
    }
  });

  it('rejects an unknown goal with the "goal" code', () => {
    expect(codes({ ...valid, goal: 'BECOME_ASTRONAUT' })).toContain('goal');
  });
});

describe('LeadCreateSchema — the request body', () => {
  it('defaults the source to the hero form', () => {
    expect(LeadCreateSchema.parse(valid).source).toBe('WEBSITE_HERO');
  });

  it('accepts UTM parameters and bot signals', () => {
    const parsed = LeadCreateSchema.parse({
      ...valid,
      source: 'WEBSITE_OTHER',
      utm: { source: 'google', medium: 'gbp' },
      company: '',
      renderedAt: 1_757_491_200_000,
    });
    expect(parsed.utm).toEqual({ source: 'google', medium: 'gbp' });
  });

  it('requires the contact consent to be exactly true', () => {
    expect(codes({ ...valid, consentContact: false })).toContain('consent');
    expect(codes({ name: valid.name, mobile: valid.mobile, goal: valid.goal })).toContain('consent');
  });

  it('refuses sources staff record, so a public form cannot claim to be a walk-in', () => {
    expect(LeadCreateSchema.safeParse({ ...valid, source: 'WALK_IN' }).success).toBe(false);
  });

  it('rejects unknown keys rather than silently storing them', () => {
    expect(LeadCreateSchema.safeParse({ ...valid, isAdmin: true }).success).toBe(false);
    expect(LeadCreateSchema.safeParse({ ...valid, utm: { source: 'x', evil: 'y' } }).success).toBe(false);
  });

  it('caps UTM values so a crafted URL cannot store a novel', () => {
    expect(LeadCreateSchema.safeParse({ ...valid, utm: { source: 'x'.repeat(101) } }).success).toBe(false);
  });

  it('uses only error codes that exist in the message catalogue', () => {
    const produced = new Set([
      ...codes({ ...valid, name: '' }),
      ...codes({ ...valid, mobile: '1' }),
      ...codes({ ...valid, goal: 'X' }),
      ...codes({ ...valid, consentContact: false }),
    ]);
    for (const code of produced) {
      expect(LEAD_ERROR_CODES as readonly string[]).toContain(code);
    }
  });
});

describe('leadIssueField', () => {
  it('returns the first path segment when it names a field', () => {
    expect(leadIssueField(['mobile'])).toBe('mobile');
    expect(leadIssueField(['utm', 'source'])).toBe('utm');
    expect(leadIssueField([])).toBeNull();
    expect(leadIssueField([0])).toBeNull();
  });
});
