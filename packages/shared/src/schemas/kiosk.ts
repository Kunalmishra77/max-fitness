import { z } from 'zod';

/**
 * What the reception phone is allowed to send (api-specification.md §7).
 *
 * The kiosk is the one client we do not write the request for by hand every time — it
 * is a separate app, shipped separately, and an old build will still be talking to a
 * new server months from now. So every field is bounded here rather than trusted: a
 * temperature of 900, a queue of a million or an app version the length of a novel is
 * a bug or an attack, and neither should reach the database.
 */

export const KioskPairSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, { message: 'code' }),
  deviceName: z.string().trim().min(1, { message: 'deviceName' }).max(60, { message: 'deviceName' }),
  appVersion: z.string().trim().min(1, { message: 'appVersion' }).max(20, { message: 'appVersion' }),
  modelVersion: z.string().trim().min(1, { message: 'modelVersion' }).max(40, { message: 'modelVersion' }),
});
export type KioskPair = z.infer<typeof KioskPairSchema>;

export const KioskHeartbeatSchema = z.object({
  battery: z.number().int().min(0).max(100),
  charging: z.boolean(),
  // A phone that reports -40 or 150 is reporting a broken sensor, not a temperature.
  temperatureC: z.number().min(-40).max(150),
  queueSize: z.number().int().min(0).max(1_000_000),
  cameraOk: z.boolean(),
  freeStorageMb: z.number().int().min(0).max(10_000_000),
  appVersion: z.string().trim().min(1).max(20),
  fps: z.number().min(0).max(240),
});
export type KioskHeartbeat = z.infer<typeof KioskHeartbeatSchema>;

/**
 * The reception tablet's check-in requests (BR-9.4).
 *
 * A lookup takes a whole mobile or a whole member code and nothing else: a prefix is
 * not a lookup, it is somebody fishing for names, so the schema refuses it before the
 * query is ever built.
 */
export const CheckInLookupSchema = z
  .object({
    mobile: z
      .string()
      .trim()
      .regex(/^\+91\d{10}$/, { message: 'mobile' })
      .optional(),
    memberCode: z.string().trim().min(3, { message: 'memberCode' }).max(20, { message: 'memberCode' }).optional(),
  })
  .refine((value) => value.mobile !== undefined || value.memberCode !== undefined, { message: 'mobile' });
export type CheckInLookup = z.infer<typeof CheckInLookupSchema>;

export const CheckInAttendanceSchema = z.object({
  memberId: z.string().trim().min(1).max(40),
  /** Made by the screen, so a double tap is one visit rather than two. */
  clientEventId: z.string().trim().min(8).max(64),
  method: z.enum(['KEYPAD', 'FACE', 'FACE_CONFIRMED']),
});
export type CheckInAttendance = z.infer<typeof CheckInAttendanceSchema>;
