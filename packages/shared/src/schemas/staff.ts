import { z } from 'zod';
import { isValidIndianMobile, toE164 } from '../phone';
import { NAME_PATTERN } from './registration';

/**
 * Adding a staff member and setting their PIN (crm-ux-blueprint §14; security-plan §3.1).
 *
 * The same schema validates the form in the browser and the server action (CLAUDE.md
 * §2.3). Each message is a field code the screen looks up under `crm.staff.errors`.
 * Names follow the same rule as a member's, so "what counts as a name" is decided once.
 */

/** Roles an owner can give from the CRM. Another owner is not made from a form. */
export const ASSIGNABLE_STAFF_ROLES = ['RECEPTION', 'TRAINER'] as const;
export type AssignableStaffRole = (typeof ASSIGNABLE_STAFF_ROLES)[number];

/** security-plan §3.1: four to six digits, typed one-handed at a desk. */
export const StaffPinSchema = z.string().regex(/^\d{4,6}$/, { message: 'pin' });

export const StaffCreateSchema = z
  .object({
    name: z.string().trim().min(2, { message: 'name' }).max(60, { message: 'name' }).regex(NAME_PATTERN, { message: 'name' }),
    mobile: z
      .string()
      .trim()
      .refine(isValidIndianMobile, { message: 'mobile' })
      .transform((value) => toE164(value)),
    role: z.enum(ASSIGNABLE_STAFF_ROLES, { message: 'role' }),
    pin: StaffPinSchema,
  })
  .strict();

export type StaffCreateInput = z.input<typeof StaffCreateSchema>;
export type StaffCreate = z.output<typeof StaffCreateSchema>;
