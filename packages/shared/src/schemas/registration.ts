import { z } from 'zod';
import { isValidIndianMobile, toE164 } from '../phone';
import { isISTDate } from '../time/ist-date';

/**
 * Online registration (PRD SU-02, SU-05; signup-and-payment-flow.md §3;
 * api-specification.md `POST /registrations`).
 *
 * The same schema validates the details step in the browser and the multipart
 * request on the server (CLAUDE.md §2.3). The selfie travels as a file part and is
 * validated separately. As with leads, each message is a short code the UI looks up
 * under `signup.errors.<code>`, so Hindi and English stay in the catalogues.
 */

/** Validation codes; each maps to `signup.errors.<code>` in messages/{en,hi}.json. */
export const REGISTRATION_ERROR_CODES = [
  'fullName',
  'mobile',
  'email',
  'dob',
  'gender',
  'terms',
  'privacy',
  'noticeVersion',
] as const;
export type RegistrationErrorCode = (typeof REGISTRATION_ERROR_CODES)[number];

/** `OTHER` is priced per `pricing.otherGenderPricing` (BR-2.5). */
export const MEMBER_GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;

/** Letters (Latin or Devanagari, with their combining marks), spaces and . ' - */
export const NAME_PATTERN = /^[\p{Script=Latin}\p{Script=Devanagari}\p{M}][\p{Script=Latin}\p{Script=Devanagari}\p{M} .'-]*$/u;

/**
 * Email is optional. The privacy notice lists it as optional, and it is the one field
 * the gym does not need to run a membership (data minimisation, privacy plan §2).
 */
const optionalEmail = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z
    .string()
    .trim()
    .toLowerCase()
    .max(120, { message: 'email' })
    .pipe(z.email({ message: 'email' }))
    .optional(),
);

export const RegistrationConsentsSchema = z
  .object({
    terms: z.literal(true, { message: 'terms' }),
    privacy: z.literal(true, { message: 'privacy' }),
    /** Needed for renewal reminders; the UI warns when it is left off. */
    whatsappUpdates: z.boolean().default(false),
    /** Separate, optional and un-ticked by default (privacy plan §3.3). */
    faceAttendance: z.boolean().default(false),
  })
  .strict();

export const RegistrationFieldsSchema = z
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
    email: optionalEmail,
    // The type guard narrows the output to ISTDate: only real calendar dates pass.
    dob: z.string().refine(isISTDate, { message: 'dob' }),
    gender: z.enum(MEMBER_GENDERS, { message: 'gender' }),
    language: z.enum(['en', 'hi']).default('en'),
    consents: RegistrationConsentsSchema,
    /** The privacy notice version shown at sign-up, stored with each consent (BR-12.3). */
    noticeVersion: z.string().trim().min(1, { message: 'noticeVersion' }).max(20, { message: 'noticeVersion' }),
  })
  .strict();

export type RegistrationFieldsInput = z.input<typeof RegistrationFieldsSchema>;
export type RegistrationFields = z.output<typeof RegistrationFieldsSchema>;
