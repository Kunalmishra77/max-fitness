import { z } from 'zod';
import { isValidIndianMobile } from '../phone';
import { LEAD_GOALS, PUBLIC_LEAD_SOURCES } from './lead-constants';

export * from './lead-constants';

/**
 * Lead capture (PRD LP-04, api-specification.md `POST /leads`).
 *
 * The same schema validates the form in the browser and the request on the server
 * (CLAUDE.md §2.3). Validation messages are not user-facing text: each is a short
 * code that the UI looks up under `lead.errors.<code>` in the message catalogue, so
 * Hindi and English stay in the translation files (CLAUDE.md §2.9).
 */

/** The three fields a person actually fills in. */
export const LeadFormSchema = z.object({
  name: z.string().trim().min(2, { message: 'name' }).max(80, { message: 'name' }),
  mobile: z.string().trim().refine(isValidIndianMobile, { message: 'mobile' }),
  goal: z.enum(LEAD_GOALS, { message: 'goal' }),
});
export type LeadFormValues = z.infer<typeof LeadFormSchema>;

const utmValue = z.string().trim().max(100);

export const LeadUtmSchema = z
  .object({
    source: utmValue.optional(),
    medium: utmValue.optional(),
    campaign: utmValue.optional(),
    term: utmValue.optional(),
    content: utmValue.optional(),
  })
  .strict();
export type LeadUtm = z.infer<typeof LeadUtmSchema>;

/**
 * The full request body.
 *
 * `company` and `renderedAt` are bot signals, not data: a honeypot input that people
 * never see, and the time the form was rendered so a submission faster than a human
 * can type is recognised. Neither is stored.
 */
export const LeadCreateSchema = LeadFormSchema.extend({
  source: z.enum(PUBLIC_LEAD_SOURCES).default('WEBSITE_HERO'),
  utm: LeadUtmSchema.optional(),
  /** The form states that submitting agrees to a call or WhatsApp about membership. */
  consentContact: z.literal(true, { message: 'consent' }),
  company: z.string().max(200).optional(),
  renderedAt: z.number().int().nonnegative().optional(),
}).strict();

export type LeadCreateInput = z.input<typeof LeadCreateSchema>;
export type LeadCreate = z.output<typeof LeadCreateSchema>;

/** Field name for a validation issue, or `null` when it is not tied to one input. */
export function leadIssueField(path: ReadonlyArray<PropertyKey>): string | null {
  const first = path[0];
  return typeof first === 'string' ? first : null;
}
