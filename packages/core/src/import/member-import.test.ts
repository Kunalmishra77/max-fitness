import { beforeEach, describe, expect, it } from 'vitest';
import { istDate, type E164Mobile } from '@mfp/shared';
import { fakeClockAt } from '../testing/builders';
import type { CrmActor } from '../crm/permissions';
import {
  commitMemberImport,
  parseMemberImport,
  previewMemberImport,
  type ImportAuditEntry,
  type ImportedMemberRecord,
  type MemberImportStore,
} from './member-import';

/**
 * Bringing in the gym's paper register (PRD CRM-21; crm-module-spec §7; BR-3.6; ADR-009).
 *
 * A CSV in the template's columns becomes ACTIVE members with declared memberships.
 * Every row is checked and explained before anything is written; the commit re-reads
 * the file rather than trusting the preview, writes nothing if any row is wrong, never
 * creates a member twice, and turns WhatsApp on only when the owner says the members
 * agreed at the desk — people who never consented get no reminders.
 */

const TODAY = '2026-09-16';
const clock = fakeClockAt(`${TODAY}T11:00`);

const HEADER = 'full_name,mobile,gender,dob,email,plan_months,month_end_date,last_amount,joined_on,notes';
const TEMPLATE = [
  HEADER,
  'Sanjay Tomar,9876543210,M,14-02-1984,,3,30-09-2026,4000,05-06-2019,Morning batch',
  'Neha Gupta,9811122233,F,22-11-1990,neha@example.com,1,18-09-2026,1200,01-08-2026,',
  'Amit Tyagi,9899988877,M,,,12,15-03-2027,13500,15-03-2024,Pays by UPI',
].join('\n');

const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');
const parse = (text: string) => parseMemberImport(text, { today: istDate(TODAY) });
const rowsOf = (text: string) => {
  const parsed = parse(text);
  if (!parsed.ok) throw new Error(`file refused: ${parsed.error}`);
  return parsed.rows;
};

describe('parseMemberImport — the template', () => {
  it('reads every column, and works out each start date from the month-end date (BR-3.6)', () => {
    const rows = rowsOf(TEMPLATE);

    expect(rows.map((row) => [row.line, row.errors, row.warnings])).toEqual([
      [2, [], []],
      [3, [], []],
      [4, [], []],
    ]);
    expect(rows[0]?.member).toEqual({
      fullName: 'Sanjay Tomar',
      mobile: '+919876543210',
      gender: 'MALE',
      dob: '1984-02-14',
      email: null,
      planMonths: 3,
      monthEndDate: '2026-09-30',
      startDate: '2026-07-01',
      lastAmountPaise: 400_000,
      joinedOn: '2019-06-05',
      notes: 'Morning batch',
    });
    expect(rows[1]?.member).toMatchObject({ gender: 'FEMALE', email: 'neha@example.com', startDate: '2026-08-19', notes: null });
    // No date of birth is fine; twelve months back from the day after the end date.
    expect(rows[2]?.member).toMatchObject({ dob: null, planMonths: 12, startDate: '2026-03-16', lastAmountPaise: 1_350_000 });
  });

  it('leaves the start date unknown when the plan length is unknown, rather than inventing one', () => {
    const [row] = rowsOf(csv('Ravi Kumar,9876500001,M,,,,30-09-2026,,,'));
    expect(row?.member).toMatchObject({ planMonths: null, startDate: null, lastAmountPaise: null, joinedOn: null });
  });
});

describe('parseMemberImport — what spreadsheets actually produce', () => {
  it('copes with a BOM, Windows line endings, quoted commas, blank lines and columns in any order', () => {
    const text =
      '﻿Mobile , Full_Name,gender,month_end_date,notes\r\n' +
      '98765 43210,"Sanjay Tomar",m,30-09-2026,"Morning, 6 am — says ""hi"""\r\n' +
      '\r\n' +
      '+91 98111 22233,Neha Gupta,F,1-9-2026,\r\n';
    const rows = rowsOf(text);

    expect(rows).toHaveLength(2);
    // A comma is fine inside quotes (names follow the shared rule, which has no commas).
    expect(rows[0]?.member).toMatchObject({ fullName: 'Sanjay Tomar', mobile: '+919876543210', gender: 'MALE', notes: 'Morning, 6 am — says "hi"' });
    // Single-digit day and month are still DD-MM-YYYY. Blank lines keep their line numbers.
    expect(rows[1]).toMatchObject({ line: 4, member: { mobile: '+919811122233', monthEndDate: '2026-09-01' } });
  });

  it('refuses an empty file, a file without the required columns, and one too long to check', () => {
    expect(parse('')).toEqual({ ok: false, error: 'empty' });
    expect(parse(`${HEADER}\n`)).toEqual({ ok: false, error: 'empty' });
    expect(parse('name,phone\nSanjay,9876543210')).toEqual({
      ok: false,
      error: 'missing_columns',
      missing: ['full_name', 'mobile', 'gender', 'month_end_date'],
    });
    const tooMany = csv(...Array.from({ length: 2001 }, (_, i) => `Member,98${String(i).padStart(8, '0')},M,,,,30-09-2026,,,`));
    expect(parse(tooMany)).toEqual({ ok: false, error: 'too_many_rows' });
  });
});

describe('parseMemberImport — row by row', () => {
  const errorsOf = (row: string) => rowsOf(csv(row))[0]?.errors;

  it('names each field that is wrong, and keeps the rest of the file', () => {
    expect(errorsOf('Sanjay 2,9876543210,M,,,,30-09-2026,,,')).toEqual(['full_name']);
    expect(errorsOf('Sanjay,12345,M,,,,30-09-2026,,,')).toEqual(['mobile']);
    expect(errorsOf('Sanjay,9876543210,X,,,,30-09-2026,,,')).toEqual(['gender']);
    expect(errorsOf('Sanjay,9876543210,M,31-02-1990,,,30-09-2026,,,')).toEqual(['dob']);
    expect(errorsOf('Sanjay,9876543210,M,01-01-2030,,,30-09-2026,,,')).toEqual(['dob']);
    expect(errorsOf('Sanjay,9876543210,M,,not-an-email,,30-09-2026,,,')).toEqual(['email']);
    expect(errorsOf('Sanjay,9876543210,M,,,2,30-09-2026,,,')).toEqual(['plan_months']);
    expect(errorsOf('Sanjay,9876543210,M,,,,2026-09-30,,,')).toEqual(['month_end_date']);
    expect(errorsOf('Sanjay,9876543210,M,,,,,,,')).toEqual(['month_end_date']);
    expect(errorsOf('Sanjay,9876543210,M,,,,12.5,,,')).toEqual(['month_end_date']);
    expect(errorsOf('Sanjay,9876543210,M,,,,30-09-2026,12.50,,')).toEqual(['last_amount']);
    expect(errorsOf('Sanjay,9876543210,M,,,,30-09-2026,-100,,')).toEqual(['last_amount']);
    expect(errorsOf('Sanjay,9876543210,M,,,,30-09-2026,,31-13-2020,')).toEqual(['joined_on']);
    expect(errorsOf(`Sanjay,9876543210,M,,,,30-09-2026,,,${'x'.repeat(501)}`)).toEqual(['notes']);
    // Several at once are all reported.
    expect(errorsOf('Sanjay,123,X,,,,,,,')).toEqual(['mobile', 'gender', 'month_end_date']);
  });

  it('refuses a month-end date more than thirteen months away — no plan runs that long', () => {
    expect(errorsOf('Sanjay,9876543210,M,,,,17-10-2027,,,')).toEqual(['month_end_date']);
    expect(errorsOf('Sanjay,9876543210,M,,,,16-10-2027,,,')).toEqual([]);
  });

  it('warns about a number shared by a family, and refuses the same person twice', () => {
    const rows = rowsOf(
      csv(
        'Sanjay Tomar,9876543210,M,,,,30-09-2026,,,',
        'Rekha Tomar,9876543210,F,,,,30-09-2026,,,',
        'sanjay  tomar,98765 43210,M,,,,30-09-2026,,,',
      ),
    );
    expect(rows.map((row) => [row.errors, row.warnings])).toEqual([
      [[], ['shared_mobile']],
      [[], ['shared_mobile']],
      [['duplicate_row'], ['shared_mobile']],
    ]);
  });

  it('warns about a membership that ran out long ago', () => {
    const [row] = rowsOf(csv('Sanjay,9876543210,M,,,,17-07-2026,,,'));
    expect(row?.warnings).toEqual(['long_expired']);
    expect(rowsOf(csv('Sanjay,9876543210,M,,,,18-07-2026,,,'))[0]?.warnings).toEqual([]);
  });
});

// ── The service ────────────────────────────────────────────────────────────

const owner: CrmActor = {
  staffUserId: 'staff_1',
  gymId: 'gym_1',
  role: 'OWNER',
  elevatedUntil: new Date(clock.now().getTime() + 60_000),
  receptionMayTakePayments: true,
};
const ownerWithoutPin: CrmActor = { ...owner, elevatedUntil: null };
const reception: CrmActor = { ...owner, staffUserId: 'staff_2', role: 'RECEPTION' };

class FakeStore implements MemberImportStore {
  existing: Array<{ mobile: E164Mobile; fullName: string }> = [{ mobile: '+919876543210' as E164Mobile, fullName: 'SANJAY TOMAR' }];
  counter = 100;
  readonly inserted: ImportedMemberRecord[] = [];
  readonly audit: ImportAuditEntry[] = [];
  readonly asked: string[][] = [];

  findMembersByMobile(_gymId: string, mobiles: readonly E164Mobile[]) {
    this.asked.push([...mobiles]);
    return Promise.resolve(this.existing.filter((member) => mobiles.includes(member.mobile)));
  }
  reserveCounterBlock(_gymId: string, _key: string, count: number) {
    const first = this.counter + 1;
    this.counter += count;
    return Promise.resolve(first);
  }
  insertImportedMembers(records: readonly ImportedMemberRecord[]) {
    this.inserted.push(...records);
    return Promise.resolve();
  }
  writeAudit(entry: ImportAuditEntry) {
    this.audit.push(entry);
    return Promise.resolve();
  }
}

describe('previewMemberImport', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  it('marks who is already a member, and who shares a number with one, asking about each number once', async () => {
    store.existing.push({ mobile: '+919811122233' as E164Mobile, fullName: 'Pooja Gupta' });
    const preview = await previewMemberImport({ csv: TEMPLATE }, { actor: ownerWithoutPin, clock, store });

    if (!preview.ok) throw new Error('refused');
    expect(preview.rows.map((row) => row.warnings)).toEqual([['already_member'], ['shared_mobile'], []]);
    expect(preview.summary).toEqual({ rows: 3, ready: 2, skipped: 1, withErrors: 0 });
    expect(store.asked).toEqual([['+919876543210', '+919811122233', '+919899988877']]);
  });

  it('is for the owner only (the PIN is asked at commit)', async () => {
    await expect(previewMemberImport({ csv: TEMPLATE }, { actor: reception, clock, store })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('commitMemberImport', () => {
  let store: FakeStore;
  const commit = (input: { csv: string; deskConsent: boolean }, actor = owner) =>
    commitMemberImport(input, { actor, clock, uow: { transaction: (work) => work(store) }, noticeVersion: '1.0', newImportId: () => 'imp_1' });

  beforeEach(() => {
    store = new FakeStore();
  });

  it('creates the new members with declared memberships, skips the one already here, and numbers them in a block', async () => {
    const result = await commit({ csv: TEMPLATE, deskConsent: false });

    expect(result).toEqual({ importId: 'imp_1', created: 2, skipped: 1 });
    expect(store.inserted).toEqual([
      {
        gymId: 'gym_1',
        memberCode: 'MF-0101',
        fullName: 'Neha Gupta',
        mobile: '+919811122233',
        gender: 'FEMALE',
        dob: '1990-11-22',
        email: 'neha@example.com',
        isMinor: false,
        notes: 'Joined 01-08-2026',
        whatsappOptIn: false,
        createdById: 'staff_1',
        membership: { durationMonths: 1, startDate: '2026-08-19', endDate: '2026-09-18', pricePaise: 120_000 },
        whatsappConsent: null,
      },
      expect.objectContaining({
        memberCode: 'MF-0102',
        fullName: 'Amit Tyagi',
        notes: 'Joined 15-03-2024 · Pays by UPI',
        membership: { durationMonths: 12, startDate: '2026-03-16', endDate: '2027-03-15', pricePaise: 1_350_000 },
      }),
    ]);
  });

  it('turns WhatsApp on only when the owner confirms the members agreed at the desk, and records that consent', async () => {
    await commit({ csv: TEMPLATE, deskConsent: true });
    expect(store.inserted.every((record) => record.whatsappOptIn)).toBe(true);
    expect(store.inserted[0]?.whatsappConsent).toEqual({ noticeVersion: '1.0' });
  });

  it('marks a member under eighteen as a minor, and records no amount as zero rupees', async () => {
    await commit({ csv: csv('Kabir Singh,9800000001,M,01-01-2012,,1,30-09-2026,,,'), deskConsent: false });
    expect(store.inserted[0]).toMatchObject({ isMinor: true, membership: { pricePaise: 0 } });
  });

  it('audits the import by counts only — no name or number goes into the log', async () => {
    await commit({ csv: TEMPLATE, deskConsent: true });

    expect(store.audit).toEqual([
      {
        gymId: 'gym_1',
        actorType: 'staff',
        actorId: 'staff_1',
        action: 'member.import',
        entityType: 'Import',
        entityId: 'imp_1',
        after: { rows: 3, created: 2, skipped: 1, deskConsent: true },
      },
    ]);
    expect(JSON.stringify(store.audit)).not.toMatch(/Neha|9811122233/);
  });

  it('writes nothing when any row is wrong, and nothing when the file is refused', async () => {
    await expect(commit({ csv: `${TEMPLATE}\nBroken,123,M,,,,30-09-2026,,,`, deskConsent: false })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      meta: { lines: '5', count: 1 },
    });
    await expect(commit({ csv: '', deskConsent: false })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', meta: { file: 'empty' } });
    expect(store.inserted).toEqual([]);
    expect(store.audit).toEqual([]);
  });

  it('writes nothing, and says so, when every row is already a member', async () => {
    const result = await commit({ csv: csv('Sanjay Tomar,9876543210,M,,,,30-09-2026,,,'), deskConsent: false });
    expect(result).toEqual({ importId: 'imp_1', created: 0, skipped: 1 });
    expect(store.counter).toBe(100);
    expect(store.audit).toEqual([]);
  });

  it('needs the owner with a PIN entered a moment ago', async () => {
    await expect(commit({ csv: TEMPLATE, deskConsent: false }, ownerWithoutPin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(commit({ csv: TEMPLATE, deskConsent: false }, reception)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(store.inserted).toEqual([]);
  });
});
