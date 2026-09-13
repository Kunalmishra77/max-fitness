import { z } from 'zod';

/**
 * Environment validation.
 *
 * TRD §9: the app refuses to start when required variables are missing or wrong,
 * rather than failing later with a confusing error at the point of use. Every
 * variable here is documented in the root `.env.example` (CLAUDE.md §2.12).
 *
 * Nothing in this file ever prints a value. Connection strings and secrets appear
 * only as key names in error messages (CLAUDE.md §2.8, override 8).
 */

const bool = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const requiredString = (message: string) => z.string().min(1, message);

const postgresUrl = (label: string) =>
  z
    .string()
    .min(1, `${label} is required`)
    .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
      message: `${label} must be a postgres:// or postgresql:// connection string`,
    });

const optionalPostgresUrl = (label: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? undefined : v))
    .refine((v) => v === undefined || v.startsWith('postgres://') || v.startsWith('postgresql://'), {
      message: `${label} must be a postgres:// or postgresql:// connection string when set`,
    });

/** A comma-separated allowlist of E.164 numbers. */
const csvList = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );

export const EnvSchema = z
  .object({
    // ── App ─────────────────────────────────────────────────────────────
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_URL: z.string().url('APP_URL must be an absolute URL').default('http://localhost:3000'),
    APP_TIMEZONE: z.literal('Asia/Kolkata').default('Asia/Kolkata'),
    DEMO_MODE: bool(true),
    ALLOW_DEMO_IN_PRODUCTION: bool(false),
    GYM_SLUG: requiredString('GYM_SLUG is required').default('max-fitness-indirapuram'),

    // ── Database (ADR-010) ──────────────────────────────────────────────
    /** Supavisor transaction pooler, :6543. Runtime queries from apps/web. */
    DATABASE_URL: postgresUrl('DATABASE_URL'),
    /** Supavisor session pooler, :5432. Migrations, seed and the pg-boss worker. */
    DIRECT_URL: postgresUrl('DIRECT_URL'),
    /** Optional: only when `prisma migrate dev` cannot create its own shadow database. */
    SHADOW_DATABASE_URL: optionalPostgresUrl('SHADOW_DATABASE_URL'),
    /** Optional: integration tests skip themselves when this is unset. */
    TEST_DATABASE_URL: optionalPostgresUrl('TEST_DATABASE_URL'),

    // ── Security ────────────────────────────────────────────────────────
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    LINK_TOKEN_SECRET: z.string().min(32, 'LINK_TOKEN_SECRET must be at least 32 characters'),
    KIOSK_TOKEN_PEPPER: z.string().min(32, 'KIOSK_TOKEN_PEPPER must be at least 32 characters'),
    FIELD_ENCRYPTION_KEY: z.string().min(1, 'FIELD_ENCRYPTION_KEY is required'),

    // ── Storage ─────────────────────────────────────────────────────────
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_PATH: z.string().default('./storage'),
    S3_ENDPOINT: z.string().default(''),
    S3_REGION: z.string().default(''),
    S3_BUCKET: z.string().default(''),
    S3_ACCESS_KEY_ID: z.string().default(''),
    S3_SECRET_ACCESS_KEY: z.string().default(''),

    // ── Payments ────────────────────────────────────────────────────────
    RAZORPAY_KEY_ID: z.string().default(''),
    RAZORPAY_KEY_SECRET: z.string().default(''),
    RAZORPAY_WEBHOOK_SECRET: z.string().default(''),

    // ── WhatsApp ────────────────────────────────────────────────────────
    WHATSAPP_PROVIDER: z.enum(['simulator', 'meta_cloud', 'bsp']).default('simulator'),
    WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
    WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().default(''),
    WHATSAPP_ACCESS_TOKEN: z.string().default(''),
    WHATSAPP_APP_SECRET: z.string().default(''),
    WHATSAPP_VERIFY_TOKEN: z.string().default(''),
    WHATSAPP_GRAPH_API_VERSION: z.string().default(''),
    WHATSAPP_ALLOWLIST: csvList,
    OWNER_WHATSAPP_NUMBER: z.string().default(''),

    // ── Observability ───────────────────────────────────────────────────
    SENTRY_DSN: z.string().default(''),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    // ── Analytics ───────────────────────────────────────────────────────
    NEXT_PUBLIC_PLAUSIBLE_DOMAIN: z.string().default(''),
    NEXT_PUBLIC_GA4_ID: z.string().default(''),
    NEXT_PUBLIC_META_PIXEL_ID: z.string().default(''),

    // ── Worker ──────────────────────────────────────────────────────────
    WORKER_ID: z.string().min(1).default('worker-main'),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
    WORKER_DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(3),

    // ── Seed ────────────────────────────────────────────────────────────
    SEED_TODAY: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v.trim() === '' ? undefined : v))
      .refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), {
        message: 'SEED_TODAY must be YYYY-MM-DD when set',
      }),
  })
  // CLAUDE.md §2.7 and security-plan.md §6: demo mode in production would simulate
  // payments and swallow real messages. It takes a deliberate second flag to allow it.
  .refine((env) => !(env.NODE_ENV === 'production' && env.DEMO_MODE && !env.ALLOW_DEMO_IN_PRODUCTION), {
    message:
      'DEMO_MODE=true is refused when NODE_ENV=production. Set ALLOW_DEMO_IN_PRODUCTION=true only for a deliberate demo deployment.',
    path: ['DEMO_MODE'],
  })
  // A real WhatsApp provider needs its credentials; discovering that at send time
  // means a member silently gets no reminder.
  .refine((env) => env.WHATSAPP_PROVIDER === 'simulator' || env.WHATSAPP_ACCESS_TOKEN.length > 0, {
    message: 'WHATSAPP_ACCESS_TOKEN is required when WHATSAPP_PROVIDER is not "simulator"',
    path: ['WHATSAPP_ACCESS_TOKEN'],
  })
  .refine((env) => env.WHATSAPP_PROVIDER === 'simulator' || env.WHATSAPP_APP_SECRET.length > 0, {
    message: 'WHATSAPP_APP_SECRET is required to verify webhooks when not using the simulator',
    path: ['WHATSAPP_APP_SECRET'],
  })
  .refine((env) => env.STORAGE_DRIVER === 'local' || env.S3_BUCKET.length > 0, {
    message: 'S3_BUCKET is required when STORAGE_DRIVER is "s3"',
    path: ['S3_BUCKET'],
  })
  // Real payments need real keys. Only a production deployment that is NOT in demo
  // mode takes money; a deliberate demo deployment uses the simulated gateway.
  .refine((env) => env.NODE_ENV !== 'production' || env.DEMO_MODE || env.RAZORPAY_KEY_SECRET.length > 0, {
    message: 'RAZORPAY_KEY_SECRET is required in production when DEMO_MODE is off',
    path: ['RAZORPAY_KEY_SECRET'],
  });

export type Env = z.infer<typeof EnvSchema>;

export class EnvValidationError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Invalid environment:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Validate the environment and return a typed, frozen view of it.
 *
 * Throws `EnvValidationError` listing every problem at once — fixing one variable
 * per restart is a miserable way to set up a deployment. The message names keys and
 * says what is wrong; it never echoes a value.
 */
export function parseEnv(source: NodeJS.ProcessEnv | Record<string, unknown> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(root)';
      return `${key}: ${issue.message}`;
    });
    throw new EnvValidationError(issues);
  }
  return Object.freeze(result.data);
}

let cached: Env | undefined;

/** Parse once per process. Call `resetEnvCache()` between tests. */
export function env(source?: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  cached ??= parseEnv(source);
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}

/** True when payments are simulated and WhatsApp goes to the in-app simulator (CLAUDE.md §2.7). */
export function isDemoMode(e: Env): boolean {
  return e.DEMO_MODE;
}

/**
 * In demo mode a real send is allowed only to an allowlisted number
 * (CLAUDE.md §2.7, seed spec §1). Everything else goes to the simulator.
 */
export function canSendRealWhatsApp(e: Env, toE164Number: string): boolean {
  if (!e.DEMO_MODE) return true;
  return e.WHATSAPP_ALLOWLIST.includes(toE164Number);
}
