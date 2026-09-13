/**
 * Serialise structured data for a `<script type="application/ld+json">`.
 *
 * `<` is escaped so a value containing `</script>` (an owner-edited promo line, say)
 * cannot close the tag early.
 */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
