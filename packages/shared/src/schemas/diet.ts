import { z } from 'zod';

/**
 * The shape a diet plan has to come back in (ADR-089).
 *
 * The model is asked for JSON in exactly this shape rather than prose, for three reasons:
 * the PDF and the WhatsApp message can lay it out properly, a half-written answer fails
 * the parse instead of reaching a member, and the safety checks have numbers to look at.
 *
 * The bounds here are deliberately wide — they only keep out nonsense. What is *right for
 * this member* is decided by `checkDietPlanSafety` in `packages/core`, which knows their
 * weight, their diet and their allergies.
 */

export const DietMealSchema = z
  .object({
    /** "Breakfast", "Pre-workout" — whatever the plan calls it. */
    name: z.string().trim().min(1).max(60),
    /** "7:30 am", "after training" — free text, because real plans are not a timetable. */
    timing: z.string().trim().min(1).max(60),
    items: z.array(z.string().trim().min(1).max(200)).min(1).max(12),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

export const DietPlanDocSchema = z
  .object({
    summary: z.string().trim().min(10).max(600),
    caloriesPerDay: z.number().int().min(600).max(6000),
    proteinGramsPerDay: z.number().int().min(10).max(400),
    meals: z.array(DietMealSchema).min(3).max(8),
    hydration: z.string().trim().min(3).max(400),
    portionGuidance: z.string().trim().min(3).max(600),
    generalAdvice: z.array(z.string().trim().min(3).max(300)).max(8).default([]),
    /** The model's own flag: this member should see a qualified nutritionist. */
    seeProfessional: z.boolean(),
  })
  .strict();

export type DietMeal = z.output<typeof DietMealSchema>;
export type DietPlanDoc = z.output<typeof DietPlanDocSchema>;
