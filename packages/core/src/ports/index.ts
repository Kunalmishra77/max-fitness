/**
 * Ports.
 *
 * system-architecture.md §3: arrows point *into* `packages/core`, and out to
 * integrations only through interfaces injected at the app boundary. Everything the
 * domain needs from the outside world — the clock, WhatsApp, payments, storage, the
 * outbox, the message log — is declared here as an interface, so a rule can be
 * tested with a fake and an adapter can be swapped without touching a rule.
 *
 * ADR-017: `packages/integrations` may import from this directory and nothing else
 * in core, and must never import `packages/db`.
 */

export type { Clock } from '@mfp/shared';
export type {
  E164Mobile,
  FeeState,
  Gender,
  ISTDate,
  ISTTime,
  Language,
  MemberStatus,
  MembershipStatus,
  PlanCode,
  PlanDurationMonths,
  PricedGender,
  ReminderRuleCode,
  TokenPurpose,
  WhatsAppTemplateName,
} from '@mfp/shared';

export * from './whatsapp';
export * from './payments';
export * from './storage';
export * from './outbox';
export * from './message-log';
export * from './auth';
