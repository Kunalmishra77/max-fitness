import { IMPORT_COLUMNS } from '@mfp/core';
import { currentActor } from '@/lib/crm';

/**
 * `GET /crm/import/template` — the register template (crm-module-spec §7).
 *
 * The columns come from the parser itself, so the template can never drift from what
 * the import accepts. The example rows are made up. A byte-order mark goes first so a
 * spreadsheet opens Hindi names correctly; the parser ignores it.
 */

export const dynamic = 'force-dynamic';

const EXAMPLES = [
  'Sanjay Tomar,9876543210,M,14-02-1984,,3,30-09-2026,4000,05-06-2019,Morning batch',
  'नेहा गुप्ता,9811122233,F,22-11-1990,neha@example.com,1,18-09-2026,1200,01-08-2026,',
];

export async function GET() {
  if ((await currentActor()) === null) return new Response(null, { status: 401 });

  const body = `﻿${[IMPORT_COLUMNS.join(','), ...EXAMPLES].join('\r\n')}\r\n`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="max-register-import-template.csv"',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
