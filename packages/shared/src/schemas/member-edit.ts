import { z } from 'zod';
import { LANGUAGES, TRAINING_SLOTS } from '../constants';
import { isValidIndianMobile, toE164 } from '../phone';
import { isISTDate } from '../time/ist-date';
import { MEMBER_GENDERS, NAME_PATTERN } from './registration';

/**
 * Correcting a member's details at the desk (crm-ux-blueprint §5; PRD CRM-04).
 *
 * The registration rules minus the consents — those were given once and are not re-taken
 * when a spelling is fixed — and plus the training slot, which members do change. The same
 * schema runs in the browser and in the server action (CLAUDE.md §2.3).
 *
 * Date of birth and slot may be blank: the members imported from the paper register have
 * neither, and the desk must be able to save a corrected name without inventing a birthday.
 * Each message is a short code the UI looks up under `crm.edit.errors.<code>`.
 */

export const MEMBER_EDIT_ERROR_CODES = ['fullName', 'mobile', 'email', 'dob', 'gender', 'language', 'trainingSlot', 'joinedOn', 'notes'] as const;
export type MemberEditErrorCode = (typeof MEMBER_EDIT_ERROR_CODES)[number];

/** `''` means "not recorded" everywhere a form posts a cleared field. */
const blankToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? null : value), schema.nullable());

export const MemberEditSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, { message: 'fullName' })
      .max(60, { message: 'fullName' })
      .regex(NAME_PATTERN, { message: 'fullName' }),
    mobile: z
      .string()
      .trim()
      .refine(isValidIndianMobile, { message: 'mobile' })
      .transform((value) => toE164(value)),
    email: blankToNull(z.string().trim().toLowerCase().max(120, { message: 'email' }).pipe(z.email({ message: 'email' }))),
    dob: blankToNull(z.string().refine(isISTDate, { message: 'dob' })),
    gender: z.enum(MEMBER_GENDERS, { message: 'gender' }),
    language: z.enum(LANGUAGES, { message: 'language' }),
    trainingSlot: blankToNull(z.enum(TRAINING_SLOTS, { message: 'trainingSlot' })),
    // Members imported from the paper register joined years before this system; the date
    // may be unknown, and must stay blank rather than being invented.
    joinedOn: blankToNull(z.string().refine(isISTDate, { message: 'joinedOn' })),
    notes: blankToNull(z.string().trim().max(500, { message: 'notes' })),
    // A checkbox posts nothing when it is clear, so absent means off.
    whatsappOptIn: z.coerce.boolean().default(false),
  })
  .strict();

export type MemberEditInput = z.input<typeof MemberEditSchema>;
export type MemberEditFields = z.output<typeof MemberEditSchema>;
