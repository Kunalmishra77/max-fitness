import { describe, expect, it } from 'vitest';
import { auditChanges, auditValue } from './audit-summary';

/**
 * CRM-AUDIT. The screen this feeds exists to show the owner what staff changed — so the
 * tests that matter are the ones proving it does not leak the data it is auditing. An
 * audit trail that exposes members' numbers is worse than no audit trail.
 */

describe('auditValue — what must never be shown', () => {
  it.each([
    'pinHash',
    'newPinHash',
    'staffPinHash',
    'pin',
    'tokenHash',
    'deviceToken',
    'webhookSecret',
    'password',
    'faceVector',
    'embedding',
    'faceTemplate',
    'signature',
    'otpCode',
    'apiKey',
  ])('masks %s on the strength of its name', (key) => {
    const shown = auditValue(key, 'the-actual-secret-value');
    expect(shown).not.toContain('the-actual-secret-value');
    expect(shown).toBe('[redacted]');
  });

  it('catches a sensitive key whatever its casing', () => {
    expect(auditValue('PIN_HASH', 'secret')).toBe('[redacted]');
    expect(auditValue('NewPinHash', 'secret')).toBe('[redacted]');
  });

  /**
   * The denylist matches key fragments, so a field nobody has thought of yet — added by a
   * future migration — is caught if it is named like the thing it holds. That is the whole
   * reason it works on names rather than values.
   */
  it('catches a field that does not exist yet but is named like a secret', () => {
    expect(auditValue('razorpayWebhookSecretRotatedTo', 'x')).toBe('[redacted]');
    expect(auditValue('kioskPairingTokenPepper', 'x')).toBe('[redacted]');
  });
});

describe('auditValue — what is masked rather than hidden', () => {
  it('masks a mobile number but leaves it recognisable', () => {
    const shown = auditValue('mobile', '+919876543210');
    expect(shown).not.toBe('+919876543210');
    expect(shown).not.toBe('[redacted]');
    expect(shown).toContain('x');
  });

  it('masks an email address', () => {
    const shown = auditValue('email', 'neha@example.com');
    expect(shown).not.toBe('neha@example.com');
    expect(shown).not.toBe('[redacted]');
  });

  it('masks a member name', () => {
    expect(auditValue('fullName', 'Sanjay Tomar')).not.toBe('Sanjay Tomar');
  });

  it('masks a storage key, which points at a selfie or an ID card', () => {
    expect(auditValue('storageKey', 'selfies/abc123def456')).not.toBe('selfies/abc123def456');
  });
});

describe('auditValue — what is shown', () => {
  it('shows an ordinary field, which is the point of the screen', () => {
    expect(auditValue('endDate', '2026-10-31')).toBe('2026-10-31');
    expect(auditValue('amountPaise', 400000)).toBe('400000');
    expect(auditValue('isActive', false)).toBe('false');
  });

  it('says nothing for an absent value rather than writing "null"', () => {
    expect(auditValue('endDate', null)).toBeNull();
    expect(auditValue('endDate', undefined)).toBeNull();
  });

  it('summarises a nested object instead of printing a blob', () => {
    // Recursing would need the denylist to hold at every depth, and nobody reads a blob.
    expect(auditValue('settings', { a: 1, b: 2 })).toBe('{…}');
    expect(auditValue('plans', [1, 2, 3])).toBe('[3]');
  });

  /**
   * The masker branch used to run before the shape check, so a key named `mobile` holding
   * an object rendered as the literal `[object Object]`. Harmless to read, and exactly the
   * sort of thing that becomes a leak the day a column changes type.
   */
  it('checks the shape before the name, so an object under a masked key is summarised', () => {
    expect(auditValue('mobile', { toString: () => 'leak' })).toBe('{…}');
    expect(auditValue('email', ['a@b.com'])).toBe('[1]');
    expect(auditValue('fullName', { first: 'Sanjay' })).toBe('{…}');
  });

  it('truncates a very long value so one row cannot become a wall', () => {
    const shown = auditValue('notes', 'x'.repeat(200));
    expect(shown?.length).toBeLessThanOrEqual(61);
    expect(shown?.endsWith('…')).toBe(true);
  });
});

describe('auditChanges', () => {
  it('lists only the fields that moved', () => {
    const changes = auditChanges(
      { endDate: '2026-09-30', planMonths: 1, fullName: 'Sanjay Tomar' },
      { endDate: '2026-10-31', planMonths: 1, fullName: 'Sanjay Tomar' },
    );
    // A row listing forty identical values hides the one that changed.
    expect(changes).toEqual([{ field: 'endDate', before: '2026-09-30', after: '2026-10-31' }]);
  });

  it('reads a field only in `after` as an addition, and only in `before` as a removal', () => {
    expect(auditChanges({}, { note: 'added' })).toEqual([{ field: 'note', before: null, after: 'added' }]);
    expect(auditChanges({ note: 'gone' }, {})).toEqual([{ field: 'note', before: 'gone', after: null }]);
  });

  /**
   * The ordering bug worth guarding: if masking ran before comparison, two *different*
   * mobile numbers would both render as the same mask and the change would vanish.
   */
  it('compares before masking, so a changed number is still a change', () => {
    const changes = auditChanges({ mobile: '+919876543210' }, { mobile: '+919811122233' });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.before).not.toBe(changes[0]?.after);
  });

  it('still reports that a secret changed, without saying what to', () => {
    const changes = auditChanges({ pinHash: 'old-hash' }, { pinHash: 'new-hash' });
    expect(changes).toEqual([{ field: 'pinHash', before: '[redacted]', after: '[redacted]' }]);
  });

  it('treats an absent field and an explicit null as the same', () => {
    expect(auditChanges({ note: null }, {})).toEqual([]);
    expect(auditChanges({}, { note: null })).toEqual([]);
  });

  it('copes with a row that has no snapshots at all', () => {
    // Most actions record what happened, not a diff — `member.export` has nothing to diff.
    expect(auditChanges(null, null)).toEqual([]);
    expect(auditChanges(undefined, undefined)).toEqual([]);
  });

  it('copes with a snapshot that is not an object', () => {
    expect(auditChanges('nonsense', 42)).toEqual([]);
  });

  it('shows a creation as every field appearing', () => {
    const changes = auditChanges(null, { endDate: '2026-10-31', planMonths: 1 });
    expect(changes.map((c) => c.field)).toEqual(['endDate', 'planMonths']);
    expect(changes.every((c) => c.before === null)).toBe(true);
  });

  it('sorts by field name, so the same change reads the same way twice', () => {
    const changes = auditChanges({ z: 1, a: 1 }, { z: 2, a: 2 });
    expect(changes.map((c) => c.field)).toEqual(['a', 'z']);
  });
});
