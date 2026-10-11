/**
 * The sheet somebody types into Meta's template manager, generated from the code.
 *
 *   pnpm wa:templates            # writes docs/04-content/whatsapp-template-submission.md
 *
 * `docs/04-content/whatsapp-templates.md` was written by hand and drifted: it documents
 * ten of the twenty-one templates and names four that no longer exist. Submitting from it
 * would both miss templates and create dead ones, so this is generated from
 * `packages/integrations/src/whatsapp/templates.ts`, which is what the product actually
 * sends. Re-run it after any template change and submit the diff.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATES } from '../src/whatsapp/templates';

/**
 * Meta requires a sample for every `{{n}}` and rejects samples that do not fit the body —
 * a date where the template reads "ends on {{2}}" has to look like a date.
 */
const SAMPLES: Readonly<Record<string, string>> = {
  firstName: 'Ravi',
  ownerName: 'Ajay',
  endDate: '15 Sep 2026',
  startDate: '16 Jun 2026',
  firstChargeDate: '1 Oct 2026',
  whenPhrase: 'in 7 days',
  amount: '₹4,000',
  planName: '3 months',
  receiptNo: 'MF/2026-27/000123',
  memberCode: 'MF-0231',
  hours: 'Mon-Sat 4:30 am - 10 pm',
  code: '418266',
  days: '3',
  message: 'The gym stays closed on Sunday 12 October.',
  sentence: '3 members have fees overdue by more than a week.',
  question: 'How many meals do you eat in a day?',
  calories: '2,100',
  meals: '4',
  link: 'https://maxfitnessgym.co.in/r/abc123',
  endingToday: '2',
  overdue: '5',
  dueThisWeek: '7',
  callsToday: '4',
  birthdays: '1',
  collectedYesterday: '₹12,000',
};

const LANGUAGES = [
  { code: 'en', label: 'English (en)' },
  { code: 'hi', label: 'Hindi (hi)' },
] as const;

const lines: string[] = [
  '# WhatsApp templates — submission sheet',
  '',
  '**Generated — do not edit by hand.** Source: `packages/integrations/src/whatsapp/templates.ts`.',
  'Regenerate with `pnpm wa:templates`.',
  '',
  'Submit each one in Meta → WhatsApp Manager → Message templates → Create template.',
  'The **name must match exactly** — the product sends by that name, and a typo is a message that never arrives.',
  'Each template is submitted **twice**, once per language, under the same name.',
  '',
  `${Object.keys(TEMPLATES).length} templates.`,
  '',
  '> Anything in `docs/04-content/whatsapp-templates.md` that is not listed here is obsolete.',
  '> It names four templates the product no longer sends; do not create them.',
  '',
  '---',
  '',
];

for (const definition of Object.values(TEMPLATES)) {
  lines.push(`## \`${definition.name}\``, '', `**Category:** ${definition.category}`, '');

  if (definition.variables.length === 0) {
    lines.push('**Variables:** none', '');
  } else {
    lines.push('**Variables**, in this order:', '');
    lines.push('| # | Meaning | Sample to paste |', '|---|---|---|');
    definition.variables.forEach((name, index) => {
      lines.push(`| {{${index + 1}}} | ${name} | ${SAMPLES[name] ?? '—'} |`);
    });
    lines.push('');
  }

  for (const language of LANGUAGES) {
    lines.push(`### ${language.label}`, '', '```', definition.body[language.code], '```', '');
    lines.push(`Footer: \`${definition.footer[language.code]}\``, '');
    if (definition.buttons !== undefined) {
      const buttons = definition.buttons
        .map((button) => `${button.kind === 'url' ? '[URL]' : '[Quick reply]'} ${button.label[language.code]}`)
        .join(' · ');
      lines.push(`Buttons, in this order: ${buttons}`, '');
    }
  }

  if (definition.buttons?.some((button) => button.kind === 'url') === true) {
    lines.push(
      'The URL button is **dynamic**: set it to `https://maxfitnessgym.co.in/r/{{1}}` with sample `abc123`.',
      'The product sends only the token, because the template already holds everything before it.',
      '',
    );
  }

  lines.push('---', '');
}

// Relative to this file, so it writes the same place whatever the working directory is.
const out = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/04-content/whatsapp-template-submission.md');
writeFileSync(out, `${lines.join('\n')}\n`, 'utf8');
console.log(`${Object.keys(TEMPLATES).length} templates written to ${out}`);
