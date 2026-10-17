import type { ISTDate } from '@mfp/shared';
import type { PrismaClient } from '../client';

/**
 * Reading the audit trail (CRM-AUDIT).
 *
 * `AuditLog` has been written to since the first migration and nothing has ever read it,
 * so the gym carried the cost of recording every sensitive action without the benefit of
 * being able to look. This is the read side, and nothing more — the table is append-only
 * by design and there is deliberately no update or delete here.
 *
 * Served by the existing `@@index([gymId, createdAt])`, so no migration.
 *
 * **Cursor paging, not offset.** `OFFSET 2000` makes the database count two thousand rows
 * it then discards, and an append-only table grows for ever: the log is the one screen in
 * here guaranteed to get slower every day under offset paging. A cursor on `(createdAt,
 * id)` stays flat, and `id` is in there because two actions inside the same transaction
 * share a timestamp and a cursor on time alone would skip or repeat them.
 */

export interface AuditLogRow {
  readonly id: string;
  readonly createdAt: Date;
  readonly actorType: string;
  readonly actorId: string | null;
  /** The staff member's name when the actor is one of ours and still on the books. */
  readonly actorName: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly before: unknown;
  readonly after: unknown;
}

export interface AuditLogPage {
  readonly rows: readonly AuditLogRow[];
  /** Pass back as `before` to get the next page; `null` when there is nothing older. */
  readonly nextCursor: string | null;
}

export interface AuditLogFilter {
  readonly from?: ISTDate;
  readonly to?: ISTDate;
  /** An exact action, as recorded — `payment.void`, `settings.update`. */
  readonly action?: string;
  readonly actorId?: string;
  /** `<createdAt ISO>|<id>` from a previous page's `nextCursor`. */
  readonly cursor?: string;
  readonly limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class PrismaAuditReader {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  /** Distinct actions actually present for this gym, for the filter's options. */
  async actions(gymId: string): Promise<readonly string[]> {
    const rows = await this.#prisma.auditLog.findMany({
      where: { gymId },
      select: { action: true },
      distinct: ['action'],
      orderBy: { action: 'asc' },
    });
    return rows.map((row) => row.action);
  }

  async list(gymId: string, filter: AuditLogFilter = {}): Promise<AuditLogPage> {
    const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const cursor = parseCursor(filter.cursor);

    /**
     * Dates are IST business days and `createdAt` is a UTC instant, so the bounds are the
     * IST day's edges rather than midnight UTC — otherwise "today" starts at 05:30 and the
     * early-morning rows land on the wrong day (CLAUDE.md §2.2).
     */
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (filter.from !== undefined) createdAt.gte = new Date(`${filter.from}T00:00:00+05:30`);
    if (filter.to !== undefined) createdAt.lte = new Date(`${filter.to}T23:59:59.999+05:30`);

    const rows = await this.#prisma.auditLog.findMany({
      where: {
        gymId,
        ...(Object.keys(createdAt).length === 0 ? {} : { createdAt }),
        ...(filter.action === undefined ? {} : { action: filter.action }),
        ...(filter.actorId === undefined ? {} : { actorId: filter.actorId }),
        // Strictly older than the cursor, breaking the tie on id so rows sharing a
        // timestamp are neither skipped nor shown twice.
        ...(cursor === null
          ? {}
          : { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }),
      },
      select: { id: true, createdAt: true, actorType: true, actorId: true, action: true, entityType: true, entityId: true, before: true, after: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // One more than asked for, to know whether there is another page without counting.
      take: limit + 1,
    });

    const page = rows.slice(0, limit);
    const names = await this.#actorNames(gymId, page);

    return {
      rows: page.map((row) => ({
        ...row,
        actorName: row.actorId === null ? null : (names.get(row.actorId) ?? null),
      })),
      nextCursor: nextCursorFor(rows.length > limit, page.at(-1)),
    };
  }

  /**
   * Names for the staff ids on this page, in one query.
   *
   * A row whose actor is `system`, `webhook` or a member has no staff name, and one whose
   * staff record has since been deleted has none either — the screen then shows the actor
   * type, which is still true. The id is never resolved against members: this screen names
   * who *acted*, and a member is never the actor on an audited staff action.
   */
  async #actorNames(gymId: string, rows: ReadonlyArray<{ actorType: string; actorId: string | null }>): Promise<Map<string, string>> {
    const ids = [...new Set(rows.filter((row) => row.actorType === 'staff' && row.actorId !== null).map((row) => row.actorId as string))];
    if (ids.length === 0) return new Map();

    const staff = await this.#prisma.staffUser.findMany({ where: { gymId, id: { in: ids } }, select: { id: true, name: true } });
    return new Map(staff.map((row) => [row.id, row.name]));
  }
}

/** `<iso>|<id>`, or null for anything unreadable — a bad cursor shows page one. */
function parseCursor(raw: string | undefined): { createdAt: Date; id: string } | null {
  if (raw === undefined) return null;
  const separator = raw.lastIndexOf('|');
  if (separator <= 0) return null;

  const createdAt = new Date(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  return Number.isNaN(createdAt.getTime()) || id === '' ? null : { createdAt, id };
}

/** The cursor for the next page, or null when this page is the last one. */
function nextCursorFor(hasMore: boolean, last: { createdAt: Date; id: string } | undefined): string | null {
  return hasMore && last !== undefined ? `${last.createdAt.toISOString()}|${last.id}` : null;
}
