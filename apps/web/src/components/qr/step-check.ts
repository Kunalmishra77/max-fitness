/**
 * Asking the server about one answer, where it is asked (ADR-121).
 *
 * Everything used to be checked when the whole form was sent: a member filled in eight
 * screens at a reception desk, pressed the button, and only then learnt the gym already
 * had them — with a queue behind and nothing to do but start again.
 *
 * **A refusal here never stops the submission from being checked again.** This is for
 * the member's benefit, not the register's: a browser can skip it, so the real guards
 * stay where they were.
 *
 * A check that cannot be made — offline, slow, a server having a bad minute — lets the
 * member through. Being unable to reach the gym must not be the same as being refused by
 * it, and the submission will catch anything this missed.
 */

export type StepVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: string;
      /** A warning the member can accept and move past, as a shared date of birth is. */
      readonly soft?: boolean;
      /** Only ever set for the face: their own record, because their face proved it. */
      readonly member?: { readonly fullName: string };
    };

export async function checkStep(fields: Record<string, string | Blob>): Promise<StepVerdict> {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);

  try {
    const response = await fetch('/api/v1/qr/check', { method: 'POST', body });
    if (!response.ok) return { ok: true };
    const json = (await response.json()) as { data?: StepVerdict };
    return json.data ?? { ok: true };
  } catch {
    return { ok: true };
  }
}
