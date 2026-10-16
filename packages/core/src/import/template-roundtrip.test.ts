import { describe, expect, it } from 'vitest';
import { istDate } from '@mfp/shared';
import { IMPORT_COLUMNS, parseMemberImport } from './member-import';

/**
 * The template the CRM hands the owner has to be importable (Phase 6.7).
 *
 * `/crm/import/template` built its byte-order mark as `` `FEFF${…}` `` — the four literal
 * characters rather than `\uFEFF`. The first header therefore read `FEFFfull_name`; the
 * parser strips a real BOM by code point (`charCodeAt(0) === 0xfeff`) and so did not strip
 * this, and the column was unrecognised. **The file the CRM produced could not be read
 * back by the CRM.**
 *
 * The route is a thin Next handler and the parser lives here, so the round trip is
 * asserted here, against the same `IMPORT_COLUMNS` the route writes out.
 */

const TODAY = istDate('2026-10-16');
const EXAMPLE = 'Sanjay Tomar,9876543210,M,14-02-1984,,3,30-09-2026,4000,05-06-2019,Morning batch';

/** Exactly what the route emits, including the mark and the CRLF line endings. */
const templateBody = (mark: string) => `${mark}${[IMPORT_COLUMNS.join(','), EXAMPLE].join('\r\n')}\r\n`;

describe('the import template round-trips', () => {
  it('parses with a real byte-order mark in front of the header', () => {
    const result = parseMemberImport(templateBody('\uFEFF'), { today: TODAY });

    expect(result.ok).toBe(true);
    const rows = result.ok ? result.rows : [];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.member?.fullName).toBe('Sanjay Tomar');
    expect(rows[0]?.member?.mobile).toBe('+919876543210');
    // The row the CRM wrote itself must come back with nothing to complain about.
    expect(rows[0]?.errors).toEqual([]);
  });

  it('parses identically with no mark at all', () => {
    const result = parseMemberImport(templateBody(''), { today: TODAY });
    const rows = result.ok ? result.rows : [];
    expect(rows[0]?.member?.fullName).toBe('Sanjay Tomar');
    expect(rows[0]?.errors).toEqual([]);
  });

  /**
   * The regression itself, asserted from the failure side: if somebody writes `FEFF`
   * again, the name column stops being recognised and this test fails — rather than the
   * owner finding out with a paper register open in front of them.
   */
  it('fails to find the name when the mark is four literal characters', () => {
    const result = parseMemberImport(templateBody('FEFF'), { today: TODAY });
    const rows = result.ok ? result.rows : [];
    const name = rows[0]?.member?.fullName;

    expect(name).not.toBe('Sanjay Tomar');
  });
});
