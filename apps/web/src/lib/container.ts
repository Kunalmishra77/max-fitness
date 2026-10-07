import { parseEnv, systemClock, type Clock, type Env } from '@mfp/shared';
import {
  getPrismaClient,
  PrismaCheckoutUnitOfWork,
  PrismaMessageLogWriter,
  PrismaPaymentConfirmationUnitOfWork,
  PrismaMandateChargeUnitOfWork,
  PrismaMandateStatusUnitOfWork,
  PrismaStartMandateUnitOfWork,
  PrismaRegistrationUnitOfWork,
  PrismaWebhookEventStore,
  type PrismaClient,
} from '@mfp/db';
import type {
  CheckoutUnitOfWork,
  MandateChargeUnitOfWork,
  MandateStatusUnitOfWork,
  PaymentConfirmationUnitOfWork,
  RegistrationUnitOfWork,
  StartMandateUnitOfWork,
  SubscriptionProvider,
  WebhookEventStore,
} from '@mfp/core';
import type { AiTextGenerator, MessageLogWriter, PaymentProvider, StorageDriver, WhatsAppProvider } from '@mfp/core/ports';
import { createAiGenerator } from '@mfp/integrations/ai';
import { createStorageDriver } from '@mfp/integrations/storage';
import { SimulatedPaymentProvider, RazorpayPaymentProvider } from '@mfp/integrations/payments';
import { SimulatorWhatsAppProvider, MetaCloudWhatsAppProvider } from '@mfp/integrations/whatsapp';
import { SimulatedOtpSender, WhatsAppOtpSender } from '@mfp/integrations/otp';
import { FaceClient } from '@/lib/face-client';
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
  /**
   * Autopay (ADR-105). `null` in DEMO_MODE, where there is no subscription provider: a demo
   * mandate that behaved like a real one would be a fiction, so the CRM says it is
   * unavailable instead of pretending.
   */
  readonly subscriptions: SubscriptionProvider | null;
  readonly mandateChargeUow: MandateChargeUnitOfWork;
  readonly mandateStatusUow: MandateStatusUnitOfWork;
  readonly startMandateUow: StartMandateUnitOfWork;
  /** Writes diet plans and answers members (ADR-089, ADR-090); unavailable with no key. */
  readonly ai: AiTextGenerator;
  /**
   * Turns a photograph into numbers (ADR-107). `configured` is false when no service URL
   * is set, and the check-in screen falls back to the keypad rather than failing at a
   * member standing in front of it.
   */
  readonly face: FaceClient;
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
  const razorpay =
    simulator === null
      ? new RazorpayPaymentProvider({
          keyId: env.RAZORPAY_KEY_ID,
          keySecret: env.RAZORPAY_KEY_SECRET,
          webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
        })
      : null;
  const payments: PaymentProvider = simulator ?? (razorpay as RazorpayPaymentProvider);

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
    // The same Razorpay object: one adapter implements both ports, because a plan and a
    // subscription are the same account and the same credentials.
    subscriptions: razorpay,
    mandateChargeUow: new PrismaMandateChargeUnitOfWork(prisma),
    mandateStatusUow: new PrismaMandateStatusUnitOfWork(prisma),
    startMandateUow: new PrismaStartMandateUnitOfWork(prisma),
    // Empty key means unavailable: the CRM says so rather than failing at the last moment.
    ai: createAiGenerator({ apiKey: env.AI_API_KEY, model: env.AI_MODEL }),
    face: new FaceClient({ baseUrl: env.FACE_SERVICE_URL, token: env.FACE_SERVICE_TOKEN }),
  };
}
