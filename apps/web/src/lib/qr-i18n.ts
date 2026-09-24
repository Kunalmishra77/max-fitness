/**
 * Which catalogues the reception-QR pages send to the browser.
 *
 * The QR pages do not ship the whole catalogue — a member at the desk is on gym wifi
 * and the CRM's strings are no use to them. The cost of choosing is that a client
 * component asking for a catalogue nobody listed renders its own key as the label,
 * which is what `/qr/existing` did in production: every question read
 * "qrExisting.fields.fullName".
 */
export const QR_CLIENT_NAMESPACES = ['qr', 'signup', 'qrExisting'] as const;

/** The catalogues above, picked out of the full set for `NextIntlClientProvider`. */
export function qrClientMessages(all: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const namespace of QR_CLIENT_NAMESPACES) picked[namespace] = all[namespace];
  return picked;
}
