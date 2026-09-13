/**
 * Consent-gated analytics (PRD LP-25, PRD §7).
 *
 * Nothing is sent, and no analytics script is loaded, until the visitor allows it.
 * The choice is kept in localStorage. Event properties carry context only (which
 * button, which plan) — never a name, number or anything typed into a form
 * (CLAUDE.md §2.8).
 */

export type ConsentChoice = 'granted' | 'denied';

/** The PRD §7 events that happen on the public site (landing page, sign-up, renewal). No event carries personal data. */
export const SITE_EVENTS = [
  'lead_submitted',
  'signup_started',
  'selfie_captured',
  'selfie_failed',
  'signup_submitted',
  'plan_selected',
  'payment_started',
  'payment_succeeded',
  'payment_failed',
  'pay_at_reception_chosen',
  'renew_link_opened',
  'renew_paid',
  'whatsapp_click',
  'call_click',
] as const;
export type SiteEvent = (typeof SITE_EVENTS)[number];

export type EventProps = Readonly<Record<string, string>>;

const CONSENT_KEY = 'mfp-analytics-consent';
const listeners = new Set<() => void>();

declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: EventProps }) => void;
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

export function isSiteEvent(value: string | undefined): value is SiteEvent {
  return value !== undefined && (SITE_EVENTS as readonly string[]).includes(value);
}

export function readConsent(): ConsentChoice | null {
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
}

export function writeConsent(choice: ConsentChoice): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, choice);
  } catch {
    // Storage blocked: the choice holds for this page view only.
  }
  sessionChoice = choice;
  listeners.forEach((listener) => listener());
}

/** Covers browsers where storage is blocked, so the banner still goes away. */
let sessionChoice: ConsentChoice | null = null;

export function currentConsent(): ConsentChoice | null {
  return readConsent() ?? sessionChoice;
}

export function subscribeConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function track(event: SiteEvent, props: EventProps = {}): void {
  if (typeof window === 'undefined' || currentConsent() !== 'granted') return;
  window.plausible?.(event, { props });
  window.gtag?.('event', event, props);
}

/**
 * Event properties from `data-track-*` attributes: `data-track-source="hero"` becomes
 * `{ source: 'hero' }`. Lets server-rendered links be tracked without client code.
 */
export function propsFromDataset(dataset: DOMStringMap): Record<string, string> {
  const props: Record<string, string> = {};
  for (const [key, value] of Object.entries(dataset)) {
    if (key.startsWith('track') && key !== 'track' && value !== undefined && value !== '') {
      props[key.charAt(5).toLowerCase() + key.slice(6)] = value;
    }
  }
  return props;
}
