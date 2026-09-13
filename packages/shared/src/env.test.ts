import { describe, expect, it } from 'vitest';
import { EnvValidationError, canSendRealWhatsApp, isDemoMode, parseEnv } from './env';

const SECRET = 'x'.repeat(48);

/** The smallest environment that boots. */
function base(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    DATABASE_URL: 'postgresql://user:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
    DIRECT_URL: 'postgresql://user:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres',
    SESSION_SECRET: SECRET,
    LINK_TOKEN_SECRET: SECRET,
    KIOSK_TOKEN_PEPPER: SECRET,
    FIELD_ENCRYPTION_KEY: 'base64:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    ...overrides,
  };
}

describe('parseEnv — defaults', () => {
  it('applies the documented defaults', () => {
    const env = parseEnv(base());
    expect(env.NODE_ENV).toBe('development');
    expect(env.APP_URL).toBe('http://localhost:3000');
    expect(env.APP_TIMEZONE).toBe('Asia/Kolkata');
    expect(env.DEMO_MODE).toBe(true);
    expect(env.GYM_SLUG).toBe('max-fitness-indirapuram');
    expect(env.STORAGE_DRIVER).toBe('local');
    expect(env.STORAGE_LOCAL_PATH).toBe('./storage');
    expect(env.WHATSAPP_PROVIDER).toBe('simulator');
    expect(env.WORKER_ID).toBe('worker-main');
    expect(env.WORKER_CONCURRENCY).toBe(4);
    expect(env.WORKER_DB_POOL_MAX).toBe(3);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('leaves the optional database URLs undefined rather than empty strings', () => {
    const env = parseEnv(base({ SHADOW_DATABASE_URL: '', TEST_DATABASE_URL: '   ' }));
    expect(env.SHADOW_DATABASE_URL).toBeUndefined();
    expect(env.TEST_DATABASE_URL).toBeUndefined();
  });

  it('returns a frozen object so nothing can mutate config at runtime', () => {
    const env = parseEnv(base());
    expect(Object.isFrozen(env)).toBe(true);
  });
});

describe('parseEnv — boolean coercion', () => {
  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['yes', true],
    ['on', true],
    ['false', false],
    ['0', false],
    ['no', false],
    ['', false],
    ['anything else', false],
  ])('reads DEMO_MODE=%s as %s', (raw, expected) => {
    expect(parseEnv(base({ DEMO_MODE: raw })).DEMO_MODE).toBe(expected);
  });
});

describe('parseEnv — database URLs (ADR-010)', () => {
  it('requires both DATABASE_URL and DIRECT_URL', () => {
    const withoutDirect = base();
    delete withoutDirect['DIRECT_URL'];
    expect(() => parseEnv(withoutDirect)).toThrow(/DIRECT_URL/);
  });

  it('rejects a URL that is not a postgres connection string', () => {
    expect(() => parseEnv(base({ DATABASE_URL: 'mysql://localhost/db' }))).toThrow(/DATABASE_URL/);
    expect(() => parseEnv(base({ TEST_DATABASE_URL: 'not-a-url' }))).toThrow(/TEST_DATABASE_URL/);
  });

  it('accepts both postgres:// and postgresql:// spellings', () => {
    expect(() => parseEnv(base({ DATABASE_URL: 'postgres://u:p@host:6543/db' }))).not.toThrow();
  });
});

describe('parseEnv — the demo-mode production guard (CLAUDE.md §2.7)', () => {
  const production = {
    NODE_ENV: 'production',
    RAZORPAY_KEY_SECRET: 'secret',
  };

  it('refuses DEMO_MODE=true in production', () => {
    expect(() => parseEnv(base({ ...production, DEMO_MODE: 'true' }))).toThrow(EnvValidationError);
    expect(() => parseEnv(base({ ...production, DEMO_MODE: 'true' }))).toThrow(/DEMO_MODE/);
  });

  it('allows it only with the explicit override', () => {
    const env = parseEnv(base({ ...production, DEMO_MODE: 'true', ALLOW_DEMO_IN_PRODUCTION: 'true' }));
    expect(env.DEMO_MODE).toBe(true);
    expect(isDemoMode(env)).toBe(true);
  });

  it('allows DEMO_MODE=false in production without the override', () => {
    expect(() => parseEnv(base({ ...production, DEMO_MODE: 'false' }))).not.toThrow();
  });

  it('allows DEMO_MODE=true outside production', () => {
    expect(() => parseEnv(base({ NODE_ENV: 'development', DEMO_MODE: 'true' }))).not.toThrow();
  });
});

describe('parseEnv — provider credentials must be present before they are needed', () => {
  it('demands a WhatsApp token once the provider is real', () => {
    expect(() => parseEnv(base({ WHATSAPP_PROVIDER: 'meta_cloud' }))).toThrow(/WHATSAPP_ACCESS_TOKEN/);
  });

  it('demands an app secret to verify webhook signatures', () => {
    expect(() =>
      parseEnv(base({ WHATSAPP_PROVIDER: 'meta_cloud', WHATSAPP_ACCESS_TOKEN: 'tok' })),
    ).toThrow(/WHATSAPP_APP_SECRET/);
  });

  it('is satisfied when both are set', () => {
    expect(() =>
      parseEnv(
        base({ WHATSAPP_PROVIDER: 'meta_cloud', WHATSAPP_ACCESS_TOKEN: 'tok', WHATSAPP_APP_SECRET: 'sec' }),
      ),
    ).not.toThrow();
  });

  it('demands a bucket when storage is S3', () => {
    expect(() => parseEnv(base({ STORAGE_DRIVER: 's3' }))).toThrow(/S3_BUCKET/);
  });
});

describe('parseEnv — payment keys in production', () => {
  it('refuses a live production deployment without a Razorpay secret', () => {
    expect(() => parseEnv(base({ NODE_ENV: 'production', DEMO_MODE: 'false' }))).toThrow(/RAZORPAY_KEY_SECRET/);
  });

  it('boots a live production deployment once the secret is set', () => {
    expect(() =>
      parseEnv(base({ NODE_ENV: 'production', DEMO_MODE: 'false', RAZORPAY_KEY_SECRET: 'secret' })),
    ).not.toThrow();
  });

  it('does not demand Razorpay keys for a deliberate demo deployment, which simulates payments', () => {
    expect(() =>
      parseEnv(base({ NODE_ENV: 'production', DEMO_MODE: 'true', ALLOW_DEMO_IN_PRODUCTION: 'true' })),
    ).not.toThrow();
  });

  it('does not demand Razorpay keys in development', () => {
    expect(() => parseEnv(base({ NODE_ENV: 'development', DEMO_MODE: 'false' }))).not.toThrow();
  });
});

describe('parseEnv — secret strength', () => {
  it('rejects a short signing secret', () => {
    expect(() => parseEnv(base({ SESSION_SECRET: 'too-short' }))).toThrow(/SESSION_SECRET/);
    expect(() => parseEnv(base({ LINK_TOKEN_SECRET: 'short' }))).toThrow(/LINK_TOKEN_SECRET/);
    expect(() => parseEnv(base({ KIOSK_TOKEN_PEPPER: 'short' }))).toThrow(/KIOSK_TOKEN_PEPPER/);
  });
});

describe('parseEnv — error reporting', () => {
  it('reports every problem at once, not one per restart', () => {
    const broken = base({ SESSION_SECRET: 'short', DATABASE_URL: 'nope', LOG_LEVEL: 'chatty' });
    try {
      parseEnv(broken);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues;
      expect(issues.length).toBeGreaterThanOrEqual(3);
      expect(issues.join('\n')).toMatch(/SESSION_SECRET/);
      expect(issues.join('\n')).toMatch(/DATABASE_URL/);
      expect(issues.join('\n')).toMatch(/LOG_LEVEL/);
    }
  });

  it('never echoes a secret or a connection string into the message (override 8)', () => {
    const secretValue = 'super-secret-password-value';
    const broken = base({
      DATABASE_URL: `mysql://user:${secretValue}@host/db`,
      SESSION_SECRET: secretValue,
    });
    try {
      parseEnv(broken);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain(secretValue);
    }
  });
});

describe('SEED_TODAY', () => {
  it('accepts a YYYY-MM-DD value', () => {
    expect(parseEnv(base({ SEED_TODAY: '2026-09-10' })).SEED_TODAY).toBe('2026-09-10');
  });

  it('treats blank as absent', () => {
    expect(parseEnv(base({ SEED_TODAY: '' })).SEED_TODAY).toBeUndefined();
  });

  it('rejects any other format', () => {
    expect(() => parseEnv(base({ SEED_TODAY: '10-09-2026' }))).toThrow(/SEED_TODAY/);
  });
});

describe('canSendRealWhatsApp — the demo allowlist (CLAUDE.md §2.7)', () => {
  it('blocks every number not on the allowlist while in demo mode', () => {
    const env = parseEnv(base({ DEMO_MODE: 'true', WHATSAPP_ALLOWLIST: '+919999999999, +918888888888' }));
    expect(canSendRealWhatsApp(env, '+919999999999')).toBe(true);
    expect(canSendRealWhatsApp(env, '+918888888888')).toBe(true);
    // A seeded demo member must never receive a real message (seed spec §1).
    expect(canSendRealWhatsApp(env, '+919000010188')).toBe(false);
  });

  it('blocks everything when the allowlist is empty', () => {
    const env = parseEnv(base({ DEMO_MODE: 'true' }));
    expect(env.WHATSAPP_ALLOWLIST).toEqual([]);
    expect(canSendRealWhatsApp(env, '+919999999999')).toBe(false);
  });

  it('allows any number once demo mode is off', () => {
    const env = parseEnv(base({ DEMO_MODE: 'false' }));
    expect(canSendRealWhatsApp(env, '+919000010188')).toBe(true);
  });
});
