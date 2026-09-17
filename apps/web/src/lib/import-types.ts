/**
 * What the register import actions answer (crm-module-spec §7; ADR-056).
 *
 * Kept apart from the actions file, which may export only async functions, so the
 * wizard and the actions share one definition.
 */

export type ImportFileErrorCode = 'empty' | 'missing_columns' | 'too_many_rows' | 'unreadable' | 'too_large';

export interface ImportProblem {
  readonly line: number;
  /** Shown when the row could be read; a row with mistakes is identified by its line. */
  readonly name: string | null;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export type ImportPreviewResult =
  | {
      readonly ok: true;
      readonly summary: { readonly rows: number; readonly ready: number; readonly skipped: number; readonly withErrors: number };
      /** Rows with a mistake or a warning, at most 200 of them. */
      readonly problems: readonly ImportProblem[];
      readonly hiddenProblems: number;
    }
  | { readonly ok: false; readonly code: ImportFileErrorCode | 'FORBIDDEN' | 'INTERNAL'; readonly missing?: readonly string[] };

export type ImportCommitResult =
  | { readonly ok: true; readonly created: number; readonly skipped: number }
  | { readonly ok: false; readonly code: 'INVALID_PIN' | 'ACCOUNT_LOCKED' | 'FORBIDDEN' | 'ROWS_WRONG' | 'FILE' | 'INTERNAL' };

/** The largest register file accepted, checked in the browser and again on the server. */
export const MAX_IMPORT_BYTES = 1024 * 1024;
