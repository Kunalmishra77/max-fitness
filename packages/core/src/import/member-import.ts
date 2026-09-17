import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  addDays,
  addMonthsClamped,
  compareISTDates,
  istDate,
  NAME_PATTERN,
  normaliseIndianMobile,
  PLAN_DURATIONS,
  todayIST,
  type Clock,
  type E164Mobile,
  type ISTDate,
  type PlanDurationMonths,
} from '@mfp/shared';
import { assertCan, mayAfterPinEntry, type CrmActor } from '../crm/permissions';
import { DomainError } from '../errors';
import { declaredMembershipPeriod } from '../membership/dates';
import { formatMemberCode, MEMBER_CODE_COUNTER_KEY } from '../payments/receipt-number';

/**
 * Bringing in the gym's paper register (PRD CRM-21; crm-module-spec §7; BR-3.6; ADR-009, ADR-056).
 *
 * The owner fills the template CSV; each row becomes an ACTIVE member with a declared
 * membership. Three steps, and the rules that make them safe:
 *
 * - **Parse** explains every row — the fields that are wrong, and the things worth a
 *   second look (a number shared by a family, a membership that ran out long ago).
 * - **Preview** adds what only the database knows: who is already a member.
 * - **Commit** needs the owner with a fresh PIN, reads the file again rather than
 *   trusting the preview, writes nothing if any row is wrong, never creates the same
 *   person twice, and numbers the new members in one block.
 *
 * WhatsApp stays off for imported members (ADR-009) unless the owner confirms they
 * agreed at the desk, which is then recorded as their consent. The audit log gets the
 * counts, never a name or a number.
 */

export const IMPORT_COLUMNS = [
  'full_name',
  'mobile',
  'gender',
  'dob',
  'email',
  'plan_months',
  'month_end_date',
  'last_amount',
  'joined_on',
  'notes',
] as const;
type ImportColumn = (typeof IMPORT_COLUMNS)[number];

const REQUIRED_COLUMNS: readonly ImportColumn[] = ['full_name', 'mobile', 'gender', 'month_end_date'];

export const MAX_IMPORT_ROWS = 2000;
/** No plan runs longer than twelve months; a month-end further out than this is a typo. */
const MAX_MONTHS_AHEAD = 13;
/** BR-4.3's default: this long past expiry, a member is usually gone. */
const LONG_EXPIRED_DAYS = 60;
const MAX_NOTES = 500;
const MAX_NAME = 100;
/** ₹10,00,000: anything above is a typo, not a fee. */
const MAX_AMOUNT_RUPEES = 1_000_000;
const ADULT_MONTHS = 18 * 12;

export type ImportRowError = ImportColumn | 'duplicate_row';
export type ImportRowWarning = 'shared_mobile' | 'already_member' | 'long_expired';
export type ImportFileError = 'empty' | 'missing_columns' | 'too_many_rows' | 'unreadable';

export interface ImportedMember {
  readonly fullName: string;
  readonly mobile: E164Mobile;
  readonly gender: 'MALE' | 'FEMALE';
  readonly dob: ISTDate | null;
  readonly email: string | null;
  readonly planMonths: PlanDurationMonths | null;
  readonly monthEndDate: ISTDate;
  /** BR-3.6: worked back from the end date when the plan length is known, else unknown. */
  readonly startDate: ISTDate | null;
  readonly lastAmountPaise: number | null;
  readonly joinedOn: ISTDate | null;
  readonly notes: string | null;
}

export interface ImportRow {
  /** The line the row starts on in the file, counting the header as 1. */
  readonly line: number;
  /** `null` when any field is wrong. */
  readonly member: ImportedMember | null;
  readonly errors: readonly ImportRowError[];
  readonly warnings: readonly ImportRowWarning[];
}

export type ParsedImport =
  | { readonly ok: true; readonly rows: readonly ImportRow[] }
  | { readonly ok: false; readonly error: ImportFileError; readonly missing?: readonly ImportColumn[] };

// ── CSV ─────────────────────────────────────────────────────────────────────

interface CsvRecord {
  readonly line: number;
  readonly fields: readonly string[];
}

/** RFC 4180 as spreadsheets write it: quoted fields, doubled quotes, CRLF or LF. `null` if a quote never closes. */
function readCsv(text: string): CsvRecord[] | null {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') line++;
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else if (char === '\n') {
      fields.push(field);
      records.push({ line: recordLine, fields });
      fields = [];
      field = '';
      line++;
      recordLine = line;
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (quoted) return null;
  if (field !== '' || fields.length > 0) {
    fields.push(field);
    records.push({ line: recordLine, fields });
  }
  return records;
}

const isBlank = (record: CsvRecord) => record.fields.every((value) => value.trim() === '');
const headerName = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '_');

// ── Fields ──────────────────────────────────────────────────────────────────

const collapse = (value: string) => value.trim().replace(/\s+/g, ' ');
const personKey = (mobile: E164Mobile, fullName: string) => `${mobile}|${collapse(fullName).toLowerCase()}`;

/** `DD-MM-YYYY`, one or two digits for day and month; `null` if not a real date. */
function parseDate(value: string): ISTDate | null {
  const match = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(value.trim());
  if (match === null) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return istDate(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
}

/** `2026-09-30` → `30-09-2026`, the way the register writes it. */
function displayDate(date: ISTDate): string {
  const [year, month, day] = date.split('-');
  return `${day ?? ''}-${month ?? ''}-${year ?? ''}`;
}

const emailSchema = z.email();

function parseRow(record: CsvRecord, columns: ReadonlyMap<ImportColumn, number>, today: ISTDate): { member: ImportedMember | null; errors: ImportRowError[]; warnings: ImportRowWarning[] } {
  const raw = (column: ImportColumn) => {
    const index = columns.get(column);
    return index === undefined ? '' : (record.fields[index] ?? '').trim();
  };
  const errors: ImportRowError[] = [];
  const warnings: ImportRowWarning[] = [];

  const fullName = collapse(raw('full_name'));
  if (fullName.length < 2 || fullName.length > MAX_NAME || !NAME_PATTERN.test(fullName)) errors.push('full_name');

  const mobile = raw('mobile') === '' ? null : normaliseIndianMobile(raw('mobile'));
  if (mobile === null) errors.push('mobile');

  const genderValue = raw('gender').toUpperCase();
  const gender = genderValue === 'M' || genderValue === 'MALE' ? 'MALE' : genderValue === 'F' || genderValue === 'FEMALE' ? 'FEMALE' : null;
  if (gender === null) errors.push('gender');

  let dob: ISTDate | null = null;
  if (raw('dob') !== '') {
    dob = parseDate(raw('dob'));
    if (dob === null || compareISTDates(dob, today) > 0) errors.push('dob');
  }

  let email: string | null = null;
  if (raw('email') !== '') {
    email = raw('email').toLowerCase();
    if (!emailSchema.safeParse(email).success) errors.push('email');
  }

  let planMonths: PlanDurationMonths | null = null;
  if (raw('plan_months') !== '') {
    const months = /^\d+$/.test(raw('plan_months')) ? Number(raw('plan_months')) : NaN;
    planMonths = (PLAN_DURATIONS as readonly number[]).includes(months) ? (months as PlanDurationMonths) : null;
    if (planMonths === null) errors.push('plan_months');
  }

  const monthEndDate = parseDate(raw('month_end_date'));
  if (monthEndDate === null || compareISTDates(monthEndDate, addMonthsClamped(today, MAX_MONTHS_AHEAD)) > 0) {
    errors.push('month_end_date');
  } else if (compareISTDates(monthEndDate, addDays(today, -LONG_EXPIRED_DAYS)) < 0) {
    warnings.push('long_expired');
  }

  let lastAmountPaise: number | null = null;
  if (raw('last_amount') !== '') {
    const rupees = /^\d+$/.test(raw('last_amount')) ? Number(raw('last_amount')) : NaN;
    if (Number.isSafeInteger(rupees) && rupees <= MAX_AMOUNT_RUPEES) lastAmountPaise = rupees * 100;
    else errors.push('last_amount');
  }

  let joinedOn: ISTDate | null = null;
  if (raw('joined_on') !== '') {
    joinedOn = parseDate(raw('joined_on'));
    if (joinedOn === null || compareISTDates(joinedOn, today) > 0) errors.push('joined_on');
  }

  const notesText = raw('notes');
  if (notesText.length > MAX_NOTES) errors.push('notes');

  if (errors.length > 0 || mobile === null || gender === null || monthEndDate === null) {
    return { member: null, errors, warnings };
  }
  return {
    member: {
      fullName,
      mobile,
      gender,
      dob,
      email,
      planMonths,
      monthEndDate,
      startDate: declaredMembershipPeriod(monthEndDate, planMonths).startDate,
      lastAmountPaise,
      joinedOn,
      notes: notesText === '' ? null : notesText,
    },
    errors,
    warnings,
  };
}

/** Mobile and name for rows whose mobile could be read, even if another field is wrong. */
function identityOf(record: CsvRecord, columns: ReadonlyMap<ImportColumn, number>): { mobile: E164Mobile; key: string } | null {
  const at = (column: ImportColumn) => {
    const index = columns.get(column);
    return index === undefined ? '' : (record.fields[index] ?? '');
  };
  const mobile = at('mobile').trim() === '' ? null : normaliseIndianMobile(at('mobile'));
  return mobile === null ? null : { mobile, key: personKey(mobile, at('full_name')) };
}

export function parseMemberImport(csv: string, options: { readonly today: ISTDate }): ParsedImport {
  const records = readCsv(csv);
  if (records === null) return { ok: false, error: 'unreadable' };

  const [header, ...rest] = records.filter((record) => !isBlank(record));
  if (header === undefined) return { ok: false, error: 'empty' };

  const columns = new Map<ImportColumn, number>();
  header.fields.forEach((value, index) => {
    const name = headerName(value);
    if ((IMPORT_COLUMNS as readonly string[]).includes(name) && !columns.has(name as ImportColumn)) columns.set(name as ImportColumn, index);
  });
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.has(column));
  if (missing.length > 0) return { ok: false, error: 'missing_columns', missing };
  if (rest.length === 0) return { ok: false, error: 'empty' };
  if (rest.length > MAX_IMPORT_ROWS) return { ok: false, error: 'too_many_rows' };

  const identities = rest.map((record) => identityOf(record, columns));
  const namesByMobile = new Map<string, Set<string>>();
  for (const identity of identities) {
    if (identity === null) continue;
    const names = namesByMobile.get(identity.mobile) ?? new Set<string>();
    names.add(identity.key);
    namesByMobile.set(identity.mobile, names);
  }

  const seen = new Set<string>();
  const rows = rest.map((record, index): ImportRow => {
    const parsed = parseRow(record, columns, options.today);
    const identity = identities[index] ?? null;
    const errors = [...parsed.errors];
    const warnings: ImportRowWarning[] = [];

    if (identity !== null) {
      if ((namesByMobile.get(identity.mobile)?.size ?? 0) > 1) warnings.push('shared_mobile');
      if (seen.has(identity.key)) errors.push('duplicate_row');
      seen.add(identity.key);
    }
    warnings.push(...parsed.warnings);

    return { line: record.line, member: errors.length > 0 ? null : parsed.member, errors, warnings };
  });

  return { ok: true, rows };
}

// ── Preview and commit ──────────────────────────────────────────────────────

export interface ImportedMemberRecord {
  readonly gymId: string;
  readonly memberCode: string;
  readonly fullName: string;
  readonly mobile: E164Mobile;
  readonly gender: 'MALE' | 'FEMALE';
  readonly dob: ISTDate | null;
  readonly email: string | null;
  readonly isMinor: boolean;
  readonly notes: string | null;
  readonly whatsappOptIn: boolean;
  readonly createdById: string;
  /** A declared, confirmed membership (BR-3.6): no payment was taken in this system. */
  readonly membership: {
    readonly durationMonths: PlanDurationMonths | null;
    readonly startDate: ISTDate | null;
    readonly endDate: ISTDate;
    readonly pricePaise: number;
  };
  /** Present only when the owner confirmed the members agreed to WhatsApp at the desk. */
  readonly whatsappConsent: { readonly noticeVersion: string } | null;
}

export interface ImportAuditEntry {
  readonly gymId: string;
  readonly actorType: 'staff';
  readonly actorId: string;
  readonly action: 'member.import';
  readonly entityType: 'Import';
  readonly entityId: string;
  readonly after: { readonly rows: number; readonly created: number; readonly skipped: number; readonly deskConsent: boolean };
}

export interface MemberImportReader {
  /** Members of this gym on any of these numbers, deleted ones excluded. */
  findMembersByMobile(gymId: string, mobiles: readonly E164Mobile[]): Promise<ReadonlyArray<{ readonly mobile: E164Mobile; readonly fullName: string }>>;
}

export interface MemberImportStore extends MemberImportReader {
  /** Reserves `count` consecutive values and returns the first. */
  reserveCounterBlock(gymId: string, key: string, count: number): Promise<number>;
  insertImportedMembers(records: readonly ImportedMemberRecord[]): Promise<void>;
  writeAudit(entry: ImportAuditEntry): Promise<void>;
}

export interface MemberImportUnitOfWork {
  transaction<T>(work: (store: MemberImportStore) => Promise<T>): Promise<T>;
}

export interface ImportSummary {
  readonly rows: number;
  /** Rows that will become members. */
  readonly ready: number;
  /** Rows already in the register, left alone. */
  readonly skipped: number;
  readonly withErrors: number;
}

export type ImportPreview =
  | { readonly ok: true; readonly rows: readonly ImportRow[]; readonly summary: ImportSummary }
  | Extract<ParsedImport, { ok: false }>;

/** Adds what only the database knows: who is already a member, and who shares a number with one. */
async function markExisting(gymId: string, rows: readonly ImportRow[], reader: MemberImportReader): Promise<ImportRow[]> {
  const mobiles = [...new Set(rows.flatMap((row) => (row.member === null ? [] : [row.member.mobile])))];
  const existing = mobiles.length === 0 ? [] : await reader.findMembersByMobile(gymId, mobiles);
  const keys = new Set(existing.map((member) => personKey(member.mobile, member.fullName)));
  const numbers = new Set(existing.map((member) => member.mobile));

  return rows.map((row) => {
    if (row.member === null) return row;
    const warnings = [...row.warnings];
    if (keys.has(personKey(row.member.mobile, row.member.fullName))) {
      warnings.push('already_member');
    } else if (numbers.has(row.member.mobile) && !warnings.includes('shared_mobile')) {
      warnings.push('shared_mobile');
    }
    return { ...row, warnings };
  });
}

const isSkipped = (row: ImportRow) => row.warnings.includes('already_member');

function summarise(rows: readonly ImportRow[]): ImportSummary {
  const withErrors = rows.filter((row) => row.errors.length > 0).length;
  const skipped = rows.filter((row) => row.errors.length === 0 && isSkipped(row)).length;
  return { rows: rows.length, ready: rows.length - withErrors - skipped, skipped, withErrors };
}

export async function previewMemberImport(
  input: { readonly csv: string },
  deps: { readonly actor: CrmActor; readonly clock: Clock; readonly store: MemberImportReader },
): Promise<ImportPreview> {
  const now = deps.clock.now();
  // The preview writes nothing, so it asks only for the role; the commit asks for the PIN.
  if (!mayAfterPinEntry(deps.actor, 'member.import', now)) throw new DomainError('FORBIDDEN', 'Not allowed', { capability: 'member.import' });

  const parsed = parseMemberImport(input.csv, { today: todayIST(deps.clock) });
  if (!parsed.ok) return parsed;
  const rows = await markExisting(deps.actor.gymId, parsed.rows, deps.store);
  return { ok: true, rows, summary: summarise(rows) };
}

export async function commitMemberImport(
  input: { readonly csv: string; readonly deskConsent: boolean },
  deps: {
    readonly actor: CrmActor;
    readonly clock: Clock;
    readonly uow: MemberImportUnitOfWork;
    /** `privacy.privacyNoticeVersion`, recorded with a desk consent. */
    readonly noticeVersion: string;
    readonly newImportId?: () => string;
  },
): Promise<{ readonly importId: string; readonly created: number; readonly skipped: number }> {
  const { actor, clock } = deps;
  assertCan(actor, 'member.import', clock.now());

  const today = todayIST(clock);
  const parsed = parseMemberImport(input.csv, { today });
  if (!parsed.ok) throw new DomainError('VALIDATION_FAILED', 'The file cannot be imported', { file: parsed.error });
  const wrong = parsed.rows.filter((row) => row.errors.length > 0).map((row) => row.line);
  if (wrong.length > 0) {
    throw new DomainError('VALIDATION_FAILED', 'Some rows need fixing before the import', { lines: wrong.join(','), count: wrong.length });
  }

  const importId = (deps.newImportId ?? randomUUID)();

  return deps.uow.transaction(async (store) => {
    const rows = await markExisting(actor.gymId, parsed.rows, store);
    const creatable = rows.filter((row) => !isSkipped(row)).flatMap((row) => (row.member === null ? [] : [row.member]));
    const skipped = rows.length - creatable.length;
    if (creatable.length === 0) return { importId, created: 0, skipped };

    const first = await store.reserveCounterBlock(actor.gymId, MEMBER_CODE_COUNTER_KEY, creatable.length);
    const records = creatable.map(
      (member, index): ImportedMemberRecord => ({
        gymId: actor.gymId,
        memberCode: formatMemberCode(first + index),
        fullName: member.fullName,
        mobile: member.mobile,
        gender: member.gender,
        dob: member.dob,
        email: member.email,
        isMinor: member.dob !== null && compareISTDates(addMonthsClamped(member.dob, ADULT_MONTHS), today) > 0,
        notes: [member.joinedOn === null ? null : `Joined ${displayDate(member.joinedOn)}`, member.notes].filter((part) => part !== null).join(' · ') || null,
        whatsappOptIn: input.deskConsent,
        createdById: actor.staffUserId,
        membership: {
          durationMonths: member.planMonths,
          startDate: member.startDate,
          endDate: member.monthEndDate,
          pricePaise: member.lastAmountPaise ?? 0,
        },
        whatsappConsent: input.deskConsent ? { noticeVersion: deps.noticeVersion } : null,
      }),
    );

    await store.insertImportedMembers(records);
    await store.writeAudit({
      gymId: actor.gymId,
      actorType: 'staff',
      actorId: actor.staffUserId,
      action: 'member.import',
      entityType: 'Import',
      entityId: importId,
      after: { rows: rows.length, created: records.length, skipped, deskConsent: input.deskConsent },
    });
    return { importId, created: records.length, skipped };
  });
}
