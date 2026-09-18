import { parseEnv, systemClock, type Clock, type Env } from '@mfp/shared';
import {
  getPrismaClient,
  PrismaCheckoutUnitOfWork,
  PrismaMessageLogWriter,
  PrismaPaymentConfirmationUnitOfWork,
  PrismaRegistrationUnitOfWork,
  PrismaWebhookEventStore,
  type PrismaClient,
} from '@mfp/db';
import type { CheckoutUnitOfWork, PaymentConfirmationUnitOfWork, RegistrationUnitOfWork, WebhookEventStore } from '@mfp/core';
import type { MessageLogWriter, PaymentProvider, StorageDriver, WhatsAppProvider } from '@mfp/core/ports';
import { createStorageDriver } from '@mfp/integrations/storage';
import { SimulatedPaymentProvider, RazorpayPaymentProvider } from '@mfp/integrations/payments';
import { SimulatorWhatsAppProvider, MetaCloudWhatsAppProvider } from '@mfp/integrations/whatsapp';
import { SimulatedOtpSender, WhatsAppOtpSender } from '@mfp/integrations/otp';
import type { OtpSender } from '@mfp/core';

/**
 * Dependency wiring for the web app.
 *
 * system-architecture.md §3: adapters are chosen here, at the application
 * boundary, and injected into `packages/core` as interfaces. This is the only file
 * in the web app that knows whether payments are real or simulated, or where files
 * are stored — a domain rule never asks.
 */

export interface Container {
  readonly env: Env;
  readonly clock: Clock;
  readonly prisma: PrismaClient;
  readonly messageLog: MessageLogWriter;
  readonly whatsapp: WhatsAppProvider;
  /** DEMO_MODE shows the code on screen instead of sending it (ADR-060). */
  readonly otpSender: OtpSender;
  readonly payments: PaymentProvider;
  /** The same object as `payments` in DEMO_MODE, for the pay dialog; otherwise `null`. */
  readonly simulator: SimulatedPaymentProvider | null;
  readonly storage: StorageDriver;
  readonly registrationUow: RegistrationUnitOfWork;
  readonly checkoutUow: CheckoutUnitOfWork;
  readonly paymentUow: PaymentConfirmationUnitOfWork;
  readonly webhookEvents: WebhookEventStore;
}

/**
 * Held on `globalThis`, like the Prisma client. Next.js may evaluate this module more
 * than once — on every dev reload, and separately for route handlers and pages — and
 * the simulated gateway keeps its orders in memory: an order created by one route
 * must still be known to the next.
 */
const globalForContainer = globalThis as unknown as { __mfpContainer?: Container };

export function getContainer(): Container {
  globalForContainer.__mfpContainer ??= build();
  return globalForContainer.__mfpContainer;
}

function build(): Container {
  const env = parseEnv();
  const clock = systemClock;

  // Transaction pooler (:6543) with a small pool — the pooler is the real pool (ADR-010).
  const prisma = getPrismaClient({
    connectionString: env.DATABASE_URL,
    poolMax: 5,
    logQueries: env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace',
  });

  const messageLog = new PrismaMessageLogWriter(prisma);

  // The local folder, or the private Supabase bucket over S3 (ADR-055) — the worker
  // builds its driver the same way, so both always read the same place.
  const storage: StorageDriver = createStorageDriver(env);

  // CLAUDE.md §2.7: in demo mode payments are simulated and WhatsApp goes to the
  // in-app simulator, which will still make a real send to an allowlisted number.
  const simulator = env.DEMO_MODE ? new SimulatedPaymentProvider() : null;
  const payments: PaymentProvider =
    simulator ??
    new RazorpayPaymentProvider({
      keyId: env.RAZORPAY_KEY_ID,
      keySecret: env.RAZORPAY_KEY_SECRET,
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    });

  const realWhatsApp =
    env.WHATSAPP_PROVIDER === 'meta_cloud'
      ? new MetaCloudWhatsAppProvider({
          phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
          accessToken: env.WHATSAPP_ACCESS_TOKEN,
          graphApiVersion: env.WHATSAPP_GRAPH_API_VERSION,
          appSecret: env.WHATSAPP_APP_SECRET,
        })
      : undefined;

  const whatsapp: WhatsAppProvider =
    env.DEMO_MODE || realWhatsApp === undefined
      ? new SimulatorWhatsAppProvider({
          gymId: env.GYM_SLUG,
          log: messageLog,
          allowlist: env.WHATSAPP_ALLOWLIST,
          ...(realWhatsApp === undefined ? {} : { realProvider: realWhatsApp }),
        })
      : realWhatsApp;

  const otpSender: OtpSender = env.DEMO_MODE ? new SimulatedOtpSender() : new WhatsAppOtpSender(whatsapp);

  return {
    env,
    clock,
    prisma,
    messageLog,
    whatsapp,
    otpSender,
    payments,
    simulator,
    storage,
    registrationUow: new PrismaRegistrationUnitOfWork(prisma),
    checkoutUow: new PrismaCheckoutUnitOfWork(prisma),
    paymentUow: new PrismaPaymentConfirmationUnitOfWork(prisma),
    webhookEvents: new PrismaWebhookEventStore(prisma, clock),
  };
}
