import {
  busyHours,
  can,
  csvFile,
  isReportPeriod,
  kioskShare,
  membershipFlow,
  monthBoundsFor,
  moneyByMethod,
  periodEndToDate,
  readReportMonth,
  readReportPeriod,
  type CsvValue,
} from '@mfp/core';
import { addDays, todayIST } from '@mfp/shared';
import { getContainer } from '@/lib/container';
import { reportsReader, requireCrmContext } from '@/lib/crm';

/**
 * `GET /crm/reports/export?period=|month=&from=&to=` — the figures on screen, as rows
 * (REP-003).
 *
 * **Behind `money.view`, checked here.** Most of this screen is money, the capability is
 * owner-only, and a URL can be typed — so reception following a link they were sent gets a
 * 403 rather than the gym's takings.
 *
 * The window is resolved by exactly the same two calls the page uses, in the same order, so
 * a download cannot describe a different period from the screen it was started from. The
 * same is true of every figure: they come from the same `reportsReader().inputs` and the
 * same pure functions, so there is no second implementation of "what the gym earned" to
 * drift out of step with the first.
 *
 * Long rather than wide — one `section,label,value` row per figure instead of a hundred
 * columns. A spreadsheet pivots that in two clicks, and it means adding a card later does
 * not reshape anybody's saved file.
 *
 * Amounts are written in **rupees as a decimal**, not paise, because this file is read by a
 * person. The integer-paise rule is about arithmetic, and all of that has already happened
 * by the time a value reaches here.
 */

export const dynamic = 'force-dynamic';

const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
const ATTENDANCE_DAYS = 28;
const PLAN_MIX_DAYS = 90;

/** Paise to a rupee decimal, for a human reader rather than for arithmetic. */
const rupees = (paise: number) => (paise / 100).toFixed(2);

export async function GET(request: Request) {
  const { actor, gym, today: contextToday } = await requireCrmContext();
  const { clock } = getContainer();

  if (!can(actor, 'money.view', clock.now())) {
    return new Response(null, { status: 403 });
  }

  const today = contextToday === undefined ? todayIST(clock) : contextToday;
  const params = new URL(request.url).searchParams;
  const askedMonth = params.get('month') ?? undefined;
  const askedPeriod = params.get('period') ?? undefined;

  // The same resolution the page does, in the same order: a named month wins.
  const askedForMonth = askedMonth !== undefined || !isReportPeriod(askedPeriod);
  const viewing = readReportMonth(askedMonth, today);
  const chosen = askedForMonth
    ? { period: 'MONTH' as const, bounds: monthBoundsFor(viewing, today) }
    : readReportPeriod({ period: askedPeriod, from: params.get('from') ?? undefined, to: params.get('to') ?? undefined }, today);
  const month = chosen.bounds;

  const attendanceFrom = addDays(today, -(ATTENDANCE_DAYS - 1));
  const inputs = await reportsReader().inputs(gym.id, month, {
    attendanceFrom,
    attendanceTo: today,
    planMixFrom: addDays(today, -(PLAN_MIX_DAYS - 1)),
  });

  const money = moneyByMethod({ thisMonth: inputs.paidThisMonth, lastMonth: inputs.paidLastMonth });
  const flow = membershipFlow(inputs.memberships, {
    monthStart: month.start,
    monthEnd: month.end,
    today,
    graceDays: gym.settings.membership.renewalGraceDays,
  });
  const hours = busyHours({ capturedAt: inputs.attendance.map((row) => row.capturedAt), from: attendanceFrom, to: today });
  const kiosk = kioskShare(inputs.attendance.map((row) => row.method));

  const rows: CsvValue[][] = [
    ['period', 'name', chosen.period],
    ['period', 'from', month.start],
    ['period', 'to', periodEndToDate(month, today)],
    ['period', 'compared_from', month.previousStart],
    ['period', 'compared_to', month.previousToDate],

    ['money', 'collected_rupees', rupees(money.totalPaise)],
    ['money', 'collected_previous_rupees', rupees(money.lastMonthPaise)],
    ['money', 'change_rupees', rupees(money.deltaPaise)],
    // Kept apart and never added to income (ADR-037); written so a zero is visible rather
    // than a column the owner has to wonder about.
    ['money', 'demo_gateway_rupees', rupees(money.demoPaise)],
    ...money.byMethod.map((row): CsvValue[] => ['money_by_method', row.method, rupees(row.amountPaise)]),

    ['members', 'new', flow.newMembers],
    ['members', 'renewals', flow.renewals],
    ['members', 'renewal_rate_due', flow.renewalRate.due],
    ['members', 'renewal_rate_renewed', flow.renewalRate.renewed],
    // `null` when nothing was due yet, which is not the same as 0% and is written empty.
    ['members', 'renewal_rate_percent', flow.renewalRate.percent],
    ...inputs.leftByReason.map((row): CsvValue[] => ['left_by_reason', row.reason, row.count]),

    ...GENDERS.map((gender): CsvValue[] => ['active_by_gender', gender, inputs.activeByGender.find((row) => row.gender === gender)?.count ?? 0]),
    ...inputs.planMix.map((row): CsvValue[] => ['plan_mix_90_days', String(row.durationMonths), row.count]),

    // Anchored on today rather than on the period, exactly as the screen says: the floor's
    // rhythm is about the gym as it is now, not about the month whose money is being read.
    ['attendance', 'window_from', attendanceFrom],
    ['attendance', 'window_to', today],
    // `null` with no check-ins at all: empty, not 0%, which would claim the camera failed.
    ['attendance', 'kiosk_share_percent', kiosk],
    ...hours.map((row): CsvValue[] => ['busy_hours_weekday_avg', String(row.hour), row.weekday]),
    ...hours.map((row): CsvValue[] => ['busy_hours_weekend_avg', String(row.hour), row.weekend]),
  ];

  const body = csvFile(['section', 'label', 'value'], rows);
  const filename = `max-reports-${month.start}-to-${periodEndToDate(month, today)}.csv`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
