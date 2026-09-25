import type { Language, WhatsAppTemplateName } from '@mfp/shared';
import type { TemplateVariables } from '@mfp/core/ports';

/**
 * Template bodies, transcribed from `docs/04-content/whatsapp-templates.md`.
 *
 * These are **previews**, not the messages Meta sends. In production the Cloud API
 * renders the approved template from its own copy and we only supply the variables;
 * these strings exist so the CRM message log and the DEMO_MODE simulator can show
 * the owner exactly what a member would have received.
 *
 * They must therefore stay in step with what is submitted for approval. If Meta
 * requires a wording change during review, change it here in the same commit.
 */

type TemplateBodies = Readonly<Record<Language, string>>;

interface TemplateDefinition {
  readonly name: WhatsAppTemplateName;
  readonly category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  /** `{{1}}`-style placeholders, in order, so a caller can see what is required. */
  readonly variables: readonly string[];
  readonly body: TemplateBodies;
  readonly footer: TemplateBodies;
}

const FOOTER: TemplateBodies = {
  en: 'Max Fitness Gym, Nyay Khand 1, Indirapuram',
  hi: 'Max Fitness Gym, न्याय खंड 1, इंदिरापुरम',
};

/** T1 — used by PRE_7, PRE_3, PRE_2, PRE_1 (BR-5.1). */
const RENEWAL_DUE: TemplateDefinition = {
  name: 'mf_renewal_due',
  category: 'UTILITY',
  variables: ['firstName', 'endDate', 'whenPhrase'],
  body: {
    en: [
      'Hi {{1}}, your Max Fitness Gym membership ends on {{2}} ({{3}}).',
      '',
      'Renew before this date to continue your workouts without a break.',
      '',
      'If you do not want to continue your membership, please unsubscribe.',
    ].join('\n'),
    hi: [
      'नमस्ते {{1}}, Max Fitness Gym में आपकी मेंबरशिप {{2}} ({{3}}) को खत्म हो रही है।',
      '',
      'बिना ब्रेक वर्कआउट जारी रखने के लिए इस तारीख से पहले रिन्यू करें।',
      '',
      'अगर आप मेंबरशिप जारी नहीं रखना चाहते, तो कृपया अनसब्सक्राइब करें।',
    ].join('\n'),
  },
  footer: FOOTER,
};

/** T2 — used by DUE_TODAY. */
const RENEWAL_DUE_TODAY: TemplateDefinition = {
  name: 'mf_renewal_due_today',
  category: 'UTILITY',
  variables: ['firstName', 'endDate'],
  body: {
    en: [
      'Hi {{1}}, your Max Fitness Gym membership ends today, {{2}}.',
      '',
      'Renew today to keep training from tomorrow without a break.',
      '',
      'If you do not want to continue your membership, please unsubscribe.',
    ].join('\n'),
    hi: [
      'नमस्ते {{1}}, Max Fitness Gym में आपकी मेंबरशिप आज, {{2}} को खत्म हो रही है।',
      '',
      'कल से बिना ब्रेक ट्रेनिंग के लिए आज ही रिन्यू करें।',
      '',
      'अगर आप मेंबरशिप जारी नहीं रखना चाहते, तो कृपया अनसब्सक्राइब करें।',
    ].join('\n'),
  },
  footer: FOOTER,
};

/** T3 — used by POST, at three slots a day up to the cap (BR-5.1, BR-5.2). */
const MEMBERSHIP_EXPIRED: TemplateDefinition = {
  name: 'mf_membership_expired',
  category: 'UTILITY',
  variables: ['firstName', 'endDate'],
  body: {
    en: [
      'Hi {{1}}, your Max Fitness Gym membership ended on {{2}}.',
      '',
      'Renew using the button below to continue your workouts. You can also pay at reception.',
      '',
      'If you do not want to continue your membership, please unsubscribe.',
    ].join('\n'),
    hi: [
      'नमस्ते {{1}}, Max Fitness Gym में आपकी मेंबरशिप {{2}} को खत्म हो गई है।',
      '',
      'वर्कआउट जारी रखने के लिए नीचे दिए बटन से रिन्यू करें। आप रिसेप्शन पर भी फीस दे सकते हैं।',
      '',
      'अगर आप मेंबरशिप जारी नहीं रखना चाहते, तो कृपया अनसब्सक्राइब करें।',
    ].join('\n'),
  },
  footer: FOOTER,
};

/** T4 — sent after a payment confirms (BR-11). */
const PAYMENT_RECEIPT: TemplateDefinition = {
  name: 'mf_payment_receipt',
  category: 'UTILITY',
  variables: ['firstName', 'amount', 'planName', 'startDate', 'endDate', 'receiptNo'],
  body: {
    en: [
      'Payment received. Thank you, {{1}}.',
      '',
      'Amount: {{2}}',
      'Plan: {{3}}',
      'Valid: {{4}} to {{5}}',
      'Receipt no: {{6}}',
    ].join('\n'),
    hi: [
      'भुगतान मिल गया। धन्यवाद, {{1}}।',
      '',
      'राशि: {{2}}',
      'प्लान: {{3}}',
      'वैधता: {{4}} से {{5}} तक',
      'रसीद नंबर: {{6}}',
    ].join('\n'),
  },
  footer: FOOTER,
};

/** T8 — Meta's fixed authentication format: the code, a security line, and the expiry as footer. */
const LOGIN_CODE: TemplateDefinition = {
  name: 'mf_login_code',
  category: 'AUTHENTICATION',
  variables: ['code'],
  body: {
    en: '{{1}} is your verification code. For your security, do not share this code.',
    hi: '{{1}} आपका वेरिफिकेशन कोड है। अपनी सुरक्षा के लिए यह कोड किसी को न बताएँ।',
  },
  footer: {
    en: 'This code expires in 10 minutes.',
    hi: 'यह कोड 10 मिनट में खत्म हो जाएगा।',
  },
};

/** T5 — the first message a new member gets, right after the receipt. */
const WELCOME_MEMBER: TemplateDefinition = {
  name: 'mf_welcome_member',
  category: 'UTILITY',
  variables: ['firstName', 'memberCode', 'hours'],
  body: {
    en: [
      'Welcome to Max Fitness Gym, {{1}}. Your member code is {{2}}.',
      '',
      'Gym timings: {{3}}',
      'On your first visit, please meet reception so we can set up your attendance.',
    ].join('\n'),
    hi: [
      'Max Fitness Gym में आपका स्वागत है, {{1}}। आपका मेंबर कोड {{2}} है।',
      '',
      'जिम का समय: {{3}}',
      'पहली बार आएँ तो रिसेप्शन पर मिलें, ताकि आपकी हाज़िरी सेट की जा सके।',
    ].join('\n'),
  },
  footer: FOOTER,
};

/** T6 — a QR member's details checked and switched on at the desk. */
const VERIFICATION_APPROVED: TemplateDefinition = {
  name: 'mf_verification_approved',
  category: 'UTILITY',
  variables: ['firstName', 'endDate'],
  body: {
    en: [
      'Hi {{1}}, your details are confirmed at Max Fitness Gym.',
      '',
      "Your fees are paid till {{2}}. We'll remind you before this date on WhatsApp.",
      '',
      'If you do not want reminders, please unsubscribe.',
    ].join('\n'),
    hi: [
      'नमस्ते {{1}}, Max Fitness Gym में आपकी जानकारी पक्की हो गई है।',
      '',
      'आपकी फीस {{2}} तक जमा है। इस तारीख से पहले हम आपको WhatsApp पर याद दिला देंगे।',
      '',
      'अगर आप रिमाइंडर नहीं चाहते, तो कृपया अनसब्सक्राइब करें।',
    ].join('\n'),
  },
  footer: FOOTER,
};

/** T9 — the owner's morning digest, skipped on days with nothing to say. */
const OWNER_DIGEST: TemplateDefinition = {
  name: 'mf_owner_daily_digest',
  category: 'UTILITY',
  variables: ['ownerName', 'endingToday', 'overdue', 'dueThisWeek', 'callsToday', 'birthdays', 'collectedYesterday'],
  body: {
    en: [
      'Good morning {{1}}. Today at a glance:',
      '',
      'Fees ending today: {{2}}',
      'Fees overdue: {{3}}',
      'Fees due this week: {{4}}',
      "Today's calls: {{5}}",
      'Birthdays: {{6}}',
      'Collected yesterday: {{7}}',
    ].join('\n'),
    hi: [
      'सुप्रभात {{1}}। आज का हिसाब:',
      '',
      'फीस आज खत्म: {{2}}',
      'फीस बाकी: {{3}}',
      'इस हफ्ते आने वाली फीस: {{4}}',
      'आज के कॉल: {{5}}',
      'जन्मदिन: {{6}}',
      'कल आए पैसे: {{7}}',
    ].join('\n'),
  },
  footer: FOOTER,
};

/**
 * T10 — one controlled sentence to the owner.
 *
 * The sentence is built in the app, never by the member, so an alert cannot carry
 * whatever someone typed into WhatsApp.
 */
const OWNER_ALERT: TemplateDefinition = {
  name: 'mf_owner_alert',
  category: 'UTILITY',
  variables: ['sentence'],
  body: { en: '{{1}}', hi: '{{1}}' },
  footer: FOOTER,
};

/**
 * T11 — the birthday wish.
 *
 * Marketing, not utility: it sells nothing, but Meta reads any unsolicited greeting
 * that way, so it needs the member's own opt-in and the owner's tap — BR-8.2 keeps
 * `autoBirthdayWish` off.
 */
const BIRTHDAY_WISH: TemplateDefinition = {
  name: 'mf_birthday_wish',
  category: 'MARKETING',
  variables: ['firstName'],
  body: {
    en: 'Many happy returns of the day, {{1}}! 🎉 Everyone at Max Fitness Gym wishes you a healthy and strong year ahead.',
    hi: 'जन्मदिन की बहुत-बहुत शुभकामनाएँ, {{1}}! 🎉 Max Fitness Gym की पूरी टीम की ओर से आपको स्वस्थ और ताकतवर साल की शुभकामनाएँ।',
  },
  footer: FOOTER,
};

/**
 * T12 — the owner's announcement to every member (ADR-079).
 *
 * Marketing, because Meta reads any message the member did not ask for that way, whether
 * it says "closed for Diwali" or "50% off". So it needs the member's own opt-in, and the
 * gym needs this template approved before a single one of these can go out.
 *
 * The owner's words are one variable, like the owner's own alerts: whatever they write is
 * the message, and nothing here adds to it or interprets it.
 */
const ANNOUNCEMENT: TemplateDefinition = {
  name: 'mf_announcement',
  category: 'MARKETING',
  variables: ['firstName', 'message'],
  body: {
    en: 'Hi {{1}}, a message from Max Fitness Gym: {{2}}',
    hi: 'नमस्ते {{1}}, Max Fitness Gym की ओर से सूचना: {{2}}',
  },
  footer: FOOTER,
};

export const TEMPLATES: Readonly<Record<WhatsAppTemplateName, TemplateDefinition>> = {
  mf_renewal_due: RENEWAL_DUE,
  mf_renewal_due_today: RENEWAL_DUE_TODAY,
  mf_membership_expired: MEMBERSHIP_EXPIRED,
  mf_payment_receipt: PAYMENT_RECEIPT,
  mf_login_code: LOGIN_CODE,
  mf_welcome_member: WELCOME_MEMBER,
  mf_verification_approved: VERIFICATION_APPROVED,
  mf_owner_daily_digest: OWNER_DIGEST,
  mf_owner_alert: OWNER_ALERT,
  mf_birthday_wish: BIRTHDAY_WISH,
  mf_announcement: ANNOUNCEMENT,
};

export function templateDefinition(name: WhatsAppTemplateName): TemplateDefinition {
  return TEMPLATES[name];
}

/**
 * Substitute `{{1}}`, `{{2}}`... from the named variables, in the order the
 * template declares them.
 *
 * A missing variable renders as `{{n}}` rather than an empty string: a preview
 * reading "Hi , your membership ends on " hides the bug, whereas a visible
 * placeholder in the simulator is caught before anyone submits the template.
 */
export function renderTemplate(
  name: WhatsAppTemplateName,
  language: Language,
  variables: TemplateVariables,
): string {
  const definition = TEMPLATES[name];
  const ordered = definition.variables.map((key) => variables[key]);

  const body = definition.body[language].replace(/\{\{(\d+)\}\}/g, (match, index: string) => {
    const value = ordered[Number(index) - 1];
    return value ?? match;
  });

  return `${body}\n\n${definition.footer[language]}`;
}

/**
 * The `{{3}}` phrase in T1 — "in 7 days" / "tomorrow" / "7 दिन बाद" / "कल".
 *
 * `daysLeft` comes from fee state, where 0 means "ends today"; T1 is never used on
 * that day (DUE_TODAY has its own template), but the branch exists so a
 * misconfigured rule produces sensible text rather than "in 0 days".
 */
export function daysLeftPhrase(daysLeft: number, language: Language): string {
  if (language === 'hi') {
    if (daysLeft <= 0) return 'आज';
    if (daysLeft === 1) return 'कल';
    return `${daysLeft} दिन बाद`;
  }
  if (daysLeft <= 0) return 'today';
  if (daysLeft === 1) return 'tomorrow';
  return `in ${daysLeft} days`;
}

/** Quick-reply button labels, per template language. */
export const BUTTON_LABELS: Readonly<Record<Language, { renew: string; unsubscribe: string; restart: string }>> =
  {
    en: { renew: 'Renew now', unsubscribe: 'Unsubscribe', restart: 'Restart reminders' },
    hi: { renew: 'अभी रिन्यू करें', unsubscribe: 'अनसब्सक्राइब', restart: 'रिमाइंडर फिर चालू करें' },
  };
