import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { PrismaGallery } from '@mfp/db';
import { getContainer } from '@/lib/container';

/**
 * `GET /api/v1/gallery/{id}` — a photo the gym put on its own website (ADR-091).
 *
 * Public on purpose, unlike every other file this app serves: a member's selfie is private and
 * goes out behind a five-minute signed URL, while a photo of the gym floor is an advertisement.
 * So this streams the bytes with a long cache and no token — but only for a **published** photo,
 * which is the one thing it checks.
 *
 * The id is the cache key. Replacing a photo creates a new row and a new id, so a changed
 * gallery is never a stale image.
 */

export const runtime = 'nodejs';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { prisma, storage } = getContainer();

  const key = await new PrismaGallery(prisma).storageKeyOf(id);
  if (key === null) return new NextResponse(null, { status: 404 });

  try {
    const bytes = await storage.get(key);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'content-type': 'image/jpeg',
        // Immutable because the id changes when the photo does.
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    // The row says it is there and the bucket disagrees: a 404 is the honest answer.
    return new NextResponse(null, { status: 404 });
  }
}
