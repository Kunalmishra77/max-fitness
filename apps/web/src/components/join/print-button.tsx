'use client';

/**
 * "Save or print this" (ADR-089).
 *
 * The member's own browser turns the page into a PDF, which is how they already save a
 * ticket or a bill — and it keeps their language, because the phone has the Devanagari font
 * and a server-rendered PDF would need one embedded. The button hides itself when printing,
 * so it does not appear on the paper.
 */
export function PrintButton({ label }: { readonly label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-button border-2 border-brand-obsidian px-5 py-3 text-body font-semibold text-brand-obsidian print:hidden"
    >
      {label}
    </button>
  );
}
