import { NextResponse, type NextRequest } from 'next/server';
import type { StorageDriver } from '@mfp/core/ports';
import { getContainer } from '@/lib/container';

/**
 * `GET /api/v1/files?key=&expires=&sig=` — a private object behind a signed URL
 * (api-specification.md §3; security-plan.md §3.1).
 *
 * Selfies are the most sensitive thing this system stores, so nothing is served from
 * the storage folder directly: the signature is checked first, the object is read by
 * key, and the response is private, uncached by shared caches and never indexed. An
 * expired or forged link is a plain 404 — it says nothing about whether the file exists.
 *
 * Only the local driver needs this route. With S3 the signed URL points at the bucket.
 *
 * The driver is recognised by its shape rather than `instanceof`: Next bundles a route
 * handler separately from the container module, so the same class arrives as two
 * different constructors and an `instanceof` check silently fails.
 */

interface SignedUrlVerifier {
  verifySignedUrl(key: string, expires: number, signature: string): boolean;
}

function verifiesSignedUrls(storage: StorageDriver): storage is StorageDriver & SignedUrlVerifier {
  return storage.name === 'local' && typeof (storage as Partial<SignedUrlVerifier>).verifySignedUrl === 'function';
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `prefix/object`, as `LocalStorageDriver` mints them. */
const STORAGE_KEY = /^[a-zA-Z0-9_-]+\/[A-Za-z0-9_-]{16,64}$/;

export async function GET(request: NextRequest) {
  const { storage, prisma } = getContainer();
  if (!verifiesSignedUrls(storage)) return new NextResponse(null, { status: 404 });

  const params = request.nextUrl.searchParams;
  const key = params.get('key') ?? '';
  const expires = Number(params.get('expires') ?? '0');
  const signature = params.get('sig') ?? '';

  if (!STORAGE_KEY.test(key) || !Number.isSafeInteger(expires) || signature === '') {
    return new NextResponse(null, { status: 404 });
  }
  if (!storage.verifySignedUrl(key, expires, signature)) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const media = await prisma.mediaFile.findFirst({
      where: { storageKey: key, deletedAt: null },
      select: { mimeType: true, sizeBytes: true },
    });
    if (media === null) return new NextResponse(null, { status: 404 });

    const bytes = await storage.get(key);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': media.mimeType,
        'Content-Length': String(media.sizeBytes),
        // Private and short-lived: the link itself expires within minutes.
        'Cache-Control': 'private, max-age=60',
        'X-Robots-Tag': 'noindex',
        'Referrer-Policy': 'no-referrer',
        'Content-Disposition': 'inline',
      },
    });
  } catch (error) {
    console.error(`[files] failed: ${error instanceof Error ? error.name : 'Error'}`);
    return new NextResponse(null, { status: 404 });
  }
}
