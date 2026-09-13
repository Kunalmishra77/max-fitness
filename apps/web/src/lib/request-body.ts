/**
 * A small JSON body, read with a hard size limit (api-specification.md §1).
 *
 * Checkout bodies are a few hundred bytes. Reading as text first means an oversized
 * body is refused on length, before `JSON.parse` spends any time on it.
 */
export type JsonBodyResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly status: 400 | 413 };

export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBodyResult> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return { ok: false, status: 413 };

  const raw = await request.text();
  if (Buffer.byteLength(raw) > maxBytes) return { ok: false, status: 413 };

  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}
