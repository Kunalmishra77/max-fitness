import { RegistrationFieldsSchema, type RegistrationFields } from '@mfp/shared';

/**
 * Reading the `POST /registrations` multipart body (api-specification.md §3).
 *
 * Only the named parts are read, so a crafted extra part (`status`, `amountPaise`)
 * never reaches the schema, and the fields go through the same Zod schema the details
 * form uses in the browser (CLAUDE.md §2.3). The selfie comes back as raw bytes for
 * the image pipeline; nothing here trusts its declared type.
 */

export type RegistrationFormResult =
  | { readonly ok: true; readonly fields: RegistrationFields; readonly selfie: Uint8Array }
  | { readonly ok: false; readonly fields: Record<string, string> };

const TEXT_PARTS = ['fullName', 'mobile', 'email', 'dob', 'gender', 'language', 'noticeVersion'] as const;

function parseConsents(raw: FormDataEntryValue | null): unknown {
  if (typeof raw !== 'string') return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

export async function parseRegistrationForm(form: FormData): Promise<RegistrationFormResult> {
  const candidate: Record<string, unknown> = { consents: parseConsents(form.get('consents')) };
  for (const part of TEXT_PARTS) {
    const value = form.get(part);
    if (typeof value === 'string') candidate[part] = value;
  }

  const parsed = RegistrationFieldsSchema.safeParse(candidate);
  const selfiePart = form.get('selfie');
  const fields: Record<string, string> = {};

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [first, second] = issue.path;
      // Consent problems are reported per consent (`terms`, `privacy`), as the form shows them.
      const field = first === 'consents' ? (typeof second === 'string' ? second : 'terms') : String(first ?? 'form');
      fields[field] ??= issue.message;
    }
  }
  if (!(selfiePart instanceof Blob) || selfiePart.size === 0) {
    fields['selfie'] = 'selfie';
  }

  if (!parsed.success || Object.keys(fields).length > 0 || !(selfiePart instanceof Blob)) {
    return { ok: false, fields };
  }
  return { ok: true, fields: parsed.data, selfie: new Uint8Array(await selfiePart.arrayBuffer()) };
}
