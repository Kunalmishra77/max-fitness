import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

/**
 * The Prisma client (ADR-010).
 *
 * Runtime queries go through Supavisor's **transaction** pooler on :6543, which
 * multiplexes many short-lived web requests onto few backend connections. The pool
 * here is deliberately small: with a pooler in front, a large client-side pool
 * buys nothing and just uses up the project's connection budget.
 *
 * Transaction mode does not support prepared statements. `@prisma/adapter-pg` runs
 * on node-postgres, which issues unnamed queries, so no `pgbouncer=true` flag is
 * needed — Prisma explicitly recommends against that flag for PgBouncer ≥ 1.21.
 * If this ever regresses, appending `pgbouncer=true` to `DATABASE_URL` is the
 * documented fallback.
 */

export interface PrismaClientOptions {
  /** Transaction pooler for the web app; session pooler for the worker and seed. */
  readonly connectionString: string;
  /** Web: 5. Worker: 3. Seed: 3-5. Keep it small — the pooler is the real pool. */
  readonly poolMax?: number;
  readonly logQueries?: boolean;
}

export function createPrismaClient(options: PrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.connectionString,
    max: options.poolMax ?? 5,
    // Supabase is a network hop away, so a connection that cannot be established
    // should fail fast rather than hold a request open.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

  return new PrismaClient({
    adapter,
    // No 'error' level: every query error is thrown to our code, which handles it and
    // decides what is safe to show. Prisma's own error log prints the raw driver
    // message — including the database username / Supabase project ref — and Next
    // dev forwards server logs to the browser console (CLAUDE.md §2.8).
    log: options.logQueries === true ? ['query', 'warn'] : ['warn'],
  });
}

/**
 * A process-wide singleton.
 *
 * Next.js dev reloads modules on every edit; without stashing the client on
 * `globalThis` each reload would open another pool and exhaust the pooler within
 * a few minutes of editing.
 */
const globalForPrisma = globalThis as unknown as { __mfpPrisma?: PrismaClient };

export function getPrismaClient(options: PrismaClientOptions): PrismaClient {
  globalForPrisma.__mfpPrisma ??= createPrismaClient(options);
  return globalForPrisma.__mfpPrisma;
}

export async function disconnectPrisma(): Promise<void> {
  const client = globalForPrisma.__mfpPrisma;
  if (client !== undefined) {
    await client.$disconnect();
    delete globalForPrisma.__mfpPrisma;
  }
}

export type { PrismaClient };

/** A transaction handle: the same API as the client, minus the connection controls. */
export type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

/**
 * Run work in one transaction.
 *
 * TRD §5: renewals, unsubscribe and verification approval each run in a single
 * transaction, with side effects enqueued to the outbox *inside* it — so nothing is
 * sent for work that rolled back (system-architecture.md §5).
 *
 * The timeout is generous because the database is a network hop away, but not so
 * generous that a stuck transaction holds a pooler connection all day.
 */
export async function withTransaction<T>(
  client: PrismaClient,
  fn: (tx: TransactionClient) => Promise<T>,
  options: { timeoutMs?: number; maxWaitMs?: number } = {},
): Promise<T> {
  return client.$transaction(fn, {
    timeout: options.timeoutMs ?? 15_000,
    maxWait: options.maxWaitMs ?? 5_000,
  });
}
