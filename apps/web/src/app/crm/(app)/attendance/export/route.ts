import { can, csvFile, customRange, isDomainError } from '@mfp/core';
import { addDays, compareISTDates, formatISTDate, isISTDate, todayIST, type ISTDate } from '@mfp/shared';
import { getContainer } from '@/lib/container';
import { requireCrmContext } from '@/lib/crm';

/**
 * `GET /crm/attendance/export?from=&to=` — the register as rows (ATT-007).
 *
 * The owner's question is almost always asked of a spreadsheet in the end — who came in
 * October, how often did Trilok train — so this hands over the range on screen rather
 * than trying to answer every version of it in the CRM.
 *
 * **Authorised here, not on the button.** A URL can be typed, and this one is a list of
 * every member who came in a span of time; the same `attendance.manual` capability that
 * lets somebody see the attendance screen is what lets them download it. A trainer has
 * it, which is right — they run the floor — and it is checked server-side regardless.
 *
 * **The range is parsed by the same `customRange` the screen uses**, so a URL that
 * produces a table cannot disagree with the screen it came from, and the two-year
 * ceiling that stops a hand-typed range asking for the whole table applies here too.
 *
 * Only the fields the task needs: who, when, how, and their code. No mobile numbers, no
 * email, no photographs, no identity documents — an attendance export has no business
 * carrying a column of phone numbers out of the building (privacy §4).
 *
 * Every field goes through `csvField`, which neutralises a leading `=`, `+`, `-` or `@`.
 * Member names come out of the QR form, which members fill in themselves, so they are
 * untrusted text and this file is opened by the one person who can see everything.
 */

export const dynamic = 'force-dynamic';

const PRIVATE = {
  'Content-Type': 'text/csv; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
  'Referrer-Policy': 'no-referrer',
} as const;

export async function GET(request: Request) {
  const { actor, gym, reader } = await requireCrmContext();
  const { clock } = getContainer();

  if (!can(actor, 'attendance.manual', clock.now())) {
    return new Response(null, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const from = params.get('from');
  const to = params.get('to');
  if (!isISTDate(from) || !isISTDate(to)) {
    return new Response(null, { status: 400 });
  }

  const today = todayIST(clock);
  let range;
  try {
    range = customRange(from, to, today);
  } catch (error) {
    // The screen says what is wrong in words; a download has only a status to say it with.
    return new Response(isDomainError(error) ? error.message : 'Invalid range', { status: 400 });
  }

  /**
   * Walked a day at a time, because `attendanceOn` is the query that already exists and
   * is already indexed, and the ceiling on the range bounds the number of round trips.
   * A single range query would be fewer, and is the thing to write if an export ever
   * feels slow — at a gym of this size over two years it has nothing to beat.
   */
  const days: ISTDate[] = [];
  for (let cursor = range.from; compareISTDates(cursor, range.to) <= 0; cursor = addDays(cursor, 1)) days.push(cursor);

  const rows: Array<Array<string | number | null>> = [];
  for (const day of days) {
    const events = await reader.attendanceOn(gym.id, day, 1_000);
    for (const event of events) {
      rows.push([
        day,
        formatISTDate(day, 'en-IN', { year: true }),
        new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(event.capturedAt),
        event.memberCode,
        event.fullName,
        event.method,
      ]);
    }
  }

  const body = csvFile(['date', 'date_readable', 'time_ist', 'member_code', 'member_name', 'method'], rows);
  const filename = `max-attendance-${range.from}-to-${range.to}.csv`;

  return new Response(body, {
    headers: { ...PRIVATE, 'Content-Disposition': `attachment; filename="${filename}"` },
  });
}
