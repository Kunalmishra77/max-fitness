import { IMPORT_COLUMNS } from '@mfp/core';
import { currentActor } from '@/lib/crm';

/**
 * `GET /crm/import/template` — the register template (crm-module-spec §7).
 *
 * The columns come from the parser itself, so the template can never drift from what
 * the import accepts. The example rows are made up. A byte-order mark goes first so a
 * spreadsheet opens Hindi names correctly; the parser ignores it.
 *
 * That mark was written as `FEFF` rather than `\uFEFF` — the four literal characters, not
 * the character. The first header therefore read `FEFFfull_name`, which the parser does
 * not recognise (it strips a real BOM by code point, `charCodeAt(0) === 0xfeff`), so
 * **the template this route handed the owner could not be imported back**. Round-tripped
 * in a test now, which is the check that was missing.
 */

export const dynamic = 'force-dynamic';

const EXAMPLES = [
  'Sanjay Tomar,9876543210,M,14-02-1984,,3,30-09-2026,4000,05-06-2019,Morning batch',
  'नेहा गुप्ता,9811122233,F,22-11-1990,neha@example.com,1,18-09-2026,1200,01-08-2026,',
];

export async function GET() {
  if ((await currentActor()) === null) return new Response(null, { status: 401 });

  const body = `\uFEFF${[IMPORT_COLUMNS.join(','), ...EXAMPLES].join('\r\n')}\r\n`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="max-register-import-template.csv"',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
