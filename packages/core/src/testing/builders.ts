import {
  DEFAULT_PLAN_PRICES_PAISE,
  FakeClock,
  istDate,
  istTime,
  planCode,
  type ISTDate,
  type ISTTime,
  type PlanDurationMonths,
  type PricedGender,
} from '@mfp/shared';
import type { Plan } from '../pricing/plans';
import type { MembershipForFeeState } from '../membership/fee-state';
import type { ReminderRule } from '../reminders/rules';

/**
 * Test factories (testing-strategy.md §2).
 *
 * Every builder takes an overrides object and fills the rest with something sensible,
 * so a test states only the fields it is actually about. A test that has to specify
 * eleven irrelevant fields to make a point stops being read.
 */

/** `ist('2026-09-10T19:00')` — an IST wall-clock moment as a UTC instant. */
export function ist(value: string): Date {
  const [datePart, timePart = '00:00'] = value.split('T');
  const [hh, mm] = timePart.split(':');
  // IST is UTC+5:30 with no DST (BR-1.1), so the offset is a constant.
  const utcMs = Date.UTC(
    Number(datePart?.slice(0, 4)),
    Number(datePart?.slice(5, 7)) - 1,
    Number(datePart?.slice(8, 10)),
    Number(hh),
    Number(mm),
  );
  return new Date(utcMs - 5.5 * 3_600_000);
}

/** A clock stopped at an IST moment. Defaults to 10:00, when most reminder slots run. */
export function fakeClockAt(value: string): FakeClock {
  return new FakeClock(ist(value));
}

export function buildPlan(overrides: Partial<Plan> = {}): Plan {
  const durationMonths: PlanDurationMonths = overrides.durationMonths ?? 1;
  const gender: PricedGender = overrides.gender ?? 'MALE';
  const code = planCode(durationMonths, gender);
  return {
    id: `plan-${code}`,
    code,
    durationMonths,
    gender,
    pricePaise: DEFAULT_PLAN_PRICES_PAISE[code],
    isActive: true,
    sortOrder: durationMonths,
    ...overrides,
  };
}

/** The eight default plans (BR-2.2) — the catalogue the seed creates. */
export function buildPlanCatalogue(): Plan[] {
  const genders: PricedGender[] = ['MALE', 'FEMALE'];
  const months: PlanDurationMonths[] = [1, 3, 6, 12];
  return genders.flatMap((gender) => months.map((durationMonths) => buildPlan({ gender, durationMonths })));
}

let membershipCounter = 0;

export function buildMembership(overrides: Partial<MembershipForFeeState> = {}): MembershipForFeeState {
  membershipCounter += 1;
  return {
    id: `mem-${membershipCounter}`,
    startDate: istDate('2026-08-11'),
    endDate: istDate('2026-09-10'),
    status: 'CONFIRMED',
    ...overrides,
  };
}

/** A membership ending `daysFromToday` days from `today`, chained back by `months`. */
export function buildMembershipEndingIn(
  today: ISTDate,
  daysFromToday: number,
  overrides: Partial<MembershipForFeeState> = {},
): MembershipForFeeState {
  const end = shiftDate(today, daysFromToday);
  return buildMembership({ startDate: shiftDate(end, -30), endDate: end, ...overrides });
}

function shiftDate(date: ISTDate, days: number): ISTDate {
  const ms = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  const d = new Date(ms + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return istDate(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
}

export function buildReminderRule(overrides: Partial<ReminderRule> = {}): ReminderRule {
  return {
    code: 'PRE_7',
    offsetDays: -7,
    offsetDaysTo: -7,
    slots: ['10:00'],
    templateName: 'mf_renewal_due',
    isEnabled: true,
    ...overrides,
  };
}

/** The BR-5.1 default rule set, with the POST cap taken from settings (ADR-015). */
export function buildDefaultReminderRules(postExpiryMaxDays: number | null = 7): ReminderRule[] {
  return [
    buildReminderRule({ code: 'PRE_7', offsetDays: -7, offsetDaysTo: -7 }),
    buildReminderRule({ code: 'PRE_3', offsetDays: -3, offsetDaysTo: -3 }),
    buildReminderRule({ code: 'PRE_2', offsetDays: -2, offsetDaysTo: -2 }),
    buildReminderRule({ code: 'PRE_1', offsetDays: -1, offsetDaysTo: -1 }),
    buildReminderRule({
      code: 'DUE_TODAY',
      offsetDays: 0,
      offsetDaysTo: 0,
      templateName: 'mf_renewal_due_today',
    }),
    buildReminderRule({
      code: 'POST',
      offsetDays: 1,
      offsetDaysTo: postExpiryMaxDays,
      slots: ['09:30', '14:00', '19:00'],
      templateName: 'mf_membership_expired',
    }),
  ];
}

export const DEFAULT_QUIET_HOURS: { start: ISTTime; end: ISTTime } = {
  start: istTime('08:00'),
  end: istTime('21:00'),
};
