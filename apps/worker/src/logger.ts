import { pino } from 'pino';
import { LOG_REDACT_PATHS } from '@mfp/shared';

/**
 * Worker logging.
 *
 * CLAUDE.md §2.8 and security-plan.md §3.1: JSON logs with PII redaction. The
 * redaction paths come from `packages/shared` so the pino config and the masking
 * helpers cannot drift apart — a new sensitive field is added in one place.
 *
 * Redaction is the safety net, not the plan: values that reach a log line on
 * purpose should already have gone through `maskMobile` / `maskEmail`.
 */
export function createLogger(options: { level: string; workerId: string; version: string }) {
  return pino({
    level: options.level,
    base: { worker: options.workerId, version: options.version },
    redact: {
      paths: [...LOG_REDACT_PATHS],
      censor: '[redacted]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
